import { CDPSession, Frame } from "playwright";

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
  waitForSettlement(options?: Partial<SettlementOptions>): Promise<void>;
  getActiveRequests(): NetworkRequest[];
  clearStalled(timeout: number): void;
}

export interface SettlementOptions {
  quietWindowMs: number; // Default: 500ms
  maxWaitMs: number; // Default: 30000ms
  ignorePatterns: RegExp[]; // Exclude WebSocket, SSE, etc.
}

export type EncodedId = `${number}-${number}`;

export interface TreeResult {
  tree: AccessibilityNode[];
  simplified: string;
  iframes?: AccessibilityNode[];
  idToUrl: Record<EncodedId, string>;
  xpathMap: Record<EncodedId, string>;
}

export interface AXNode {
  role?: { value: string };
  name?: { value: string };
  description?: { value: string };
  value?: { value: string };
  nodeId: string;
  backendDOMNodeId?: number;
  parentId?: string;
  childIds?: string[];
  properties?: {
    name: string;
    value: {
      type: string;
      value?: string;
    };
  }[];
}

export type AccessibilityNode = {
  role: string;
  name?: string;
  description?: string;
  value?: string;
  children?: AccessibilityNode[];
  childIds?: string[];
  parentId?: string;
  nodeId?: string;
  backendDOMNodeId?: number;
  properties?: {
    name: string;
    value: {
      type: string;
      value?: string;
    };
  }[];
};

export type DOMNode = {
  backendNodeId?: number;
  nodeName?: string;
  children?: DOMNode[];
  shadowRoots?: DOMNode[];
  contentDocument?: DOMNode;
  nodeType: number;
  frameId?: string;
};

export type BackendIdMaps = {
  tagNameMap: Record<EncodedId, string>;
  xpathMap: Record<EncodedId, string>;
};

export type FrameId = string;
export type LoaderId = string;

export interface CdpFrame {
  id: FrameId;
  parentId?: FrameId;
  loaderId: LoaderId;
  name?: string;
  url: string;
  urlFragment?: string;
  domainAndRegistry?: string;
  securityOrigin: string;
  securityOriginDetails?: Record<string, unknown>;
  mimeType: string;
  unreachableUrl?: string;
  adFrameStatus?: string;
  secureContextType?: string;
  crossOriginIsolatedContextType?: string;
  gatedAPIFeatures?: string[];
}

export interface CdpFrameTree {
  frame: CdpFrame;
  childFrames?: CdpFrameTree[];
}

export interface FrameOwnerResult {
  backendNodeId?: number;
}

export interface CombinedA11yResult {
  combinedTree: string;
  combinedXpathMap: Record<EncodedId, string>;
  combinedUrlMap: Record<EncodedId, string>;
}

export interface FrameSnapshot {
  tree: string;
  xpathMap: Record<EncodedId, string>;
  urlMap: Record<EncodedId, string>;
  frameXpath: string;
  backendNodeId: number | null;
  parentFrame?: Frame | null;
  frameId?: string;
}

export interface RichNode extends AccessibilityNode {
  encodedId?: EncodedId;
}

export const ID_PATTERN = /^\d+-\d+$/;
