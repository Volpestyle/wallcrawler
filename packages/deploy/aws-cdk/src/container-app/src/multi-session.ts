/**
 * WallCrawler Multi-Session Container
 * Manages multiple browser contexts in a single container
 */

import { chromium, Browser, BrowserContext, Page, CDPSession } from 'playwright-core';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { createClient } from 'redis';
import { createSandboxedContext, SessionSandbox } from './session-sandbox.js';
import { ScreencastManager } from './screencast-manager.js';
import type {
  InputEvent
} from '@wallcrawler/infra-common/src/types/screencast';

// Environment configuration
const PORT = parseInt(process.env.PORT || '8080');
const CONTAINER_ID = process.env.CONTAINER_ID!;
const _PROXY_ENDPOINT = process.env.PROXY_ENDPOINT!;
const MAX_SESSIONS = parseInt(process.env.MAX_SESSIONS || '20');
const REDIS_ENDPOINT = process.env.REDIS_ENDPOINT!;
const S3_BUCKET = process.env.S3_BUCKET!;
const _CONTAINER_TOKEN = process.env.CONTAINER_TOKEN || 'dev-token';

interface Session {
  id: string;
  userId: string;
  context: BrowserContext;
  sandbox: SessionSandbox;
  pages: Map<string, Page>;
  cdpSessions: Map<string, CDPSession>;
  lastActivity: number;
  options: SessionOptions;
}

interface SessionOptions {
  viewport?: { width: number; height: number };
  userAgent?: string;
  locale?: string;
  timezoneId?: string;
  storageState?: any;
  extraHTTPHeaders?: Record<string, string>;

}

interface ClientMessage {
  id: number;
  method?: Parameters<CDPSession['send']>[0];
  params?: object;
  targetId?: string;
}

class MultiSessionContainer {
  private browser: Browser | null = null;
  private sessions = new Map<string, Session>();
  private screencastManager = new ScreencastManager();
  private httpServer: ReturnType<typeof createServer> | null = null;
  private wss: WebSocketServer | null = null;
  private proxyConnection: WebSocket | null = null;
  private redis!: ReturnType<typeof createClient>;
  private s3Client = new S3Client({});
  private healthInterval: NodeJS.Timeout | null = null;
  private cleanupInterval: NodeJS.Timeout | null = null;

  async start() {
    // Connect to Redis
    this.redis = createClient({
      socket: { host: REDIS_ENDPOINT, port: 6379 },
      password: process.env.REDIS_PASSWORD || undefined, // Use env var; undefined if not set (for unauthenticated Redis)
    });
    this.redis.on('error', (err) => console.error('Redis Client Error:', err)); // Basic error handling
    await this.redis.connect();

    // Launch browser
    this.browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1920,1080',
      ],
    });

    // Start HTTP server for internal communication
    this.httpServer = createServer(this.handleRequest.bind(this));

    // Create WebSocket server
    this.wss = new WebSocketServer({
      server: this.httpServer,
      path: '/internal/ws'
    });

    // Handle WebSocket connections
    this.wss.on('connection', (ws, req) => {
      this.handleInternalOpen(ws, req);
      ws.on('message', (message) => this.handleInternalMessage(ws, message.toString()));
      ws.on('close', () => this.handleInternalClose(ws));
    });

    // Start listening
    this.httpServer.listen(PORT, () => {
      console.log(`🚀 Multi-Session Container started on port ${PORT}`);
      console.log(`Container ID: ${CONTAINER_ID}`);
      console.log(`Max Sessions: ${MAX_SESSIONS}`);
    });

    console.log(`🚀 Multi-Session Container started on port ${PORT}`);
    console.log(`Container ID: ${CONTAINER_ID}`);
    console.log(`Max Sessions: ${MAX_SESSIONS}`);

    // Register with proxy
    await this.registerWithProxy();

    // Start cleanup interval
    this.startCleanupInterval();

    // Graceful shutdown
    process.on('SIGTERM', () => this.shutdown());
    process.on('SIGINT', () => this.shutdown());
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url || '', `http://${req.headers.host}`);

    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'healthy',
        sessions: this.sessions.size,
        maxSessions: MAX_SESSIONS,
        containerId: CONTAINER_ID,
      }));
      return;
    }

    // WebSocket upgrades are handled by the WebSocketServer
    // No need to handle /internal/ws here

    // Default: Not Found
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }

  private async handleInternalOpen(ws: WebSocket, _req: IncomingMessage) {
    // WebSocket connections to /internal/ws are authorized by path
    // Additional validation can be added here if needed

    // This is the proxy connection
    this.proxyConnection = ws;
    console.log('Proxy connected');
  }

  private async handleInternalMessage(ws: WebSocket, message: Buffer | string) {
    const data = JSON.parse(message.toString()) as {
      type: string;
      sessionId?: string;
      userId?: string;
      options?: SessionOptions;
      data?: any;
    };

    switch (data.type) {
      case 'CREATE_SESSION':
        await this.createSession(data.sessionId!, data.userId!, data.options!);
        break;

      case 'DESTROY_SESSION':
        await this.destroySession(data.sessionId!);
        break;

      case 'CLIENT_MESSAGE':
        await this.handleClientMessage(data.sessionId!, data.data);
        break;

      case 'START_SCREENCAST':
        await this.handleStartScreencast(ws, data);
        break;

      case 'STOP_SCREENCAST':
        await this.handleStopScreencast(data);
        break;

      case 'SEND_INPUT':
        await this.handleInputEvent(data);
        break;
    }
  }

  private handleInternalClose(_ws: WebSocket) {
    console.log('Proxy disconnected');
    this.proxyConnection = null;
  }

  private async registerWithProxy() {
    // Get container IP from ECS metadata
    let containerIp = 'localhost';
    const metadataUri = process.env.ECS_CONTAINER_METADATA_URI_V4;

    if (metadataUri) {
      try {
        const response = await fetch(`${metadataUri}/task`);
        const metadata = await response.json();

        // Find our container's network interface
        for (const container of metadata.Containers) {
          if (container.Name === 'BrowserContainer') {
            containerIp = container.Networks[0].IPv4Addresses[0];
            break;
          }
        }
      } catch (error) {
        console.error('Failed to get container metadata:', error);
      }
    }

    // Register with proxy
    const response = await fetch(`${_PROXY_ENDPOINT}/internal/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Container-Token': _CONTAINER_TOKEN,
      },
      body: JSON.stringify({
        containerId: CONTAINER_ID,
        ip: containerIp,
        port: PORT,
        taskArn: process.env.ECS_TASK_ARN || 'local',
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to register with proxy: ${response.status}`);
    }

    console.log(`Registered with proxy at ${_PROXY_ENDPOINT}`);
  }

  private async createSession(sessionId: string, userId: string, options: SessionOptions) {
    if (this.sessions.size >= MAX_SESSIONS) {
      this.sendToProxy({
        type: 'SESSION_ERROR',
        sessionId,
        error: 'Container at capacity',
      });
      return;
    }

    try {
      const { context, sandbox } = await createSandboxedContext(this.browser!, {
        sessionId,
        userId,
        isolationLevel: 'strict',
        contextOptions: {
          viewport: options.viewport || { width: 1920, height: 1080 },
          userAgent: options.userAgent,
          locale: options.locale,
          timezoneId: options.timezoneId,
          storageState: options.storageState,
          extraHTTPHeaders: options.extraHTTPHeaders,
        },
      });

      // Create initial page
      const page = await context.newPage();

      // Enable CDP domains
      const cdpSession = await context.newCDPSession(page);
      await cdpSession.send('Page.enable');
      await cdpSession.send('Runtime.enable');
      await cdpSession.send('DOM.enable');
      await cdpSession.send('Accessibility.enable');

      const session: Session = {
        id: sessionId,
        userId,
        context,
        sandbox,
        pages: new Map([['main', page]]),
        cdpSessions: new Map([['main', cdpSession]]),
        lastActivity: Date.now(),
        options,
      };

      this.sessions.set(sessionId, session);

      // Update Redis
      await this.redis.hSet(
        `container:${CONTAINER_ID}:sessions`,
        sessionId,
        JSON.stringify({
          userId,
          createdAt: Date.now(),
        })
      );

      // Notify proxy
      this.sendToProxy({
        type: 'SESSION_READY',
        sessionId,
      });

      console.log(`Session created: ${sessionId} for user ${userId}`);
    } catch (error) {
      console.error(`Failed to create session ${sessionId}:`, error);
      this.sendToProxy({
        type: 'SESSION_ERROR',
        sessionId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private async destroySession(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    try {
      // Stop screencast if active
      await this.screencastManager.stopScreencast(sessionId);

      // Close all CDP sessions
      for (const cdp of session.cdpSessions.values()) {
        await cdp.detach().catch(() => { });
      }

      // Close context (closes all pages)
      await session.context.close();
      await session.sandbox.cleanup();

      this.sessions.delete(sessionId);

      // Update Redis
      await this.redis.hDel(`container:${CONTAINER_ID}:sessions`, sessionId);

      console.log(`Session destroyed: ${sessionId}`);
    } catch (error) {
      console.error(`Error destroying session ${sessionId}:`, error);
    }
  }

  private async handleClientMessage(
    sessionId: string,
    message: ClientMessage
  ) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      this.sendToProxy({
        type: 'CDP_RESPONSE',
        sessionId,
        data: {
          id: message.id,
          error: { message: 'Session not found' },
        },
      });
      return;
    }

    session.lastActivity = Date.now();

    try {
      // Handle CDP commands
      if (message.method) {
        const targetId = message.targetId || 'main';
        let cdpSession = session.cdpSessions.get(targetId);

        if (!cdpSession) {
          // Create new page/CDP session if needed
          if (message.method === 'Target.createTarget') {
            const page = await session.context.newPage();
            cdpSession = await session.context.newCDPSession(page);
            session.pages.set(targetId, page);
            session.cdpSessions.set(targetId, cdpSession);
          } else {
            throw new Error(`Target ${targetId} not found`);
          }
        }

        // Execute CDP command
        const result = await cdpSession.send(
          message.method as Parameters<CDPSession['send']>[0],
          (message.params ?? {}) as Parameters<CDPSession['send']>[1]
        );

        // Special handling for screenshots
        if (message.method === 'Page.captureScreenshot' && (result as any).data) {
          const screenshotUrl = await this.uploadScreenshot(sessionId, (result as any).data);
          (result as any).screenshotUrl = screenshotUrl;
        }

        // Send response
        this.sendToProxy({
          type: 'CDP_RESPONSE',
          sessionId,
          data: {
            id: message.id,
            result,
          },
        });
      }
    } catch (error) {
      console.error(`Error handling client message for ${sessionId}:`, error);
      this.sendToProxy({
        type: 'CDP_RESPONSE',
        sessionId,
        data: {
          id: message.id,
          error: {
            message: error instanceof Error ? error.message : 'Unknown error',
          },
        },
      });
    }
  }

  /**
   * Handle start screencast message
   */
  private async handleStartScreencast(ws: WebSocket, data: any): Promise<void> {
    try {
      const { sessionId, params } = data as any;
      const session = this.sessions.get(sessionId);

      if (!session) {
        throw new Error(`Session ${sessionId} not found`);
      }

      // Get the main page for the session
      const mainPage = session.pages.get('main');
      if (!mainPage) {
        throw new Error(`Main page not found for session ${sessionId}`);
      }

      await this.screencastManager.startScreencast(
        sessionId,
        mainPage,
        ws,
        params
      );

    } catch (error) {
      console.error('Error starting screencast:', error);
      ws.send(JSON.stringify({
        type: 'SCREENCAST_ERROR',
        sessionId: (data as any).sessionId,
        error: error instanceof Error ? error.message : 'Unknown error'
      }));
    }
  }

  /**
   * Handle stop screencast message
   */
  private async handleStopScreencast(data: any): Promise<void> {
    try {
      const { sessionId } = data as any;
      await this.screencastManager.stopScreencast(sessionId);
    } catch (error) {
      console.error('Error stopping screencast:', error);
    }
  }

  /**
   * Handle input event message
   */
  private async handleInputEvent(data: any): Promise<void> {
    try {
      const { sessionId, event } = data as any;
      await this.screencastManager.handleInput(sessionId, event as InputEvent);
    } catch (error) {
      console.error('Error handling input event:', error);
    }
  }

  private async uploadScreenshot(sessionId: string, base64Data: string): Promise<string> {
    const timestamp = Date.now();
    const key = `screenshots/${sessionId}/${timestamp}.jpg`;

    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
        Body: Buffer.from(base64Data, 'base64'),
        ContentType: 'image/jpeg',
        Metadata: {
          sessionId,
          timestamp: String(timestamp),
        },
      })
    );

    return `s3://${S3_BUCKET}/${key}`;
  }

  private sendToProxy(message: any) {
    if (this.proxyConnection && this.proxyConnection.readyState === WebSocket.OPEN) {
      this.proxyConnection.send(JSON.stringify(message));
    }
  }

  private async getHealthStatus() {
    const memoryUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    return {
      status: 'healthy',
      containerId: CONTAINER_ID,
      sessions: this.sessions.size,
      maxSessions: MAX_SESSIONS,
      memoryUsage: {
        rss: memoryUsage.rss,
        heapUsed: memoryUsage.heapUsed,
        heapTotal: memoryUsage.heapTotal,
      },
      cpuUsage: cpuUsage.user / 1000000, // Convert to seconds
      uptime: process.uptime(),
    };
  }

  private startHealthReporting() {
    this.healthInterval = setInterval(async () => {
      const health = await this.getHealthStatus();

      // Report to proxy
      this.sendToProxy({
        type: 'HEALTH_UPDATE',
        cpuUsage: health.cpuUsage,
        memoryUsage: health.memoryUsage.heapUsed / health.memoryUsage.heapTotal,
      });

      // Update Redis
      await this.redis.setEx(`container:${CONTAINER_ID}:health`, 60, JSON.stringify(health));
    }, 30000); // Every 30 seconds
  }

  private startCleanupInterval() {
    this.cleanupInterval = setInterval(async () => {
      const now = Date.now();
      const IDLE_TIMEOUT = 5 * 60 * 1000; // 5 minutes

      for (const [sessionId, session] of this.sessions) {
        if (now - session.lastActivity > IDLE_TIMEOUT) {
          console.log(`Cleaning up idle session: ${sessionId}`);
          await this.destroySession(sessionId);

          // Notify proxy
          this.sendToProxy({
            type: 'SESSION_TIMEOUT',
            sessionId,
          });
        }
      }
    }, 60000); // Every minute
  }

  private async shutdown() {
    console.log('Shutting down container...');

    if (this.healthInterval) clearInterval(this.healthInterval);
    if (this.cleanupInterval) clearInterval(this.cleanupInterval);

    // Stop all active screencasts
    await this.screencastManager.stopAllScreencasts();

    // Close all sessions
    for (const sessionId of this.sessions.keys()) {
      await this.destroySession(sessionId);
    }

    // Close browser
    if (this.browser) {
      await this.browser.close();
    }

    // Close connections
    if (this.proxyConnection) {
      this.proxyConnection.close();
    }

    await this.redis.quit();

    if (this.httpServer) {
      this.httpServer.close();
    }
    if (this.wss) {
      this.wss.close();
    }

    process.exit(0);
  }
}

// Start the container
const container = new MultiSessionContainer();
container.start().catch((error) => {
  console.error('Failed to start container:', error);
  process.exit(1);
});
