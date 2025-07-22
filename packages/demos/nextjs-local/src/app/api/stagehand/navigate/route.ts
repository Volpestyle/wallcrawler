import { NextRequest, NextResponse } from 'next/server';
import { stagehandService } from '@/lib/stagehand-service';

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { sessionId, url } = body;

        if (!sessionId) {
            return NextResponse.json(
                { error: 'Session ID is required' },
                { status: 400 }
            );
        }

        if (!url) {
            return NextResponse.json(
                { error: 'URL is required' },
                { status: 400 }
            );
        }

        const result = await stagehandService.navigate(sessionId, url);
        await stagehandService.updateSessionActivity(sessionId);

        return NextResponse.json({ result });
    } catch (error) {
        console.error('Failed to navigate:', error);
        return NextResponse.json(
            { error: `Failed to navigate: ${(error as Error).message}` },
            { status: 500 }
        );
    }
} 