import { NextRequest, NextResponse } from 'next/server';
import { storage } from '@/lib/storage';
import type { Workflow } from '@/types/stagehand';

export async function GET() {
    try {
        const workflows = storage.getWorkflows();
        return NextResponse.json({ workflows });
    } catch (error) {
        console.error('Failed to get workflows:', error);
        return NextResponse.json(
            { error: 'Failed to get workflows' },
            { status: 500 }
        );
    }
}

export async function POST(request: NextRequest) {
    try {
        const workflowData = await request.json();

        const workflow: Workflow = {
            id: `workflow_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            name: workflowData.name,
            description: workflowData.description,
            steps: workflowData.steps || [],
            createdAt: new Date().toISOString(),
        };

        storage.saveWorkflow(workflow);

        return NextResponse.json({ workflow });
    } catch (error) {
        console.error('Failed to create workflow:', error);
        return NextResponse.json(
            { error: 'Failed to create workflow' },
            { status: 500 }
        );
    }
} 