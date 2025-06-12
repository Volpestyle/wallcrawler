import { z } from "zod";
import {
  ObserveHandler as IObserveHandler,
  ObserveResult,
} from "../types/handlers";
import { LLMClient } from "../types/llm";
import { WallCrawlerConfig } from "../types/config";
import { createLogger } from "../utils/logger";
import { WallCrawlerPage } from "../types/page";
import { DOMProcessor } from "../dom/processor";
import { drawObserveOverlay } from "../utils/overlay";

const logger = createLogger("observe");

// Create schema factory like Stagehand does
const createObserveElementSchema = (returnAction: boolean) => {
  const baseSchema = {
    elementId: z
      .string()
      .describe("the ID string associated with the element. Never include surrounding square brackets. This field must follow the format of 'number-number'."),
    description: z
      .string()
      .describe("A brief description of the component and what action can be taken on it. Keep this short and concise."),
  };

  if (returnAction) {
    return z.object({
      ...baseSchema,
      method: z
        .string()
        .describe("The suggested method to interact with the element. Valid methods are: click, type, check, uncheck, select, navigate, scroll, press. If no interaction is possible, return 'none'."),
      arguments: z
        .array(z.any())
        .describe("An array of arguments for the method. For 'type', this is the text to type. For 'select', this is the value of the option to select. For 'scroll', this is ['up', 'down', 'left', 'right', 'top', 'bottom', 'near', 'far']. For 'press', this is the key to press."),
    });
  }

  return z.object(baseSchema);
};

const createObserveResultSchema = (returnAction: boolean) => z.object({
  elements: z.array(createObserveElementSchema(returnAction)).describe("an array of accessible elements that match the instruction"),
});

export class ObserveHandler implements IObserveHandler {
  private domProcessor!: DOMProcessor;
  private wallCrawlerPage!: WallCrawlerPage;

  constructor(
    private llmClient: LLMClient,
    private config: WallCrawlerConfig
  ) {}

  init(wallCrawlerPage: WallCrawlerPage): void {
    this.wallCrawlerPage = wallCrawlerPage;
    this.domProcessor = new DOMProcessor(wallCrawlerPage);
  }

  async observe(
    instruction?: string,
    options: {
      returnAction?: boolean;
      drawOverlay?: boolean;
      fromAct?: boolean;
      iframes?: boolean;
    } = {}
  ): Promise<ObserveResult[]> {
    const {
      returnAction = true,
      drawOverlay = false,
      fromAct = false,
      iframes = false,
    } = options;

    if (!instruction) {
      instruction = `Find elements that can be used for any future actions in the page. These may be navigation links, related pages, section/subsection links, buttons, or other interactive elements. Be comprehensive: if there are multiple elements that may be relevant for future actions, return all of them.`;
    }

    logger.info("Starting observation", { instruction, returnAction, fromAct });

    try {
      // Wait for DOM to settle
      await this.wallCrawlerPage._waitForSettledDom();

      // Get accessibility tree data like Stagehand
      logger.info("Getting accessibility tree data");
      const domState = await this.domProcessor.getProcessedDOM({
        includeAccessibility: true,
        maxElements: 1000,
      });

      const accessibilityContent = domState.accessibility.simplified;
      const xpathMap = domState.accessibility.xpathMap || {};

      // Perform observation inference like Stagehand
      const observationResponse = await this.performObservation(
        instruction,
        accessibilityContent,
        returnAction,
        fromAct
      );

      // Map element IDs to ObserveResults using xpath map
      const results = this.mapElementsToResults(
        observationResponse.elements,
        xpathMap,
        returnAction
      );

      logger.info("Observation finished", {
        instruction,
        resultCount: results.length,
      });

      // Draw overlay if requested
      if (drawOverlay) {
        await drawObserveOverlay(this.wallCrawlerPage, results);
      }

      return results;
    } catch (error) {
      logger.error("Failed to observe page", {
        error: (error as Error).message,
        instruction,
      });
      throw error;
    }
  }

  private async performObservation(
    instruction: string,
    accessibilityContent: string,
    returnAction: boolean,
    fromAct: boolean
  ): Promise<{ elements: any[]; prompt_tokens: number; completion_tokens: number; inference_time_ms: number }> {
    const observeSchema = createObserveResultSchema(returnAction);
    
    const prompt = this.buildObservationPrompt(instruction, accessibilityContent, returnAction, fromAct);
    
    const startTime = Date.now();
    
    const response = await this.llmClient.generateObject({
      prompt,
      schema: observeSchema,
      temperature: 0.1, // Lower temperature for consistency like Stagehand
    });
    
    const endTime = Date.now();
    
    logger.debug("Observation inference completed", {
      inferenceTimeMs: endTime - startTime,
      elementCount: response.elements?.length || 0,
    });
    
    return {
      elements: response.elements || [],
      prompt_tokens: 0, // TODO: Add token tracking like Stagehand
      completion_tokens: 0,
      inference_time_ms: endTime - startTime,
    };
  }

  private buildObservationPrompt(
    instruction: string,
    accessibilityContent: string,
    returnAction: boolean,
    fromAct: boolean
  ): string {
    // Build prompt similar to Stagehand's approach
    let prompt = `Analyze this web page and identify interactive elements.\n\nAccessibility tree:\n${accessibilityContent}`;
    
    if (instruction) {
      prompt += `\n\nFocus on elements that are relevant to: ${instruction}`;
    }
    
    if (returnAction) {
      prompt += `\n\nFor each relevant element, provide:\n1. The element ID (elementId) - use the exact ID from the accessibility tree\n2. A brief description of what the element does\n3. The suggested method to interact with it\n4. Any arguments needed for the method`;
      
      if (fromAct) {
        prompt += `\n\nFocus on finding the SINGLE BEST element that matches the user's intent.`;
      } else {
        prompt += `\n\nReturn multiple relevant elements if appropriate.`;
      }
    } else {
      prompt += `\n\nFor each relevant element, provide:\n1. The element ID (elementId) - use the exact ID from the accessibility tree\n2. A brief description of what the element does`;
    }
    
    return prompt;
  }

  private mapElementsToResults(
    elements: any[],
    xpathMap: Record<string, string>,
    returnAction: boolean
  ): ObserveResult[] {
    return elements.map((element) => {
      const { elementId, description, method, arguments: args } = element;
      
      // Get xpath from the xpath map using the elementId
      const xpath = xpathMap[elementId] || `//*[@data-element-id='${elementId}']`;
      
      const result: ObserveResult = {
        selector: `xpath=${xpath}`,
        description: String(description),
        backendNodeId: this.extractBackendNodeId(elementId),
      };
      
      if (returnAction && method) {
        result.method = String(method);
        result.arguments = Array.isArray(args) ? args.map(String) : [];
      }
      
      return result;
    }).filter(Boolean);
  }

  private extractBackendNodeId(elementId: string): number | undefined {
    // ElementId format is "frameId-backendNodeId" or just "backendNodeId"
    const parts = elementId.split('-');
    const backendNodeIdStr = parts[parts.length - 1];
    const backendNodeId = parseInt(backendNodeIdStr, 10);
    return isNaN(backendNodeId) ? undefined : backendNodeId;
  }
}
