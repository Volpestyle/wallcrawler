import { NextRequest, NextResponse } from 'next/server';
import { storage } from '@/lib/storage';

interface RouteParams {
    params: {
        workflowId: string;
    };
}

export async function GET(
    request: NextRequest,
    { params }: RouteParams
) {
    try {
        const workflow = storage.getWorkflow(params.workflowId);

        if (!workflow) {
            return NextResponse.json(
                { error: 'Workflow not found' },
                { status: 404 }
            );
        }

        return NextResponse.json({ workflow });
    } catch (error) {
        console.error('Failed to get workflow:', error);
        return NextResponse.json(
            { error: 'Failed to get workflow' },
            { status: 500 }
        );
    }
}

export async function PUT(
    request: NextRequest,
    { params }: RouteParams
) {
    try {
        const workflowData = await request.json();
        const existingWorkflow = storage.getWorkflow(params.workflowId);

        if (!existingWorkflow) {
            return NextResponse.json(
                { error: 'Workflow not found' },
                { status: 404 }
            );
        }

        const updatedWorkflow = {
            ...existingWorkflow,
            ...workflowData,
            id: params.workflowId, // Ensure ID doesn't change
        };

        storage.saveWorkflow(updatedWorkflow);

        return NextResponse.json({ workflow: updatedWorkflow });
    } catch (error) {
        console.error('Failed to update workflow:', error);
        return NextResponse.json(
            { error: 'Failed to update workflow' },
            { status: 500 }
        );
    }
}

export async function DELETE(
    request: NextRequest,
    { params }: RouteParams
) {
    try {
        const workflow = storage.getWorkflow(params.workflowId);

        if (!workflow) {
            return NextResponse.json(
                { error: 'Workflow not found' },
                { status: 404 }
            );
        }

        storage.deleteWorkflow(params.workflowId);

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Failed to delete workflow:', error);
        return NextResponse.json(
            { error: 'Failed to delete workflow' },
            { status: 500 }
        );
    }
} 