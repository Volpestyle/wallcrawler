/**
 * Shared types for WallCrawler packages
 * These types are used across stagehand, infra, and other packages to ensure consistency
 */

// =====================================
// Session and Browser Types
// =====================================

export interface SessionOptions {
    viewport?: { width: number; height: number };
    userAgent?: string;
    locale?: string;
    timezoneId?: string;
    storageState?: unknown;
    extraHTTPHeaders?: Record<string, string>;
    headless?: boolean;
    timeout?: number;
}

export interface BrowserSession {
    id: string;
    status: 'creating' | 'active' | 'stopping' | 'stopped' | 'failed';
    createdAt: Date;
    lastActiveAt?: Date;
    config: SessionOptions;
    metadata?: Record<string, unknown>;
    endpoint?: string;
    connectUrl?: string;
    token?: string;
    logger?: (message: string) => void;
}

// =====================================
// Authentication Types
// =====================================

export interface SessionToken {
    sessionId: string;
    userId: string;
    iat: number; // issued at
    exp: number; // expires at
    sub: string; // subject (api key)
    aud: string; // audience (wallcrawler)
}

export interface AuthenticatedRequest {
    apiKey: string;
    userId: string;
    sessionId?: string;
    timestamp: number;
}

// =====================================
// Input and Event Types
// =====================================

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

// =====================================
// Screencast and Media Types
// =====================================

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

export interface ScreencastFrame {
    data: string;
    metadata: ScreencastMetadata;
    sessionId: string;
    frameId: number;
}

// =====================================
// Infrastructure Provider Types
// =====================================

export interface ProviderConfig {
    region?: string;
    apiKey?: string;
    timeout?: number;
    retryAttempts?: number;
    metadata?: Record<string, unknown>;
}

export interface TaskInfo {
    taskId: string;
    status: string;
    createdAt: Date;
    startedAt?: Date;
    stoppedAt?: Date;
    metadata?: Record<string, unknown>;
}

// =====================================
// Artifact Types
// =====================================

export interface Artifact {
    id: string;
    name: string;
    size: number;
    mimeType?: string;
    createdAt: Date;
    path: string;
    metadata?: Record<string, unknown>;
    url?: string;
}

export interface ArtifactUploadOptions {
    sessionId: string;
    metadata?: Record<string, unknown>;
    contentType?: string;
    tags?: Record<string, string>;
}

// =====================================
// Message and Communication Types
// =====================================

export interface WebSocketMessage {
    type: string;
    id?: number;
    method?: string;
    params?: unknown;
    sessionId?: string;
    data?: unknown;
    event?: unknown;
    timestamp: number;
}

export interface FrameStreamMessage {
    type: 'frame' | 'event' | 'status';
    sessionId: string;
    timestamp: string;
    data?: unknown;
}

// =====================================
// Error Types
// =====================================

export interface WallCrawlerError {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    timestamp: Date;
    sessionId?: string;
    userId?: string;
}

// =====================================
// Provider Interface Types
// =====================================

export interface IBrowserProvider {
    /**
     * Initialize the provider
     */
    initialize(): Promise<void>;

    /**
     * Create a new browser session
     */
    createSession(options?: SessionOptions): Promise<BrowserSession>;

    /**
     * Get an existing session
     */
    getSession(sessionId: string): Promise<BrowserSession | null>;

    /**
     * End a browser session
     */
    endSession(sessionId: string): Promise<void>;

    /**
     * Upload an artifact
     */
    uploadArtifact(data: Buffer | string, options: ArtifactUploadOptions): Promise<Artifact>;

    /**
     * Health check
     */
    healthCheck(): Promise<boolean>;
}

/**
 * Type for the getSession API response
 */
export interface SessionDetails {
    id: string;
    status: string;
    userId: string;
    createdAt: string;
    lastActivity: string;
    lastHeartbeat: string;
    timeout: number | null;
    browserSettings: Record<string, unknown>;
    taskArn: string;
    taskStatus: string;
    activeConnections: number;
    pendingMessages: number;
}