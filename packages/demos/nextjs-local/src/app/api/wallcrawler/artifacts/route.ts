import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';

// Import shared sessions map
declare global {
  var wallcrawlerSessions: Map<string, {
    status: 'running' | 'success' | 'error';
    message?: string;
    progress?: number;
    result?: any;
  }>;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const sessionId = searchParams.get('sessionId');
    const type = searchParams.get('type');
    const id = searchParams.get('id');

    // If requesting specific artifact (like screenshot)
    if (type === 'screenshot' && id) {
      try {
        const screenshotPath = path.join(process.cwd(), '.wallcrawler/demo/screenshots', `${id}.png`);
        const imageBuffer = await readFile(screenshotPath);
        
        return new NextResponse(imageBuffer, {
          headers: {
            'Content-Type': 'image/png',
            'Cache-Control': 'public, max-age=3600',
          },
        });
      } catch (error) {
        return NextResponse.json(
          { error: 'Screenshot not found' },
          { status: 404 }
        );
      }
    }

    // Otherwise return session results
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

    if (session.status !== 'success' && session.status !== 'error') {
      return NextResponse.json(
        { error: 'Results not ready yet' },
        { status: 202 }
      );
    }

    return NextResponse.json(session.result || {
      success: false,
      error: 'No results available',
    });
  } catch (error) {
    console.error('Artifacts API error:', error);
    return NextResponse.json(
      { error: 'Failed to get artifacts' },
      { status: 500 }
    );
  }
}