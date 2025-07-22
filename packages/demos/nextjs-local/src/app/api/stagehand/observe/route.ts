import { NextRequest, NextResponse } from 'next/server';
import { stagehandService } from '@/lib/stagehand-service';
import { ObserveOptionsSchema } from '@/types/stagehand';

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { sessionId, ...observeOptions } = body;

        if (!sessionId) {
            return NextResponse.json(
                { error: 'Session ID is required' },
                { status: 400 }
            );
        }

        // Validate the options using Zod schema
        const validatedOptions = ObserveOptionsSchema.parse(observeOptions);

        const result = await stagehandService.observe(sessionId, validatedOptions);
        await stagehandService.updateSessionActivity(sessionId);

        return NextResponse.json({ result });
    } catch (error) {
        console.error('Failed to perform observe:', error);
        return NextResponse.json(
            { error: `Failed to perform observe: ${(error as Error).message}` },
            { status: 500 }
        );
    }
} 