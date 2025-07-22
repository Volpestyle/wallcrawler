import { NextRequest, NextResponse } from 'next/server';
import { stagehandService } from '@/lib/stagehand-service';

export async function GET() {
    try {
        const sessions = await stagehandService.getAllSessions();
        return NextResponse.json({ sessions });
    } catch (error) {
        console.error('Failed to get sessions:', error);
        return NextResponse.json(
            { error: 'Failed to get sessions', details: (error as Error).message },
            { status: 500 }
        );
    }
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { verbose, enableCaching } = body;

        console.log('[API] Creating new session with options:', { verbose, enableCaching });

        const session = await stagehandService.createSession({
            verbose,
            enableCaching,
        });

        console.log('[API] Session created successfully:', session.id);
        return NextResponse.json({ session });
    } catch (error) {
        const errorMessage = (error as Error).message;
        console.error('[API] Failed to create session:', {
            error: errorMessage,
            stack: (error as Error).stack,
        });

        // Provide more specific error messages
        let userFriendlyMessage = errorMessage;
        if (errorMessage.includes('browser context is undefined')) {
            userFriendlyMessage = 'Failed to start browser. Please ensure Playwright is installed and no other browser automation tools are running.';
        } else if (errorMessage.includes('Session') && errorMessage.includes('not found')) {
            userFriendlyMessage = 'Session management error. This might be a configuration issue.';
        } else if (errorMessage.includes('CDP connection')) {
            userFriendlyMessage = 'Browser connection failed. Please check if Chrome/Chromium is available.';
        }

        return NextResponse.json(
            {
                error: userFriendlyMessage,
                details: errorMessage,
                timestamp: new Date().toISOString()
            },
            { status: 500 }
        );
    }
} 