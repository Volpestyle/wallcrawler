import { z } from 'zod';

// Intervention Event Types (received from WallCrawler)
export interface InterventionEvent {
  sessionId: string;
  type: InterventionType;
  confidence: number;
  elements: InterventionElement[];
  url: string;
  title: string;
  screenshot?: string;
  suggestedAction?: string;
  metadata?: Record<string, any>;
}

export enum InterventionType {
  LOGIN = 'LOGIN',
  CAPTCHA = 'CAPTCHA',
  TWO_FACTOR = 'TWO_FACTOR',
  COOKIE_CONSENT = 'COOKIE_CONSENT',
  GDPR_CONSENT = 'GDPR_CONSENT',
  PAYWALL = 'PAYWALL',
  RATE_LIMIT = 'RATE_LIMIT',
  CUSTOM = 'CUSTOM',
  UNKNOWN = 'UNKNOWN'
}

export interface InterventionElement {
  selector: string;
  type: string;
  label?: string;
  required: boolean;
  value?: string;
}

// Notification Types
export interface NotificationProvider {
  initialize(config: NotificationConfig): Promise<void>;
  sendNotification(request: InterventionRequest): Promise<NotificationResult>;
  getDeviceTokens(userId: string): Promise<DeviceToken[]>;
  registerDevice(token: DeviceToken): Promise<void>;
}

export interface NotificationConfig {
  apnsCertificate?: string;
  fcmServerKey?: string;
  snsTopicArn?: string;
  emailFrom?: string;
  webPushVapidKeys?: {
    publicKey: string;
    privateKey: string;
  };
}

export interface InterventionRequest {
  sessionId: string;
  userId: string;
  interventionType: InterventionType;
  portalUrl: string;
  expiresAt: number;
  context: {
    url: string;
    title: string;
    screenshot?: string;
    elements: InterventionElement[];
  };
  priority: 'high' | 'normal' | 'low';
}

export interface NotificationResult {
  status: 'sent' | 'failed' | 'queued';
  channels: NotificationChannel[];
  notificationId: string;
  timestamp: number;
}

export interface NotificationChannel {
  type: 'push' | 'websocket' | 'email' | 'sms';
  status: 'success' | 'failed';
  deviceId?: string;
  error?: string;
}

export interface DeviceToken {
  userId: string;
  deviceId: string;
  platform: 'ios' | 'android' | 'web';
  token: string;
  endpoint?: string;
  createdAt: number;
  lastUsed?: number;
}

// Portal Types
export interface InterventionSession {
  sessionId: string;
  userId: string;
  interventionId: string;
  status: 'pending' | 'active' | 'completed' | 'expired';
  createdAt: number;
  expiresAt: number;
  completedAt?: number;
  actions: InterventionAction[];
}

export interface InterventionAction {
  type: 'fill' | 'click' | 'select' | 'upload' | 'custom';
  selector: string;
  value?: any;
  timestamp: number;
}

export interface BrowserState {
  sessionId: string;
  url: string;
  title: string;
  screenshot: string;
  viewport: {
    width: number;
    height: number;
  };
  elements: Array<{
    selector: string;
    type: string;
    visible: boolean;
    interactable: boolean;
    bounds: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
  }>;
}

// WebSocket Message Types
export const WebSocketMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('browser-state'),
    payload: z.object({
      state: z.any(), // BrowserState
    }),
  }),
  z.object({
    type: z.literal('user-action'),
    payload: z.object({
      action: z.any(), // InterventionAction
    }),
  }),
  z.object({
    type: z.literal('complete'),
    payload: z.object({
      sessionId: z.string(),
      success: z.boolean(),
    }),
  }),
  z.object({
    type: z.literal('error'),
    payload: z.object({
      message: z.string(),
      code: z.string().optional(),
    }),
  }),
]);

export type WebSocketMessage = z.infer<typeof WebSocketMessageSchema>;

// DynamoDB Table Schemas
export interface InterventionRecord {
  PK: string; // INTERVENTION#<interventionId>
  SK: string; // SESSION#<sessionId>
  userId: string;
  type: InterventionType;
  status: 'pending' | 'active' | 'completed' | 'expired';
  createdAt: number;
  expiresAt: number;
  ttl: number; // For DynamoDB TTL
  portalUrl: string;
  context: Record<string, any>;
}

export interface DeviceTokenRecord {
  PK: string; // USER#<userId>
  SK: string; // DEVICE#<deviceId>
  platform: 'ios' | 'android' | 'web';
  token: string;
  endpoint?: string;
  createdAt: number;
  lastUsed: number;
  ttl: number;
}

export interface NotificationStatusRecord {
  PK: string; // NOTIFICATION#<notificationId>
  SK: string; // TIMESTAMP#<timestamp>
  status: 'pending' | 'delivered' | 'failed';
  channel: string;
  attempts: number;
  metadata: Record<string, any>;
  ttl: number;
}