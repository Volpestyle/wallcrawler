import { useState, useEffect, useCallback } from 'react';
import { format } from 'date-fns';
import type { Session, Workflow, WorkflowRun } from '@/types/stagehand';

interface MetricsData {
    // Basic counts
    totalSessions: number;
    activeSessions: number;
    totalWorkflows: number;
    totalWorkflowRuns: number;

    // Token and cost metrics
    totalTokens: number;
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalCost: number;

    // Performance metrics
    avgResponseTime: number;
    totalInferenceTime: number;

    // Success metrics
    successRate: number;
    totalActions: number;
    successfulActions: number;

    // Activity data
    recentActivity: Array<{
        id: string;
        timestamp: string;
        action: string;
        session: string;
        tokens: number;
        responseTime: number;
        success: boolean;
    }>;

    // Hourly usage for charts
    hourlyUsage: Array<{
        hour: string;
        tokens: number;
        actions: number;
    }>;
}

interface EntityData {
    sessions: Session[];
    workflows: Workflow[];
    workflowRuns: WorkflowRun[];
}

interface UseMetricsOptions {
    autoRefresh?: boolean;
    refreshInterval?: number; // in milliseconds
}

interface UseDataOptions {
    autoRefresh?: boolean;
    refreshInterval?: number; // in milliseconds
}

export function useMetrics(options: UseMetricsOptions = {}) {
    const { autoRefresh = false, refreshInterval = 5000 } = options;

    const [metrics, setMetrics] = useState<MetricsData>({
        totalSessions: 0,
        activeSessions: 0,
        totalWorkflows: 0,
        totalWorkflowRuns: 0,
        totalTokens: 0,
        totalPromptTokens: 0,
        totalCompletionTokens: 0,
        totalCost: 0,
        avgResponseTime: 0,
        totalInferenceTime: 0,
        successRate: 0,
        totalActions: 0,
        successfulActions: 0,
        recentActivity: [],
        hourlyUsage: [],
    });

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const generateHourlyUsage = useCallback((activities: MetricsData['recentActivity']) => {
        const hours = new Map<string, { tokens: number; actions: number }>();
        const now = new Date();

        // Initialize last 6 hours
        for (let i = 5; i >= 0; i--) {
            const hour = new Date(now.getTime() - i * 60 * 60 * 1000);
            const hourKey = format(hour, 'HH:mm');
            hours.set(hourKey, { tokens: 0, actions: 0 });
        }

        // Group activities by hour
        activities.forEach(activity => {
            try {
                const activityHour = format(new Date(activity.timestamp), 'HH:mm');
                const existing = hours.get(activityHour);
                if (existing) {
                    existing.tokens += activity.tokens;
                    existing.actions += 1;
                }
            } catch {
                // Skip invalid timestamps
                console.warn('Invalid timestamp in activity:', activity.timestamp);
            }
        });

        return Array.from(hours.entries()).map(([hour, data]) => ({
            hour,
            tokens: data.tokens,
            actions: data.actions,
        }));
    }, []);

    const loadMetrics = useCallback(async () => {
        try {
            setError(null);

            // Fetch data from API routes instead of direct storage access
            const [globalMetricsRes, activitiesRes, sessionsRes, workflowsRes, workflowRunsRes] = await Promise.all([
                fetch('/api/metrics'),
                fetch('/api/activities'),
                fetch('/api/sessions'),
                fetch('/api/workflows'),
                fetch('/api/workflows/runs'),
            ]);

            if (!globalMetricsRes.ok) {
                throw new Error(`Failed to fetch global metrics: ${globalMetricsRes.status}`);
            }
            if (!activitiesRes.ok) {
                throw new Error(`Failed to fetch activities: ${activitiesRes.status}`);
            }
            if (!sessionsRes.ok) {
                throw new Error(`Failed to fetch sessions: ${sessionsRes.status}`);
            }
            if (!workflowsRes.ok) {
                throw new Error(`Failed to fetch workflows: ${workflowsRes.status}`);
            }
            if (!workflowRunsRes.ok) {
                throw new Error(`Failed to fetch workflow runs: ${workflowRunsRes.status}`);
            }

            const [globalMetricsData, activitiesData, sessionsData, workflowsData, workflowRunsData] = await Promise.all([
                globalMetricsRes.json(),
                activitiesRes.json(),
                sessionsRes.json(),
                workflowsRes.json(),
                workflowRunsRes.json(),
            ]);

            const globalMetrics = globalMetricsData.metrics;
            const activities = activitiesData.activities || [];
            const sessions = sessionsData.sessions || [];
            const workflows = workflowsData.workflows || [];
            const workflowRuns = workflowRunsData.runs || [];

            // Calculate derived metrics
            const totalPromptTokens = globalMetrics.totalPromptTokens;
            const totalCompletionTokens = globalMetrics.totalCompletionTokens;
            const totalTokens = totalPromptTokens + totalCompletionTokens;
            const totalCost = totalTokens * 0.0001; // Rough estimate at $0.0001 per token

            const activeSessions = sessions.filter((s: Session) => s.status === 'active');
            const successfulActivities = activities.filter((a: MetricsData['recentActivity'][0]) => a.success);
            const successRate = activities.length > 0 ? (successfulActivities.length / activities.length) * 100 : 0;
            const avgResponseTime = activities.length > 0
                ? Math.round(globalMetrics.totalInferenceTimeMs / activities.length)
                : 0;

            // Generate hourly usage chart data
            const hourlyUsage = generateHourlyUsage(activities);

            setMetrics({
                totalSessions: sessions.length,
                activeSessions: activeSessions.length,
                totalWorkflows: workflows.length,
                totalWorkflowRuns: workflowRuns.length,
                totalTokens,
                totalPromptTokens,
                totalCompletionTokens,
                totalCost,
                avgResponseTime,
                totalInferenceTime: globalMetrics.totalInferenceTimeMs,
                successRate,
                totalActions: activities.length,
                successfulActions: successfulActivities.length,
                recentActivity: activities.slice(0, 20), // Last 20 activities
                hourlyUsage,
            });
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'Failed to load metrics';
            setError(errorMessage);
            console.error('Failed to load metrics:', err);
        } finally {
            setLoading(false);
        }
    }, [generateHourlyUsage]);

    const refresh = useCallback(() => {
        setLoading(true);
        loadMetrics();
    }, [loadMetrics]);

    // Initial load
    useEffect(() => {
        loadMetrics();
    }, [loadMetrics]);

    // Auto-refresh setup
    useEffect(() => {
        if (!autoRefresh) return;

        const interval = setInterval(() => {
            loadMetrics();
        }, refreshInterval);

        return () => clearInterval(interval);
    }, [autoRefresh, refreshInterval, loadMetrics]);

    return {
        metrics,
        loading,
        error,
        refresh,
    };
}

export function useData(options: UseDataOptions = {}) {
    const { autoRefresh = false, refreshInterval = 5000 } = options;

    const [data, setData] = useState<EntityData>({
        sessions: [],
        workflows: [],
        workflowRuns: [],
    });

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const loadData = useCallback(async () => {
        try {
            setError(null);

            // Fetch data from API routes instead of direct storage access
            const [sessionsRes, workflowsRes, workflowRunsRes] = await Promise.all([
                fetch('/api/sessions'),
                fetch('/api/workflows'),
                fetch('/api/workflows/runs'),
            ]);

            if (!sessionsRes.ok) {
                throw new Error(`Failed to fetch sessions: ${sessionsRes.status}`);
            }
            if (!workflowsRes.ok) {
                throw new Error(`Failed to fetch workflows: ${workflowsRes.status}`);
            }
            if (!workflowRunsRes.ok) {
                throw new Error(`Failed to fetch workflow runs: ${workflowRunsRes.status}`);
            }

            const [sessionsData, workflowsData, workflowRunsData] = await Promise.all([
                sessionsRes.json(),
                workflowsRes.json(),
                workflowRunsRes.json(),
            ]);

            setData({
                sessions: sessionsData.sessions || [],
                workflows: workflowsData.workflows || [],
                workflowRuns: workflowRunsData.runs || [],
            });
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'Failed to load data';
            setError(errorMessage);
            console.error('Failed to load data:', err);
        } finally {
            setLoading(false);
        }
    }, []);

    const refresh = useCallback(() => {
        setLoading(true);
        loadData();
    }, [loadData]);

    // Helper function to get workflow status
    const getWorkflowStatus = useCallback((workflow: Workflow) => {
        const runs = data.workflowRuns.filter(r => r.workflowId === workflow.id);
        const completedRuns = runs.filter(r => r.status === 'completed');
        const successRate = runs.length > 0 ? (completedRuns.length / runs.length) * 100 : 0;

        return {
            status: (workflow.steps.length === 0 ? 'draft' : runs.length > 0 ? 'active' : 'draft') as 'draft' | 'active',
            successRate: Math.round(successRate),
            totalRuns: runs.length,
            lastRun: runs.length > 0 ? runs[runs.length - 1] : null,
        };
    }, [data.workflowRuns]);

    // Initial load
    useEffect(() => {
        loadData();
    }, [loadData]);

    // Auto-refresh setup
    useEffect(() => {
        if (!autoRefresh) return;

        const interval = setInterval(() => {
            loadData();
        }, refreshInterval);

        return () => clearInterval(interval);
    }, [autoRefresh, refreshInterval, loadData]);

    return {
        data,
        loading,
        error,
        refresh,
        getWorkflowStatus,
    };
}

// Specialized hooks for common use cases
export function useDashboardMetrics() {
    return useMetrics({ autoRefresh: true, refreshInterval: 10000 });
}

export function useWorkflowMetrics() {
    return useMetrics({ autoRefresh: false });
}

export function useWorkflowData() {
    return useData({ autoRefresh: false });
}

export function useRealTimeMetrics() {
    return useMetrics({ autoRefresh: true, refreshInterval: 2000 });
} 