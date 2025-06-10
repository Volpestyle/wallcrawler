export interface LambdaHandler {
  // Handle 15-minute timeout with checkpoint/resume
  execute(event: AutomationEvent): Promise<AutomationResult>;
  checkpoint(state: SessionState): Promise<string>;
  resume(checkpointId: string): Promise<SessionState>;
}

export interface AutomationEvent {
  task: string;
  config: any;
  checkpointId?: string;
  sessionId?: string;
}

export interface AutomationResult {
  success: boolean;
  data?: any;
  error?: string;
  checkpointId?: string;
  sessionId: string;
}

export interface SessionState {
  browserWSEndpoint: string;
  cookies: any[];
  currentUrl: string;
  navigationHistory: string[];
  lastAction: string;
  checkpointTimestamp: number;
}

export interface DynamoDBSession {
  sessionId: string;
  state: SessionState;
  createdAt: number;
  updatedAt: number;
  ttl: number;
}

export interface S3Artifact {
  bucket: string;
  key: string;
  contentType: string;
  metadata: Record<string, string>;
}