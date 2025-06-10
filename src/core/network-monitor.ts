import { CDPSession } from 'playwright';
import { NetworkMonitor, NetworkRequest, SettlementOptions } from '../types/cdp';
import { createLogger } from '../utils/logger';

const logger = createLogger('network');

const DEFAULT_SETTLEMENT_OPTIONS: SettlementOptions = {
  quietWindowMs: 500,
  maxWaitMs: 30000,
  ignorePatterns: [
    /\.(png|jpg|jpeg|gif|svg|ico|webp)$/i, // Images
    /\.(woff|woff2|ttf|eot)$/i, // Fonts
    /\.(css|scss|sass|less)$/i, // Stylesheets
    /\/ws$|\/websocket/i, // WebSocket connections
    /\/sse$|\/events$/i, // Server-sent events
    /google-analytics|googletagmanager|doubleclick/i, // Analytics
    /hotjar|fullstory|segment|mixpanel/i, // More analytics
  ],
};

export class DefaultNetworkMonitor implements NetworkMonitor {
  private activeRequests: Map<string, NetworkRequest> = new Map();
  private lastActivityTime: number = Date.now();
  private cdpSession: CDPSession | null = null;
  private isMonitoring: boolean = false;

  constructor(private options: SettlementOptions = DEFAULT_SETTLEMENT_OPTIONS) {}

  async initialize(cdpSession: CDPSession): Promise<void> {
    this.cdpSession = cdpSession;
    
    // Enable network domain
    await cdpSession.send('Network.enable');
    
    // Set up event listeners
    cdpSession.on('Network.requestWillBeSent', this.handleRequestWillBeSent.bind(this));
    cdpSession.on('Network.responseReceived', this.handleResponseReceived.bind(this));
    cdpSession.on('Network.loadingFailed', this.handleLoadingFailed.bind(this));
    cdpSession.on('Network.loadingFinished', this.handleLoadingFinished.bind(this));
    
    this.isMonitoring = true;
    logger.info('Network monitoring initialized');
  }

  trackRequest(request: NetworkRequest): void {
    // Check if we should ignore this request
    if (this.shouldIgnoreRequest(request.url)) {
      logger.debug('Ignoring request', { url: request.url });
      return;
    }

    this.activeRequests.set(request.requestId, request);
    this.lastActivityTime = Date.now();
    
    logger.debug('Tracking request', {
      requestId: request.requestId,
      url: request.url,
      method: request.method,
      activeCount: this.activeRequests.size,
    });
  }

  isSettled(options?: Partial<SettlementOptions>): boolean {
    const opts = { ...this.options, ...options };
    const now = Date.now();
    const quietTime = now - this.lastActivityTime;
    
    // Clear any stalled requests
    this.clearStalled(5000); // 5 second timeout for stalled requests
    
    const hasActiveRequests = this.activeRequests.size > 0;
    const isQuietLongEnough = quietTime >= opts.quietWindowMs;
    
    logger.debug('Settlement check', {
      activeRequests: this.activeRequests.size,
      quietTime,
      quietWindowMs: opts.quietWindowMs,
      isSettled: !hasActiveRequests && isQuietLongEnough,
    });
    
    return !hasActiveRequests && isQuietLongEnough;
  }

  getActiveRequests(): NetworkRequest[] {
    return Array.from(this.activeRequests.values());
  }

  clearStalled(timeout: number): void {
    const now = Date.now();
    let stalledCount = 0;
    
    for (const [requestId, request] of this.activeRequests) {
      if (now - request.timestamp > timeout) {
        this.activeRequests.delete(requestId);
        stalledCount++;
      }
    }
    
    if (stalledCount > 0) {
      logger.debug('Cleared stalled requests', { count: stalledCount });
    }
  }

  private shouldIgnoreRequest(url: string): boolean {
    return this.options.ignorePatterns.some(pattern => pattern.test(url));
  }

  private handleRequestWillBeSent(params: any): void {
    const request: NetworkRequest = {
      requestId: params.requestId,
      frameId: params.frameId,
      url: params.request.url,
      method: params.request.method,
      timestamp: Date.now(),
      resourceType: params.type,
    };
    
    this.trackRequest(request);
  }

  private handleResponseReceived(params: any): void {
    // Don't remove the request yet - wait for loadingFinished
    logger.debug('Response received', {
      requestId: params.requestId,
      status: params.response.status,
    });
  }

  private handleLoadingFailed(params: any): void {
    this.activeRequests.delete(params.requestId);
    this.lastActivityTime = Date.now();
    
    logger.debug('Request failed', {
      requestId: params.requestId,
      errorText: params.errorText,
    });
  }

  private handleLoadingFinished(params: any): void {
    this.activeRequests.delete(params.requestId);
    this.lastActivityTime = Date.now();
    
    logger.debug('Request finished', {
      requestId: params.requestId,
      activeCount: this.activeRequests.size,
    });
  }

  async waitForSettlement(options?: Partial<SettlementOptions>): Promise<void> {
    const opts = { ...this.options, ...options };
    const startTime = Date.now();
    
    logger.info('Waiting for network settlement', opts);
    
    while (Date.now() - startTime < opts.maxWaitMs) {
      if (this.isSettled(opts)) {
        logger.info('Network settled', {
          duration: Date.now() - startTime,
          activeRequests: this.activeRequests.size,
        });
        return;
      }
      
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    logger.warn('Network settlement timeout', {
      duration: opts.maxWaitMs,
      activeRequests: this.activeRequests.size,
      pendingUrls: this.getActiveRequests().map(r => r.url),
    });
  }

  cleanup(): void {
    this.activeRequests.clear();
    this.isMonitoring = false;
    logger.info('Network monitor cleaned up');
  }
}