import { NextRequest, NextResponse } from "next/server";
import { sessionStorage } from "@/lib/server/session-storage";

export async function POST(
  request: NextRequest,
  { params }: { params: { sessionId: string } }
) {
  try {
    const { url } = await request.json();

    if (!url) {
      return NextResponse.json(
        {
          success: false,
          error: "URL is required",
          timestamp: new Date(),
        },
        { status: 400 }
      );
    }

    const sessionData = sessionStorage.get(params.sessionId);
    
    if (!sessionData) {
      return NextResponse.json(
        {
          success: false,
          error: "Session not found",
          timestamp: new Date(),
        },
        { status: 404 }
      );
    }

    await sessionData.stagehand.page.goto(url);
    sessionData.session.lastActiveAt = new Date();

    return NextResponse.json({
      success: true,
      timestamp: new Date(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Navigation failed",
        timestamp: new Date(),
      },
      { status: 500 }
    );
  }
}