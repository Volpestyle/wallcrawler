import { Page, CDPSession } from 'playwright';
import { CDPSessionManager } from '../types/cdp';
import { CDPError } from '../types/errors';
import { createLogger } from '../utils/logger';

const logger = createLogger('cdp');

export class DefaultCDPSessionManager implements CDPSessionManager {
  private sessions: Map<string, CDPSession> = new Map();
  private page: Page | null = null;

  async createSession(page: Page): Promise<CDPSession> {
    try {
      this.page = page;
      const session = await page.context().newCDPSession(page);
      const sessionId = this.generateSessionId();
      this.sessions.set(sessionId, session);
      
      logger.debug('CDP session created', { sessionId });
      
      // Set up error handling
      session.on('disconnected', () => {
        logger.warn('CDP session disconnected', { sessionId });
        this.sessions.delete(sessionId);
      });

      return session;
    } catch (error) {
      throw new CDPError('Failed to create CDP session', { error });
    }
  }

  async enableDomains(session: CDPSession, domains: string[]): Promise<void> {
    const enablePromises = domains.map(async (domain) => {
      try {
        await session.send(`${domain}.enable` as any);
        logger.debug('CDP domain enabled', { domain });
      } catch (error) {
        // Some domains might already be enabled
        if (!error.message?.includes('already enabled')) {
          throw new CDPError(`Failed to enable CDP domain: ${domain}`, { error });
        }
      }
    });

    await Promise.all(enablePromises);
  }

  async handleSessionError(error: Error): Promise<void> {
    logger.error('CDP session error', { error: error.message, stack: error.stack });
    
    // Try to recreate session if page is still available
    if (this.page && !this.page.isClosed()) {
      try {
        logger.info('Attempting to recreate CDP session');
        await this.createSession(this.page);
      } catch (recreateError) {
        logger.error('Failed to recreate CDP session', { error: recreateError });
      }
    }
  }

  async cleanup(): Promise<void> {
    for (const [sessionId, session] of this.sessions) {
      try {
        // CDP sessions are automatically cleaned up when the page closes
        // but we'll clear our references
        this.sessions.delete(sessionId);
        logger.debug('CDP session reference cleared', { sessionId });
      } catch (error) {
        logger.error('Error during CDP session cleanup', { sessionId, error });
      }
    }
    
    this.sessions.clear();
    this.page = null;
  }

  private generateSessionId(): string {
    return `cdp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  getActiveSessionCount(): number {
    return this.sessions.size;
  }
}