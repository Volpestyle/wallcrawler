import { WallCrawlerConfig } from '../types/config';
import { WallCrawlerPage } from '../types/page';
import { createLogger } from '../utils/logger';
import { InfrastructureProvider, InterventionEvent, BrowserConfig } from '../types/infrastructure';
import { SessionManager } from './session-manager';
import { CacheManager } from './cache-manager';
import { randomUUID } from 'crypto';

const logger = createLogger('core');

export interface CreatePageOptions extends BrowserConfig {
  checkpointId?: string;
}

export class WallCrawler {
  private config: WallCrawlerConfig;
  private provider: InfrastructureProvider;
  private sessionManager: SessionManager;
  private cacheManager: CacheManager;
  private sessionId: string;

  constructor(provider: InfrastructureProvider, config: WallCrawlerConfig) {
    this.provider = provider;
    this.config = config;
    this.sessionId = randomUUID();
    this.sessionManager = new SessionManager();
    this.cacheManager = new CacheManager(this.config.features.caching.maxSize);
    
    // Initialize LLM client
    
    // Set infrastructure provider
    this.sessionManager.setProvider(this.provider);
    this.cacheManager.setProvider(this.provider);
    
    logger.info('WallCrawler initialized', {
      provider: this.config.llm.provider,
      model: this.config.llm.model,
      sessionId: this.sessionId,
    });
  }


  async createPage(options?: CreatePageOptions): Promise<WallCrawlerPage> {
    const config: BrowserConfig = {
      sessionId: options?.sessionId || this.sessionId,
      headless: options?.headless ?? this.config.browser.headless,
      viewport: options?.viewport ?? this.config.browser.viewport,
      ...(options?.userAgent ?? this.config.browser.userAgent ? { userAgent: options?.userAgent ?? this.config.browser.userAgent } : {}),
      ...(options?.locale ?? this.config.browser.locale ? { locale: options?.locale ?? this.config.browser.locale } : {}),
      ...(options?.timezone ?? this.config.browser.timezone ? { timezone: options?.timezone ?? this.config.browser.timezone } : {}),
      timeout: options?.timeout ?? this.config.browser.timeout,
    };
    
    const page = await this.provider.createBrowser(config, this.config);
    logger.info('Page created', { sessionId: page.sessionId });
    return page;
  }

  async handleInterventionDetected(
    page: WallCrawlerPage,
    event: InterventionEvent
  ): Promise<void> {
    try {
      // Save current state as checkpoint
      const checkpoint = await this.sessionManager.saveCheckpoint(page);
      if (!checkpoint) {
        throw new Error('Failed to create checkpoint for intervention');
      }
      
      // Trigger intervention through provider
      const session = await this.provider.handleIntervention({
        ...event,
        checkpointReference: checkpoint,
      } as any);

      logger.info('Intervention session created', { 
        sessionId: session.sessionId,
        interventionId: session.interventionId,
        portalUrl: session.portalUrl
      });

      // Wait for intervention completion
      const result = await this.provider.waitForIntervention(session.sessionId);
      
      if (result.completed) {
        logger.info('Intervention completed successfully', {
          sessionId: session.sessionId,
          action: result.action
        });
        
        // Resume is handled by provider during next createPage call
        logger.info('Ready to resume from checkpoint on next page creation');
      } else {
        throw new Error('Intervention failed or was cancelled');
      }
    } catch (error) {
      logger.error('Failed to handle intervention', error);
      throw error;
    }
  }

  async destroySession(sessionId: string): Promise<void> {
    try {
      await this.provider.destroyBrowser(sessionId);
      logger.info('Session destroyed', { sessionId });
    } catch (error) {
      logger.error('Error destroying session', error);
      throw error;
    }
  }

  getConfig(): WallCrawlerConfig {
    return this.config;
  }

  getSessionId(): string {
    return this.sessionId;
  }


  // Cache access methods
  getCache(): CacheManager {
    return this.cacheManager;
  }

  // Session management access
  getSessionManager(): SessionManager {
    return this.sessionManager;
  }

  // Provider access
  getProvider(): InfrastructureProvider {
    return this.provider;
  }
}