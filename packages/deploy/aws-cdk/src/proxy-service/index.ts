/**
 * WallCrawler Proxy Service
 * Manages WebSocket connections and routes them to multi-session containers
 */

import { WebSocket } from 'ws';
import { createClient } from 'redis';
import { S3Client } from '@aws-sdk/client-s3';
import { ECSClient, RunTaskCommand, ListTasksCommand } from '@aws-sdk/client-ecs';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { ElasticLoadBalancingV2Client, DescribeTargetHealthCommand } from '@aws-sdk/client-elastic-load-balancing-v2';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { JWETokenManager } from './jwe-utils';

// Environment configuration
const PORT = parseInt(process.env.PORT || '8080');
const REDIS_ENDPOINT = process.env.REDIS_ENDPOINT!;
const JWE_SECRET_ARN = process.env.JWE_SECRET_ARN!;
const _API_KEYS_ARN = process.env.API_KEYS_ARN!;
const _ALB_TARGET_GROUP_ARN = process.env.ALB_TARGET_GROUP_ARN!;
const ECS_CLUSTER_NAME = process.env.ECS_CLUSTER_NAME!;
const _ECS_SERVICE_NAME = process.env.ECS_SERVICE_NAME!;
const _CONTAINER_IMAGE = process.env.CONTAINER_IMAGE!;
const CONTAINER_TASK_DEF = process.env.CONTAINER_TASK_DEF!;
const CONTAINER_SUBNETS = process.env.CONTAINER_SUBNETS!.split(',');
const CONTAINER_SECURITY_GROUP = process.env.CONTAINER_SECURITY_GROUP_ID!;
const MIN_CONTAINERS = parseInt(process.env.MIN_CONTAINERS || '2');
const MAX_CONTAINERS = parseInt(process.env.MAX_CONTAINERS || '100');
const MAX_SESSIONS_PER_CONTAINER = parseInt(process.env.MAX_SESSIONS_PER_CONTAINER || '20');

interface ClientConnection {
  ws: Bun.ServerWebSocket;
  sessionId: string;
  userId: string;
  containerId?: string;
}

interface ContainerConnection {
  ws: WebSocket;
  containerId: string;
  taskArn: string;
  ip: string;
  sessions: Set<string>;
  lastHealthCheck: number;
  cpuUsage: number;
  memoryUsage: number;
}

class WallCrawlerProxy {
  private server: Bun.Server | null = null;
  private redis!: ReturnType<typeof createClient>;
  private s3Client = new S3Client({});
  private ecsClient = new ECSClient({});
  private secretsClient = new SecretsManagerClient({});
  private elbClient = new ElasticLoadBalancingV2Client({});
  private ssmClient = new SSMClient({});

  // Connection management
  private clients = new Map<string, ClientConnection>();
  private containers = new Map<string, ContainerConnection>();
  private sessionToContainer = new Map<string, string>();

  // Configuration
  private jweSecret!: string;
  private jweTokenManager: JWETokenManager | null = null;
  private allowedApiKeys: Set<string> = new Set();

  // Container pool management
  private poolMaintenanceInterval: NodeJS.Timeout | null = null;

  async start() {
    // Load JWE secret
    await this.loadSecrets();

    // Connect to Redis
    this.redis = createClient({
      socket: { host: REDIS_ENDPOINT, port: 6379 },
    });
    await this.redis.connect();

    // Initialize container pool
    await this.initializeContainerPool();

    // Start server
    this.server = Bun.serve({
      port: PORT,
      fetch: this.handleRequest.bind(this),
      websocket: {
        message: this.handleClientMessage.bind(this),
        open: this.handleClientOpen.bind(this),
        close: this.handleClientClose.bind(this),
      },
    });

    console.log(`🚀 WallCrawler Proxy started on port ${PORT}`);

    // Start pool maintenance
    this.startPoolMaintenance();

    // Graceful shutdown
    process.on('SIGTERM', () => this.shutdown());
    process.on('SIGINT', () => this.shutdown());
  }

  private async handleRequest(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === '/health') {
      return Response.json({
        status: 'healthy',
        containers: this.containers.size,
        clients: this.clients.size,
        uptime: process.uptime(),
      });
    }

    // WebSocket upgrade for clients
    if (url.pathname.startsWith('/sessions/')) {
      const upgraded = this.server!.upgrade(req, {
        data: {
          url: req.url,
          headers: req.headers,
        },
      });
      if (upgraded) {
        return new Response(null, { status: 101 });
      }
      return new Response('WebSocket upgrade failed', { status: 400 });
    }

    // Internal container registration endpoint
    if (url.pathname === '/internal/register' && req.method === 'POST') {
      return this.handleContainerRegistration(req);
    }

    return new Response('Not Found', { status: 404 });
  }

  private async handleClientOpen(ws: Bun.ServerWebSocket) {
    const data = ws.data as { url: string; headers: Headers } | undefined;
    if (!data) {
      ws.close(1008, 'Invalid WebSocket data');
      return;
    }

    const url = new URL(data.url);
    const pathParts = url.pathname.split('/');
    const sessionId = pathParts[2]; // /sessions/{sessionId}/ws

    // Extract JWT from Authorization header
    const authHeader = data.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      ws.close(1008, 'Invalid authorization');
      return;
    }

    const token = authHeader.substring(7);

    try {
      // Verify JWE token
      const decoded = await this.jweTokenManager!.verifyToken(token);

      // Create client connection
      const client: ClientConnection = {
        ws,
        sessionId,
        userId: decoded.userId,
      };

      this.clients.set(sessionId, client);

      // Find or create session in container
      const containerId = await this.assignSessionToContainer(sessionId, decoded.userId);
      client.containerId = containerId;

      // Notify container of new session
      const container = this.containers.get(containerId);
      if (container) {
        container.ws.send(
          JSON.stringify({
            type: 'CREATE_SESSION',
            sessionId,
            userId: decoded.userId,
            options: decoded.browserOptions || {},
          })
        );
      }

      console.log(`Client connected: session=${sessionId}, container=${containerId}`);
    } catch (error) {
      console.error('Client authentication failed:', error);
      ws.close(1008, 'Authentication failed');
    }
  }

  private async handleClientMessage(ws: Bun.ServerWebSocket, message: string | Buffer) {
    const sessionId = this.findSessionIdByWs(ws);
    if (!sessionId) return;

    const client = this.clients.get(sessionId);
    if (!client?.containerId) return;

    const container = this.containers.get(client.containerId);
    if (!container) return;

    try {
      const parsedMessage = JSON.parse(message.toString());

      // Handle screencast messages directly
      if (parsedMessage.type === 'START_SCREENCAST' ||
        parsedMessage.type === 'STOP_SCREENCAST' ||
        parsedMessage.type === 'SEND_INPUT') {
        // Forward screencast messages directly with session context
        container.ws.send(
          JSON.stringify({
            ...parsedMessage,
            sessionId
          })
        );
      } else {
        // Forward other messages as CLIENT_MESSAGE
        container.ws.send(
          JSON.stringify({
            type: 'CLIENT_MESSAGE',
            sessionId,
            data: parsedMessage,
          })
        );
      }
    } catch (error) {
      console.error('Error handling client message:', error);
    }
  }

  private async handleClientClose(ws: Bun.ServerWebSocket) {
    const sessionId = this.findSessionIdByWs(ws);
    if (!sessionId) return;

    const client = this.clients.get(sessionId);
    if (client?.containerId) {
      const container = this.containers.get(client.containerId);
      if (container) {
        // Notify container to cleanup session
        container.ws.send(
          JSON.stringify({
            type: 'DESTROY_SESSION',
            sessionId,
          })
        );

        container.sessions.delete(sessionId);
      }
    }

    this.clients.delete(sessionId);
    this.sessionToContainer.delete(sessionId);

    console.log(`Client disconnected: session=${sessionId}`);
  }

  private async assignSessionToContainer(sessionId: string, userId: string): Promise<string> {
    // Try to find container with existing user sessions (affinity)
    for (const [containerId, container] of this.containers) {
      if (container.sessions.size < MAX_SESSIONS_PER_CONTAINER) {
        // Check if user has sessions in this container
        for (const sid of container.sessions) {
          const client = this.clients.get(sid);
          if (client?.userId === userId) {
            container.sessions.add(sessionId);
            this.sessionToContainer.set(sessionId, containerId);
            return containerId;
          }
        }
      }
    }

    // Find least loaded container
    let targetContainer: ContainerConnection | null = null;
    let minSessions = MAX_SESSIONS_PER_CONTAINER;

    for (const container of this.containers.values()) {
      if (container.sessions.size < minSessions) {
        targetContainer = container;
        minSessions = container.sessions.size;
      }
    }

    if (targetContainer) {
      targetContainer.sessions.add(sessionId);
      this.sessionToContainer.set(sessionId, targetContainer.containerId);
      return targetContainer.containerId;
    }

    // Need to spawn new container
    if (this.containers.size < MAX_CONTAINERS) {
      const newContainerId = await this.spawnContainer();
      const newContainer = this.containers.get(newContainerId);
      if (newContainer) {
        newContainer.sessions.add(sessionId);
        this.sessionToContainer.set(sessionId, newContainerId);
        return newContainerId;
      }
    }

    throw new Error('No containers available');
  }

  private async spawnContainer(): Promise<string> {
    const containerId = `cnt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    const response = await this.ecsClient.send(
      new RunTaskCommand({
        cluster: ECS_CLUSTER_NAME,
        taskDefinition: CONTAINER_TASK_DEF,
        launchType: 'FARGATE',
        networkConfiguration: {
          awsvpcConfiguration: {
            subnets: CONTAINER_SUBNETS,
            securityGroups: [CONTAINER_SECURITY_GROUP],
            assignPublicIp: 'DISABLED',
          },
        },
        overrides: {
          containerOverrides: [
            {
              name: 'BrowserContainer',
              environment: [
                { name: 'CONTAINER_ID', value: containerId },
                { name: 'PROXY_ENDPOINT', value: `http://proxy.internal:${PORT}` },
                { name: 'CONTAINER_MODE', value: 'MULTI_SESSION' },
                { name: 'MAX_SESSIONS', value: String(MAX_SESSIONS_PER_CONTAINER) },
              ],
            },
          ],
        },
      })
    );

    const _taskArn = response.tasks![0].taskArn!;

    // Wait for container to register
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Container registration timeout'));
      }, 60000);

      const checkInterval = setInterval(async () => {
        if (this.containers.has(containerId)) {
          clearInterval(checkInterval);
          clearTimeout(timeout);
          resolve(containerId);
        }
      }, 1000);
    });
  }

  private async handleContainerRegistration(req: Request): Promise<Response> {
    const body = (await req.json()) as { containerId: string; ip: string; port: number; taskArn: string };
    const { containerId, ip, port } = body;

    // Verify container token
    const token = req.headers.get('x-container-token');
    if (!token || !(await this.verifyContainerToken(token, containerId))) {
      return new Response('Unauthorized', { status: 401 });
    }

    // Establish WebSocket connection to container
    const ws = new WebSocket(`ws://${ip}:${port}/internal/ws`);

    const container: ContainerConnection = {
      ws,
      containerId,
      taskArn: body.taskArn,
      ip,
      sessions: new Set(),
      lastHealthCheck: Date.now(),
      cpuUsage: 0,
      memoryUsage: 0,
    };

    // Setup container WebSocket handlers
    ws.on('message', (data) => {
      const message = JSON.parse(data.toString());
      this.handleContainerMessage(containerId, message);
    });

    ws.on('close', () => {
      this.handleContainerDisconnect(containerId);
    });

    ws.on('error', (error) => {
      console.error(`Container ${containerId} WebSocket error:`, error);
    });

    this.containers.set(containerId, container);

    console.log(`Container registered: ${containerId} at ${ip}:${port}`);

    return Response.json({ status: 'registered' });
  }

  private handleContainerMessage(containerId: string, message: any) {
    switch (message.type) {
      case 'SESSION_READY': {
        // Forward to client
        const client = this.clients.get(message.sessionId);
        if (client) {
          client.ws.send(
            JSON.stringify({
              type: 'session_ready',
              sessionId: message.sessionId,
            })
          );
        }
        break;
      }

      case 'CDP_RESPONSE': {
        // Forward CDP response to client
        const sessionClient = this.clients.get(message.sessionId);
        if (sessionClient) {
          sessionClient.ws.send(JSON.stringify(message.data));
        }
        break;
      }

      case 'HEALTH_UPDATE': {
        // Update container metrics
        const container = this.containers.get(containerId);
        if (container) {
          container.cpuUsage = message.cpuUsage;
          container.memoryUsage = message.memoryUsage;
          container.lastHealthCheck = Date.now();
        }
        break;
      }

      case 'SCREENCAST_FRAME': {
        // Forward screencast frame to client
        const sessionId = message.sessionId;
        if (sessionId && this.clients.has(sessionId)) {
          const clientWs = this.clients.get(sessionId)?.ws;
          if (clientWs && clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify(message));
          }
        }
        break;
      }

      case 'SCREENCAST_STARTED':
      case 'SCREENCAST_STOPPED':
      case 'SCREENCAST_ERROR': {
        // Forward screencast status messages to client
        const sessionId = message.sessionId;
        if (sessionId && this.clients.has(sessionId)) {
          const clientWs = this.clients.get(sessionId)?.ws;
          if (clientWs && clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify(message));
          }
        }
        break;
      }
    }
  }

  private handleContainerDisconnect(containerId: string) {
    const container = this.containers.get(containerId);
    if (!container) return;

    // Reassign all sessions from this container
    for (const sessionId of container.sessions) {
      const client = this.clients.get(sessionId);
      if (client) {
        client.ws.close(1011, 'Container disconnected');
      }
    }

    this.containers.delete(containerId);
    console.log(`Container disconnected: ${containerId}`);
  }

  private async initializeContainerPool() {
    // Ensure minimum containers are running
    const runningTasks = await this.ecsClient.send(
      new ListTasksCommand({
        cluster: ECS_CLUSTER_NAME,
        family: CONTAINER_TASK_DEF,
      })
    );

    const currentContainers = runningTasks.taskArns?.length || 0;
    const toSpawn = Math.max(0, MIN_CONTAINERS - currentContainers);

    console.log(`Initializing container pool: ${currentContainers} running, spawning ${toSpawn}`);

    for (let i = 0; i < toSpawn; i++) {
      await this.spawnContainer();
    }
  }

  private startPoolMaintenance() {
    this.poolMaintenanceInterval = setInterval(async () => {
      // Remove unhealthy containers
      for (const [containerId, container] of this.containers) {
        if (Date.now() - container.lastHealthCheck > 60000) {
          console.log(`Removing unhealthy container: ${containerId}`);
          this.handleContainerDisconnect(containerId);
        }
      }

      // Ensure minimum containers
      if (this.containers.size < MIN_CONTAINERS) {
        const toSpawn = MIN_CONTAINERS - this.containers.size;
        for (let i = 0; i < toSpawn; i++) {
          await this.spawnContainer();
        }
      }

      // Update Redis with pool state
      await this.redis.set(
        'pool:state',
        JSON.stringify({
          totalContainers: this.containers.size,
          totalSessions: this.clients.size,
          timestamp: Date.now(),
        })
      );
    }, 30000); // Every 30 seconds
  }

  private async loadSecrets(): Promise<void> {
    try {
      // Load JWE secret
      const jweSecretResponse = await this.secretsClient.send(
        new GetSecretValueCommand({
          SecretId: JWE_SECRET_ARN,
        })
      );

      if (!jweSecretResponse.SecretString) {
        throw new Error('JWE secret not found');
      }

      this.jweSecret = jweSecretResponse.SecretString;
      this.jweTokenManager = new JWETokenManager(this.jweSecret);

      // Load allowed API keys
      const apiKeysResponse = await this.ssmClient.send(
        new GetParameterCommand({
          Name: _API_KEYS_ARN,
          WithDecryption: true,
        })
      );
      this.allowedApiKeys = new Set(JSON.parse(apiKeysResponse.Parameter!.Value!));

      // Load ALB target group ARN
      const albTargetGroupArnResponse = await this.ssmClient.send(
        new GetParameterCommand({
          Name: _ALB_TARGET_GROUP_ARN,
          WithDecryption: true,
        })
      );
      const albTargetGroupArn = albTargetGroupArnResponse.Parameter!.Value!;

      // Register container with ALB
      await this.elbClient.send(
        new DescribeTargetHealthCommand({
          TargetGroupArn: albTargetGroupArn,
        })
      );
    } catch (error) {
      console.error('Failed to load secrets:', error);
      throw error;
    }
  }

  private async verifyContainerToken(_token: string, _containerId: string): Promise<boolean> {
    // Implement container token verification
    return true;
  }

  private findSessionIdByWs(ws: Bun.ServerWebSocket): string | null {
    for (const [sessionId, client] of this.clients) {
      if (client.ws === ws) {
        return sessionId;
      }
    }
    return null;
  }
  private async shutdown() {
    console.log('Shutting down proxy...');

    if (this.poolMaintenanceInterval) {
      clearInterval(this.poolMaintenanceInterval);
    }

    // Close all client connections
    for (const client of this.clients.values()) {
      client.ws.close(1001, 'Proxy shutting down');
    }

    // Disconnect from containers
    for (const container of this.containers.values()) {
      container.ws.close();
    }

    await this.redis.quit();
    this.server?.stop();
    process.exit(0);
  }
}

// Start the proxy
const proxy = new WallCrawlerProxy();
proxy.start().catch((error) => {
  console.error('Failed to start proxy:', error);
  process.exit(1);
});
