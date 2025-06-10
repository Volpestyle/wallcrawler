export interface WallCrawlerLogEntry {
  timestamp: string; // ISO 8601
  level: 0 | 1 | 2; // 0: error, 1: info, 2: debug
  category: LogCategory;
  message: string;
  requestId: string; // UUID v4
  sessionId?: string; // AWS session ID
  duration?: number; // Operation duration in ms
  auxiliary?: Record<string, { value: any; type: string }>;
  stack?: string; // Error stack traces only
}

export type LogCategory =
  | 'act'
  | 'extract'
  | 'observe'
  | 'llm'
  | 'llm_cache'
  | 'dom'
  | 'cdp'
  | 'aws'
  | 'network'
  | 'error'
  | 'core'
  | 'page'
  | 'debug';

export interface DebugTools {
  // Save processed DOM with element IDs
  exportDom(filepath: string): Promise<void>;

  // Export accessibility tree as JSON
  exportA11yTree(filepath: string): Promise<void>;

  // Generate network waterfall diagram
  exportNetworkTimeline(filepath: string): Promise<void>;

  // Create visual action replay
  exportActionHistory(format: 'json' | 'video'): Promise<void>;
}