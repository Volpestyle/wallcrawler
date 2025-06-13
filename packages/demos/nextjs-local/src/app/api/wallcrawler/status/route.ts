import { NextRequest, NextResponse } from 'next/server';

// Import shared sessions map (in production, use a proper store)
declare global {
  var wallcrawlerSessions: Map<string, {
    status: 'running' | 'success' | 'error';
    message?: string;
    progress?: number;
    result?: any;
  }>;
}

// Initialize global sessions if not exists
if (!global.wallcrawlerSessions) {
  global.wallcrawlerSessions = new Map();
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const sessionId = searchParams.get('sessionId');

    if (!sessionId) {
      return NextResponse.json(
        { error: 'Session ID is required' },
        { status: 400 }
      );
    }

    const session = global.wallcrawlerSessions.get(sessionId);
    
    if (!session) {
      return NextResponse.json(
        { error: 'Session not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      status: session.status,
      message: session.message,
      progress: session.progress,
    });
  } catch (error) {
    console.error('Status API error:', error);
    return NextResponse.json(
      { error: 'Failed to get status' },
      { status: 500 }
    );
  }
}