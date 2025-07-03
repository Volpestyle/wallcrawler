import { chromium, BrowserContext } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  IBrowserProvider,
  ProviderType,
  ProviderSession,
  SessionCreateParams,
  BrowserConnectionResult,
  Artifact,
  ArtifactList,
  LogLine,
  Stagehand,
} from '@wallcrawler/stagehand';

export interface LocalProviderConfig {
  /** Local browser launch options */
  browserLaunchOptions?: Record<string, unknown>;
  /** Run in headless mode */
  headless?: boolean;
  /** Path to store artifacts */
  artifactsPath?: string;
  /** Logging function */
  logger?: (logLine: LogLine) => void;
}

export interface SessionState {
  stagehand?: Stagehand;
  lastUsed: number;
  currentModel?: string;
}

/**
 * Local browser provider for running browsers on the local machine
 * Handles browser launching, session management, and local artifact storage
 */
export class LocalProvider implements IBrowserProvider {
  public readonly type: ProviderType = 'local';
  public readonly name: string = 'Local Browser Provider';

  private readonly config: LocalProviderConfig;
  private readonly artifactsPath: string;
  private readonly sessions: Map<string, ProviderSession> = new Map();
  private readonly sessionState: Map<string, SessionState> = new Map();

  constructor(config: LocalProviderConfig = {}) {
    this.config = config;
    this.artifactsPath = config.artifactsPath || path.join(os.tmpdir(), 'wallcrawler-artifacts');

    // Ensure artifacts directory exists
    if (!fs.existsSync(this.artifactsPath)) {
      fs.mkdirSync(this.artifactsPath, { recursive: true });
    }
  }

  private log(logLine: Omit<LogLine, 'category'>): void {
    if (this.config.logger) {
      this.config.logger({
        category: 'local-provider',
        ...logLine,
      });
    }
  }

  /**
   * Create a new browser session
   */
  async createSession(params?: SessionCreateParams): Promise<ProviderSession> {
    const sessionId = this.generateSessionId();

    this.log({
      message: 'creating new local browser session',
      level: 1,
      auxiliary: {
        sessionId: { value: sessionId, type: 'string' },
      },
    });

    const session: ProviderSession = {
      sessionId,
      provider: this.type,
      metadata: {
        ...params?.userMetadata,
        createdAt: new Date().toISOString(),
        artifactsPath: path.join(this.artifactsPath, sessionId),
      },
    };

    // Create session artifacts directory
    const sessionArtifactsPath = path.join(this.artifactsPath, sessionId);
    if (!fs.existsSync(sessionArtifactsPath)) {
      fs.mkdirSync(sessionArtifactsPath, { recursive: true });
    }

    this.sessions.set(sessionId, session);

    this.log({
      message: 'local browser session created',
      level: 1,
      auxiliary: {
        sessionId: { value: sessionId, type: 'string' },
      },
    });

    return session;
  }

  /**
   * Resume an existing session
   */
  async resumeSession(sessionId: string): Promise<ProviderSession> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    this.log({
      message: 'resuming local browser session',
      level: 1,
      auxiliary: {
        sessionId: { value: sessionId, type: 'string' },
      },
    });

    return session;
  }

  /**
   * Connect to a browser instance
   */
  async connectToBrowser(session: ProviderSession): Promise<BrowserConnectionResult> {
    this.log({
      message: 'launching local browser',
      level: 1,
      auxiliary: {
        sessionId: { value: session.sessionId, type: 'string' },
        headless: {
          value: (this.config.headless || false).toString(),
          type: 'boolean',
        },
      },
    });

    const userDataDir = path.join(os.tmpdir(), `wallcrawler-${session.sessionId}`);

    // Launch browser with stealth options
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: this.config.headless || false,
      viewport: { width: 1280, height: 720 },
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      ...this.config.browserLaunchOptions,
    });

    // Apply stealth scripts
    await this.applyStealthScripts(context);

    // Get browser instance
    const browser = context.browser()!;

    this.log({
      message: 'local browser launched successfully',
      level: 1,
      auxiliary: {
        sessionId: { value: session.sessionId, type: 'string' },
        contextPath: { value: userDataDir, type: 'string' },
      },
    });

    return {
      browser,
      session,
      contextPath: userDataDir,
    };
  }

  /**
   * End a browser session
   */
  async endSession(sessionId: string): Promise<void> {
    this.log({
      message: 'ending local browser session',
      level: 1,
      auxiliary: {
        sessionId: { value: sessionId, type: 'string' },
      },
    });

    this.sessions.delete(sessionId);

    this.log({
      message: 'local browser session ended',
      level: 1,
      auxiliary: {
        sessionId: { value: sessionId, type: 'string' },
      },
    });
  }

  /**
   * Save an artifact to local storage
   */
  async saveArtifact(sessionId: string, filePath: string, data: Buffer): Promise<Artifact> {
    const artifactId = this.generateArtifactId();
    const fileName = path.basename(filePath);
    const sessionArtifactsPath = path.join(this.artifactsPath, sessionId);
    const artifactPath = path.join(sessionArtifactsPath, `${artifactId}_${fileName}`);

    // Ensure session artifacts directory exists
    if (!fs.existsSync(sessionArtifactsPath)) {
      fs.mkdirSync(sessionArtifactsPath, { recursive: true });
    }

    this.log({
      message: 'saving artifact to local storage',
      level: 1,
      auxiliary: {
        sessionId: { value: sessionId, type: 'string' },
        artifactId: { value: artifactId, type: 'string' },
        fileName: { value: fileName, type: 'string' },
        size: { value: data.length.toString(), type: 'integer' },
      },
    });

    // Write file to disk
    fs.writeFileSync(artifactPath, data);

    const artifact: Artifact = {
      id: artifactId,
      name: fileName,
      size: data.length,
      createdAt: new Date(),
      path: artifactPath,
      metadata: {
        sessionId,
        originalPath: filePath,
      },
    };

    this.log({
      message: 'artifact saved to local storage',
      level: 1,
      auxiliary: {
        sessionId: { value: sessionId, type: 'string' },
        artifactId: { value: artifactId, type: 'string' },
        fileName: { value: fileName, type: 'string' },
        size: { value: data.length.toString(), type: 'integer' },
      },
    });

    return artifact;
  }

  /**
   * List artifacts for a session
   */
  async getArtifacts(sessionId: string, _cursor?: string): Promise<ArtifactList> {
    const sessionArtifactsPath = path.join(this.artifactsPath, sessionId);

    if (!fs.existsSync(sessionArtifactsPath)) {
      return {
        artifacts: [],
        totalCount: 0,
        hasMore: false,
      };
    }

    const files = fs.readdirSync(sessionArtifactsPath);
    const artifacts: Artifact[] = [];

    for (const file of files) {
      const filePath = path.join(sessionArtifactsPath, file);
      const stats = fs.statSync(filePath);

      if (stats.isFile()) {
        const [artifactId, ...nameParts] = file.split('_');
        const name = nameParts.join('_');

        artifacts.push({
          id: artifactId,
          name: name,
          size: stats.size,
          createdAt: stats.birthtime,
          path: filePath,
          metadata: {
            sessionId,
          },
        });
      }
    }

    return {
      artifacts,
      totalCount: artifacts.length,
      hasMore: false,
    };
  }

  /**
   * Download a specific artifact
   */
  async downloadArtifact(sessionId: string, artifactId: string): Promise<Buffer> {
    const artifacts = await this.getArtifacts(sessionId);
    const artifact = artifacts.artifacts.find((a) => a.id === artifactId);

    if (!artifact) {
      throw new Error(`Artifact ${artifactId} not found for session ${sessionId}`);
    }

    return fs.readFileSync(artifact.path);
  }

  /**
   * Clean up provider resources
   */
  async cleanup(): Promise<void> {
    this.log({
      message: 'cleaning up local provider resources',
      level: 1,
    });

    this.sessions.clear();
  }

  /**
   * Apply stealth scripts to avoid detection
   */
  private async applyStealthScripts(context: BrowserContext): Promise<void> {
    await context.addInitScript(() => {
      // Override the navigator.webdriver property
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });

      // Mock languages and plugins to mimic a real browser
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
      });

      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5],
      });

      // Mock chrome object and Notification API
      interface ExtendedWindow extends Window {
        chrome?: {
          runtime: Record<string, unknown>;
        };
        Notification: {
          permission: string;
        };
      }
      (window as ExtendedWindow).chrome = {
        runtime: {},
      };

      const extendedNavigator = window.navigator as Navigator & {
        permissions: {
          query: (parameters: PermissionDescriptor) => Promise<PermissionStatus>;
        };
      };

      const originalQuery = extendedNavigator.permissions.query;
      extendedNavigator.permissions.query = (parameters: PermissionDescriptor) =>
        parameters.name === 'notifications'
          ? Promise.resolve({
              state: (window as ExtendedWindow).Notification.permission,
              name: parameters.name,
              onchange: null,
              addEventListener: () => {},
              removeEventListener: () => {},
              dispatchEvent: () => false,
            } as PermissionStatus)
          : originalQuery(parameters);
    });
  }

  /**
   * Generate a unique session ID
   */
  private generateSessionId(): string {
    return `local_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  }

  /**
   * Generate a unique artifact ID
   */
  private generateArtifactId(): string {
    return `${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  }

  /**
   * Session state management for Stagehand instances
   */

  setSessionState(sessionId: string, stagehand: Stagehand, model?: string): void {
    this.sessionState.set(sessionId, {
      stagehand,
      lastUsed: Date.now(),
      currentModel: model,
    });
  }

  getSessionState(sessionId: string): SessionState | undefined {
    const state = this.sessionState.get(sessionId);
    if (state) {
      state.lastUsed = Date.now(); // Update last used time
    }
    return state;
  }

  hasSessionState(sessionId: string): boolean {
    return this.sessionState.has(sessionId);
  }

  updateSessionModel(sessionId: string, model: string): void {
    const state = this.sessionState.get(sessionId);
    if (state) {
      state.currentModel = model;
      state.lastUsed = Date.now();
    }
  }

  removeSessionState(sessionId: string): void {
    this.sessionState.delete(sessionId);
  }

  /**
   * Clean up old session state (called periodically)
   */
  cleanupSessionState(timeoutMs: number = 5 * 60 * 1000): void {
    const now = Date.now();
    for (const [sessionId, state] of this.sessionState.entries()) {
      if (now - state.lastUsed > timeoutMs) {
        this.log({
          message: `Cleaning up expired session state: ${sessionId}`,
          level: 1,
        });

        // Close stagehand instance if it exists
        if (state.stagehand && typeof state.stagehand.close === 'function') {
          try {
            state.stagehand.close();
          } catch (error) {
            this.log({
              message: `Error closing stagehand instance during cleanup: ${error}`,
              level: 1,
            });
          }
        }

        this.sessionState.delete(sessionId);
      }
    }
  }
}
