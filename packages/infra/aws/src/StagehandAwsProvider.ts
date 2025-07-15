/**
 * AWS Provider for Stagehand Browser Automation
 * Connects to AWS containerized browser infrastructure compatible with Stagehand's IBrowserProvider interface
 */

import { Browser, BrowserContext, Page, CDPSession } from '@playwright/test';
import WebSocket from 'ws';
import {
  IBrowserProvider,
  ProviderSession,
  SessionCreateParams as BaseSessionCreateParams,
  BrowserConnectionResult,
  Artifact,
  ArtifactList,
  ProviderType,
} from '@wallcrawler/stagehand/types/provider';

export interface SessionCreateParams extends BaseSessionCreateParams {
  enableScreencast?: boolean;
  viewport?: { width: number; height: number };
}

export interface StagehandAwsProviderConfig {
  /** Container app base URL */
  baseUrl: string;
  /** API key for authentication */
  apiKey: string;
  /** Session timeout in milliseconds */
  sessionTimeoutMs?: number;
  /** Custom headers for requests */
  headers?: Record<string, string>;
  /** Optional region identifier */
  region?: string;
}

/**
 * AWS Provider for Stagehand Browser Automation
 * This provider connects to your AWS container infrastructure and provides
 * a Stagehand-compatible interface for browser automation.
 */
export class StagehandAwsProvider implements IBrowserProvider {
  readonly type: ProviderType = 'aws';
  readonly name = 'AWS Container Provider for Stagehand';

  private config: StagehandAwsProviderConfig;
  private activeSessions = new Map<string, ProviderSession>();
  private cdpWebSockets = new Map<string, WebSocket>();
  private cdpCommandId = 0;
  private pendingCommands = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (reason?: unknown) => void;
    }
  >();
  private screencastState = new Map<string, boolean>(); // Track screencast state per session

  constructor(config: StagehandAwsProviderConfig) {
    this.config = {
      sessionTimeoutMs: 4 * 60 * 60 * 1000, // 4 hours default
      region: 'us-east-1',
      ...config,
    };
  }

  /**
   * Create a new browser session in AWS container
   */
  async createSession(params: SessionCreateParams = {}): Promise<ProviderSession> {
    try {
      // Step 1: Create signed session
      const signedSessionResponse = await this.makeRequest('/auth/session', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: undefined,
          timeoutMs: params.timeoutMs || this.config.sessionTimeoutMs,
          metadata: params.userMetadata,
        }),
      });

      const { sessionId, signedToken, websocketUrl, cdpPort, endpoints } = signedSessionResponse.data;

      // Step 2: Start the browser session
      const _sessionStartResponse = await this.makeRequest('/session/start', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${signedToken}`,
        },
        body: JSON.stringify({
          sessionId,
        }),
      });

      // Extract hostname from baseUrl for CDP connection
      const hostname = new URL(this.config.baseUrl).hostname;
      const cdpUrl = `ws://${hostname}:${cdpPort}`;

      const session: ProviderSession = {
        sessionId,
        connectUrl: cdpUrl,
        debugUrl: `http://${hostname}:${cdpPort}`,
        sessionUrl: `${this.config.baseUrl}/session/info?token=${signedToken}`,
        provider: this.type,
        metadata: {
          signedToken,
          websocketUrl,
          endpoints,
          region: this.config.region,
          ...params.userMetadata,
        },
      };

      this.activeSessions.set(sessionId, session);

      // Optionally enable screencast
      if (params.enableScreencast) {
        await this.sendCDPCommand(sessionId, 'Page.startScreencast', {
          format: 'jpeg',
          quality: 80,
          maxWidth: params.viewport?.width || 1920,
          maxHeight: params.viewport?.height || 1080,
          everyNthFrame: 1,
        });
      }

      console.log(`[StagehandAwsProvider] Created session ${sessionId} with CDP at ${cdpUrl}`);
      return session;
    } catch (error) {
      throw new Error(`Failed to create AWS session: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Start screencast for an active session
   */
  async startScreencast(
    sessionId: string,
    params: {
      format?: 'jpeg' | 'png';
      quality?: number;
      maxWidth?: number;
      maxHeight?: number;
      everyNthFrame?: number;
    } = {}
  ): Promise<void> {
    if (!this.activeSessions.has(sessionId)) {
      throw new Error(`No active session ${sessionId}`);
    }

    const defaultParams = {
      format: 'jpeg',
      quality: 80,
      maxWidth: 1920,
      maxHeight: 1080,
      everyNthFrame: 1,
      ...params,
    };

    await this.sendCDPCommand(sessionId, 'Page.startScreencast', defaultParams);
    this.screencastState.set(sessionId, true);
    console.log(`[StagehandAwsProvider] Started screencast for session ${sessionId}`);
  }

  /**
   * Stop screencast for an active session
   */
  async stopScreencast(sessionId: string): Promise<void> {
    if (!this.activeSessions.has(sessionId)) {
      throw new Error(`No active session ${sessionId}`);
    }

    await this.sendCDPCommand(sessionId, 'Page.stopScreencast');
    this.screencastState.set(sessionId, false);
    console.log(`[StagehandAwsProvider] Stopped screencast for session ${sessionId}`);
  }

  /**
   * Check if screencast is currently active for a session
   */
  isScreencastActive(sessionId: string): boolean {
    return this.screencastState.get(sessionId) || false;
  }

  /**
   * Toggle screencast on/off for a session
   */
  async toggleScreencast(
    sessionId: string,
    params: {
      format?: 'jpeg' | 'png';
      quality?: number;
      maxWidth?: number;
      maxHeight?: number;
      everyNthFrame?: number;
    } = {}
  ): Promise<boolean> {
    const isActive = this.isScreencastActive(sessionId);

    if (isActive) {
      await this.stopScreencast(sessionId);
      return false;
    } else {
      await this.startScreencast(sessionId, params);
      return true;
    }
  }

  /**
   * Resume an existing session
   */
  async resumeSession(sessionId: string): Promise<ProviderSession> {
    const existingSession = this.activeSessions.get(sessionId);
    if (existingSession) {
      console.log(`[StagehandAwsProvider] Resuming cached session ${sessionId}`);
      return existingSession;
    }

    try {
      // Try to get session info to verify it exists and is still active
      const sessionResponse = await this.makeRequest(`/session/info`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${existingSession?.metadata?.signedToken || ''}`,
        },
      });

      if (sessionResponse.success) {
        // Reconstruct session from available info
        const hostname = new URL(this.config.baseUrl).hostname;
        const session: ProviderSession = {
          sessionId,
          connectUrl: `ws://${hostname}:9222`,
          debugUrl: `http://${hostname}:9222`,
          sessionUrl: `${this.config.baseUrl}/session/info`,
          provider: this.type,
          metadata: {
            region: this.config.region,
            ...existingSession?.metadata,
          },
        };

        this.activeSessions.set(sessionId, session);
        console.log(`[StagehandAwsProvider] Resumed session ${sessionId}`);
        return session;
      }
    } catch (error) {
      throw new Error(
        `Failed to resume AWS session ${sessionId}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }

    throw new Error(`Session ${sessionId} not found or expired`);
  }

  /**
   * Connect to the browser instance via CDP proxy (this is what Stagehand calls)
   */
  async connectToBrowser(session: ProviderSession): Promise<BrowserConnectionResult> {
    console.log(`[StagehandAwsProvider] Creating CDP proxy for session ${session.sessionId}`);

    try {
      // Establish CDP WebSocket connection to container
      await this.setupCDPWebSocket(session);

      // Create proxy browser that intercepts CDP calls
      const browser = this.createBrowserProxy(session);

      console.log(`[StagehandAwsProvider] Successfully created CDP proxy for session ${session.sessionId}`);

      return {
        browser,
        session,
      };
    } catch (error) {
      throw new Error(`Failed to create CDP proxy: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Setup CDP WebSocket connection to container
   */
  private async setupCDPWebSocket(session: ProviderSession): Promise<void> {
    const hostname = new URL(this.config.baseUrl).hostname;
    const cdpWebSocketUrl = `ws://${hostname}:11222`;

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(cdpWebSocketUrl, {
        headers: {
          Authorization: `Bearer ${session.metadata?.signedToken}`,
        },
      });

      ws.on('open', () => {
        console.log(`[StagehandAwsProvider] CDP WebSocket connected for session ${session.sessionId}`);
        this.cdpWebSockets.set(session.sessionId, ws);
        resolve();
      });

      ws.on('message', (data: Buffer) => {
        try {
          const response = JSON.parse(data.toString());
          const pending = this.pendingCommands.get(response.id);
          if (pending) {
            if (response.error) {
              pending.reject(new Error(response.error.message));
            } else {
              pending.resolve(response.result);
            }
            this.pendingCommands.delete(response.id);
          }
        } catch (error) {
          console.error('[StagehandAwsProvider] Error parsing CDP response:', error);
        }
      });

      ws.on('error', (error) => {
        console.error(`[StagehandAwsProvider] CDP WebSocket error for session ${session.sessionId}:`, error);
        reject(error);
      });

      ws.on('close', () => {
        console.log(`[StagehandAwsProvider] CDP WebSocket closed for session ${session.sessionId}`);
        this.cdpWebSockets.delete(session.sessionId);
      });
    });
  }

  /**
   * Create browser proxy that intercepts CDP calls
   */
  private createBrowserProxy(session: ProviderSession): Browser {
    return {
      contexts: () => [this.createContextProxy(session)],
      close: async () => {
        const ws = this.cdpWebSockets.get(session.sessionId);
        if (ws) {
          ws.close();
          this.cdpWebSockets.delete(session.sessionId);
        }
      },
      // Add other browser methods as needed
    } as Browser;
  }

  /**
   * Create context proxy
   */
  private createContextProxy(session: ProviderSession): BrowserContext {
    return {
      newCDPSession: async (_page?: Page) => {
        return this.createCDPSessionProxy(session);
      },
      pages: () => [this.createPageProxy(session)],
      close: async () => {},
      // Add other context methods as needed
    } as BrowserContext;
  }

  /**
   * Create page proxy
   */
  private createPageProxy(_session: ProviderSession): Page {
    return {
      // Add page methods as needed - most will be handled by CDP
    } as Page;
  }

  /**
   * Create CDP session proxy that routes commands over WebSocket
   */
  private createCDPSessionProxy(session: ProviderSession): CDPSession {
    return {
      send: async (method: string, params?: unknown) => {
        return this.sendCDPCommand(session.sessionId, method, params);
      },
      // Add other CDP session methods as needed
    } as CDPSession;
  }

  /**
   * Send CDP command over WebSocket to container
   */
  private async sendCDPCommand(sessionId: string, method: string, params: unknown = {}): Promise<unknown> {
    const ws = this.cdpWebSockets.get(sessionId);
    if (!ws) {
      throw new Error(`No CDP WebSocket connection for session ${sessionId}`);
    }

    const id = ++this.cdpCommandId;

    const command = {
      id,
      method,
      params,
    };

    return new Promise((resolve: (value: unknown) => void, reject: (reason?: unknown) => void) => {
      this.pendingCommands.set(id, { resolve, reject });

      try {
        ws.send(JSON.stringify(command));
      } catch (error) {
        this.pendingCommands.delete(id);
        reject(error);
        return;
      }

      // Timeout after 30s
      setTimeout(() => {
        if (this.pendingCommands.has(id)) {
          this.pendingCommands.delete(id);
          reject(new Error(`CDP command timeout: ${method}`));
        }
      }, 30000);
    });
  }

  /**
   * End a browser session
   */
  async endSession(sessionId: string): Promise<void> {
    console.log(`[StagehandAwsProvider] Ending session ${sessionId}`);

    const session = this.activeSessions.get(sessionId);

    try {
      if (session?.metadata?.signedToken) {
        await this.makeRequest('/session/stop', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.metadata.signedToken}`,
          },
        });
        console.log(`[StagehandAwsProvider] Successfully stopped session ${sessionId}`);
      }
    } catch (error) {
      console.warn(`[StagehandAwsProvider] Failed to stop AWS session ${sessionId}:`, error);
    } finally {
      this.activeSessions.delete(sessionId);
      this.screencastState.delete(sessionId); // Clean up screencast state
    }
  }

  /**
   * Save an artifact to AWS storage (for screenshots, downloads, etc.)
   */
  async saveArtifact(sessionId: string, path: string, data: Buffer): Promise<Artifact> {
    const session = this.activeSessions.get(sessionId);
    if (!session?.metadata?.signedToken) {
      throw new Error(`No active session found for ${sessionId}`);
    }

    try {
      const response = await this.makeRequest('/artifacts/upload', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.metadata.signedToken}`,
          'Content-Type': 'application/octet-stream',
          'X-File-Path': path,
          'X-Session-Id': sessionId,
        },
        body: data,
      });

      console.log(`[StagehandAwsProvider] Saved artifact ${path} for session ${sessionId}`);
      return response.data;
    } catch (error) {
      throw new Error(`Failed to save artifact: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * List artifacts for a session
   */
  async getArtifacts(sessionId: string, cursor?: string): Promise<ArtifactList> {
    const session = this.activeSessions.get(sessionId);
    if (!session?.metadata?.signedToken) {
      throw new Error(`No active session found for ${sessionId}`);
    }

    try {
      const url = `/artifacts/list?sessionId=${sessionId}${cursor ? `&cursor=${cursor}` : ''}`;
      const response = await this.makeRequest(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${session.metadata.signedToken}`,
        },
      });

      return response.data;
    } catch (error) {
      throw new Error(`Failed to list artifacts: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Download a specific artifact
   */
  async downloadArtifact(sessionId: string, artifactId: string): Promise<Buffer> {
    const session = this.activeSessions.get(sessionId);
    if (!session?.metadata?.signedToken) {
      throw new Error(`No active session found for ${sessionId}`);
    }

    try {
      const response = await fetch(`${this.config.baseUrl}/artifacts/download/${artifactId}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${session.metadata.signedToken}`,
          ...this.config.headers,
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (error) {
      throw new Error(`Failed to download artifact: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Clean up provider resources
   */
  async cleanup(): Promise<void> {
    console.log(`[StagehandAwsProvider] Cleaning up ${this.activeSessions.size} active sessions`);

    const sessionIds = Array.from(this.activeSessions.keys());
    await Promise.allSettled(sessionIds.map((sessionId) => this.endSession(sessionId)));

    // Close all remaining CDP WebSockets
    this.cdpWebSockets.forEach((ws, sessionId) => {
      console.log(`[StagehandAwsProvider] Closing CDP WebSocket for session ${sessionId}`);
      ws.close();
    });

    this.activeSessions.clear();
    this.cdpWebSockets.clear();
    this.pendingCommands.clear();
    this.screencastState.clear(); // Clean up screencast state

    console.log(`[StagehandAwsProvider] Cleanup completed`);
  }

  /**
   * Make authenticated HTTP request to container app
   */
  private async makeRequest(endpoint: string, options: RequestInit = {}): Promise<any> {
    const url = `${this.config.baseUrl}${endpoint}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
        ...this.config.headers,
        ...options.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.json();
  }
}
