import { z, ZodTypeAny } from "zod";
import {
  ExtractHandler as IExtractHandler,
  ExtractOptions,
} from "../types/handlers";
import { LLMClient } from "../types/llm";
import { createLogger } from "../utils/logger";
import { WallCrawlerPage } from "../types/page";
import { DOMProcessor } from "../dom/processor";
import { ValidationError, TimeoutError } from "../types/errors";
import { transformSchema, injectUrls } from "../utils/schema-transform";
import { pageTextSchema } from "../types/page";

const logger = createLogger("extract");

export class ExtractHandler implements IExtractHandler {
  private domProcessor!: DOMProcessor;
  private wallCrawlerPage!: WallCrawlerPage;

  constructor(
    private llmClient: LLMClient
  ) {}

  init(wallCrawlerPage: WallCrawlerPage): void {
    this.wallCrawlerPage = wallCrawlerPage;
    this.domProcessor = new DOMProcessor(wallCrawlerPage);
  }

  async extract<T>(options?: ExtractOptions<T>): Promise<T> {
    // Handle no-arguments case like Stagehand - return page text
    if (!options || (!options.instruction && !options.schema)) {
      logger.info("Extracting entire page text");
      return this.extractPageText() as T;
    }

    const {
      instruction,
      schema,
      timeoutMs,
    } = options;

    if (!instruction || !schema) {
      throw new ValidationError(
        "Both instruction and schema are required for structured extraction",
        []
      );
    }

    logger.info("Extracting structured data", { instruction });

    const doExtract = async (): Promise<T> => {
      try {
        // Wait for DOM to settle
        await this.wallCrawlerPage._waitForSettledDom();

        // Transform schema to handle URL fields (Stagehand approach)
        const [transformedSchema, urlPaths] = transformSchema(schema);

        // Get accessibility tree content like Stagehand
        const { content, urlMapping } = await this.getAccessibilityContent();

        // Build extraction prompt
        const prompt = this.buildExtractionPrompt(instruction, content);

        // Two-phase extraction like Stagehand
        const extractedData = await this.performExtraction(prompt, transformedSchema);
        const metadata = await this.extractMetadata(instruction, extractedData);

        // Post-process to restore URLs
        for (const { segments } of urlPaths) {
          injectUrls(extractedData, segments, urlMapping);
        }

        // Validate against original schema
        const validated = schema.parse(extractedData);

        logger.info("Data extracted successfully", {
          instruction,
          completed: metadata.completed,
          fields: Object.keys(validated as any),
        });

        return validated;
      } catch (error) {
        logger.error("Failed to extract data", error, { instruction });

        if (error instanceof z.ZodError) {
          throw new ValidationError(
            "Extracted data failed schema validation",
            error.errors
          );
        }

        throw error;
      }
    };

    // If no timeout specified, execute directly
    if (!timeoutMs) {
      return doExtract();
    }

    // Race extract against timeout
    return await Promise.race([
      doExtract(),
      new Promise<T>((_, reject) => {
        setTimeout(() => {
          logger.error("Extract operation timed out", {
            timeoutMs,
            instruction,
          });
          reject(
            new TimeoutError(
              `Extract operation timed out after ${timeoutMs}ms`,
              "extract",
              timeoutMs
            )
          );
        }, timeoutMs);
      }),
    ]);
  }

  private async extractPageText(): Promise<{ page_text: string }> {
    await this.wallCrawlerPage._waitForSettledDom();
    
    const dom = await this.domProcessor.getProcessedDOM({
      includeAccessibility: true,
      maxElements: 1000,
    });

    logger.info("Getting accessibility tree data for page text extraction");
    const outputString = dom.accessibility.simplified;

    const result = { page_text: outputString };
    return pageTextSchema.parse(result);
  }

  private async getAccessibilityContent(): Promise<{ content: string; urlMapping: Record<number, string> }> {
    const dom = await this.domProcessor.getProcessedDOM({
      includeAccessibility: true,
      maxElements: 1000,
    });

    // Collect URLs using DOM processor's built-in URL mapping
    const urlMapping: Record<number, string> = {};
    
    // Get URLs from the DOM processor's URL map if available
    if (dom.accessibility.idToUrl) {
      Object.entries(dom.accessibility.idToUrl).forEach(([, url], index) => {
        urlMapping[index] = url;
      });
    }

    // Build content using accessibility tree (like Stagehand)
    const content = dom.accessibility.simplified;

    logger.info("Getting accessibility tree data for extraction");

    return { content, urlMapping };
  }


  private buildExtractionPrompt(
    instruction: string,
    content: string
  ): string {
    return `Extract the following information from the page:\n\n${instruction}\n\nPage content:\n${content}`;
  }

  private async performExtraction<T>(
    prompt: string,
    schema: ZodTypeAny
  ): Promise<T> {
    const extractStartTime = Date.now();
    
    const response = await this.llmClient.generateObject({
      prompt,
      schema,
      temperature: 0.1, // Low temperature for consistent extraction
    });
    
    const extractEndTime = Date.now();
    logger.debug("Extraction inference completed", {
      inferenceTimeMs: extractEndTime - extractStartTime,
    });
    
    return response;
  }

  private async extractMetadata(
    instruction: string,
    extractedData: any
  ): Promise<{ progress: string; completed: boolean }> {
    const metadataSchema = z.object({
      progress: z
        .string()
        .describe("progress of what has been extracted so far, as concise as possible"),
      completed: z
        .boolean()
        .describe("true if the goal is now accomplished. Use this conservatively, only when sure that the goal has been completed."),
    });

    const metadataPrompt = `Based on the instruction "${instruction}" and the extracted data below, provide metadata about the extraction:\n\nExtracted data: ${JSON.stringify(extractedData, null, 2)}`;

    const metadataStartTime = Date.now();
    
    const metadata = await this.llmClient.generateObject({
      prompt: metadataPrompt,
      schema: metadataSchema,
      temperature: 0.1,
    });
    
    const metadataEndTime = Date.now();
    logger.debug("Metadata extraction completed", {
      inferenceTimeMs: metadataEndTime - metadataStartTime,
      progress: metadata.progress,
      completed: metadata.completed,
    });
    
    return metadata;
  }
}
