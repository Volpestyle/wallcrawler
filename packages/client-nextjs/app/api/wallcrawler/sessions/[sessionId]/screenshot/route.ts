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

    const screenshot = await sessionData.stagehand.page.screenshot({
      fullPage: true,
      type: "png",
    });

    const base64 = screenshot.toString("base64");
    sessionData.session.lastActiveAt = new Date();

    return NextResponse.json({
      success: true,
      data: `data:image/png;base64,${base64}`,
      timestamp: new Date(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Screenshot failed",
        timestamp: new Date(),
      },
      { status: 500 }
    );
  }
}