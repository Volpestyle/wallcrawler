import { Page, CDPSession } from 'playwright';
import { PageMetrics } from '../types/page';
import { createLogger } from './logger';
import fs from 'fs/promises';
import path from 'path';

const logger = createLogger('debug');

export class DebugManager {
  constructor(
    private page: Page,
    private cdpSession: CDPSession
  ) {}

  async exportDom(filepath: string): Promise<void> {
    try {
      const dom = await this.page.content();
      const debugInfo = {
        url: this.page.url(),
        title: await this.page.title(),
        timestamp: new Date().toISOString(),
        viewport: this.page.viewportSize(),
        dom: dom,
      };

      await fs.mkdir(path.dirname(filepath), { recursive: true });
      await fs.writeFile(filepath, JSON.stringify(debugInfo, null, 2));
      
      logger.info('DOM exported', { filepath });
    } catch (error) {
      logger.error('Failed to export DOM', error);
      throw error;
    }
  }

  async getMetrics(): Promise<PageMetrics> {
    try {
      // Get performance metrics from CDP
      const { metrics } = await this.cdpSession.send('Performance.getMetrics');
      
      const metricsMap = new Map(
        metrics.map((m: any) => [m.name, m.value])
      );

      // Get DOM metrics
      const domMetrics = await this.page.evaluate(() => {
        return {
          domNodes: document.getElementsByTagName('*').length,
          eventListeners: (window as any).getEventListeners ? 
            Object.keys((window as any).getEventListeners(window)).length : 0,
        };
      });

      return {
        timestamp: Date.now(),
        url: this.page.url(),
        domNodes: domMetrics.domNodes,
        eventListeners: domMetrics.eventListeners,
        jsHeapUsed: metricsMap.get('JSHeapUsedSize') || 0,
        jsHeapTotal: metricsMap.get('JSHeapTotalSize') || 0,
        layoutDuration: metricsMap.get('LayoutDuration') || 0,
        scriptDuration: metricsMap.get('ScriptDuration') || 0,
        taskDuration: metricsMap.get('TaskDuration') || 0,
      };
    } catch (error) {
      logger.error('Failed to get metrics', error);
      throw error;
    }
  }
}