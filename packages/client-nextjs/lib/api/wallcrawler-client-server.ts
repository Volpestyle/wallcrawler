import { Stagehand } from "@wallcrawler/stagehand";
import { Session, ApiResponse } from "@/lib/types/stagehand";

export interface WallcrawlerSession extends Session {
  stagehandInstance?: Stagehand;
  sessionId: string;
  debugUrl?: string;
  sessionUrl?: string;
}

export class WallcrawlerClient {
  private apiKey: string | undefined;
  private projectId: string | undefined;
  private sessions: Map<string, WallcrawlerSession> = new Map();

  constructor(apiKey?: string, projectId?: string) {
    this.apiKey = apiKey || process.env.NEXT_PUBLIC_WALLCRAWLER_API_KEY;
    this.projectId = projectId || process.env.NEXT_PUBLIC_WALLCRAWLER_PROJECT_ID;
  }

  private validateConfig(): void {
    if (!this.apiKey) {
      throw new Error("WALLCRAWLER_API_KEY is not set in environment variables");
    }
    if (!this.projectId) {
      throw new Error("WALLCRAWLER_PROJECT_ID is not set in environment variables");
    }
  }

  async createSession(name: string): Promise<ApiResponse<WallcrawlerSession>> {
    try {
      this.validateConfig();

      // Initialize Stagehand with Wallcrawler
      const stagehand = new Stagehand({
        env: "WALLCRAWLER",
        apiKey: this.apiKey,
        projectId: this.projectId,
        verbose: 1,
        headless: false,
      });

      // Initialize the browser session
      const { sessionId, debugUrl, sessionUrl } = await stagehand.init();

      if (!sessionId) {
        throw new Error("Failed to initialize Wallcrawler session");
      }

      // Create session object
      const session: WallcrawlerSession = {
        id: sessionId,
        sessionId,
        url: sessionUrl || `https://api.wallcrawler.dev/sessions/${sessionId}`,
        name,
        status: "running",
        createdAt: new Date(),
        lastActiveAt: new Date(),
        stagehandInstance: stagehand,
        debugUrl,
        sessionUrl,
      };

      // Store session
      this.sessions.set(sessionId, session);

      return {
        success: true,
        data: session,
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to create session",
        timestamp: new Date(),
      };
    }
  }

  async getSession(sessionId: string): Promise<ApiResponse<WallcrawlerSession>> {
    try {
      const session = this.sessions.get(sessionId);
      if (!session) {
        return {
          success: false,
          error: "Session not found",
          timestamp: new Date(),
        };
      }

      // Update last active time
      session.lastActiveAt = new Date();

      return {
        success: true,
        data: session,
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to get session",
        timestamp: new Date(),
      };
    }
  }

  async listSessions(): Promise<ApiResponse<WallcrawlerSession[]>> {
    try {
      const sessions = Array.from(this.sessions.values());
      return {
        success: true,
        data: sessions,
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to list sessions",
        timestamp: new Date(),
      };
    }
  }

  async closeSession(sessionId: string): Promise<ApiResponse<void>> {
    try {
      const session = this.sessions.get(sessionId);
      if (!session) {
        return {
          success: false,
          error: "Session not found",
          timestamp: new Date(),
        };
      }

      // Close the Stagehand instance
      if (session.stagehandInstance && !session.stagehandInstance.isClosed) {
        await session.stagehandInstance.close();
      }

      // Remove from sessions map
      this.sessions.delete(sessionId);

      return {
        success: true,
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to close session",
        timestamp: new Date(),
      };
    }
  }

  async navigateTo(sessionId: string, url: string): Promise<ApiResponse<void>> {
    try {
      const session = this.sessions.get(sessionId);
      if (!session || !session.stagehandInstance) {
        return {
          success: false,
          error: "Session not found or not initialized",
          timestamp: new Date(),
        };
      }

      await session.stagehandInstance.page.goto(url);
      session.lastActiveAt = new Date();

      return {
        success: true,
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Navigation failed",
        timestamp: new Date(),
      };
    }
  }

  async takeScreenshot(sessionId: string): Promise<ApiResponse<string>> {
    try {
      const session = this.sessions.get(sessionId);
      if (!session || !session.stagehandInstance) {
        return {
          success: false,
          error: "Session not found or not initialized",
          timestamp: new Date(),
        };
      }

      const screenshot = await session.stagehandInstance.page.screenshot({
        fullPage: true,
        type: "png",
      });

      const base64 = screenshot.toString("base64");
      session.lastActiveAt = new Date();

      return {
        success: true,
        data: `data:image/png;base64,${base64}`,
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Screenshot failed",
        timestamp: new Date(),
      };
    }
  }

  getStagehandInstance(sessionId: string): Stagehand | undefined {
    return this.sessions.get(sessionId)?.stagehandInstance;
  }
}