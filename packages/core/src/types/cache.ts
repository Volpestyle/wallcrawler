export interface CacheEntry {
  key: string;
  value: any;
  metadata: {
    timestamp: number;
    ttl: number;
    hits: number;
    provider: string;
    model: string;
    tokenUsage: { input: number; output: number };
  };
}

export interface CacheManager {
  get(key: string): Promise<CacheEntry | null>;
  set(key: string, value: any, metadata: CacheEntry['metadata']): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
  getStats(): Promise<CacheStats>;
}

export interface CacheStats {
  totalEntries: number;
  totalHits: number;
  totalMisses: number;
  hitRate: number;
  totalTokensUsed: { input: number; output: number };
  oldestEntry: number;
  newestEntry: number;
}