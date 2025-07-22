/**
 * Shared types for WallCrawler container application
 */

// JWT and Authentication Types - use @wallcrawler/utils/auth for JWTPayload

// Session Configuration Types
export interface SessionOptions {
  viewport?: { width: number; height: number };
  userAgent?: string;
  locale?: string;
  timezoneId?: string;
  storageState?: any;
  extraHTTPHeaders?: Record<string, string>;
}

// Input Event Types
export interface InputEvent {
  type: 'mousePressed' | 'mouseReleased' | 'mouseMoved' | 'keyDown' | 'keyUp' | 'char' | 'mouseWheel' | 'mouse' | 'keyboard' | 'touch';
  timestamp: number;
  data?: Record<string, unknown>;
  x?: number;
  y?: number;
  button?: string;
  clickCount?: number;
  modifiers?: number;
  key?: string;
  code?: string;
  text?: string;
  deltaX?: number;
  deltaY?: number;
}

// Screencast Types
export interface ScreencastOptions {
  quality?: number;
  everyNthFrame?: number;
  detectIdle?: boolean;
  idleThreshold?: number;
  maxWidth?: number;
  maxHeight?: number;
}

export interface ScreencastMetadata {
  offsetTop: number;
  pageScaleFactor: number;
  deviceWidth: number;
  deviceHeight: number;
  scrollOffsetX: number;
  scrollOffsetY: number;
  timestamp: number;
}

export interface FrameDetectionState {
  lastFrameHash: string | null;
  idleFrameCount: number;
  lastForcedTime: number;
  options: Required<ScreencastOptions>;
}

export interface ScreencastFrame {
  data: string;
  metadata: ScreencastMetadata;
  sessionId: string;
  frameId: number;
}

export interface ScreencastStats {
  framesSent: number;
  framesSkipped: number;
  bytesTransmitted: number;
  averageFrameSize: number;
  actualFps: number;
  skipPercentage: number;
}

// Container Message Types
export interface ClientMessage {
  id: number;
  method?: string;
  params?: object;
  targetId?: string;
}

export interface InternalMessage {
  type: 'CREATE_SESSION' | 'DESTROY_SESSION' | 'CLIENT_MESSAGE' | 'START_SCREENCAST' | 'STOP_SCREENCAST' | 'SEND_INPUT';
  sessionId?: string;
  userId?: string;
  options?: SessionOptions;
  data?: any;
  event?: InputEvent;
  params?: any;
}

// Legacy types (keeping for backward compatibility)
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
  button: 'left' | 'right' | 'middle';
  clickCount?: number;
  modifiers?: number;
}

export interface KeyboardData {
  key: string;
  code?: string;
  modifiers?: number;
  text?: string;
}

export interface ScrollData {
  deltaX: number;
  deltaY: number;
  x?: number;
  y?: number;
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
