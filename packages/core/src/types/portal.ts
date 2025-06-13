import { ViewportSize } from "playwright";

/**
 * Portal Session State
 * Tracks the current state of a portal session
 */
export interface PortalSession {
  sessionId: string;
  userId?: string;
  status: PortalStatus;
  createdAt: number;
  lastActiveAt: number;
  expiresAt: number;
  portalUrl: string;
  connectionId?: string;
}

export type PortalStatus = 
  | "pending"     // Portal created but not yet connected
  | "connected"   // Portal is connected and active
  | "paused"      // Automation is paused, user has control
  | "automated"   // Automation is running, portal observing
  | "intervention" // Intervention required, waiting for user
  | "expired"     // Portal session has expired
  | "closed";     // Portal explicitly closed

/**
 * Browser State for Portal Streaming
 * Comprehensive snapshot of current browser state
 */
export interface PortalBrowserState {
  sessionId: string;
  timestamp: number;
  
  // Page information
  url: string;
  title: string;
  viewport: ViewportSize;
  
  // Visual state
  screenshot?: string; // Base64 encoded PNG
  videoFrame?: string; // Base64 encoded frame for video streaming
  
  // DOM state
  domState?: {
    simplified: string;
    interactive: InteractiveElement[];
    formData?: Record<string, any>;
  };
  
  // Automation state
  automationStatus: AutomationStatus;
  lastAction?: ActionInfo;
  actionHistory: ActionInfo[];
  
  // Intervention context
  interventionRequired?: boolean;
  interventionReason?: string;
  
  // Performance metrics
  metrics?: {
    loadTime: number;
    responseTime: number;
    memoryUsage: number;
  };
}

export type AutomationStatus = 
  | "running"      // Automation is actively executing
  | "waiting"      // Automation is waiting for something
  | "paused"       // Automation paused by user
  | "error"        // Automation encountered an error
  | "completed"    // Automation finished successfully
  | "manual";      // User has taken manual control

export interface ActionInfo {
  id: string;
  type: string;
  description: string;
  timestamp: number;
  success?: boolean;
  error?: string;
  duration?: number;
  details?: Record<string, any>;
}

export interface InteractiveElement {
  selector: string;
  tagName: string;
  type?: string;
  label?: string;
  value?: string;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  visible: boolean;
  interactable: boolean;
  highlighted?: boolean;
}

/**
 * Portal Commands
 * Commands that can be sent from portal to automation
 */
export interface PortalCommand {
  id: string;
  type: PortalCommandType;
  timestamp: number;
  payload?: Record<string, any>;
}

export type PortalCommandType =
  | "pause"           // Pause automation
  | "resume"          // Resume automation  
  | "stop"            // Stop automation completely
  | "take-control"    // User wants manual control
  | "return-control"  // Return control to automation
  | "execute-action"  // Execute a specific action
  | "inject-script"   // Inject JavaScript into page
  | "screenshot"      // Take a screenshot
  | "reload"          // Reload the page
  | "navigate"        // Navigate to a new URL
  | "close-portal";   // Close the portal session

/**
 * Portal Events
 * Events that can be sent from automation to portal
 */
export interface PortalEvent {
  id: string;
  type: PortalEventType;
  timestamp: number;
  payload?: Record<string, any>;
}

export type PortalEventType =
  | "state-update"        // Browser state has changed
  | "action-started"      // New action started
  | "action-completed"    // Action completed
  | "action-failed"       // Action failed
  | "intervention-required" // Human intervention needed
  | "intervention-completed" // Intervention resolved
  | "automation-paused"   // Automation was paused
  | "automation-resumed"  // Automation was resumed
  | "automation-completed" // Automation finished
  | "error"              // Error occurred
  | "portal-opened"      // Portal was opened
  | "portal-closed";     // Portal was closed

/**
 * Portal Configuration
 * Configuration options for portal behavior
 */
export interface PortalConfig {
  // Session settings
  sessionTimeoutMs: number;
  maxInactivityMs: number;
  
  // Streaming settings
  updateIntervalMs: number;
  screenshotQuality: number;
  maxScreenshotSize: number;
  enableVideoStream: boolean;
  videoFrameRate: number;
  
  // Feature flags
  allowManualControl: boolean;
  allowScriptInjection: boolean;
  enableMetrics: boolean;
  enableDOMStream: boolean;
  
  // UI settings
  theme: "light" | "dark" | "auto";
  language: string;
  
  // Security settings
  requireAuthentication: boolean;
  allowedOrigins: string[];
  csrfToken?: string;
}

/**
 * Portal Connection Info
 * Information about the portal connection
 */
export interface PortalConnectionInfo {
  connectionId: string;
  protocol: "websocket" | "sse" | "polling";
  endpoint: string;
  authenticationType: "token" | "session" | "none";
  connectedAt: number;
  lastPingAt: number;
}

/**
 * Portal Statistics
 * Usage and performance statistics
 */
export interface PortalStats {
  sessionId: string;
  
  // Usage stats
  totalDuration: number;
  manualControlDuration: number;
  actionsExecuted: number;
  interventionsHandled: number;
  
  // Performance stats
  averageResponseTime: number;
  dataTransferred: number;
  screenshotsTaken: number;
  
  // Connection stats
  connectionDrops: number;
  reconnections: number;
  averageLatency: number;
}