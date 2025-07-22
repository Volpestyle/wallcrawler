import { Stagehand } from '@wallcrawler/stagehand';
import { LocalProvider } from '@wallcrawler/infra-local';
import type {
    ActOptions,
    ExtractOptions,
    ObserveOptions,
    AgentExecuteOptions,
    StagehandMetrics,
    Session
} from '@/types/stagehand';

class SessionManager {
    private provider: LocalProvider;

    constructor() {
        this.provider = new LocalProvider({ headless: false });
    }

    async createSession(options?: { verbose?: 0 | 1 | 2; enableCaching?: boolean, sessionId?: string }): Promise<Session> {
        const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
        const modelName = process.env.MODEL_NAME;

        if (!anthropicApiKey || !modelName) {
            throw new Error('Missing required env vars: ANTHROPIC_API_KEY and MODEL_NAME');
        }

        const stagehand = new Stagehand({
            sessionId: options?.sessionId,
            provider: this.provider,
            verbose: options?.verbose ?? 1,
            enableCaching: options?.enableCaching ?? true,
            modelName,
            modelClientOptions: { apiKey: anthropicApiKey },
            disablePino: true,
        });

        const initResult = await stagehand.init();
        const sessionId = initResult.sessionId!;

        const now = new Date();
        const session: Session = {
            id: sessionId,
            status: 'active',
            createdAt: now.toISOString(),
            debugUrl: initResult.debugUrl,
            sessionUrl: initResult.sessionUrl,
            lastActivity: now.toISOString(),
        };

        return session;
    }

    getSession(sessionId: string): Session | null {
        const instance = this.provider.getSession(sessionId);
        return instance ? { ...instance.session } : null;
    }

    async getAllSessions(): Promise<Session[]> {
        console.log('getAllSessions ---->', this.activeInstances);
        return Array.from(this.activeInstances.values()).map(instance => ({ ...instance.session }));
    }

    async closeSession(sessionId: string): Promise<void> {
        const instance = this.activeInstances.get(sessionId);
        if (instance) {
            await instance.stagehand.close();
            this.activeInstances.delete(sessionId);
        }
    }

    private getStagehand(sessionId: string): Stagehand {
        const instance = this.activeInstances.get(sessionId);
        if (!instance || instance.status !== 'active') {
            throw new Error(`Session ${sessionId} not found or closed`);
        }
        instance.lastActivity = new Date();
        instance.session.lastActivity = instance.lastActivity.toISOString();
        return instance.stagehand;
    }

    // Wrapper methods (e.g., act, extract, etc.)
    async act(sessionId: string, options: ActOptions) {
        const stagehand = this.getStagehand(sessionId);
        return await stagehand.page.act(options);
    }

    async extract(sessionId: string, options: ExtractOptions): Promise<Record<string, unknown>> {
        const stagehand = this.getStagehand(sessionId);
        return await stagehand.page.extract(options);
    }

    async observe(sessionId: string, options: ObserveOptions) {
        const stagehand = this.getStagehand(sessionId);
        return await stagehand.page.observe(options);
    }

    async agent(sessionId: string, options: AgentExecuteOptions) {
        const stagehand = this.getStagehand(sessionId);
        return await stagehand.agent().execute(options);
    }

    async navigate(sessionId: string, url: string) {
        const stagehand = this.getStagehand(sessionId);
        return await stagehand.page.goto(url);
    }

    async getMetrics(sessionId: string): Promise<StagehandMetrics> {
        const stagehand = this.getStagehand(sessionId);
        return stagehand.metrics || { /* default metrics */ };
    }
}

export const stagehandService = new SessionManager();