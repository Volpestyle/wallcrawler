import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { initRedisClient } from '@wallcrawler/utils/redis';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
        const redis = await initRedisClient();

        // Parse request body
        const body = JSON.parse(event.body || '{}') as {
            containerId: string;
            maxSessions?: number;
            currentSessions?: number;
        };

        const { containerId, maxSessions = 20, currentSessions = 0 } = body;

        if (!containerId) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Container ID is required' }),
            };
        }

        // Check if container can take more sessions
        if (currentSessions >= maxSessions) {
            return {
                statusCode: 200,
                body: JSON.stringify({
                    success: true,
                    sessions: [],
                    message: 'Container at capacity',
                }),
            };
        }

        const availableSlots = maxSessions - currentSessions;
        const claimedSessions = [];

        // Claim up to available slots from pending queue
        for (let i = 0; i < availableSlots; i++) {
            // Use LPOP to atomically get and remove from queue
            const sessionId = await redis.lPop('pending-sessions');
            if (!sessionId) break; // No more pending sessions

            // Double-check session still exists and is pending
            const sessionData = await redis.hGetAll(`session:${sessionId}`);
            if (!sessionData || Object.keys(sessionData).length === 0) {
                console.warn(`Session ${sessionId} not found, skipping`);
                continue;
            }

            if (sessionData.status !== 'pending') {
                console.warn(`Session ${sessionId} is ${sessionData.status}, not pending, skipping`);
                continue;
            }

            // Claim the session
            await redis.hSet(`session:${sessionId}`, {
                status: 'active',
                containerId: containerId,
                assignedAt: new Date().toISOString(),
                lastActivity: new Date().toISOString(),
            });

            // Track container assignment
            await redis.sAdd(`container:${containerId}:sessions`, sessionId);

            claimedSessions.push({
                sessionId,
                userId: sessionData.userId,
                browserSettings: sessionData.browserSettings ? JSON.parse(sessionData.browserSettings) : {},
                createdAt: sessionData.createdAt,
            });

            console.log(`Container ${containerId} claimed session ${sessionId}`);
        }

        // Update container heartbeat
        await redis.hSet(`container:${containerId}`, {
            lastHeartbeat: new Date().toISOString(),
            activeSessions: (currentSessions + claimedSessions.length).toString(),
            maxSessions: maxSessions.toString(),
        });
        await redis.expire(`container:${containerId}`, 300); // 5 minute TTL

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                success: true,
                sessions: claimedSessions,
                claimedCount: claimedSessions.length,
            }),
        };
    } catch (error) {
        console.error('Error claiming sessions:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({
                error: 'Failed to claim sessions',
                details: error instanceof Error ? error.message : 'Unknown error',
            }),
        };
    }
}; 