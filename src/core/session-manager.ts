import { Cookie } from 'playwright';
import { 
  InfrastructureProvider, 
  Checkpoint, 
  CheckpointReference,
  BrowserState,
  StateReference
} from '../types/infrastructure';
import { WallCrawlerPage } from './wallcrawler-page';
import { createLogger } from '../utils/logger';

const logger = createLogger('session-manager');

export class SessionManager {
  private provider?: InfrastructureProvider;

  setProvider(provider: InfrastructureProvider): void {
    this.provider = provider;
  }

  async saveCheckpoint(page: WallCrawlerPage): Promise<CheckpointReference | null> {
    if (!this.provider) {
      logger.debug('No infrastructure provider configured for checkpoint');
      return null;
    }

    try {
      const checkpoint: Checkpoint = {
        sessionId: page.sessionId,
        timestamp: Date.now(),
        url: await page.url(),
        cookies: await page.context().cookies(),
        localStorage: await page.evaluate(() => {
          const items: Record<string, string> = {};
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key) {
              items[key] = localStorage.getItem(key) || '';
            }
          }
          return items;
        }),
        sessionStorage: await page.evaluate(() => {
          const items: Record<string, string> = {};
          for (let i = 0; i < sessionStorage.length; i++) {
            const key = sessionStorage.key(i);
            if (key) {
              items[key] = sessionStorage.getItem(key) || '';
            }
          }
          return items;
        }),
        viewport: page.viewportSize() || { width: 1280, height: 720 },
        headers: await this.extractHeaders(page),
      };

      const reference = await this.provider.saveCheckpoint(checkpoint);
      logger.info('Checkpoint saved', { 
        sessionId: page.sessionId, 
        timestamp: checkpoint.timestamp 
      });
      
      return reference;
    } catch (error) {
      logger.error('Failed to save checkpoint', error);
      throw error;
    }
  }

  async loadCheckpoint(reference: CheckpointReference): Promise<Checkpoint> {
    if (!this.provider) {
      throw new Error('No infrastructure provider configured');
    }

    try {
      const checkpoint = await this.provider.loadCheckpoint(reference);
      logger.info('Checkpoint loaded', { 
        sessionId: checkpoint.sessionId,
        timestamp: checkpoint.timestamp
      });
      return checkpoint;
    } catch (error) {
      logger.error('Failed to load checkpoint', error);
      throw error;
    }
  }

  async saveState(page: WallCrawlerPage): Promise<StateReference | null> {
    if (!this.provider) {
      logger.debug('No infrastructure provider configured for state save');
      return null;
    }

    try {
      const state: BrowserState = {
        sessionId: page.sessionId,
        url: await page.url(),
        cookies: await page.context().cookies(),
        localStorage: await page.evaluate(() => {
          const items: Record<string, string> = {};
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key) {
              items[key] = localStorage.getItem(key) || '';
            }
          }
          return items;
        }),
        sessionStorage: await page.evaluate(() => {
          const items: Record<string, string> = {};
          for (let i = 0; i < sessionStorage.length; i++) {
            const key = sessionStorage.key(i);
            if (key) {
              items[key] = sessionStorage.getItem(key) || '';
            }
          }
          return items;
        }),
        viewport: page.viewportSize() || { width: 1280, height: 720 },
      };

      // Optionally capture screenshot
      if (this.provider.saveArtifact) {
        try {
          state.screenshot = await page.screenshot();
        } catch (error) {
          logger.warn('Failed to capture screenshot for state', error);
        }
      }

      const reference = await this.provider.saveState(state);
      logger.info('State saved', { sessionId: page.sessionId });
      
      return reference;
    } catch (error) {
      logger.error('Failed to save state', error);
      throw error;
    }
  }

  async loadState(reference: StateReference): Promise<BrowserState> {
    if (!this.provider) {
      throw new Error('No infrastructure provider configured');
    }

    try {
      const state = await this.provider.loadState(reference);
      logger.info('State loaded', { sessionId: state.sessionId });
      return state;
    } catch (error) {
      logger.error('Failed to load state', error);
      throw error;
    }
  }

  private async extractHeaders(page: WallCrawlerPage): Promise<Record<string, string>> {
    // Extract any custom headers that were set on the page
    // This is a simplified implementation - actual headers would come from context
    const headers: Record<string, string> = {};
    
    // Get user agent
    const userAgent = await page.evaluate(() => navigator.userAgent);
    if (userAgent) {
      headers['User-Agent'] = userAgent;
    }

    // Get accept-language
    const language = await page.evaluate(() => navigator.language);
    if (language) {
      headers['Accept-Language'] = language;
    }

    return headers;
  }
}