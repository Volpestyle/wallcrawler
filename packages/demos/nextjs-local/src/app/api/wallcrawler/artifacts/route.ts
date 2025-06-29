import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';

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

    // Otherwise return session artifacts
    if (!sessionId) {
      return NextResponse.json(
        { error: 'Session ID is required' },
        { status: 400 }
      );
    }

    const provider = global.wallcrawlerProvider;
    
    try {
      // Get artifacts from provider (this will also validate session exists)
      const artifactsList = await provider.getArtifacts(sessionId);
      
      return NextResponse.json({
        sessionId,
        artifacts: artifactsList.artifacts,
        hasMore: artifactsList.hasMore,
        cursor: artifactsList.cursor,
      });
    } catch (error) {
      return NextResponse.json(
        { error: 'Session not found or no artifacts available' },
        { status: 404 }
      );
    }
  } catch (error) {
    console.error('Artifacts API error:', error);
    return NextResponse.json(
      { error: 'Failed to get artifacts' },
      { status: 500 }
    );
  }
}