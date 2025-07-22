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
import { validateTokenWithPayload, getJweSecret } from '@wallcrawler/utils/auth';
import type {
  SessionOptions,
  ClientMessage,
  InternalMessage
} from './types.js';
import { StagehandExecutor } from './stagehand-executor.js';

// Environment configuration
const PORT = parseInt(process.env.PORT || '8080');
const CDP_PORT = parseInt(process.env.CDP_PORT || '9222'); // New: CDP debugging port
const CONTAINER_ID = process.env.CONTAINER_ID || `container-${Date.now()}`;
const MAX_SESSIONS = parseInt(process.env.MAX_SESSIONS || '20');
const REDIS_ENDPOINT = process.env.REDIS_ENDPOINT!;
const S3_BUCKET = process.env.S3_BUCKET!;
const PROXY_ENDPOINT = process.env.PROXY_ENDPOINT || 'http://localhost:3001'; // Add default

// JWE secret will be retrieved from environment via shared utility



function extractToken(url?: string, headers?: Record<string, string | string[] | undefined>): string | null {
  // Try URL query parameters first
  if (url) {
    const urlParams = new URLSearchParams(url.split('?')[1]);
    const token = urlParams.get('token');
    if (token) return token;
  }

  // Try headers
  if (headers) {
    const authHeader = headers.authorization || headers.Authorization;
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      return authHeader.replace('Bearer ', '');
    }
  }

  return null;
}

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

class MultiSessionContainer {
  private browser: Browser | null = null;
  private sessions = new Map<string, Session>();
  private screencastManager = new ScreencastManager();
  private httpServer: ReturnType<typeof createServer> | null = null;
  private wss: WebSocketServer | null = null;
  private cdpServer: ReturnType<typeof createServer> | null = null;
  private cdpWss: WebSocketServer | null = null;
  private proxyConnection: WebSocket | null = null;
  private redis!: ReturnType<typeof createClient>;
  private s3Client = new S3Client({});
  private healthInterval: NodeJS.Timeout | null = null;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private sessionWebSockets = new Map<string, WebSocket>(); // Map to store WebSocket connections for direct clients
  private stagehandExecutor!: StagehandExecutor;
  private commandPollingInterval: NodeJS.Timeout | null = null;

  async start() {
    // Connect to Redis
    this.redis = createClient({
      socket: { host: REDIS_ENDPOINT, port: 6379 },
      password: process.env.REDIS_PASSWORD || undefined, // Use env var; undefined if not set (for unauthenticated Redis)
    });
    this.redis.on('error', (err) => console.error('Redis Client Error:', err)); // Basic error handling
    await this.redis.connect();

    // Launch browser with CDP debugging enabled
    this.browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1920,1080',
        `--remote-debugging-port=${CDP_PORT}`, // Enable CDP debugging
        '--remote-debugging-address=0.0.0.0', // Allow external connections
      ],
    });

    // Start HTTP server for internal communication
    this.httpServer = createServer(this.handleRequest.bind(this));

    // Create WebSocket server for internal communication
    this.wss = new WebSocketServer({
      server: this.httpServer,
      path: '/internal/ws'
    });

    // Create separate CDP WebSocket server for direct CDP connections
    this.cdpServer = createServer();
    this.cdpWss = new WebSocketServer({
      server: this.cdpServer,
      path: '/cdp'
    });

    // Handle internal WebSocket connections (existing functionality)
    this.wss.on('connection', (ws, req) => {
      this.handleInternalOpen(ws, req);
      ws.on('message', (message) => this.handleInternalMessage(ws, message.toString()));
      ws.on('close', () => this.handleInternalClose(ws));
    });

    // Handle direct CDP WebSocket connections (new functionality)
    this.cdpWss.on('connection', (ws, req) => {
      this.handleCdpConnection(ws, req);
    });

    // Start servers
    this.httpServer.listen(PORT, () => {
      console.log(`🚀 Multi-Session Container started on port ${PORT}`);
      console.log(`Container ID: ${CONTAINER_ID}`);
      console.log(`Max Sessions: ${MAX_SESSIONS}`);
    });

    this.cdpServer.listen(CDP_PORT, () => {
      console.log(`🔧 CDP Debug Server started on port ${CDP_PORT}`);
    });

    console.log(`🚀 Multi-Session Container started on port ${PORT}`);
    console.log(`Container ID: ${CONTAINER_ID}`);
    console.log(`Max Sessions: ${MAX_SESSIONS}`);

    // Register with proxy
    await this.registerWithProxy();

    // Start cleanup interval
    this.startCleanupInterval();

    // Initialize Stagehand executor
    this.stagehandExecutor = new StagehandExecutor(this.redis);

    // Start command polling from Redis
    this.startCommandPolling();

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

    // Handle Stagehand operation endpoints
    if (req.method === 'POST') {
      if (url.pathname.startsWith('/sessions/') && url.pathname.endsWith('/act')) {
        await this.handleStagehandAct(req, res);
        return;
      }

      if (url.pathname.startsWith('/sessions/') && url.pathname.endsWith('/extract')) {
        await this.handleStagehandExtract(req, res);
        return;
      }

      if (url.pathname.startsWith('/sessions/') && url.pathname.endsWith('/observe')) {
        await this.handleStagehandObserve(req, res);
        return;
      }
    }

    // WebSocket upgrades are handled by the WebSocketServer
    // No need to handle /internal/ws here

    // Default: Not Found
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }

  private async handleInternalOpen(ws: WebSocket, req: IncomingMessage) {
    // Check if this is a direct client connection (with token) or proxy connection
    const token = extractToken(req.url, req.headers);

    if (token) {
      // Direct client connection - validate JWT
      try {
        const jweSecret = await getJweSecret();
        const payload = await validateTokenWithPayload(token, jweSecret);

        // Store the WebSocket connection for this session
        const session = this.sessions.get(payload.sessionId);
        if (session) {
          // Bind WebSocket to session for direct streaming
          this.sessionWebSockets.set(payload.sessionId, ws);
          console.log(`Direct client connected for session: ${payload.sessionId}`);

          // Send connection success
          ws.send(JSON.stringify({
            type: 'CONNECTION_ESTABLISHED',
            sessionId: payload.sessionId,
            timestamp: new Date().toISOString(),
          }));
        } else {
          ws.close(1008, 'Session not found');
          return;
        }
      } catch (error) {
        console.error('JWT validation failed:', error);
        ws.close(1008, 'Invalid token');
        return;
      }
    } else {
      // Proxy connection from Lambda/API Gateway
      this.proxyConnection = ws;
      console.log('Proxy connected');
    }
  }

  private async handleInternalMessage(ws: WebSocket, message: Buffer | string) {
    const data = JSON.parse(message.toString()) as InternalMessage;

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

  private async handleInternalClose(ws: WebSocket) {
    if (ws === this.proxyConnection) {
      this.proxyConnection = null;
      console.log('Proxy disconnected');
    } else {
      // Find and remove from session WebSocket mappings
      for (const [sessionId, sessionWs] of this.sessionWebSockets.entries()) {
        if (sessionWs === ws) {
          this.sessionWebSockets.delete(sessionId);
          console.log(`Direct client disconnected for session: ${sessionId}`);

          // Stop screencast if active
          if (this.screencastManager.isScreencastActive(sessionId)) {
            await this.screencastManager.stopScreencast(sessionId);
          }
          break;
        }
      }
    }
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
    const response = await fetch(`${PROXY_ENDPOINT}/internal/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Container-Token': process.env.CONTAINER_TOKEN || 'dev-token',
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

    console.log(`Registered with proxy at ${PROXY_ENDPOINT}`);
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

      // Use direct client WebSocket if available, otherwise use proxy WebSocket
      const clientWs = this.sessionWebSockets.get(sessionId) || ws;

      await this.screencastManager.startScreencast(
        sessionId,
        mainPage,
        clientWs,
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
  private async handleInputEvent(data: InternalMessage): Promise<void> {
    try {
      if (!data.sessionId || !data.event) {
        throw new Error('Missing sessionId or event in input message');
      }
      await this.screencastManager.handleInput(data.sessionId, data.event);
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

  /**
   * Handle direct CDP WebSocket connections
   * Validates token and proxies to the appropriate browser context
   */
  private async handleCdpConnection(ws: WebSocket, req: IncomingMessage) {
    console.log('CDP connection request received');

    try {
      // Extract token and session ID from query parameters
      const url = new URL(req.url!, `http://${req.headers.host}`);
      const token = url.searchParams.get('token');
      const sessionId = url.searchParams.get('sessionId');

      if (!token || !sessionId) {
        console.error('CDP connection missing token or sessionId');
        ws.close(1008, 'Missing token or sessionId');
        return;
      }

      // Validate token (basic validation - in production, verify JWT signature)
      const jweSecret = await getJweSecret();
      try {
        const payload = await validateTokenWithPayload(token, jweSecret);
        if (payload.sessionId !== sessionId) {
          throw new Error('Session ID mismatch');
        }
      } catch (error) {
        console.error('CDP token validation failed:', error);
        ws.close(1008, 'Invalid token');
        return;
      }

      // Check if session exists
      const session = this.sessions.get(sessionId);
      if (!session) {
        console.error(`CDP connection for non-existent session: ${sessionId}`);
        ws.close(1008, 'Session not found');
        return;
      }

      console.log(`CDP connection established for session: ${sessionId}`);

      // Get the CDP session for the main page
      const mainCdpSession = session.cdpSessions.get('main');
      if (!mainCdpSession) {
        console.error(`No CDP session found for session: ${sessionId}`);
        ws.close(1008, 'CDP session not available');
        return;
      }

      // Set up message forwarding between WebSocket and CDP session
      ws.on('message', async (data) => {
        try {
          const message = JSON.parse(data.toString());

          // Forward CDP command to browser
          const result = await mainCdpSession.send(
            message.method,
            message.params || {}
          );

          // Send response back to client
          ws.send(JSON.stringify({
            id: message.id,
            result: result
          }));

        } catch (error) {
          console.error('CDP command error:', error);
          ws.send(JSON.stringify({
            id: JSON.parse(data.toString()).id,
            error: {
              message: error instanceof Error ? error.message : 'Unknown error',
              code: -32000
            }
          }));
        }
      });

      // Handle CDP events from browser
      const handleCdpEvent = (method: string, params: any) => {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({
            method: method,
            params: params
          }));
        }
      };

      // Subscribe to CDP events (basic implementation)
      // In a full implementation, you'd want to manage event subscriptions more carefully
      mainCdpSession.on('Page.loadEventFired', (params) => handleCdpEvent('Page.loadEventFired', params));
      mainCdpSession.on('Page.frameNavigated', (params) => handleCdpEvent('Page.frameNavigated', params));
      mainCdpSession.on('Runtime.consoleAPICalled', (params) => handleCdpEvent('Runtime.consoleAPICalled', params));

      // Clean up on connection close
      ws.on('close', () => {
        console.log(`CDP connection closed for session: ${sessionId}`);
        // Remove event listeners if needed
      });

      // Update session activity
      session.lastActivity = Date.now();

    } catch (error) {
      console.error('Error handling CDP connection:', error);
      ws.close(1011, 'Internal server error');
    }
  }

  /**
   * Handle Stagehand act operations
   */
  private async handleStagehandAct(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const sessionId = this.extractSessionIdFromPath(req.url || '');
      if (!sessionId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Session ID required' }));
        return;
      }

      const session = this.sessions.get(sessionId);
      if (!session) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Session not found' }));
        return;
      }

      const body = await this.readRequestBody(req);
      const options = JSON.parse(body);

      const result = await this.stagehandExecutor.executeAct(session, options);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));

    } catch (error) {
      console.error('Act handler error:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error'
      }));
    }
  }

  /**
   * Handle Stagehand extract operations
   */
  private async handleStagehandExtract(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const sessionId = this.extractSessionIdFromPath(req.url || '');
      if (!sessionId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Session ID required' }));
        return;
      }

      const session = this.sessions.get(sessionId);
      if (!session) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Session not found' }));
        return;
      }

      const body = await this.readRequestBody(req);
      const options = JSON.parse(body);

      const result = await this.stagehandExecutor.executeExtract(session, options);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));

    } catch (error) {
      console.error('Extract handler error:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error'
      }));
    }
  }

  /**
   * Handle Stagehand observe operations
   */
  private async handleStagehandObserve(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const sessionId = this.extractSessionIdFromPath(req.url || '');
      if (!sessionId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Session ID required' }));
        return;
      }

      const session = this.sessions.get(sessionId);
      if (!session) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Session not found' }));
        return;
      }

      const body = await this.readRequestBody(req);
      const options = JSON.parse(body);

      const result = await this.stagehandExecutor.executeObserve(session, options);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));

    } catch (error) {
      console.error('Observe handler error:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error'
      }));
    }
  }

  /**
   * Start polling Redis for commands
   */
  private startCommandPolling(): void {
    this.commandPollingInterval = setInterval(async () => {
      await this.pollCommands();
    }, 1000); // Poll every second

    console.log('Started command polling from Redis');
  }

  /**
   * Poll Redis for pending commands
   */
  private async pollCommands(): Promise<void> {
    try {
      // Get all active sessions
      for (const [sessionId, session] of this.sessions) {
        // Check for pending commands
        const command = await this.redis.lPop(`session:${sessionId}:commands`);

        if (command) {
          await this.processCommand(sessionId, session, JSON.parse(command));
        }
      }
    } catch (error) {
      console.error('Error polling commands:', error);
    }
  }

  /**
   * Process a command from Redis
   */
  private async processCommand(sessionId: string, session: Session, command: any): Promise<void> {
    try {
      console.log(`Processing command ${command.type} for session ${sessionId}`);

      let result: any;

      switch (command.type) {
        case 'ACT':
          result = await this.stagehandExecutor.executeAct(session, command.data);
          break;
        case 'EXTRACT':
          result = await this.stagehandExecutor.executeExtract(session, command.data);
          break;
        case 'OBSERVE':
          result = await this.stagehandExecutor.executeObserve(session, command.data);
          break;
        default:
          console.warn(`Unknown command type: ${command.type}`);
          return;
      }

      // Store result in Redis for Lambda to pick up
      await this.redis.setEx(
        `session:${sessionId}:result:${command.requestId}`,
        300, // 5 minute TTL
        JSON.stringify({
          requestId: command.requestId,
          type: command.type,
          result,
          timestamp: new Date().toISOString(),
        })
      );

      console.log(`Completed command ${command.type} for session ${sessionId}`);

    } catch (error) {
      console.error(`Error processing command ${command.type}:`, error);

      // Store error result
      await this.redis.setEx(
        `session:${sessionId}:result:${command.requestId}`,
        300,
        JSON.stringify({
          requestId: command.requestId,
          type: command.type,
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date().toISOString(),
        })
      );
    }
  }

  /**
   * Extract session ID from URL path
   */
  private extractSessionIdFromPath(url: string): string | null {
    const match = url.match(/\/sessions\/([^/]+)\//);
    return match ? match[1] : null;
  }

  /**
   * Read request body
   */
  private async readRequestBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', chunk => {
        body += chunk.toString();
      });
      req.on('end', () => {
        resolve(body);
      });
      req.on('error', reject);
    });
  }

  private async shutdown() {
    console.log('Shutting down gracefully...');

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    if (this.commandPollingInterval) {
      clearInterval(this.commandPollingInterval);
    }

    // Close all sessions
    for (const [sessionId, session] of this.sessions) {
      try {
        await session.context.close();
      } catch (error) {
        console.error(`Error closing session ${sessionId}:`, error);
      }
    }

    // Close browser
    if (this.browser) {
      await this.browser.close();
    }

    // Close servers
    if (this.wss) {
      this.wss.close();
    }

    if (this.cdpWss) {
      this.cdpWss.close();
    }

    if (this.httpServer) {
      this.httpServer.close();
    }

    if (this.cdpServer) {
      this.cdpServer.close();
    }

    // Close Redis connection
    await this.redis.quit();

    console.log('Shutdown complete');
    process.exit(0);
  }
}

// Start the container
const container = new MultiSessionContainer();
container.start().catch((error) => {
  console.error('Failed to start container:', error);
  process.exit(1);
});
