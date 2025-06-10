import { Browser, BrowserContext, chromium, firefox, webkit } from 'playwright';
import { WallCrawlerConfig, defaultConfig } from '../types/config';
import { WallCrawlerPage } from '../types/page';
import { createLogger } from '../utils/logger';
import { DefaultCDPSessionManager } from './cdp-session-manager';
import { DefaultNetworkMonitor } from './network-monitor';
import { createWallCrawlerPage } from './wallcrawler-page';
import { LLMClientFactory } from '../llm/client-factory';
import { LLMClient } from '../types/llm';
import { randomUUID } from 'crypto';

const logger = createLogger('core');

export class WallCrawler {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private config: WallCrawlerConfig;
  private cdpSessionManager: DefaultCDPSessionManager;
  private llmClient: LLMClient;
  private sessionId: string;

  constructor(config?: Partial<WallCrawlerConfig>) {
    this.config = { ...defaultConfig, ...config };
    this.sessionId = randomUUID();
    this.cdpSessionManager = new DefaultCDPSessionManager();
    
    // Initialize LLM client
    this.llmClient = LLMClientFactory.create(this.config.llm);
    
    logger.info('WallCrawler initialized', {
      mode: this.config.mode,
      provider: this.config.llm.provider,
      model: this.config.llm.model,
      sessionId: this.sessionId,
    });
  }

  async launch(): Promise<void> {
    if (this.browser) {
      logger.warn('Browser already launched');
      return;
    }

    try {
      // Launch browser based on config
      const browserType = process.env.BROWSER || 'chromium';
      const launchOptions = {
        headless: this.config.browser.headless,
        timeout: this.config.browser.timeout,
      };

      switch (browserType) {
        case 'firefox':
          this.browser = await firefox.launch(launchOptions);
          break;
        case 'webkit':
          this.browser = await webkit.launch(launchOptions);
          break;
        default:
          this.browser = await chromium.launch(launchOptions);
      }

      // Create browser context with configuration
      this.context = await this.browser.newContext({
        viewport: this.config.browser.viewport,
        userAgent: this.config.browser.userAgent,
        locale: this.config.browser.locale,
        timezoneId: this.config.browser.timezone,
      });

      // Set default timeout
      this.context.setDefaultTimeout(this.config.browser.timeout);

      logger.info('Browser launched successfully', {
        browserType,
        headless: this.config.browser.headless,
      });
    } catch (error) {
      logger.error('Failed to launch browser', error);
      throw error;
    }
  }

  async newPage(): Promise<WallCrawlerPage> {
    if (!this.context) {
      throw new Error('Browser not launched. Call launch() first.');
    }

    try {
      // Create new page
      const page = await this.context.newPage();
      
      // Create CDP session
      const cdpSession = await this.cdpSessionManager.createSession(page);
      
      // Enable required CDP domains
      await this.cdpSessionManager.enableDomains(cdpSession, [
        'Runtime',
        'Network',
        'Page',
        'DOM',
        'Accessibility',
      ]);

      // Initialize network monitor
      const networkMonitor = new DefaultNetworkMonitor();
      await networkMonitor.initialize(cdpSession);

      // Create enhanced page with proxy
      const wallcrawlerPage = createWallCrawlerPage(
        page,
        cdpSession,
        networkMonitor,
        this.llmClient,
        this.config,
        this.sessionId
      );

      logger.info('New page created', { sessionId: this.sessionId });
      
      return wallcrawlerPage;
    } catch (error) {
      logger.error('Failed to create new page', error);
      throw error;
    }
  }

  async close(): Promise<void> {
    try {
      // Clean up CDP sessions
      await this.cdpSessionManager.cleanup();

      // Close context and browser
      if (this.context) {
        await this.context.close();
        this.context = null;
      }

      if (this.browser) {
        await this.browser.close();
        this.browser = null;
      }

      logger.info('WallCrawler closed', { sessionId: this.sessionId });
    } catch (error) {
      logger.error('Error during close', error);
      throw error;
    }
  }

  // Getters for internal state
  getBrowser(): Browser | null {
    return this.browser;
  }

  getContext(): BrowserContext | null {
    return this.context;
  }

  getConfig(): WallCrawlerConfig {
    return this.config;
  }

  getSessionId(): string {
    return this.sessionId;
  }

  isConnected(): boolean {
    return this.browser?.isConnected() ?? false;
  }
}