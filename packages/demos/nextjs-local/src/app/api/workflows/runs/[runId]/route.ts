import { NextRequest, NextResponse } from 'next/server';
import { storage } from '@/lib/storage';

interface RouteParams {
    params: {
        runId: string;
    };
}

export async function GET(
    request: NextRequest,
    { params }: RouteParams
) {
    try {
        const workflowRun = storage.getWorkflowRun(params.runId);

        if (!workflowRun) {
            return NextResponse.json(
                { error: 'Workflow run not found' },
                { status: 404 }
            );
        }

        return NextResponse.json({ workflowRun });
    } catch (error) {
        console.error('Failed to get workflow run:', error);
        return NextResponse.json(
            { error: 'Failed to get workflow run' },
            { status: 500 }
        );
    }
} 