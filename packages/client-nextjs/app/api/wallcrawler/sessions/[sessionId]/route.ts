import { NextRequest, NextResponse } from "next/server";
import { sessionStorage } from "@/lib/server/session-storage";

export async function GET(
  request: NextRequest,
  { params }: { params: { sessionId: string } }
) {
  try {
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

    // Update last active time
    sessionData.session.lastActiveAt = new Date();

    return NextResponse.json({
      success: true,
      data: sessionData.session,
      timestamp: new Date(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to get session",
        timestamp: new Date(),
      },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { sessionId: string } }
) {
  try {
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

    // Close the Stagehand instance
    if (!sessionData.stagehand.isClosed) {
      await sessionData.stagehand.close();
    }

    // Remove from sessions map
    sessionStorage.delete(params.sessionId);

    return NextResponse.json({
      success: true,
      timestamp: new Date(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to close session",
        timestamp: new Date(),
      },
      { status: 500 }
    );
  }
}