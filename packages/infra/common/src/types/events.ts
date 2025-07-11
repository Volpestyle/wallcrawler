/**
 * Common event types for real-time browser automation communication
 * Generalized from career-agent implementation
 */

import { TaskStatus } from './automation';
import { BrowserSession } from './session';

/**
 * Base event interface for all automation events
 */
export interface BaseAutomationEvent {
  /** Event type identifier */
  type: string;
  /** Event timestamp */
  timestamp: string;
  /** Session ID this event belongs to */
  sessionId?: string;
}

/**
 * Event fired when items are processed/extracted
 */
export interface ItemsProcessedEvent extends BaseAutomationEvent {
  type: 'items_processed';
  data: {
    /** Items that were processed */
    items: unknown[];
    /** Total items processed so far */
    totalItemsProcessed: number;
    /** Additional processing metadata */
    metadata?: Record<string, unknown>;
  };
}

/**
 * Event fired when session is updated
 */
export interface SessionUpdatedEvent extends BaseAutomationEvent {
  type: 'session_updated';
  data: {
    /** Updated session data */
    session: BrowserSession;
  };
}

/**
 * Event fired when automation configuration is updated
 */
export interface ConfigUpdatedEvent extends BaseAutomationEvent {
  type: 'config_updated';
  data: {
    /** Updated configuration */
    config: Record<string, unknown>;
  };
}

/**
 * Event fired when automation status changes
 */
export interface AutomationStatusEvent extends BaseAutomationEvent {
  type: 'automation_status';
  data: {
    /** New status */
    status: TaskStatus;
    /** Optional status message */
    message?: string;
    /** Task ARN if applicable */
    taskArn?: string;
    /** Additional status metadata */
    metadata?: Record<string, unknown>;
  };
}

/**
 * Event fired for VNC connection changes
 */
export interface VncConnectionEvent extends BaseAutomationEvent {
  type: 'vnc_connection';
  data: {
    /** Connection status */
    status: 'connected' | 'disconnected' | 'error';
    /** Connection identifier */
    connectionId?: string;
    /** VNC URL */
    vncUrl?: string;
    /** Additional connection metadata */
    metadata?: Record<string, unknown>;
  };
}

/**
 * Event fired when errors occur
 */
export interface ErrorEvent extends BaseAutomationEvent {
  type: 'error';
  data: {
    /** Error message */
    error: string;
    /** Detailed error information */
    details?: string;
    /** Component that generated the error */
    component?: string;
    /** Error code */
    code?: string;
    /** Additional error metadata */
    metadata?: Record<string, unknown>;
  };
}

/**
 * Event fired for progress updates
 */
export interface ProgressEvent extends BaseAutomationEvent {
  type: 'progress';
  data: {
    /** Progress percentage (0-100) */
    progress: number;
    /** Progress message */
    message?: string;
    /** Current step */
    currentStep?: string;
    /** Total steps */
    totalSteps?: number;
    /** Additional progress metadata */
    metadata?: Record<string, unknown>;
  };
}

/**
 * Union type for all possible automation events
 */
export type AutomationEvent =
  | ItemsProcessedEvent
  | SessionUpdatedEvent
  | ConfigUpdatedEvent
  | AutomationStatusEvent
  | VncConnectionEvent
  | ErrorEvent
  | ProgressEvent;

/**
 * Event callback function type
 */
export type EventCallback = (event: AutomationEvent) => void | Promise<void>;

/**
 * Event publisher interface
 */
export interface IEventPublisher {
  /**
   * Publish an event to a specific session
   */
  publishEvent(sessionId: string, event: AutomationEvent): Promise<void>;

  /**
   * Subscribe to events for a session
   */
  subscribe(sessionId: string, callback: EventCallback): Promise<string>;

  /**
   * Unsubscribe from events
   */
  unsubscribe(subscriptionId: string): Promise<void>;

  /**
   * Clean up expired subscriptions
   */
  cleanup(): Promise<void>;
}
