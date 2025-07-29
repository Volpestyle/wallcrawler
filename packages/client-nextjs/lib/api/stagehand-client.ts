import axios, { AxiosInstance, AxiosError } from "axios";
import {
  Session,
  NavigationRequest,
  ElementInteraction,
  DataExtractionRequest,
  ScreenshotOptions,
  Workflow,
  WorkflowStep,
  ApiResponse,
} from "@/lib/types/stagehand";

export class StagehandClient {
  private client: AxiosInstance;
  private sessionId: string | null = null;

  constructor(baseURL: string) {
    this.client = axios.create({
      baseURL,
      timeout: 30000,
      headers: {
        "Content-Type": "application/json",
      },
    });

    // Add response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => {
        const errorMessage = error.response?.data 
          ? (typeof error.response.data === "string" 
              ? error.response.data 
              : (error.response.data as any).error || error.message)
          : error.message;
        
        return Promise.reject(new Error(errorMessage));
      }
    );
  }

  // Session management
  async createSession(name: string): Promise<ApiResponse<Session>> {
    try {
      const response = await this.client.post<ApiResponse<Session>>("/sessions", {
        name,
      });
      if (response.data.success && response.data.data) {
        this.sessionId = response.data.data.id;
      }
      return response.data;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to create session",
        timestamp: new Date(),
      };
    }
  }

  async getSession(sessionId: string): Promise<ApiResponse<Session>> {
    try {
      const response = await this.client.get<ApiResponse<Session>>(
        `/sessions/${sessionId}`
      );
      return response.data;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to get session",
        timestamp: new Date(),
      };
    }
  }

  async listSessions(): Promise<ApiResponse<Session[]>> {
    try {
      const response = await this.client.get<ApiResponse<Session[]>>("/sessions");
      return response.data;
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
      const response = await this.client.delete<ApiResponse<void>>(
        `/sessions/${sessionId}`
      );
      if (this.sessionId === sessionId) {
        this.sessionId = null;
      }
      return response.data;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to close session",
        timestamp: new Date(),
      };
    }
  }

  // Navigation
  async navigate(request: NavigationRequest): Promise<ApiResponse<void>> {
    if (!this.sessionId) {
      return {
        success: false,
        error: "No active session",
        timestamp: new Date(),
      };
    }

    try {
      const response = await this.client.post<ApiResponse<void>>(
        `/sessions/${this.sessionId}/navigate`,
        request
      );
      return response.data;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Navigation failed",
        timestamp: new Date(),
      };
    }
  }

  // Element interaction
  async interact(interaction: ElementInteraction): Promise<ApiResponse<void>> {
    if (!this.sessionId) {
      return {
        success: false,
        error: "No active session",
        timestamp: new Date(),
      };
    }

    try {
      const response = await this.client.post<ApiResponse<void>>(
        `/sessions/${this.sessionId}/interact`,
        interaction
      );
      return response.data;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Interaction failed",
        timestamp: new Date(),
      };
    }
  }

  // Data extraction
  async extract(request: DataExtractionRequest): Promise<ApiResponse<any>> {
    if (!this.sessionId) {
      return {
        success: false,
        error: "No active session",
        timestamp: new Date(),
      };
    }

    try {
      const response = await this.client.post<ApiResponse<any>>(
        `/sessions/${this.sessionId}/extract`,
        request
      );
      return response.data;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Extraction failed",
        timestamp: new Date(),
      };
    }
  }

  // Screenshot
  async screenshot(options?: ScreenshotOptions): Promise<ApiResponse<string>> {
    if (!this.sessionId) {
      return {
        success: false,
        error: "No active session",
        timestamp: new Date(),
      };
    }

    try {
      const response = await this.client.post<ApiResponse<string>>(
        `/sessions/${this.sessionId}/screenshot`,
        options || {}
      );
      return response.data;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Screenshot failed",
        timestamp: new Date(),
      };
    }
  }

  // Workflow management
  async createWorkflow(workflow: Omit<Workflow, "id" | "createdAt" | "updatedAt">): Promise<ApiResponse<Workflow>> {
    try {
      const response = await this.client.post<ApiResponse<Workflow>>(
        "/workflows",
        workflow
      );
      return response.data;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to create workflow",
        timestamp: new Date(),
      };
    }
  }

  async getWorkflow(workflowId: string): Promise<ApiResponse<Workflow>> {
    try {
      const response = await this.client.get<ApiResponse<Workflow>>(
        `/workflows/${workflowId}`
      );
      return response.data;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to get workflow",
        timestamp: new Date(),
      };
    }
  }

  async listWorkflows(): Promise<ApiResponse<Workflow[]>> {
    try {
      const response = await this.client.get<ApiResponse<Workflow[]>>("/workflows");
      return response.data;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to list workflows",
        timestamp: new Date(),
      };
    }
  }

  async runWorkflow(workflowId: string): Promise<ApiResponse<void>> {
    if (!this.sessionId) {
      return {
        success: false,
        error: "No active session",
        timestamp: new Date(),
      };
    }

    try {
      const response = await this.client.post<ApiResponse<void>>(
        `/workflows/${workflowId}/run`,
        { sessionId: this.sessionId }
      );
      return response.data;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to run workflow",
        timestamp: new Date(),
      };
    }
  }

  // Health check
  async healthCheck(): Promise<ApiResponse<{ status: string; version: string }>> {
    try {
      const response = await this.client.get<ApiResponse<{ status: string; version: string }>>(
        "/health"
      );
      return response.data;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Health check failed",
        timestamp: new Date(),
      };
    }
  }

  // Getters
  getSessionId(): string | null {
    return this.sessionId;
  }

  setSessionId(sessionId: string | null): void {
    this.sessionId = sessionId;
  }
}