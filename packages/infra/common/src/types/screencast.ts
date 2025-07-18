/**
 * Screencast types for WallCrawler browser automation
 */

export interface ScreencastOptions {
    /** JPEG quality 1-100 (default: 80) */
    quality?: number;
    /** Frame sampling rate - send every Nth frame (default: 10) */
    everyNthFrame?: number;
    /** Enable idle detection to save bandwidth (default: true) */
    detectIdle?: boolean;
    /** Change threshold 0-1 for idle detection (default: 0.01) */
    idleThreshold?: number;
    /** Maximum frame width in pixels (default: 1024) */
    maxWidth?: number;
    /** Maximum frame height in pixels (default: 768) */
    maxHeight?: number;
}

export interface ScreencastMetadata {
    /** Timestamp when frame was captured */
    timestamp: number;
    /** Offset from top of page */
    offsetTop: number;
    /** Offset from left of page */
    offsetLeft: number;
    /** Page scale factor */
    pageScaleFactor: number;
    /** Device width in pixels */
    deviceWidth: number;
    /** Device height in pixels */
    deviceHeight: number;
    /** Horizontal scroll offset */
    scrollOffsetX: number;
    /** Vertical scroll offset */
    scrollOffsetY: number;
}

export interface ScreencastFrame {
    /** Base64 encoded JPEG data */
    data: string;
    /** Frame metadata for coordinate transformation */
    metadata: ScreencastMetadata;
    /** Session ID this frame belongs to */
    sessionId: string;
    /** Frame sequence number for acknowledgment */
    frameId?: number;
}

export interface MouseInputEvent {
    type: 'mousePressed' | 'mouseReleased' | 'mouseMoved';
    /** X coordinate relative to viewport */
    x: number;
    /** Y coordinate relative to viewport */
    y: number;
    /** Mouse button pressed */
    button?: 'left' | 'right' | 'middle';
    /** Number of clicks for multi-click events */
    clickCount?: number;
    /** Modifier keys pressed */
    modifiers?: number;
}

export interface KeyboardInputEvent {
    type: 'keyDown' | 'keyUp' | 'char';
    /** Text to type (for char events) */
    text?: string;
    /** Key code (for key events) */
    key?: string;
    /** Physical key code */
    code?: string;
    /** Modifier keys pressed */
    modifiers?: number;
}

export interface ScrollInputEvent {
    type: 'mouseWheel';
    /** X coordinate of scroll */
    x: number;
    /** Y coordinate of scroll */
    y: number;
    /** Horizontal scroll delta */
    deltaX: number;
    /** Vertical scroll delta */
    deltaY: number;
}

export type InputEvent = MouseInputEvent | KeyboardInputEvent | ScrollInputEvent;

// WebSocket Message Types

export interface StartScreencastMessage {
    type: 'START_SCREENCAST';
    sessionId: string;
    params: ScreencastOptions;
}

export interface StopScreencastMessage {
    type: 'STOP_SCREENCAST';
    sessionId: string;
}

export interface ScreencastFrameMessage {
    type: 'SCREENCAST_FRAME';
    sessionId: string;
    data: string;
    metadata: ScreencastMetadata;
    frameId?: number;
}

export interface ScreencastFrameAckMessage {
    type: 'SCREENCAST_FRAME_ACK';
    sessionId: string;
    frameId: number;
}

export interface SendInputMessage {
    type: 'SEND_INPUT';
    sessionId: string;
    event: InputEvent;
}

export type ScreencastMessage =
    | StartScreencastMessage
    | StopScreencastMessage
    | ScreencastFrameMessage
    | ScreencastFrameAckMessage
    | SendInputMessage;

// Frame Detection State (Internal)

export interface FrameDetectionState {
    /** Hash of the last frame that was sent */
    lastFrameHash: string | null;
    /** Number of consecutive idle frames */
    idleFrameCount: number;
    /** Timestamp of last forced frame */
    lastForcedTime: number;
    /** Screencast options */
    options: ScreencastOptions;
}

// Configuration

export interface ScreencastConfig {
    /** Enable screencast features */
    enabled: boolean;
    /** Maximum concurrent streams per container */
    maxConcurrentStreams: number;
    /** Default JPEG quality 1-100 */
    defaultQuality: number;
    /** Default frame rate (everyNthFrame) */
    defaultFrameRate: number;
    /** Enable idle detection by default */
    idleDetection: boolean;
    /** Default frame size limits */
    maxFrameSize: {
        width: number;
        height: number;
    };
    /** Force frame interval in milliseconds */
    forceFrameInterval: number;
}

// Events

export interface ScreencastEvents {
    /** Emitted when screencast starts successfully */
    screencastStarted: (sessionId: string) => void;
    /** Emitted when screencast stops */
    screencastStopped: (sessionId: string) => void;
    /** Emitted when a new frame is received */
    screencastFrame: (frame: ScreencastFrame) => void;
    /** Emitted when screencast encounters an error */
    screencastError: (error: Error, sessionId: string) => void;
}

// Utility Types

export interface CoordinateTransform {
    /** Scale factor from canvas to browser viewport */
    scaleX: number;
    /** Scale factor from canvas to browser viewport */
    scaleY: number;
    /** X offset including scroll */
    offsetX: number;
    /** Y offset including scroll */
    offsetY: number;
}

export interface ScreencastStats {
    /** Total frames sent */
    framesSent: number;
    /** Total frames skipped due to idle detection */
    framesSkipped: number;
    /** Bytes transmitted */
    bytesTransmitted: number;
    /** Average frame size in bytes */
    averageFrameSize: number;
    /** Frames per second (actual) */
    actualFps: number;
    /** Percentage of frames skipped */
    skipPercentage: number;
} 