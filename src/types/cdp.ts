import { CDPSession } from 'playwright';

export interface CDPSessionManager {
  createSession(page: any): Promise<CDPSession>;
  enableDomains(session: CDPSession, domains: string[]): Promise<void>;
  handleSessionError(error: Error): Promise<void>;
  cleanup(): Promise<void>;
}

export interface NetworkRequest {
  requestId: string;
  frameId?: string;
  url: string;
  method: string;
  timestamp: number;
  resourceType?: string;
}

export interface NetworkMonitor {
  trackRequest(request: NetworkRequest): void;
  isSettled(options: SettlementOptions): boolean;
  getActiveRequests(): NetworkRequest[];
  clearStalled(timeout: number): void;
}

export interface SettlementOptions {
  quietWindowMs: number; // Default: 500ms
  maxWaitMs: number; // Default: 30000ms
  ignorePatterns: RegExp[]; // Exclude WebSocket, SSE, etc.
}

export interface AXNode {
  nodeId: string;
  ignored: boolean;
  role?: { type: string; value: string };
  name?: { type: string; value: string };
  description?: { type: string; value: string };
  properties?: Array<{
    name: string;
    value: { type: string; value: any };
  }>;
  childIds?: string[];
  backendDOMNodeId?: number;
}