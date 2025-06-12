import { z } from "zod";
import { LLMClient } from "../types/llm";
import { WallCrawlerPage } from "../types/page";
import { 
  InterventionEvent, 
  InterventionType, 
  InterventionContext,
  ActionHistoryItem 
} from "../types/infrastructure";
import { createLogger } from "../utils/logger";
import { DOMProcessor } from "../dom/processor";

const logger = createLogger("intervention-detector");

// Schema for LLM intervention detection response
const InterventionDetectionSchema = z.object({
  interventionRequired: z.boolean().describe("Whether human intervention is required"),
  confidence: z.number().min(0).max(1).describe("Confidence level of the assessment (0-1)"),
  interventionType: z.enum(["captcha", "2fa", "login", "consent", "payment", "custom", "none"])
    .describe("Type of intervention required"),
  reason: z.string().describe("Clear explanation of why intervention is needed"),
  suggestedAction: z.string().optional().describe("Suggested action for the human to take"),
  urgency: z.enum(["low", "medium", "high"]).describe("Urgency level of the intervention"),
  blockerElements: z.array(z.string()).optional().describe("Selectors of elements causing the block"),
});

type InterventionDetectionResult = z.infer<typeof InterventionDetectionSchema>;

/**
 * LLM-powered intervention detection system.
 * 
 * Uses natural language understanding to detect when human intervention
 * is required, rather than relying on brittle heuristics.
 */
export class InterventionDetector {
  private domProcessor?: DOMProcessor;

  constructor(
    private llmClient: LLMClient,
    private sessionId: string
  ) {}

  /**
   * Analyze the current page state to detect if intervention is needed.
   * Uses LLM reasoning to understand context and determine intervention requirements.
   */
  async detectIntervention(
    page: WallCrawlerPage,
    actionHistory: ActionHistoryItem[] = [],
    errorContext?: string
  ): Promise<InterventionEvent | null> {
    try {
      logger.info("Starting intervention detection", { 
        url: page.url(), 
        sessionId: this.sessionId 
      });

      // Initialize DOM processor if needed
      if (!this.domProcessor) {
        this.domProcessor = new DOMProcessor(page);
      }

      // Gather comprehensive page context
      const context = await this.gatherPageContext(page, actionHistory, errorContext);
      
      // Use LLM to analyze for intervention needs
      const detection = await this.performLLMDetection(context);
      
      if (!detection.interventionRequired || detection.interventionType === "none") {
        logger.debug("No intervention required", { confidence: detection.confidence });
        return null;
      }

      // Create intervention event with rich context
      const interventionEvent = await this.createInterventionEvent(
        page,
        detection,
        context,
        actionHistory
      );

      logger.info("Intervention detected", {
        type: interventionEvent.type,
        confidence: detection.confidence,
        reason: detection.reason,
      });

      return interventionEvent;

    } catch (error) {
      logger.error("Failed to detect intervention", {
        error: (error as Error).message,
        sessionId: this.sessionId,
      });
      return null;
    }
  }

  /**
   * Gather comprehensive context about the current page state.
   */
  private async gatherPageContext(
    page: WallCrawlerPage,
    actionHistory: ActionHistoryItem[],
    errorContext?: string
  ): Promise<InterventionContext> {
    const title = await page.title().catch(() => "Unknown");
    const url = page.url();
    const viewport = await page.viewportSize();

    // Get accessibility tree for LLM analysis
    let accessibilityTree: string | undefined;
    try {
      const domState = await this.domProcessor!.getProcessedDOM({
        includeAccessibility: true,
        maxElements: 500, // Limit for intervention detection
      });
      accessibilityTree = domState.accessibility.simplified;
    } catch (error) {
      logger.warn("Failed to get accessibility tree", { error: (error as Error).message });
    }

    return {
      pageTitle: title,
      currentUrl: url,
      accessibilityTree,
      actionHistory,
      lastAction: actionHistory[actionHistory.length - 1],
      errorMessage: errorContext,
      confidence: 0, // Will be set by LLM
      detectionReason: "", // Will be set by LLM
      timestamp: Date.now(),
      viewport: viewport ? { width: viewport.width, height: viewport.height } : undefined,
      metadata: {},
    };
  }

  /**
   * Use LLM to analyze the page context and detect intervention needs.
   */
  private async performLLMDetection(
    context: InterventionContext
  ): Promise<InterventionDetectionResult> {
    const prompt = this.buildDetectionPrompt(context);

    logger.debug("Performing LLM intervention detection");

    const result = await this.llmClient.generateObject({
      prompt,
      schema: InterventionDetectionSchema,
      temperature: 0.1, // Low temperature for consistent detection
    });

    return result;
  }

  /**
   * Build a comprehensive prompt for LLM intervention detection.
   */
  private buildDetectionPrompt(context: InterventionContext): string {
    const { 
      pageTitle, 
      currentUrl, 
      accessibilityTree, 
      actionHistory, 
      lastAction, 
      errorMessage 
    } = context;

    let prompt = `Analyze this web page to determine if human intervention is required.

Page Context:
- URL: ${currentUrl}
- Title: ${pageTitle}
- Timestamp: ${new Date(context.timestamp).toISOString()}`;

    if (accessibilityTree) {
      prompt += `\n\nPage Content (Accessibility Tree):\n${accessibilityTree.substring(0, 3000)}`;
    }

    if (actionHistory.length > 0) {
      prompt += `\n\nRecent Actions:`;
      actionHistory.slice(-5).forEach((action, i) => {
        const status = action.success === false ? "FAILED" : "SUCCESS";
        prompt += `\n${i + 1}. ${action.action} - ${status}`;
        if (action.error) {
          prompt += ` (Error: ${action.error})`;
        }
      });
    }

    if (lastAction && lastAction.success === false) {
      prompt += `\n\nLast Action Failed:
- Action: ${lastAction.action}
- Error: ${lastAction.error || "Unknown error"}`;
    }

    if (errorMessage) {
      prompt += `\n\nError Context: ${errorMessage}`;
    }

    prompt += `\n\nAnalysis Instructions:
Look for scenarios that require human intervention:

1. **CAPTCHA/Verification**: Visual puzzles, "I'm not a robot" challenges, image selection tasks
2. **Authentication**: Login forms requiring sensitive credentials (username/password)
3. **Two-Factor Authentication**: SMS codes, authenticator apps, security keys
4. **Payment Forms**: Credit card details, billing information, payment confirmation
5. **Consent/Legal**: Cookie consent, terms acceptance, age verification
6. **Security Blocks**: "Suspicious activity" warnings, account verification required

Consider these factors:
- Are there form fields asking for sensitive information?
- Did automated actions fail due to security measures?
- Are there visual challenges or verification steps?
- Is the page blocking automated access?
- Are there elements suggesting human verification is needed?

Provide assessment with high confidence only when clearly needed.
Avoid false positives - prefer manual handling over automated mistakes.`;

    return prompt;
  }

  /**
   * Create a detailed intervention event from the detection results.
   */
  private async createInterventionEvent(
    page: WallCrawlerPage,
    detection: InterventionDetectionResult,
    context: InterventionContext,
    actionHistory: ActionHistoryItem[]
  ): Promise<InterventionEvent> {
    // Take screenshot for intervention context
    let screenshot: Buffer | undefined;
    try {
      screenshot = await page.screenshot({ type: "png" });
    } catch (error) {
      logger.warn("Failed to capture screenshot", { error: (error as Error).message });
    }

    // Update context with detection results
    context.confidence = detection.confidence;
    context.detectionReason = detection.reason;
    context.suggestedAction = detection.suggestedAction;
    context.metadata.urgency = detection.urgency;
    context.metadata.blockerElements = detection.blockerElements;

    return {
      type: detection.interventionType as InterventionType,
      sessionId: this.sessionId,
      url: context.currentUrl,
      screenshot,
      description: this.generateHumanReadableDescription(detection, context),
      context,
    };
  }

  /**
   * Generate a clear, human-readable description of the intervention needed.
   */
  private generateHumanReadableDescription(
    detection: InterventionDetectionResult,
    context: InterventionContext
  ): string {
    const urgencyPrefix = detection.urgency === "high" ? "URGENT: " : "";
    
    let description = `${urgencyPrefix}${detection.reason}`;
    
    if (detection.suggestedAction) {
      description += `\n\nSuggested Action: ${detection.suggestedAction}`;
    }

    if (context.lastAction && context.lastAction.success === false) {
      description += `\n\nTriggered by failed action: ${context.lastAction.action}`;
    }

    description += `\n\nPage: ${context.pageTitle}`;
    description += `\nURL: ${context.currentUrl}`;
    description += `\nConfidence: ${Math.round(detection.confidence * 100)}%`;

    return description;
  }
}