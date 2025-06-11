import { createHash } from 'crypto';
import { InfrastructureProvider } from '../types/infrastructure';

interface CachedItem {
  value: any;
  expiresAt: number;
}

export interface CacheKeyParams {
  url: string;
  selector?: string;
  action?: string;
  llmModel?: string;
  instruction?: string;
  schema?: string;
  viewport?: { width: number; height: number };
}

export class CacheManager {
  private provider?: InfrastructureProvider;
  private memoryCache: Map<string, CachedItem> = new Map();
  private maxMemoryItems: number = 1000;

  constructor(maxMemoryItems?: number) {
    if (maxMemoryItems) {
      this.maxMemoryItems = maxMemoryItems;
    }
  }

  setProvider(provider: InfrastructureProvider): void {
    this.provider = provider;
  }

  async get(key: string): Promise<any | null> {
    // Check memory cache first
    const memItem = this.memoryCache.get(key);
    if (memItem && memItem.expiresAt > Date.now()) {
      return memItem.value;
    }

    // Clean up expired item from memory
    if (memItem) {
      this.memoryCache.delete(key);
    }

    // Check provider cache if available
    if (this.provider && this.provider.cacheGet) {
      return this.provider.cacheGet(key);
    }

    return null;
  }

  async set(
    key: string,
    value: any,
    ttl: number = 3600
  ): Promise<void> {
    // Enforce memory cache size limit
    if (this.memoryCache.size >= this.maxMemoryItems) {
      // Remove oldest expired items first
      const now = Date.now();
      for (const [k, item] of this.memoryCache) {
        if (item.expiresAt <= now) {
          this.memoryCache.delete(k);
        }
        if (this.memoryCache.size < this.maxMemoryItems) {
          break;
        }
      }

      // If still over limit, remove oldest items
      if (this.memoryCache.size >= this.maxMemoryItems) {
        const toRemove = this.memoryCache.size - this.maxMemoryItems + 1;
        const keys = Array.from(this.memoryCache.keys());
        for (let i = 0; i < toRemove; i++) {
          this.memoryCache.delete(keys[i]);
        }
      }
    }

    // Set in memory cache
    this.memoryCache.set(key, {
      value,
      expiresAt: Date.now() + ttl * 1000,
    });

    // Set in provider cache if available
    if (this.provider && this.provider.cacheSet) {
      await this.provider.cacheSet(key, value, ttl);
    }
  }

  generateKey(params: CacheKeyParams): string {
    const normalized = JSON.stringify(params, Object.keys(params).sort());
    return createHash('sha256').update(normalized).digest('hex');
  }

  async clear(): Promise<void> {
    this.memoryCache.clear();
    // Note: Provider cache clearing would need to be implemented separately
  }

  getMemoryStats(): { size: number; maxSize: number } {
    return {
      size: this.memoryCache.size,
      maxSize: this.maxMemoryItems,
    };
  }
}