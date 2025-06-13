import { chromium, Browser, Page } from "playwright";
import {
  InfrastructureProvider,
  BrowserConfig,
  BrowserState,
  StateReference,
  Checkpoint,
  CheckpointReference,
  Artifact,
  ArtifactReference,
  InterventionEvent,
  InterventionSession,
  InterventionResult,
  Metric,
  MetricQuery,
  WallCrawlerConfig,
  WallCrawlerPage,
  createWallCrawlerPage,
  DefaultCDPSessionManager,
  LLMClientFactory,
  createLogger,
} from "wallcrawler";
import * as fs from "fs/promises";
import * as path from "path";

const logger = createLogger("local-provider");

/**
 * Local development provider for WallCrawler
 * Stores artifacts and state in the local filesystem
 */
export class LocalProvider implements InfrastructureProvider {
  private browsers: Map<string, Browser> = new Map();
  private pages: Map<string, Page> = new Map();
  private cdpSessionManager = new DefaultCDPSessionManager();
  private config: WallCrawlerConfig;
  private storageDir: string;

  constructor(config: WallCrawlerConfig, storageDir: string = ".wallcrawler") {
    this.config = config;
    this.storageDir = storageDir;
    this.ensureStorageDir();
  }

  private async ensureStorageDir(): Promise<void> {
    const dirs = [
      this.storageDir,
      path.join(this.storageDir, "states"),
      path.join(this.storageDir, "checkpoints"),
      path.join(this.storageDir, "artifacts"),
      path.join(this.storageDir, "cache"),
    ];

    for (const dir of dirs) {
      await fs.mkdir(dir, { recursive: true });
    }
  }

  async createBrowser(config: BrowserConfig): Promise<WallCrawlerPage> {
    logger.info("Creating local browser", { sessionId: config.sessionId });

    const browser = await chromium.launch({
      headless: config.headless ?? false,
      ...(config.timeout ? { timeout: config.timeout } : {}),
    });

    const context = await browser.newContext({
      viewport: config.viewport || null,
      ...(config.userAgent ? { userAgent: config.userAgent } : {}),
      ...(config.locale ? { locale: config.locale } : {}),
      ...(config.timezone ? { timezoneId: config.timezone } : {}),
    });

    const page = await context.newPage();

    // Store references
    const sessionId = config.sessionId || this.generateSessionId();
    this.browsers.set(sessionId, browser);
    this.pages.set(sessionId, page);

    // Create CDP session
    const cdpSession = await this.cdpSessionManager.createSession(page);

    // Enable required CDP domains
    await this.cdpSessionManager.enableDomains(cdpSession, [
      "Runtime",
      "Network",
      "Page",
      "DOM",
      "Accessibility",
    ]);

    // Create LLM client
    const llmClient = LLMClientFactory.create(this.config.llm);

    // Create enhanced page with proxy
    const wallcrawlerPage = createWallCrawlerPage(
      page,
      cdpSession,
      llmClient,
      this.config,
      sessionId,
      this // Pass this provider for intervention support
    );

    logger.info("Local browser created", { sessionId });

    return wallcrawlerPage;
  }

  async destroyBrowser(sessionId: string): Promise<void> {
    logger.info("Destroying local browser", { sessionId });

    const browser = this.browsers.get(sessionId);
    if (browser) {
      await browser.close();
      this.browsers.delete(sessionId);
      this.pages.delete(sessionId);
    }
  }

  async saveState(state: BrowserState): Promise<StateReference> {
    const filename = `${state.sessionId}-${Date.now()}.json`;
    const filepath = path.join(this.storageDir, "states", filename);

    await fs.writeFile(filepath, JSON.stringify(state, null, 2));
    logger.info("State saved locally", {
      sessionId: state.sessionId,
      filepath,
    });

    return {
      sessionId: state.sessionId,
      bucket: "local",
      key: filepath,
    };
  }

  async loadState(reference: StateReference): Promise<BrowserState> {
    const data = await fs.readFile(reference.key, "utf-8");
    const state = JSON.parse(data);
    logger.info("State loaded from local storage", {
      sessionId: state.sessionId,
    });
    return state;
  }

  async saveCheckpoint(checkpoint: Checkpoint): Promise<CheckpointReference> {
    const filename = `${checkpoint.sessionId}-${checkpoint.timestamp}.json`;
    const filepath = path.join(this.storageDir, "checkpoints", filename);

    await fs.writeFile(filepath, JSON.stringify(checkpoint, null, 2));
    logger.info("Checkpoint saved locally", {
      sessionId: checkpoint.sessionId,
      timestamp: checkpoint.timestamp,
    });

    return {
      sessionId: checkpoint.sessionId,
      bucket: "local",
      key: filepath,
      timestamp: checkpoint.timestamp,
    };
  }

  async loadCheckpoint(reference: CheckpointReference): Promise<Checkpoint> {
    const data = await fs.readFile(reference.key, "utf-8");
    const checkpoint = JSON.parse(data);
    logger.info("Checkpoint loaded from local storage", {
      sessionId: checkpoint.sessionId,
    });
    return checkpoint;
  }

  async saveArtifact(artifact: Artifact): Promise<ArtifactReference> {
    const timestamp = Date.now();
    const extension = this.getFileExtension(artifact.type);
    const filename = `${artifact.metadata.sessionId}-${artifact.type}-${timestamp}.${extension}`;
    const filepath = path.join(this.storageDir, "artifacts", filename);

    if (typeof artifact.data === "string") {
      await fs.writeFile(filepath, artifact.data);
    } else {
      await fs.writeFile(filepath, artifact.data);
    }

    logger.info("Artifact saved locally", { type: artifact.type, filepath });

    return {
      sessionId: artifact.metadata.sessionId,
      bucket: "local",
      key: filepath,
      type: artifact.type,
      contentType: this.getContentType(artifact.type),
    };
  }

  async loadArtifact(reference: ArtifactReference): Promise<Artifact> {
    const data =
      reference.type === "dom" || reference.type === "trace"
        ? await fs.readFile(reference.key, "utf-8")
        : await fs.readFile(reference.key);

    logger.info("Artifact loaded from local storage", {
      type: reference.type,
      key: reference.key,
    });

    return {
      type: reference.type,
      data,
      metadata: {},
    };
  }

  async handleIntervention(
    event: InterventionEvent
  ): Promise<InterventionSession> {
    logger.warn("Intervention requested in local mode", { type: event.type });

    // In local mode, just log and return a mock session
    console.log("\n⚠️  INTERVENTION REQUIRED ⚠️");
    console.log(`Type: ${event.type}`);
    console.log(`URL: ${event.url}`);
    console.log(`Description: ${event.description}`);
    console.log(
      "\nPlease complete the required action manually in the browser window.\n"
    );

    return {
      sessionId: event.sessionId,
      interventionId: `local-${Date.now()}`,
      portalUrl: "http://localhost:3000/intervention",
      expiresAt: Date.now() + 900000, // 15 minutes
    };
  }

  async waitForIntervention(sessionId: string): Promise<InterventionResult> {
    logger.info("Waiting for manual intervention completion", { sessionId });

    // In local mode, wait for user to press Enter
    console.log("Press Enter when you have completed the intervention...");

    await new Promise<void>((resolve) => {
      process.stdin.once("data", () => {
        resolve();
      });
    });

    return {
      completed: true,
      action: "manual",
      data: {},
    };
  }

  async recordMetric(metric: Metric): Promise<void> {
    logger.debug("Metric recorded", metric);
    // In local mode, just log metrics
  }

  async getMetrics(query: MetricQuery): Promise<Metric[]> {
    logger.debug("Metrics query", query);
    // In local mode, return empty array
    return [];
  }

  // Cache implementation using local filesystem
  async cacheGet(key: string): Promise<any | null> {
    try {
      const filepath = path.join(this.storageDir, "cache", `${key}.json`);
      const data = await fs.readFile(filepath, "utf-8");
      const cached = JSON.parse(data);

      if (cached.expiresAt > Date.now()) {
        logger.debug("Cache hit", { key });
        return cached.value;
      }

      // Clean up expired cache
      await fs.unlink(filepath).catch(() => {});
    } catch (error) {
      // Cache miss
    }

    logger.debug("Cache miss", { key });
    return null;
  }

  async cacheSet(key: string, value: any, ttl: number): Promise<void> {
    const filepath = path.join(this.storageDir, "cache", `${key}.json`);
    const cached = {
      value,
      expiresAt: Date.now() + ttl * 1000,
    };

    await fs.writeFile(filepath, JSON.stringify(cached, null, 2));
    logger.debug("Cache set", { key, ttl });
  }

  // Helper methods
  private generateSessionId(): string {
    return `local-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  }

  private getFileExtension(type: Artifact["type"]): string {
    switch (type) {
      case "screenshot":
        return "png";
      case "dom":
        return "json";
      case "video":
        return "webm";
      case "trace":
        return "json";
      default:
        return "bin";
    }
  }

  private getContentType(type: Artifact["type"]): string {
    switch (type) {
      case "screenshot":
        return "image/png";
      case "dom":
        return "application/json";
      case "video":
        return "video/webm";
      case "trace":
        return "application/json";
      default:
        return "application/octet-stream";
    }
  }
}