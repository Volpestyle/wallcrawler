import { Session, ApiResponse } from "@/lib/types/stagehand";

export interface WallcrawlerSession extends Session {
  sessionId: string;
  debugUrl?: string;
  sessionUrl?: string;
}

export class WallcrawlerClient {
  async createSession(name: string): Promise<ApiResponse<WallcrawlerSession>> {
    try {
      const response = await fetch("/api/wallcrawler/sessions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name }),
      });

      const data = await response.json();
      
      if (!response.ok) {
        return {
          success: false,
          error: data.error || "Failed to create session",
          timestamp: new Date(data.timestamp),
        };
      }

      return {
        success: data.success,
        data: {
          ...data.data,
          sessionId: data.data.id,
        },
        timestamp: new Date(data.timestamp),
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
      const response = await fetch(`/api/wallcrawler/sessions/${sessionId}`);
      const data = await response.json();
      
      if (!response.ok) {
        return {
          success: false,
          error: data.error || "Failed to get session",
          timestamp: new Date(data.timestamp),
        };
      }

      return {
        success: data.success,
        data: {
          ...data.data,
          sessionId: data.data.id,
        },
        timestamp: new Date(data.timestamp),
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
      const response = await fetch("/api/wallcrawler/sessions");
      const data = await response.json();
      
      if (!response.ok) {
        return {
          success: false,
          error: data.error || "Failed to list sessions",
          timestamp: new Date(data.timestamp),
        };
      }

      return {
        success: data.success,
        data: data.data.map((session: Session) => ({
          ...session,
          sessionId: session.id,
        })),
        timestamp: new Date(data.timestamp),
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
      const response = await fetch(`/api/wallcrawler/sessions/${sessionId}`, {
        method: "DELETE",
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        return {
          success: false,
          error: data.error || "Failed to close session",
          timestamp: new Date(data.timestamp),
        };
      }

      return {
        success: data.success,
        timestamp: new Date(data.timestamp),
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
      const response = await fetch(`/api/wallcrawler/sessions/${sessionId}/navigate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url }),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        return {
          success: false,
          error: data.error || "Navigation failed",
          timestamp: new Date(data.timestamp),
        };
      }

      return {
        success: data.success,
        timestamp: new Date(data.timestamp),
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
      const response = await fetch(`/api/wallcrawler/sessions/${sessionId}/screenshot`);
      const data = await response.json();
      
      if (!response.ok) {
        return {
          success: false,
          error: data.error || "Screenshot failed",
          timestamp: new Date(data.timestamp),
        };
      }

      return {
        success: data.success,
        data: data.data,
        timestamp: new Date(data.timestamp),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Screenshot failed",
        timestamp: new Date(),
      };
    }
  }

  // This method is not available in the browser version
  getStagehandInstance(sessionId: string): undefined {
    console.warn("getStagehandInstance is not available in the browser version of WallcrawlerClient");
    return undefined;
  }
}