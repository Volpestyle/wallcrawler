import { NextRequest, NextResponse } from 'next/server';
import { stagehandService } from '@/lib/stagehand-service';

export async function GET(
    req: NextRequest,
    { params }: { params: { sessionId: string } }
) {
    try {
        const session = await stagehandService.getSession(params.sessionId);

        if (!session) {
            return NextResponse.json(
                { error: 'Session not found' },
                { status: 404 }
            );
        }

        return NextResponse.json({ session });
    } catch (error) {
        console.error('Failed to get session:', error);
        return NextResponse.json(
            { error: 'Failed to get session' },
            { status: 500 }
        );
    }
}

export async function DELETE(
    req: NextRequest,
    { params }: { params: { sessionId: string } }
) {
    try {
        await stagehandService.closeSession(params.sessionId);
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Failed to close session:', error);
        return NextResponse.json(
            { error: 'Failed to close session' },
            { status: 500 }
        );
    }
} 