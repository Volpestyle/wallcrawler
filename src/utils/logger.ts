import pino from 'pino';
import { WallCrawlerLogEntry, LogCategory } from '../types/logging';
import { randomUUID } from 'crypto';

const pinoLogger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
    },
  },
});

export interface Logger {
  debug(message: string, auxiliary?: Record<string, any>): void;
  info(message: string, auxiliary?: Record<string, any>): void;
  warn(message: string, auxiliary?: Record<string, any>): void;
  error(message: string, error?: Error | any, auxiliary?: Record<string, any>): void;
}

class WallCrawlerLogger implements Logger {
  private requestId: string = randomUUID();
  
  constructor(
    private category: LogCategory,
    private sessionId?: string
  ) {}

  debug(message: string, auxiliary?: Record<string, any>): void {
    this.log(2, message, auxiliary);
  }

  info(message: string, auxiliary?: Record<string, any>): void {
    this.log(1, message, auxiliary);
  }

  warn(message: string, auxiliary?: Record<string, any>): void {
    this.log(1, message, { ...auxiliary, warning: true });
  }

  error(message: string, error?: Error | any, auxiliary?: Record<string, any>): void {
    const errorAux = error instanceof Error ? {
      error: error.message,
      stack: error.stack,
      ...auxiliary
    } : { ...error, ...auxiliary };
    
    this.log(0, message, errorAux);
  }

  private log(level: 0 | 1 | 2, message: string, auxiliary?: Record<string, any>): void {
    // Skip all network logs except errors
    if (this.category === 'network' && level > 0) {
      return;
    }
    
    const entry: WallCrawlerLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      category: this.category,
      message,
      requestId: this.requestId,
      sessionId: this.sessionId,
      auxiliary: auxiliary ? this.formatAuxiliary(auxiliary) : undefined,
    };

    // Map to pino levels
    const pinoLevel = level === 0 ? 'error' : level === 1 ? 'info' : 'debug';
    pinoLogger[pinoLevel](entry, message);
  }

  private formatAuxiliary(aux: Record<string, any>): Record<string, { value: any; type: string }> {
    const formatted: Record<string, { value: any; type: string }> = {};
    
    for (const [key, value] of Object.entries(aux)) {
      formatted[key] = {
        value,
        type: typeof value,
      };
    }
    
    return formatted;
  }

  setSessionId(sessionId: string): void {
    this.sessionId = sessionId;
  }

  newRequestId(): void {
    this.requestId = randomUUID();
  }
}

export function createLogger(category: LogCategory, sessionId?: string): Logger {
  return new WallCrawlerLogger(category, sessionId);
}