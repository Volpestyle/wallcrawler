/**
 * Shared types for WallCrawler container application
 */

export interface UserInputEvent {
  type: 'mouse' | 'keyboard' | 'scroll';
  action: string;
  data: MouseData | KeyboardData | ScrollData;
  sessionId: string;
  timestamp: number;
}

export interface MouseData {
  x: number;
  y: number;
  button?: 'left' | 'right' | 'middle';
  clickCount?: number;
  modifiers?: string[];
}

export interface KeyboardData {
  key?: string;
  text?: string;
  code?: string;
  modifiers?: string[];
}

export interface ScrollData {
  deltaX: number;
  deltaY: number;
  x?: number;
  y?: number;
}

export interface FrameData {
  data: string; // base64 encoded image
  width: number;
  height: number;
  timestamp: number;
  sessionId: string;
}

export interface SessionInfo {
  sessionId: string;
  pageUrl?: string;
  title?: string;
  ready: boolean;
  lastActivity: number;
}

export interface HealthStatus {
  status: 'healthy' | 'unhealthy';
  timestamp: number;
  chrome: boolean;
  selenium: boolean;
  cdp: boolean;
  uptime: number;
  activeSessions?: number;
  capacity?: number;
  maxSessions?: number;
  userId: string;
  runtime?: 'node' | 'bun';
  performance?: {
    avgLatency: number;
    p99Latency: number;
  };
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: number;
}

// Security and Authentication Types
export interface SessionToken {
  sessionId: string;
  userId: string; // User identifier derived from API key
  iat: number; // issued at
  exp: number; // expires at
  sub: string; // subject (api key)
  aud: string; // audience (wallcrawler)
}

export interface AuthenticatedRequest {
  apiKey: string;
  userId: string; // Required - derived from API key
  sessionId?: string;
  timestamp: number;
}

export interface SignedSessionResponse {
  sessionId: string;
  sessionToken: string;
  signedToken?: string;
  websocketUrl: string;
  cdpPort: number;
  streamingPort: number;
  endpoints: {
    input: string;
    navigate: string;
    execute: string;
  };
  expiresAt: number;
}

// Client metadata for API key management
export interface ClientMetadata {
  clientName: string;
  email?: string;
  permissions?: string[];
  createdAt: number;
  expiresAt?: number;
  rateLimit?: number;
}

export interface ApiKeyWithMetadata {
  key: string;
  metadata: ClientMetadata;
}

// WebSocket with session token extension
export interface AuthenticatedWebSocket extends Omit<WebSocket, 'dispatchEvent'> {
  sessionToken?: SessionToken;
}

// Artifact management types
export interface Artifact {
  id: string;
  name: string;
  size: number;
  mimeType?: string;
  createdAt: Date;
  path: string;
  metadata?: Record<string, unknown>;
}

export interface ArtifactList {
  artifacts: Artifact[];
  totalCount: number;
  hasMore: boolean;
  nextCursor?: string;
}

// User-based container management types
export interface UserContainer {
  userId: string;
  containerId: string;
  taskArn: string;
  endpoint: string;
  activeSessions: Map<string, ActiveSession>;
  maxSessions: number;
  createdAt: Date;
  lastActivity: Date;
}

export interface ActiveSession {
  sessionId: string;
  userId: string;
  cdpManager: any; // CDPManager type
  inputController: any; // InputController type
  startTime: number;
  isStreaming: boolean;
  lastActivity: number;
}

export interface UserContainerConfig {
  maxSessionsPerContainer: number;
  containerIdleTimeout: number; // seconds
  userContainerLimit: number;
  autoCleanup: boolean;
}
