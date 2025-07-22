import { NextRequest, NextResponse } from 'next/server';
import { storage } from '@/lib/storage';
import { stagehandService } from '@/lib/stagehand-service';
import type { WorkflowRun, WorkflowStep } from '@/types/stagehand';

interface RouteParams {
    params: {
        workflowId: string;
    };
}

export async function POST(
    request: NextRequest,
    { params }: RouteParams
) {
    try {
        const { sessionId } = await request.json();
        const workflow = storage.getWorkflow(params.workflowId);

        if (!workflow) {
            return NextResponse.json(
                { error: 'Workflow not found' },
                { status: 404 }
            );
        }

        if (!sessionId) {
            return NextResponse.json(
                { error: 'Session ID is required' },
                { status: 400 }
            );
        }

        // Check if session exists and is healthy
        const sessionHealth = await stagehandService.checkSessionHealth(sessionId);
        if (!sessionHealth) {
            return NextResponse.json(
                { error: 'Invalid or inactive session' },
                { status: 400 }
            );
        }

        const workflowRun: WorkflowRun = {
            id: `run_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            workflowId: params.workflowId,
            status: 'running',
            startTime: new Date().toISOString(),
            results: [],
        };

        storage.saveWorkflowRun(workflowRun);

        // Execute workflow steps in background
        executeWorkflowSteps(workflowRun.id, workflow.steps, sessionId);

        return NextResponse.json({ workflowRun });
    } catch (error) {
        console.error('Failed to start workflow execution:', error);
        return NextResponse.json(
            { error: 'Failed to start workflow execution' },
            { status: 500 }
        );
    }
}

async function executeWorkflowSteps(
    runId: string,
    steps: WorkflowStep[],
    sessionId: string
) {
    const workflowRun = storage.getWorkflowRun(runId);
    if (!workflowRun) return;

    try {
        const results: Record<string, unknown>[] = [];

        for (const step of steps.sort((a, b) => a.order - b.order)) {
            let result: unknown;

            switch (step.type) {
                case 'act':
                    result = await stagehandService.act(sessionId, {
                        action: step.parameters.action as string,
                        ...step.parameters,
                    });
                    break;

                case 'extract':
                    result = await stagehandService.extract(sessionId, {
                        instruction: step.parameters.instruction as string,
                        schema: step.parameters.schema as Record<string, unknown>,
                        ...step.parameters,
                    });
                    break;

                case 'observe':
                    result = await stagehandService.observe(sessionId, {
                        instruction: step.parameters.instruction as string,
                        ...step.parameters,
                    });
                    break;

                case 'agent':
                    result = await stagehandService.agent(sessionId, {
                        instruction: step.parameters.instruction as string,
                        maxSteps: step.parameters.maxSteps as number || 10,
                        ...step.parameters,
                    });
                    break;

                default:
                    throw new Error(`Unknown step type: ${step.type}`);
            }

            results.push({
                stepId: step.id,
                stepName: step.name,
                stepType: step.type,
                result,
                timestamp: new Date().toISOString(),
            });

            // Update workflow run with current results
            workflowRun.results = results;
            storage.saveWorkflowRun(workflowRun);
        }

        // Mark as completed
        workflowRun.status = 'completed';
        workflowRun.endTime = new Date().toISOString();
        storage.saveWorkflowRun(workflowRun);

        // Update workflow lastRun
        const workflow = storage.getWorkflow(workflowRun.workflowId);
        if (workflow) {
            workflow.lastRun = new Date().toISOString();
            storage.saveWorkflow(workflow);
        }
    } catch (error) {
        console.error('Workflow execution failed:', error);

        // Mark as failed
        workflowRun.status = 'failed';
        workflowRun.endTime = new Date().toISOString();
        workflowRun.error = (error as Error).message;
        storage.saveWorkflowRun(workflowRun);
    }
} 