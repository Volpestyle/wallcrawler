import { NextRequest, NextResponse } from "next/server";
import { Stagehand } from "@wallcrawler/stagehand";
import { sessionStorage } from "@/lib/server/session-storage";
import { Session } from "@/lib/types/stagehand";

export async function GET() {
  try {
    const sessionList = Array.from(sessionStorage.values()).map(({ session }) => ({
      id: session.id,
      name: session.name,
      status: session.status,
      url: session.url,
      createdAt: session.createdAt,
      lastActiveAt: session.lastActiveAt,
    }));

    return NextResponse.json({
      success: true,
      data: sessionList,
      timestamp: new Date(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to list sessions",
        timestamp: new Date(),
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { name } = await request.json();

    if (!name) {
      return NextResponse.json(
        {
          success: false,
          error: "Session name is required",
          timestamp: new Date(),
        },
        { status: 400 }
      );
    }

    const apiKey = process.env.WALLCRAWLER_API_KEY;
    const projectId = process.env.WALLCRAWLER_PROJECT_ID;

    if (!apiKey || !projectId) {
      return NextResponse.json(
        {
          success: false,
          error: "Wallcrawler API key or project ID not configured",
          timestamp: new Date(),
        },
        { status: 500 }
      );
    }

    // Initialize Stagehand with Wallcrawler
    const stagehand = new Stagehand({
      env: "WALLCRAWLER",
      apiKey,
      projectId,
      verbose: 1,
      headless: false,
    });

    // Initialize the browser session
    const { sessionId, debugUrl, sessionUrl } = await stagehand.init();

    if (!sessionId) {
      throw new Error("Failed to initialize Wallcrawler session");
    }

    // Create session object
    const session: Session = {
      id: sessionId,
      url: sessionUrl || `https://api.wallcrawler.dev/sessions/${sessionId}`,
      name,
      status: "running",
      createdAt: new Date(),
      lastActiveAt: new Date(),
    };

    // Store session with stagehand instance
    sessionStorage.set(sessionId, { session, stagehand });

    return NextResponse.json({
      success: true,
      data: {
        ...session,
        debugUrl,
        sessionUrl,
      },
      timestamp: new Date(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to create session",
        timestamp: new Date(),
      },
      { status: 500 }
    );
  }
}