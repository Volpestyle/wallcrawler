import { NextResponse } from 'next/server';
import { stagehandService } from '@/lib/stagehand-service';

export async function GET() {
    try {
        // Get pool status which includes browser stats
        const poolStatus = await stagehandService.getPoolStatus();

        // Get additional browser process statistics if available
        const stats = {
            pool: {
                activeInstances: poolStatus.activeInstances,
                maxSize: poolStatus.maxSize,
                utilization: Math.round((poolStatus.activeInstances / poolStatus.maxSize) * 100),
            },
            browser: poolStatus.browserStats || {
                totalInstances: poolStatus.activeInstances,
                healthyInstances: poolStatus.activeInstances,
                orphanedProcesses: 0,
                memoryUsage: 0,
                cpuUsage: 0,
            },
            timestamp: new Date().toISOString(),
        };

        return NextResponse.json({
            success: true,
            stats
        });
    } catch (error) {
        console.error('Failed to get browser stats:', error);
        return NextResponse.json(
            {
                success: false,
                error: 'Failed to get browser stats',
                details: (error as Error).message
            },
            { status: 500 }
        );
    }
} 