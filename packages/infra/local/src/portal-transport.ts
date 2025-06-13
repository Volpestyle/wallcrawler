import { WebSocketServer } from 'ws';
import { createServer, Server } from 'http';
import * as path from 'path';
import * as fs from 'fs/promises';
import { EventEmitter } from 'eventemitter3';
import { 
  PortalTransport,
  PortalTransportConfig,
  PortalAuthInfo,
  PortalTransportCapabilities,
  PortalMessage,
  PortalTransportError,
  CreateSessionConfig,
  PortalConnectionInfo
} from 'wallcrawler/types/portal-transport';
import {
  PortalSession,
  PortalBrowserState,
  PortalCommand,
  PortalEvent,
  PortalStats
} from 'wallcrawler/types/portal';
import { createLogger } from 'wallcrawler/utils/logger';

const logger = createLogger('local-portal-transport');

/**
 * Local Portal Transport
 * 
 * Provides portal functionality for local development using a local WebSocket server
 * and file-based session storage. Serves the portal web UI and handles real-time
 * communication between automation and portal.
 */
export class LocalPortalTransport extends EventEmitter implements PortalTransport {
  private config: PortalTransportConfig | null = null;
  private httpServer: Server | null = null;
  private wsServer: WebSocketServer | null = null;
  private sessions = new Map<string, PortalSession>();
  private connections = new Map<string, any>(); // WebSocket connections
  private stats = new Map<string, PortalStats>();
  private storageDir: string;
  private isRunning = false;
  private connectionInfo: PortalConnectionInfo | null = null;

  constructor(storageDir: string = '.wallcrawler/portal') {
    super();
    this.storageDir = storageDir;
  }

  async initialize(config: PortalTransportConfig): Promise<void> {
    this.config = config;
    await this.ensureStorageDirectories();
    
    logger.info('Local portal transport initialized', {
      host: config.local?.host || 'localhost',
      port: config.port || 3001
    });
  }

  async connect(sessionId: string, auth?: PortalAuthInfo): Promise<PortalConnectionInfo> {
    if (!this.config) {
      throw new PortalTransportError('Transport not initialized', 'CONFIGURATION_ERROR');
    }

    try {
      // Start server if not running
      if (!this.isRunning) {
        await this.startServer();
      }

      // Create connection info
      const host = this.config.local?.host || 'localhost';
      const port = this.config.port || 3001;
      
      this.connectionInfo = {
        connectionId: `local-${sessionId}-${Date.now()}`,
        protocol: 'websocket',
        endpoint: `ws://${host}:${port}/ws`,
        authenticationType: auth ? 'token' : 'none',
        connectedAt: Date.now(),
        lastPingAt: Date.now()
      };

      logger.info('Connected to local portal', {
        sessionId,
        endpoint: this.connectionInfo.endpoint
      });

      this.emit('connected', this.connectionInfo);
      return this.connectionInfo;

    } catch (error) {
      logger.error('Failed to connect to portal', error);
      throw new PortalTransportError(
        `Failed to connect: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'CONNECTION_FAILED'
      );
    }
  }

  async disconnect(): Promise<void> {
    if (this.connectionInfo) {
      logger.info('Disconnecting from portal', {
        connectionId: this.connectionInfo.connectionId
      });
      
      this.connectionInfo = null;
      this.emit('disconnected');
    }

    // Don't stop server immediately - let other sessions continue
    // Server will stop when no sessions are active
  }

  async sendBrowserState(state: PortalBrowserState): Promise<void> {
    const message: PortalMessage = {
      id: this.generateMessageId(),
      type: 'browser-state',
      timestamp: Date.now(),
      sessionId: state.sessionId,
      payload: state,
      metadata: {
        source: 'local-transport',
        version: '1.0.0'
      }
    };

    await this.broadcastMessage(state.sessionId, message);
  }

  async sendEvent(event: PortalEvent): Promise<void> {
    const message: PortalMessage = {
      id: this.generateMessageId(),
      type: 'event',
      timestamp: Date.now(),
      sessionId: event.payload?.sessionId || 'unknown',
      payload: event,
      metadata: {
        source: 'local-transport',
        version: '1.0.0'
      }
    };

    await this.broadcastMessage(message.sessionId, message);
  }

  onCommand(handler: (command: PortalCommand) => void): void {
    this.on('command', handler);
  }

  onConnectionChange(handler: (connected: boolean, info?: PortalConnectionInfo) => void): void {
    this.on('connected', (info) => handler(true, info));
    this.on('disconnected', () => handler(false));
  }

  onError(handler: (error: Error) => void): void {
    this.on('error', handler);
  }

  getConnectionInfo(): PortalConnectionInfo | null {
    return this.connectionInfo;
  }

  isConnected(): boolean {
    return this.connectionInfo !== null && this.isRunning;
  }

  getCapabilities(): PortalTransportCapabilities {
    return {
      supportsRealTimeUpdates: true,
      supportsBidirectionalCommunication: true,
      supportsFileTransfer: true,
      supportsVideoStreaming: false,
      supportsAuthentication: false,
      supportsEncryption: false,
      maxConcurrentConnections: 10,
      maxMessageSize: 10 * 1024 * 1024, // 10MB
      averageLatency: 1,
      reliability: 'high',
      protocol: 'ws',
      version: '1.0.0',
      features: ['real-time', 'file-storage', 'web-ui']
    };
  }

  async createSession(config: CreateSessionConfig): Promise<PortalSession> {
    const session: PortalSession = {
      sessionId: config.sessionId,
      userId: config.userId,
      status: 'pending',
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      expiresAt: Date.now() + (config.timeoutMs || 30 * 60 * 1000),
      portalUrl: await this.generatePortalUrl(config.sessionId),
      connectionId: this.connectionInfo?.connectionId
    };

    // Store session
    this.sessions.set(config.sessionId, session);
    await this.saveSessionToFile(session);

    // Initialize stats
    this.stats.set(config.sessionId, {
      sessionId: config.sessionId,
      totalDuration: 0,
      manualControlDuration: 0,
      actionsExecuted: 0,
      interventionsHandled: 0,
      averageResponseTime: 0,
      dataTransferred: 0,
      screenshotsTaken: 0,
      connectionDrops: 0,
      reconnections: 0,
      averageLatency: 0
    });

    logger.info('Portal session created', {
      sessionId: config.sessionId,
      portalUrl: session.portalUrl
    });

    this.emit('sessionCreated', session);
    return session;
  }

  async getSession(sessionId: string): Promise<PortalSession | null> {
    // Try memory first
    let session = this.sessions.get(sessionId);
    
    // Try loading from file
    if (!session) {
      session = await this.loadSessionFromFile(sessionId);
      if (session) {
        this.sessions.set(sessionId, session);
      }
    }
    
    return session || null;
  }

  async updateSession(sessionId: string, updates: Partial<PortalSession>): Promise<PortalSession> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new PortalTransportError(`Session ${sessionId} not found`, 'SESSION_NOT_FOUND');
    }

    const updatedSession = { ...session, ...updates, lastActiveAt: Date.now() };
    this.sessions.set(sessionId, updatedSession);
    await this.saveSessionToFile(updatedSession);

    return updatedSession;
  }

  async closeSession(sessionId: string): Promise<void> {
    const session = await this.getSession(sessionId);
    if (session) {
      session.status = 'closed';
      await this.updateSession(sessionId, session);
      
      // Close any WebSocket connections for this session
      const connections = Array.from(this.connections.values())
        .filter((conn: any) => conn.sessionId === sessionId);
      
      for (const conn of connections) {
        conn.ws.close();
      }
    }

    // Clean up if no active sessions
    const activeSessions = Array.from(this.sessions.values())
      .filter(s => s.status === 'connected' || s.status === 'pending');
    
    if (activeSessions.length === 0) {
      await this.stopServer();
    }
  }

  async getStats(sessionId: string): Promise<PortalStats> {
    const stats = this.stats.get(sessionId);
    if (!stats) {
      throw new PortalTransportError(`Stats for session ${sessionId} not found`, 'SESSION_NOT_FOUND');
    }
    return { ...stats };
  }

  async cleanup(): Promise<void> {
    await this.stopServer();
    this.sessions.clear();
    this.connections.clear();
    this.stats.clear();
    this.removeAllListeners();
  }

  private async startServer(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    const host = this.config?.local?.host || 'localhost';
    const port = this.config?.port || 3001;

    try {
      // Create HTTP server
      this.httpServer = createServer();
      
      // Set up HTTP request handler for serving portal UI
      this.httpServer.on('request', (req, res) => {
        this.handleHttpRequest(req, res);
      });

      // Create WebSocket server
      this.wsServer = new WebSocketServer({ 
        server: this.httpServer,
        path: '/ws'
      });

      this.wsServer.on('connection', (ws, req) => {
        this.handleWebSocketConnection(ws, req);
      });

      // Start listening
      await new Promise<void>((resolve, reject) => {
        this.httpServer!.listen(port, host, () => {
          this.isRunning = true;
          logger.info('Local portal server started', { host, port });
          resolve();
        });
        
        this.httpServer!.on('error', reject);
      });

    } catch (error) {
      logger.error('Failed to start local portal server', error);
      throw error;
    }
  }

  private async stopServer(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    try {
      // Close WebSocket server
      if (this.wsServer) {
        this.wsServer.close();
        this.wsServer = null;
      }

      // Close HTTP server
      if (this.httpServer) {
        await new Promise<void>((resolve) => {
          this.httpServer!.close(() => {
            this.httpServer = null;
            resolve();
          });
        });
      }

      this.isRunning = false;
      logger.info('Local portal server stopped');

    } catch (error) {
      logger.error('Error stopping local portal server', error);
    }
  }

  private async handleHttpRequest(req: any, res: any): Promise<void> {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      
      // Extract session ID from URL
      const sessionId = url.searchParams.get('sessionId') || 
                       url.searchParams.get('session') ||
                       url.pathname.split('/').pop();

      if (url.pathname === '/' || url.pathname.includes('.html')) {
        // Serve portal HTML
        await this.servePortalHtml(res, sessionId);
      } else if (url.pathname.includes('.css')) {
        // Serve CSS
        await this.servePortalCss(res);
      } else if (url.pathname.includes('.js')) {
        // Serve JavaScript
        await this.servePortalJs(res);
      } else {
        // 404
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      }

    } catch (error) {
      logger.error('HTTP request error', error);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal Server Error');
    }
  }

  private async servePortalHtml(res: any, sessionId?: string): Promise<void> {
    try {
      // In a real implementation, this would serve the portal web UI
      // For now, serve a simple HTML page
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>WallCrawler Portal - ${sessionId || 'Unknown Session'}</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 40px; background: #0f0f23; color: #ccc; }
            .container { max-width: 800px; margin: 0 auto; text-align: center; }
            .status { padding: 20px; border-radius: 8px; background: #1a1a3a; margin: 20px 0; }
            .connect-btn { 
              background: #3373dc; color: white; border: none; padding: 12px 24px; 
              border-radius: 6px; cursor: pointer; font-size: 16px; 
            }
            .connect-btn:hover { background: #4d86f7; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>🕷️ WallCrawler Agent Portal</h1>
            <div class="status">
              <h2>Local Development Portal</h2>
              <p>Session ID: <strong>${sessionId || 'Not specified'}</strong></p>
              <p>Status: <strong>Ready</strong></p>
              <p>WebSocket Endpoint: <strong>ws://localhost:${this.config?.port || 3001}/ws</strong></p>
            </div>
            <button class="connect-btn" onclick="connectToPortal()">Connect to Portal</button>
            <div id="connection-status"></div>
          </div>
          
          <script>
            let ws = null;
            
            function connectToPortal() {
              const statusDiv = document.getElementById('connection-status');
              statusDiv.innerHTML = '<p>Connecting...</p>';
              
              try {
                ws = new WebSocket('ws://localhost:${this.config?.port || 3001}/ws');
                
                ws.onopen = () => {
                  statusDiv.innerHTML = '<p style="color: #4caf50;">Connected to portal!</p>';
                };
                
                ws.onmessage = (event) => {
                  console.log('Portal message:', event.data);
                };
                
                ws.onclose = () => {
                  statusDiv.innerHTML = '<p style="color: #ff6b35;">Disconnected from portal</p>';
                };
                
                ws.onerror = (error) => {
                  statusDiv.innerHTML = '<p style="color: #f44336;">Connection error</p>';
                  console.error('WebSocket error:', error);
                };
                
              } catch (error) {
                statusDiv.innerHTML = '<p style="color: #f44336;">Failed to connect</p>';
                console.error('Connection error:', error);
              }
            }
          </script>
        </body>
        </html>
      `;

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);

    } catch (error) {
      logger.error('Error serving portal HTML', error);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Error serving portal');
    }
  }

  private async servePortalCss(res: any): Promise<void> {
    // Serve CSS - in real implementation, would serve from portal/web package
    res.writeHead(200, { 'Content-Type': 'text/css' });
    res.end('/* Portal CSS would go here */');
  }

  private async servePortalJs(res: any): Promise<void> {
    // Serve JavaScript - in real implementation, would serve from portal/web package
    res.writeHead(200, { 'Content-Type': 'application/javascript' });
    res.end('/* Portal JavaScript would go here */');
  }

  private handleWebSocketConnection(ws: any, req: any): void {
    const connectionId = this.generateConnectionId();
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const sessionId = url.searchParams.get('sessionId') || 'unknown';

    logger.info('Portal WebSocket connection', { connectionId, sessionId });

    // Store connection
    const connection = {
      id: connectionId,
      sessionId,
      ws,
      connectedAt: Date.now(),
      lastPingAt: Date.now()
    };
    
    this.connections.set(connectionId, connection);

    // Set up message handlers
    ws.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        this.handleWebSocketMessage(connectionId, message);
      } catch (error) {
        logger.error('WebSocket message parse error', error);
      }
    });

    ws.on('close', () => {
      logger.info('Portal WebSocket disconnected', { connectionId });
      this.connections.delete(connectionId);
    });

    ws.on('error', (error: Error) => {
      logger.error('Portal WebSocket error', { connectionId, error });
      this.connections.delete(connectionId);
    });

    // Send welcome message
    const welcomeMessage: PortalMessage = {
      id: this.generateMessageId(),
      type: 'auth',
      timestamp: Date.now(),
      sessionId,
      payload: {
        type: 'welcome',
        connectionId,
        serverInfo: {
          version: '1.0.0',
          capabilities: this.getCapabilities()
        }
      }
    };

    ws.send(JSON.stringify(welcomeMessage));
  }

  private handleWebSocketMessage(connectionId: string, message: any): void {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      return;
    }

    try {
      switch (message.type) {
        case 'command':
          this.handlePortalCommand(connectionId, message.payload);
          break;
        case 'ping':
          this.sendPongMessage(connectionId, message.id);
          break;
        default:
          logger.debug('Unknown WebSocket message type', { type: message.type });
      }

      // Update connection activity
      connection.lastPingAt = Date.now();

    } catch (error) {
      logger.error('Error handling WebSocket message', error);
    }
  }

  private sendPongMessage(connectionId: string, pingId: string): void {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      return;
    }

    const pongMessage: PortalMessage = {
      id: this.generateMessageId(),
      type: 'pong',
      timestamp: Date.now(),
      sessionId: connection.sessionId,
      payload: { pingId }
    };

    connection.ws.send(JSON.stringify(pongMessage));
  }

  private async broadcastMessage(sessionId: string, message: PortalMessage): Promise<void> {
    const sessionConnections = Array.from(this.connections.values())
      .filter((conn: any) => conn.sessionId === sessionId);

    const messageStr = JSON.stringify(message);

    for (const connection of sessionConnections) {
      try {
        connection.ws.send(messageStr);
      } catch (error) {
        logger.error('Error broadcasting message', { 
          connectionId: connection.id, 
          error 
        });
      }
    }
  }

  private async generatePortalUrl(sessionId: string): Promise<string> {
    const host = this.config?.local?.host || 'localhost';
    const port = this.config?.port || 3001;
    return `http://${host}:${port}/?sessionId=${sessionId}`;
  }

  private async ensureStorageDirectories(): Promise<void> {
    const dirs = [
      this.storageDir,
      path.join(this.storageDir, 'sessions'),
      path.join(this.storageDir, 'stats')
    ];

    for (const dir of dirs) {
      await fs.mkdir(dir, { recursive: true });
    }
  }

  private async saveSessionToFile(session: PortalSession): Promise<void> {
    const sessionPath = path.join(this.storageDir, 'sessions', `${session.sessionId}.json`);
    await fs.writeFile(sessionPath, JSON.stringify(session, null, 2));
  }

  private async loadSessionFromFile(sessionId: string): Promise<PortalSession | null> {
    try {
      const sessionPath = path.join(this.storageDir, 'sessions', `${sessionId}.json`);
      const data = await fs.readFile(sessionPath, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      return null;
    }
  }

  private generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateConnectionId(): string {
    return `conn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private handlePortalCommand(connectionId: string, command: any): void {
    logger.debug('Portal command received', { connectionId, commandType: command.type });
    
    // Emit command for processing by portal manager
    this.emit('command', command);
    
    // Send immediate acknowledgment
    const response = {
      id: this.generateMessageId(),
      type: 'command-response',
      timestamp: Date.now(),
      sessionId: command.sessionId,
      payload: {
        commandId: command.id || 'unknown',
        commandType: command.type,
        success: true,
        message: 'Command received',
        timestamp: Date.now()
      }
    };
    
    const connection = this.connections.get(connectionId);
    if (connection) {
      connection.ws.send(JSON.stringify(response));
    }
  }
}