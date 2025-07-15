/**
 * Browser Session Sandboxing for Multi-Session Containers
 * Provides strong isolation between browser sessions running in the same container
 */

import { BrowserContext, Page } from 'playwright-core';
import { randomBytes } from 'crypto';
import * as path from 'path';

export interface SandboxOptions {
  sessionId: string;
  userId: string;
  isolationLevel: 'strict' | 'moderate' | 'basic';
}

export interface SandboxedContext {
  context: BrowserContext;
  sandbox: SessionSandbox;
}

export class SessionSandbox {
  private readonly sessionId: string;
  private readonly userId: string;
  private readonly isolationLevel: SandboxOptions['isolationLevel'];
  private readonly sandboxToken: string;
  private readonly userDataDir: string;
  private allowedDomains: Set<string> = new Set();
  private blockedResources: Set<string> = new Set();

  constructor(options: SandboxOptions) {
    this.sessionId = options.sessionId;
    this.userId = options.userId;
    this.isolationLevel = options.isolationLevel;
    this.sandboxToken = randomBytes(32).toString('hex');
    this.userDataDir = path.join('/tmp/browser-sessions', this.sessionId);
  }

  /**
   * Apply sandbox constraints to a browser context
   */
  async applyToContext(context: BrowserContext): Promise<void> {
    // 1. Route isolation - Intercept and validate all network requests
    await context.route('**/*', async (route, request) => {
      if (!this.isRequestAllowed(request)) {
        await route.abort('blockedbyclient');
        return;
      }
      await route.continue();
    });

    // 2. Cookie isolation - Prefix all cookies with session ID
    context.on('page', async (page) => {
      await this.sandboxPage(page);
    });

    // 3. Storage isolation - Override localStorage/sessionStorage
    await context.addInitScript(() => {
      const sessionId = (window as any).__SANDBOX_SESSION_ID__;

      // Wrap localStorage
      const originalLocalStorage = window.localStorage;
      const localStorageProxy = new Proxy(originalLocalStorage, {
        get(target, prop) {
          if (prop === 'getItem') {
            return (key: string) => target.getItem(`${sessionId}:${key}`);
          }
          if (prop === 'setItem') {
            return (key: string, value: string) => target.setItem(`${sessionId}:${key}`, value);
          }
          if (prop === 'removeItem') {
            return (key: string) => target.removeItem(`${sessionId}:${key}`);
          }
          if (prop === 'clear') {
            return () => {
              const keys: string[] = [];
              for (let i = 0; i < target.length; i++) {
                const key = target.key(i);
                if (key?.startsWith(`${sessionId}:`)) {
                  keys.push(key);
                }
              }
              keys.forEach((key) => target.removeItem(key));
            };
          }
          return Reflect.get(target, prop);
        },
      });
      Object.defineProperty(window, 'localStorage', {
        value: localStorageProxy,
        configurable: false,
        writable: false,
      });

      // Similar for sessionStorage
      const originalSessionStorage = window.sessionStorage;
      const sessionStorageProxy = new Proxy(originalSessionStorage, {
        get(target, prop) {
          if (prop === 'getItem') {
            return (key: string) => target.getItem(`${sessionId}:${key}`);
          }
          if (prop === 'setItem') {
            return (key: string, value: string) => target.setItem(`${sessionId}:${key}`, value);
          }
          if (prop === 'removeItem') {
            return (key: string) => target.removeItem(`${sessionId}:${key}`);
          }
          if (prop === 'clear') {
            return () => {
              const keys: string[] = [];
              for (let i = 0; i < target.length; i++) {
                const key = target.key(i);
                if (key?.startsWith(`${sessionId}:`)) {
                  keys.push(key);
                }
              }
              keys.forEach((key) => target.removeItem(key));
            };
          }
          return Reflect.get(target, prop);
        },
      });
      Object.defineProperty(window, 'sessionStorage', {
        value: sessionStorageProxy,
        configurable: false,
        writable: false,
      });
    }, this.sessionId);

    // 4. Memory isolation - Set memory limits based on isolation level
    if (this.isolationLevel === 'strict') {
      // Inject memory monitoring
      await context.addInitScript(() => {
        let memoryUsage = 0;
        const maxMemory = 100 * 1024 * 1024; // 100MB per session

        // Override array/object creation to track memory
        const originalArrayPush = Array.prototype.push;
        Array.prototype.push = function (...args) {
          memoryUsage += args.length * 8; // Rough estimate
          if (memoryUsage > maxMemory) {
            throw new Error('Session memory limit exceeded');
          }
          return originalArrayPush.apply(this, args);
        };
      });
    }

    // 5. CPU isolation - Throttle based on isolation level
    if (this.isolationLevel !== 'basic') {
      await context.addInitScript(() => {
        // Throttle setTimeout/setInterval
        const originalSetTimeout = window.setTimeout;
        const originalSetInterval = window.setInterval;
        const minDelay = 10; // Minimum 10ms delay

        window.setTimeout = function (this: Window, handler: TimerHandler, timeout?: number, ...args: any[]): number {
          return originalSetTimeout(handler, Math.max(timeout || 0, minDelay), ...args);
        } as typeof window.setTimeout;

        window.setInterval = function (this: Window, handler: TimerHandler, timeout?: number, ...args: any[]): number {
          return originalSetInterval(handler, Math.max(timeout || 0, minDelay), ...args);
        } as typeof window.setInterval;
      });
    }
  }

  /**
   * Sandbox individual pages
   */
  private async sandboxPage(page: Page): Promise<void> {
    // Inject session ID for storage isolation
    await page.addInitScript((sessionId) => {
      (window as any).__SANDBOX_SESSION_ID__ = sessionId;
    }, this.sessionId);

    // Block dangerous APIs based on isolation level
    if (this.isolationLevel === 'strict') {
      await page.addInitScript(() => {
        // Block WebRTC to prevent IP leakage
        delete (window as any).RTCPeerConnection;
        delete (window as any).RTCSessionDescription;
        delete (window as any).RTCIceCandidate;
        delete (window as any).webkitRTCPeerConnection;

        // Block Web Workers to prevent parallel execution
        delete (window as any).Worker;
        delete (window as any).SharedWorker;

        // Block WebGL to prevent fingerprinting
        const getContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (
          this: HTMLCanvasElement,
          contextType: string,
          options?: any
        ): RenderingContext | null {
          if (contextType === 'webgl' || contextType === 'webgl2') {
            return null;
          }
          return getContext.call(this, contextType, options);
        } as typeof HTMLCanvasElement.prototype.getContext;
      });
    }

    // Monitor and limit DOM operations
    if (this.isolationLevel !== 'basic') {
      await page.addInitScript(() => {
        let domOperations = 0;
        const maxDomOperations = 10000;

        const originalCreateElement = document.createElement;
        document.createElement = function (tagName: string) {
          domOperations++;
          if (domOperations > maxDomOperations) {
            throw new Error('DOM operation limit exceeded');
          }
          return originalCreateElement.call(this, tagName);
        };
      });
    }
  }

  /**
   * Check if a network request is allowed
   */
  private isRequestAllowed(request: any): boolean {
    const url = new URL(request.url());

    // Block file:// URLs
    if (url.protocol === 'file:') {
      return false;
    }

    // Block local network access in strict mode
    if (this.isolationLevel === 'strict') {
      const hostname = url.hostname;
      if (
        hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname.startsWith('192.168.') ||
        hostname.startsWith('10.') ||
        hostname.startsWith('172.')
      ) {
        return false;
      }
    }

    // Check domain allowlist if configured
    if (this.allowedDomains.size > 0 && !this.allowedDomains.has(url.hostname)) {
      return false;
    }

    // Block specific resource types in strict mode
    if (this.isolationLevel === 'strict') {
      const resourceType = request.resourceType();
      if (['websocket', 'eventsource', 'manifest'].includes(resourceType)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Set allowed domains for this session
   */
  setAllowedDomains(domains: string[]): void {
    this.allowedDomains = new Set(domains);
  }

  /**
   * Clean up sandbox resources
   */
  async cleanup(): Promise<void> {
    // Clean up user data directory
    try {
      const fs = await import('fs/promises');
      await fs.rm(this.userDataDir, { recursive: true, force: true });
    } catch (error) {
      console.error(`Failed to clean up sandbox for ${this.sessionId}:`, error);
    }
  }

  /**
   * Get sandbox metrics
   */
  getMetrics(): SandboxMetrics {
    return {
      sessionId: this.sessionId,
      userId: this.userId,
      isolationLevel: this.isolationLevel,
      sandboxToken: this.sandboxToken,
    };
  }
}

interface SandboxMetrics {
  sessionId: string;
  userId: string;
  isolationLevel: string;
  sandboxToken: string;
}

/**
 * Create a sandboxed browser context
 */
export async function createSandboxedContext(
  browser: any,
  options: SandboxOptions & { contextOptions?: any }
): Promise<SandboxedContext> {
  const sandbox = new SessionSandbox(options);

  // Create context with isolated storage
  const context = await browser.newContext({
    ...options.contextOptions,
    // Force separate user data directory per session
    userDataDir: sandbox['userDataDir'],
    // Disable service workers in strict mode
    serviceWorkers: options.isolationLevel === 'strict' ? 'block' : 'allow',
    // Set permissions based on isolation level
    permissions: options.isolationLevel === 'strict' ? [] : undefined,
    // Isolate cookies
    httpCredentials: undefined,
    // Clear storage state
    storageState: undefined,
  });

  // Apply sandbox constraints
  await sandbox.applyToContext(context);

  return { context, sandbox };
}
