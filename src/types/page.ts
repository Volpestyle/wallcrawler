import { Page, Cookie } from 'playwright';
import { ActOptions, ExtractOptions, ObserveResult } from './handlers';

export interface WallCrawlerPage extends Page {
  // AI-powered methods
  act(instruction: string, options?: ActOptions): Promise<void>;
  extract<T>(options: ExtractOptions<T>): Promise<T>;
  observe(instruction?: string): Promise<ObserveResult[]>;

  // Session management
  checkpoint(): Promise<void>;
  restore(checkpointId: string): Promise<void>;

  // Debugging
  debugDom(filepath: string): Promise<void>;
  getMetrics(): Promise<PageMetrics>;
}

export interface PageMetrics {
  timestamp: number;
  url: string;
  domNodes: number;
  eventListeners: number;
  jsHeapUsed: number;
  jsHeapTotal: number;
  layoutDuration: number;
  scriptDuration: number;
  taskDuration: number;
}

export interface SessionState {
  browserWSEndpoint: string;
  cookies: Cookie[];
  currentUrl: string;
  navigationHistory: string[];
  lastAction: string;
  checkpointTimestamp: number;
}