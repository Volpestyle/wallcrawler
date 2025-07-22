import { NextResponse } from 'next/server';
import { storage } from '@/lib/storage';

export async function GET() {
    try {
        const runs = storage.getWorkflowRuns();
        return NextResponse.json({ runs });
    } catch (error) {
        console.error('Failed to get workflow runs:', error);
        return NextResponse.json(
            { error: 'Failed to get workflow runs' },
            { status: 500 }
        );
    }
} 