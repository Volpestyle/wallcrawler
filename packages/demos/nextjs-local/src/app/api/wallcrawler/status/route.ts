import { NextRequest, NextResponse } from 'next/server';

// Import shared provider and instances
import { Stagehand } from '@wallcrawler/stagehand';

declare global {
  var wallcrawlerProvider: any;
  var wallcrawlerInstances: Map<string, { stagehand: Stagehand; lastUsed: number; }>;
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

    const provider = global.wallcrawlerProvider;
    
    try {
      const providerSession = await provider.resumeSession(sessionId);
      return NextResponse.json({
        sessionId: providerSession.sessionId,
        status: 'active',
        provider: providerSession.provider,
        metadata: providerSession.metadata,
      });
    } catch (error) {
      return NextResponse.json(
        { error: 'Session not found' },
        { status: 404 }
      );
    }
  } catch (error) {
    console.error('Status API error:', error);
    return NextResponse.json(
      { error: 'Failed to get status' },
      { status: 500 }
    );
  }
}