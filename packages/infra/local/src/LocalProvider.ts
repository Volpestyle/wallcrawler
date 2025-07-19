/**
 * Local Browser Automation Provider
 * Implements browser automation using local Playwright browsers
 * Provides a simple alternative to AWS-based infrastructure for development
 */

import {
    IBrowserProvider,
    IBrowserAutomationProvider,
    ISessionStateManager,
    AutomationTaskConfig,
    TaskInfo,
    ContainerResponse,
    HealthStatus,
    ContainerMethod,
    ScreencastOptions,
    InputEvent,
} from '@wallcrawler/infra-common';

import { chromium, Browser, BrowserContext, Page, BrowserServer } from 'playwright';
import { EventEmitter } from 'events';
import { LocalSessionStateManager } from './LocalSessionStateManager';
import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';

// Import types that match stagehand's expectations
export interface ProviderSession {
    sessionId: string;
    debugUrl?: string;
    sessionUrl?: string;
    metadata?: Record<string, unknown>;
}

export interface BrowserConnectionResult {
    browser: Browser;
    context?: BrowserContext;
    contextPath?: string;
}

export interface Artifact {
    id: string;
    path: string;
    name: string;
    size: number;
    mimeType: string;
    url: string;
    createdAt: Date;
}

export interface ArtifactList {
    artifacts: Artifact[];
    cursor?: string;
    hasMore: boolean;
}

export interface LocalProviderConfig {
    /** Run browser in headless mode */
    headless?: boolean;
    /** Path to browser executable */
    browserPath?: string;
    /** Directory for storing artifacts */
    artifactsDir?: string;
    /** Viewport settings */
    viewport?: { width: number; height: number };
    /** Additional browser launch options */
    launchOptions?: Record<string, unknown>;
}

interface LocalSession {
    id: string;
    sessionId: string;
    browser: Browser;
    context: BrowserContext;
    page: Page;
    startedAt: Date;
    debugUrl?: string;
    metadata?: Record<string, unknown>;
    browserServer: BrowserServer;
}

interface LocalTask {
    taskId: string;
    sessionId: string;
    status: 'starting' | 'running' | 'stopping' | 'stopped' | 'failed';
    startedAt: Date;
    metadata?: Record<string, unknown>;
    process?: {
        pid: number;
        command: string;
    };
}

/**
 * Local provider implementation for browser automation
 */
export class LocalProvider extends EventEmitter implements IBrowserProvider, IBrowserAutomationProvider {
    // IBrowserProvider properties
    readonly type = 'local' as const;
    readonly name = 'Local Browser Automation Provider';

    private config: Required<LocalProviderConfig>;
    private sessionStateManager: LocalSessionStateManager;
    private sessions = new Map<string, LocalSession>();
    private tasks = new Map<string, LocalTask>();
    private isInitialized = false;
    private artifactsDir: string;

    constructor(config: LocalProviderConfig = {}) {
        super();
        this.config = {
            headless: config.headless ?? false,
            browserPath: config.browserPath ?? '',
            artifactsDir: config.artifactsDir ?? './artifacts',
            viewport: config.viewport ?? { width: 1280, height: 720 },
            launchOptions: config.launchOptions ?? {},
        };

        this.artifactsDir = path.resolve(this.config.artifactsDir);
        this.sessionStateManager = new LocalSessionStateManager();
    }

    /**
     * Initialize the provider (optional for local)
     */
    async initialize(): Promise<void> {
        if (this.isInitialized) {
            return;
        }

        // Create artifacts directory
        await fs.mkdir(this.artifactsDir, { recursive: true });

        this.isInitialized = true;
        console.log('[LocalProvider] Initialized successfully');
    }

    // =============================================================================
    // IBrowserProvider Implementation
    // =============================================================================

    async createSession(params?: Record<string, unknown>): Promise<ProviderSession> {
        const sessionId = params?.sessionId?.toString() || randomUUID();
        const uniqueSessionId = `local-${sessionId}`;

        console.log(`[LocalProvider] Creating session: ${uniqueSessionId}`);

        try {
            // Launch browser server
            const browserServer = await chromium.launchServer({
                headless: this.config.headless,
                executablePath: this.config.browserPath || undefined,
                ...this.config.launchOptions,
            });

            const cdpEndpoint = browserServer.wsEndpoint();

            // Connect to browser
            const browser = await chromium.connect(cdpEndpoint);

            // Create context
            const context = await browser.newContext({
                viewport: this.config.viewport,
            });

            // Create initial page
            const page = await context.newPage();

            const debugUrl = cdpEndpoint;

            // Store session
            const session: LocalSession = {
                id: uniqueSessionId,
                sessionId,
                browser,
                context,
                page,
                startedAt: new Date(),
                debugUrl,
                metadata: params || {},
                browserServer,
            };

            this.sessions.set(uniqueSessionId, session);

            // Create session in state manager
            await this.sessionStateManager.createSession({
                id: uniqueSessionId,
                sessionId,
                taskId: `local-task-${uniqueSessionId}`,
                taskArn: null,
                status: 'running',
                startedAt: new Date(),
                updatedAt: new Date(),
                lastHeartbeat: new Date(),
                browserUrl: debugUrl,
                privateIp: 'localhost',
                publicIp: 'localhost',
                itemsProcessed: 0,
                healthStatus: 'running',
                metadata: params || {},
            });

            console.log(`[LocalProvider] Session created: ${uniqueSessionId}`);

            return {
                sessionId: uniqueSessionId,
                debugUrl,
                sessionUrl: debugUrl,
                metadata: params,
            };
        } catch (error) {
            console.error('[LocalProvider] Failed to create session:', error);
            throw error;
        }
    }

    async resumeSession(sessionId: string): Promise<ProviderSession> {
        console.log(`[LocalProvider] Resuming session: ${sessionId}`);

        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error(`Session ${sessionId} not found`);
        }

        // Check if browser is still connected
        if (!session.browser.isConnected()) {
            throw new Error(`Session ${sessionId} browser is no longer connected`);
        }

        return {
            sessionId,
            debugUrl: session.debugUrl,
            sessionUrl: session.debugUrl,
            metadata: session.metadata,
        };
    }

    async connectToBrowser(session: ProviderSession): Promise<BrowserConnectionResult> {
        console.log(`[LocalProvider] Connecting to browser for session: ${session.sessionId}`);

        const localSession = this.sessions.get(session.sessionId);
        if (!localSession) {
            throw new Error(`Session ${session.sessionId} not found`);
        }

        return {
            browser: localSession.browser,
            context: localSession.context,
            contextPath: undefined, // Local sessions don't need context paths
        };
    }

    async endSession(sessionId: string): Promise<void> {
        console.log(`[LocalProvider] Ending session: ${sessionId}`);

        const session = this.sessions.get(sessionId);
        if (session) {
            try {
                await session.context.close();
                await session.browser.close();
                await session.browserServer.close();
            } catch (error) {
                console.error(`[LocalProvider] Error closing browser for session ${sessionId}:`, error);
            }
            this.sessions.delete(sessionId);
        }

        // Remove from state manager
        await this.sessionStateManager.deleteSession(sessionId);

        console.log(`[LocalProvider] Session ended: ${sessionId}`);
    }

    async saveArtifact(sessionId: string, filePath: string, data: Buffer): Promise<Artifact> {
        const sessionDir = path.join(this.artifactsDir, sessionId);
        await fs.mkdir(sessionDir, { recursive: true });

        const fileName = path.basename(filePath);
        const artifactPath = path.join(sessionDir, fileName);

        await fs.writeFile(artifactPath, data);

        const stats = await fs.stat(artifactPath);
        const artifact: Artifact = {
            id: randomUUID(),
            path: artifactPath,
            name: fileName,
            size: stats.size,
            mimeType: this.getMimeType(fileName),
            url: `file://${artifactPath}`,
            createdAt: new Date(),
        };

        console.log(`[LocalProvider] Saved artifact: ${artifact.name} (${artifact.size} bytes)`);
        return artifact;
    }

    async getArtifacts(sessionId: string, _cursor?: string): Promise<ArtifactList> {
        const sessionDir = path.join(this.artifactsDir, sessionId);

        try {
            const files = await fs.readdir(sessionDir);
            const artifacts: Artifact[] = [];

            for (const file of files) {
                const filePath = path.join(sessionDir, file);
                const stats = await fs.stat(filePath);

                artifacts.push({
                    id: randomUUID(),
                    path: filePath,
                    name: file,
                    size: stats.size,
                    mimeType: this.getMimeType(file),
                    url: `file://${filePath}`,
                    createdAt: stats.ctime,
                });
            }

            return {
                artifacts,
                cursor: undefined,
                hasMore: false,
            };
        } catch {
            return {
                artifacts: [],
                cursor: undefined,
                hasMore: false,
            };
        }
    }

    async downloadArtifact(sessionId: string, artifactId: string): Promise<Buffer> {
        // For local provider, we'll need to find the artifact by ID
        // This is a simplified implementation
        const artifacts = await this.getArtifacts(sessionId);
        const artifact = artifacts.artifacts.find(a => a.id === artifactId);

        if (!artifact) {
            throw new Error(`Artifact ${artifactId} not found`);
        }

        return await fs.readFile(artifact.path);
    }

    async cleanup(): Promise<void> {
        console.log('[LocalProvider] Cleaning up...');

        // Close all sessions
        for (const [sessionId] of this.sessions) {
            await this.endSession(sessionId);
        }

        this.sessions.clear();
        this.tasks.clear();
    }

    // =============================================================================
    // IBrowserAutomationProvider Implementation
    // =============================================================================

    async startAutomationTask(config: AutomationTaskConfig): Promise<TaskInfo> {
        const taskId = `local-task-${Date.now()}`;

        console.log(`[LocalProvider] Starting automation task: ${taskId}`);

        const task: LocalTask = {
            taskId,
            sessionId: config.sessionId,
            status: 'starting',
            startedAt: new Date(),
            metadata: {
                userId: config.userId,
                environment: config.environment,
                region: config.region || 'local',
            },
            process: {
                pid: process.pid,
                command: 'local-browser-process',
            },
        };

        this.tasks.set(taskId, task);

        // Simulate task startup
        setTimeout(() => {
            task.status = 'running';
        }, 100);

        const taskInfo: TaskInfo = {
            taskId,
            taskArn: `local:task:${taskId}`,
            userId: config.userId,
            status: 'starting',
            lastStatus: 'starting',
            startedAt: task.startedAt,
            privateIp: 'localhost',
            publicIp: 'localhost',
            metadata: task.metadata,
        };

        console.log(`[LocalProvider] Task started: ${taskId}`);
        return taskInfo;
    }

    async stopAutomationTask(taskId: string, _reason?: string): Promise<void> {
        console.log(`[LocalProvider] Stopping task: ${taskId}, reason: ${_reason || 'none'}`);

        const task = this.tasks.get(taskId);
        if (task) {
            task.status = 'stopping';
            // For local provider, we just mark it as stopped
            setTimeout(() => {
                task.status = 'stopped';
            }, 100);
        }
    }

    async getTaskInfo(taskId: string): Promise<TaskInfo | null> {
        const task = this.tasks.get(taskId);
        if (!task) {
            return null;
        }

        return {
            taskId,
            taskArn: `local:task:${taskId}`,
            userId: task.metadata?.userId as string || 'unknown',
            status: task.status as any,
            lastStatus: task.status as any,
            startedAt: task.startedAt,
            privateIp: 'localhost',
            publicIp: 'localhost',
            metadata: task.metadata,
        };
    }

    async findTaskBySessionId(sessionId: string): Promise<TaskInfo | null> {
        for (const [taskId, task] of this.tasks) {
            if (task.sessionId === sessionId) {
                return this.getTaskInfo(taskId);
            }
        }
        return null;
    }

    async listActiveTasks(): Promise<TaskInfo[]> {
        const activeTasks: TaskInfo[] = [];

        for (const [taskId, task] of this.tasks) {
            if (task.status === 'running' || task.status === 'starting') {
                const taskInfo = await this.getTaskInfo(taskId);
                if (taskInfo) {
                    activeTasks.push(taskInfo);
                }
            }
        }

        return activeTasks;
    }

    async getTaskEndpoint(taskId: string, _timeoutMs?: number): Promise<string | null> {
        // For local provider, return localhost endpoint
        const task = this.tasks.get(taskId);
        if (!task) {
            return null;
        }

        return 'http://localhost:3000'; // Default local endpoint
    }

    async callContainerEndpoint<T = unknown>(
        endpoint: string,
        path: string,
        method: ContainerMethod = 'GET',
        _body?: Record<string, unknown>,
        _retries?: number
    ): Promise<ContainerResponse<T>> {
        // Simplified implementation for local provider
        // In a real implementation, this would make HTTP calls to local processes
        console.log(`[LocalProvider] Calling ${method} ${endpoint}${path}`);

        return {
            success: true,
            data: {} as T,
            statusCode: 200,
        };
    }

    async getContainerHealth(taskId: string): Promise<ContainerResponse<HealthStatus>> {
        const task = this.tasks.get(taskId);

        return {
            success: true,
            data: {
                status: task?.status === 'running' ? 'healthy' : 'unhealthy',
                message: task?.status === 'running' ? 'Local task running' : 'Local task not running',
            },
            statusCode: 200,
        };
    }

    getSessionStateManager(): ISessionStateManager {
        return this.sessionStateManager;
    }

    // =============================================================================
    // Optional Screencast Support
    // =============================================================================

    async startScreencast?(sessionId: string, _options?: ScreencastOptions): Promise<void> {
        console.log(`[LocalProvider] Starting screencast for session: ${sessionId}`);
        // Placeholder for screencast implementation
        // Could use Playwright's video recording or screenshot capabilities
    }

    async stopScreencast?(sessionId: string): Promise<void> {
        console.log(`[LocalProvider] Stopping screencast for session: ${sessionId}`);
        // Placeholder for stopping screencast
    }

    async sendInput?(sessionId: string, inputEvent: InputEvent): Promise<void> {
        console.log(`[LocalProvider] Sending input to session: ${sessionId}`, inputEvent);
        // Placeholder for input forwarding
        // Could use Playwright's input methods
    }

    // =============================================================================
    // Helper Methods
    // =============================================================================

    private getMimeType(fileName: string): string {
        const ext = path.extname(fileName).toLowerCase();
        const mimeTypes: Record<string, string> = {
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.pdf': 'application/pdf',
            '.txt': 'text/plain',
            '.json': 'application/json',
            '.html': 'text/html',
            '.css': 'text/css',
            '.js': 'application/javascript',
        };

        return mimeTypes[ext] || 'application/octet-stream';
    }

    private ensureInitialized(): void {
        if (!this.isInitialized) {
            throw new Error('LocalProvider must be initialized before use. Call initialize() first.');
        }
    }
} 