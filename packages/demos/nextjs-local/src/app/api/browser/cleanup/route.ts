import { NextResponse } from 'next/server';
import { stagehandService } from '@/lib/stagehand-service';

export async function POST() {
    try {
        console.log('[API] Manual browser cleanup requested');

        // Force cleanup of all browser processes
        await stagehandService.forceCleanup();

        // Get updated stats after cleanup
        const poolStatus = await stagehandService.getPoolStatus();

        return NextResponse.json({
            success: true,
            message: 'Browser cleanup completed successfully',
            stats: {
                activeInstances: poolStatus.activeInstances,
                maxSize: poolStatus.maxSize,
                browserStats: poolStatus.browserStats,
            },
            timestamp: new Date().toISOString(),
        });
    } catch (error) {
        console.error('[API] Failed to perform browser cleanup:', error);
        return NextResponse.json(
            {
                success: false,
                error: 'Failed to perform browser cleanup',
                details: (error as Error).message
            },
            { status: 500 }
        );
    }
} 