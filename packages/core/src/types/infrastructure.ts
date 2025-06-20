import { Cookie, ViewportSize } from 'playwright';
import { WallCrawlerPage } from './page';

export interface BrowserState {
  sessionId: string;
  url: string;
  cookies: Cookie[];
  localStorage: Record<string, string>;
  sessionStorage: Record<string, string>;
  viewport?: ViewportSize;
  screenshot?: Buffer;
}

export interface Checkpoint extends BrowserState {
  timestamp: number;
  headers: Record<string, string>;
}

export interface StateReference {
  sessionId: string;
  bucket: string;
  key: string;
}

export interface CheckpointReference extends StateReference {
  timestamp: number;
}

export interface ArtifactReference extends StateReference {
  type: 'screenshot' | 'dom' | 'video' | 'trace';
  contentType: string;
}

export interface Artifact {
  type: 'screenshot' | 'dom' | 'video' | 'trace';
  data: Buffer | string;
  metadata: Record<string, any>;
}

export interface InterventionEvent {
  type: InterventionType;
  sessionId: string;
  url: string;
  selector?: string;
  screenshot?: Buffer;
  description: string;
  context: InterventionContext;
}

export interface InterventionContext {
  // Page context
  pageTitle: string;
  currentUrl: string;
  accessibilityTree?: string;
  
  // Action context
  actionHistory: ActionHistoryItem[];
  lastAction?: ActionHistoryItem;
  errorMessage?: string;
  
  // Detection context
  confidence: number; // 0-1 confidence level
  detectionReason: string;
  suggestedAction?: string;
  
  // Technical context
  timestamp: number;
  userAgent?: string;
  viewport?: { width: number; height: number };
  
  // Additional metadata
  metadata: Record<string, any>;
}

export interface ActionHistoryItem {
  action: string;
  timestamp: number;
  details: any;
  success?: boolean;
  error?: string;
}

export interface InterventionSession {
  sessionId: string;
  interventionId: string;
  portalUrl: string;
  expiresAt: number;
}

export interface InterventionResult {
  completed: boolean;
  action?: string;
  data?: Record<string, any>;
}

export interface Metric {
  name: string;
  value: number;
  unit: string;
  timestamp: number;
  dimensions: Record<string, string>;
}

export interface MetricQuery {
  name?: string;
  startTime?: number;
  endTime?: number;
  dimensions?: Record<string, string>;
}

export type InterventionType =
  | 'captcha'
  | '2fa'
  | 'login'
  | 'consent'
  | 'payment'
  | 'custom';

export interface BrowserConfig {
  sessionId?: string;
  headless?: boolean;
  viewport?: ViewportSize;
  userAgent?: string;
  locale?: string;
  timezone?: string;
  timeout?: number;
}

export interface InfrastructureProvider {
  // Core browser operations
  createBrowser(config: BrowserConfig, wallcrawlerConfig: import('./config').WallCrawlerConfig): Promise<WallCrawlerPage>;
  destroyBrowser(sessionId: string): Promise<void>;
  
  // State management
  saveState(state: BrowserState): Promise<StateReference>;
  loadState(reference: StateReference): Promise<BrowserState>;
  saveCheckpoint(checkpoint: Checkpoint): Promise<CheckpointReference>;
  loadCheckpoint(reference: CheckpointReference): Promise<Checkpoint>;
  
  // Artifact management
  saveArtifact(artifact: Artifact): Promise<ArtifactReference>;
  loadArtifact(reference: ArtifactReference): Promise<Artifact>;
  
  // Intervention support
  handleIntervention(event: InterventionEvent): Promise<InterventionSession>;
  waitForIntervention(sessionId: string): Promise<InterventionResult>;
  
  // Metrics and monitoring
  recordMetric(metric: Metric): Promise<void>;
  getMetrics(query: MetricQuery): Promise<Metric[]>;
  
  // Optional cache support
  cacheGet?(key: string): Promise<any | null>;
  cacheSet?(key: string, value: any, ttl: number): Promise<void>;
}