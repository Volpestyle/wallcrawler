import { NextRequest, NextResponse } from 'next/server';
import { stagehandService } from '@/lib/stagehand-service';
import { AgentExecuteSchema } from '@/types/stagehand';

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { sessionId, ...agentOptions } = body;

        if (!sessionId) {
            return NextResponse.json(
                { error: 'Session ID is required' },
                { status: 400 }
            );
        }

        // Validate the options using Zod schema
        const validatedOptions = AgentExecuteSchema.parse(agentOptions);

        const result = await stagehandService.agent(sessionId, validatedOptions);
        await stagehandService.updateSessionActivity(sessionId);

        return NextResponse.json({ result });
    } catch (error) {
        console.error('Failed to perform agent execution:', error);
        return NextResponse.json(
            { error: `Failed to perform agent execution: ${(error as Error).message}` },
            { status: 500 }
        );
    }
} 