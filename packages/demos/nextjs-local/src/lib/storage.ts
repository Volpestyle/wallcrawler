import type { Workflow, WorkflowRun, Session, StagehandMetrics } from '@/types/stagehand';

interface StorageData {
    workflows: Record<string, Workflow>;
    workflowRuns: Record<string, WorkflowRun>;
    sessions: Record<string, Session>;
    metrics: {
        global: StagehandMetrics;
        bySession: Record<string, StagehandMetrics>;
        activities: Array<{
            id: string;
            timestamp: string;
            action: string;
            session: string;
            tokens: number;
            responseTime: number;
            success: boolean;
        }>;
    };
}

class LocalStorage {
    private static instance: LocalStorage;
    private data: StorageData;

    private constructor() {
        this.data = this.loadFromStorage();
    }

    static getInstance(): LocalStorage {
        if (!LocalStorage.instance) {
            LocalStorage.instance = new LocalStorage();
        }
        return LocalStorage.instance;
    }

    private loadFromStorage(): StorageData {
        if (typeof window === 'undefined') {
            return this.getDefaultData();
        }

        try {
            const stored = localStorage.getItem('wallcrawler-data');
            if (stored) {
                return JSON.parse(stored);
            }
        } catch (error) {
            console.error('Failed to load from localStorage:', error);
        }

        return this.getDefaultData();
    }

    private getDefaultData(): StorageData {
        return {
            workflows: {},
            workflowRuns: {},
            sessions: {},
            metrics: {
                global: {
                    actPromptTokens: 0,
                    actCompletionTokens: 0,
                    actInferenceTimeMs: 0,
                    extractPromptTokens: 0,
                    extractCompletionTokens: 0,
                    extractInferenceTimeMs: 0,
                    observePromptTokens: 0,
                    observeCompletionTokens: 0,
                    observeInferenceTimeMs: 0,
                    agentPromptTokens: 0,
                    agentCompletionTokens: 0,
                    agentInferenceTimeMs: 0,
                    totalPromptTokens: 0,
                    totalCompletionTokens: 0,
                    totalInferenceTimeMs: 0,
                },
                bySession: {},
                activities: [],
            },
        };
    }

    private saveToStorage(): void {
        if (typeof window === 'undefined') return;

        try {
            localStorage.setItem('wallcrawler-data', JSON.stringify(this.data));
        } catch (error) {
            console.error('Failed to save to localStorage:', error);
        }
    }

    // Workflow methods
    getWorkflows(): Workflow[] {
        return Object.values(this.data.workflows);
    }

    getWorkflow(id: string): Workflow | null {
        return this.data.workflows[id] || null;
    }

    saveWorkflow(workflow: Workflow): void {
        this.data.workflows[workflow.id] = workflow;
        this.saveToStorage();
    }

    deleteWorkflow(id: string): void {
        delete this.data.workflows[id];
        // Also delete related workflow runs
        Object.keys(this.data.workflowRuns).forEach((runId) => {
            if (this.data.workflowRuns[runId].workflowId === id) {
                delete this.data.workflowRuns[runId];
            }
        });
        this.saveToStorage();
    }

    // Workflow run methods
    getWorkflowRuns(workflowId?: string): WorkflowRun[] {
        const runs = Object.values(this.data.workflowRuns);
        return workflowId ? runs.filter(run => run.workflowId === workflowId) : runs;
    }

    getWorkflowRun(id: string): WorkflowRun | null {
        return this.data.workflowRuns[id] || null;
    }

    saveWorkflowRun(run: WorkflowRun): void {
        this.data.workflowRuns[run.id] = run;
        this.saveToStorage();
    }

    deleteWorkflowRun(id: string): void {
        delete this.data.workflowRuns[id];
        this.saveToStorage();
    }

    // Session methods
    getSessions(): Session[] {
        return Object.values(this.data.sessions);
    }

    getSession(id: string): Session | null {
        return this.data.sessions[id] || null;
    }

    saveSession(session: Session): void {
        this.data.sessions[session.id] = session;
        this.saveToStorage();
    }

    deleteSession(id: string): void {
        delete this.data.sessions[id];
        delete this.data.metrics.bySession[id];
        this.saveToStorage();
    }

    // Metrics methods
    getGlobalMetrics(): StagehandMetrics {
        return this.data.metrics.global;
    }

    getSessionMetrics(sessionId: string): StagehandMetrics {
        return this.data.metrics.bySession[sessionId] || {
            actPromptTokens: 0,
            actCompletionTokens: 0,
            actInferenceTimeMs: 0,
            extractPromptTokens: 0,
            extractCompletionTokens: 0,
            extractInferenceTimeMs: 0,
            observePromptTokens: 0,
            observeCompletionTokens: 0,
            observeInferenceTimeMs: 0,
            agentPromptTokens: 0,
            agentCompletionTokens: 0,
            agentInferenceTimeMs: 0,
            totalPromptTokens: 0,
            totalCompletionTokens: 0,
            totalInferenceTimeMs: 0,
        };
    }

    updateMetrics(sessionId: string, metrics: Partial<StagehandMetrics>): void {
        const currentSession = this.data.metrics.bySession[sessionId] || this.getSessionMetrics(sessionId);

        // Update session metrics
        this.data.metrics.bySession[sessionId] = {
            ...currentSession,
            ...metrics,
        };

        // Update global metrics by recalculating from all sessions
        const allSessionMetrics = Object.values(this.data.metrics.bySession);
        this.data.metrics.global = allSessionMetrics.reduce((acc, session) => ({
            actPromptTokens: acc.actPromptTokens + session.actPromptTokens,
            actCompletionTokens: acc.actCompletionTokens + session.actCompletionTokens,
            actInferenceTimeMs: acc.actInferenceTimeMs + session.actInferenceTimeMs,
            extractPromptTokens: acc.extractPromptTokens + session.extractPromptTokens,
            extractCompletionTokens: acc.extractCompletionTokens + session.extractCompletionTokens,
            extractInferenceTimeMs: acc.extractInferenceTimeMs + session.extractInferenceTimeMs,
            observePromptTokens: acc.observePromptTokens + session.observePromptTokens,
            observeCompletionTokens: acc.observeCompletionTokens + session.observeCompletionTokens,
            observeInferenceTimeMs: acc.observeInferenceTimeMs + session.observeInferenceTimeMs,
            agentPromptTokens: acc.agentPromptTokens + session.agentPromptTokens,
            agentCompletionTokens: acc.agentCompletionTokens + session.agentCompletionTokens,
            agentInferenceTimeMs: acc.agentInferenceTimeMs + session.agentInferenceTimeMs,
            totalPromptTokens: acc.totalPromptTokens + session.totalPromptTokens,
            totalCompletionTokens: acc.totalCompletionTokens + session.totalCompletionTokens,
            totalInferenceTimeMs: acc.totalInferenceTimeMs + session.totalInferenceTimeMs,
        }), {
            actPromptTokens: 0,
            actCompletionTokens: 0,
            actInferenceTimeMs: 0,
            extractPromptTokens: 0,
            extractCompletionTokens: 0,
            extractInferenceTimeMs: 0,
            observePromptTokens: 0,
            observeCompletionTokens: 0,
            observeInferenceTimeMs: 0,
            agentPromptTokens: 0,
            agentCompletionTokens: 0,
            agentInferenceTimeMs: 0,
            totalPromptTokens: 0,
            totalCompletionTokens: 0,
            totalInferenceTimeMs: 0,
        });

        this.saveToStorage();
    }

    addActivity(activity: {
        id: string;
        timestamp: string;
        action: string;
        session: string;
        tokens: number;
        responseTime: number;
        success: boolean;
    }): void {
        this.data.metrics.activities.unshift(activity);
        // Keep only last 100 activities
        this.data.metrics.activities = this.data.metrics.activities.slice(0, 100);
        this.saveToStorage();
    }

    getActivities(): typeof this.data.metrics.activities {
        return this.data.metrics.activities;
    }

    // Utility methods
    clear(): void {
        this.data = this.getDefaultData();
        this.saveToStorage();
    }

    export(): StorageData {
        return JSON.parse(JSON.stringify(this.data));
    }

    import(data: Partial<StorageData>): void {
        this.data = { ...this.data, ...data };
        this.saveToStorage();
    }
}

export const storage = LocalStorage.getInstance(); 