/**
 * Screencast Manager
 * Handles CDP-based browser screencasting with bandwidth optimization
 */

import { CDPSession, Page } from 'playwright-core';
import { WebSocket } from 'ws';
import { createHash } from 'crypto';
import type {
    ScreencastOptions,
    ScreencastMetadata,
    FrameDetectionState,
    InputEvent,
    ScreencastFrame,
    ScreencastStats
} from './types';

export interface ScreencastSession {
    sessionId: string;
    cdpSession: CDPSession;
    page: Page;
    websocket: WebSocket;
    detectionState: FrameDetectionState;
    stats: ScreencastStats;
    isActive: boolean;
}

export class ScreencastManager {
    private activeSessions = new Map<string, ScreencastSession>();
    private readonly defaultOptions: Required<ScreencastOptions> = {
        quality: 80,
        everyNthFrame: 10,
        detectIdle: true,
        idleThreshold: 0.01,
        maxWidth: 1024,
        maxHeight: 768
    };

    /**
     * Start screencast for a session
     */
    async startScreencast(
        sessionId: string,
        page: Page,
        websocket: WebSocket,
        options: ScreencastOptions = {}
    ): Promise<void> {
        if (this.activeSessions.has(sessionId)) {
            throw new Error(`Screencast already active for session ${sessionId}`);
        }

        const finalOptions = { ...this.defaultOptions, ...options };

        // Create CDP session for this page
        const cdpSession = await page.context().newCDPSession(page);

        const detectionState: FrameDetectionState = {
            lastFrameHash: null,
            idleFrameCount: 0,
            lastForcedTime: Date.now(),
            options: finalOptions
        };

        const stats: ScreencastStats = {
            framesSent: 0,
            framesSkipped: 0,
            bytesTransmitted: 0,
            averageFrameSize: 0,
            actualFps: 0,
            skipPercentage: 0
        };

        const screencastSession: ScreencastSession = {
            sessionId,
            cdpSession,
            page,
            websocket,
            detectionState,
            stats,
            isActive: true
        };

        this.activeSessions.set(sessionId, screencastSession);

        try {
            // Start CDP screencast
            await cdpSession.send('Page.startScreencast', {
                format: 'jpeg',
                quality: finalOptions.quality,
                everyNthFrame: finalOptions.everyNthFrame,
                maxWidth: finalOptions.maxWidth,
                maxHeight: finalOptions.maxHeight
            });

            // Listen for screencast frames
            cdpSession.on('Page.screencastFrame', async (frameData) => {
                await this.handleScreencastFrame(sessionId, frameData);
            });

            console.log(`Screencast started for session ${sessionId}`);

            // Send success message
            this.sendMessage(websocket, {
                type: 'SCREENCAST_STARTED',
                sessionId,
                options: finalOptions
            });

        } catch (error) {
            this.activeSessions.delete(sessionId);
            throw error;
        }
    }

    /**
     * Stop screencast for a session
     */
    async stopScreencast(sessionId: string): Promise<void> {
        const session = this.activeSessions.get(sessionId);
        if (!session) {
            return; // Already stopped
        }

        try {
            await session.cdpSession.send('Page.stopScreencast');
            session.isActive = false;

            // Remove listeners - just detach the CDP session
            await session.cdpSession.detach();

            console.log(`Screencast stopped for session ${sessionId}`, {
                stats: session.stats
            });

            // Send stop message
            this.sendMessage(session.websocket, {
                type: 'SCREENCAST_STOPPED',
                sessionId,
                stats: session.stats
            });

        } catch (error) {
            console.error(`Error stopping screencast for session ${sessionId}:`, error);
        } finally {
            this.activeSessions.delete(sessionId);
        }
    }

    /**
     * Handle user input events
     */
    async handleInput(sessionId: string, inputEvent: InputEvent): Promise<void> {
        const session = this.activeSessions.get(sessionId);
        if (!session) {
            console.warn(`No active screencast session for input: ${sessionId}`);
            return;
        }

        try {
            const { cdpSession } = session;

            switch (inputEvent.type) {
                case 'mousePressed':
                case 'mouseReleased':
                case 'mouseMoved':
                    await cdpSession.send('Input.dispatchMouseEvent', {
                        type: inputEvent.type,
                        x: inputEvent.x || 0,
                        y: inputEvent.y || 0,
                        button: (inputEvent.button as any) || 'left',
                        clickCount: inputEvent.clickCount || 1,
                        modifiers: inputEvent.modifiers || 0
                    });
                    break;

                case 'keyDown':
                case 'keyUp':
                    await cdpSession.send('Input.dispatchKeyEvent', {
                        type: inputEvent.type,
                        key: inputEvent.key,
                        code: inputEvent.code,
                        text: inputEvent.text,
                        modifiers: inputEvent.modifiers || 0
                    });
                    break;

                case 'char':
                    await cdpSession.send('Input.dispatchKeyEvent', {
                        type: inputEvent.type,
                        text: inputEvent.text,
                        modifiers: inputEvent.modifiers || 0
                    });
                    break;

                case 'mouseWheel':
                    await cdpSession.send('Input.dispatchMouseEvent', {
                        type: 'mouseWheel',
                        x: inputEvent.x || 0,
                        y: inputEvent.y || 0,
                        deltaX: inputEvent.deltaX || 0,
                        deltaY: inputEvent.deltaY || 0
                    });
                    break;

                default:
                    console.warn(`Unknown input event type: ${(inputEvent as any).type}`);
            }

            // Reset idle detection state on user input to force next frame
            session.detectionState.lastFrameHash = null;

        } catch (error) {
            console.error(`Error handling input for session ${sessionId}:`, error);
        }
    }

    /**
     * Handle incoming screencast frame from CDP
     */
    private async handleScreencastFrame(
        sessionId: string,
        frameData: any
    ): Promise<void> {
        const session = this.activeSessions.get(sessionId);
        if (!session || !session.isActive) {
            return;
        }

        try {
            const { detectionState, stats } = session;

            // Check if we should send this frame
            const shouldSend = await this.shouldSendFrame(frameData.data, detectionState);

            if (shouldSend) {
                // Send frame to client
                const frame: ScreencastFrame = {
                    data: frameData.data,
                    metadata: frameData.metadata as ScreencastMetadata,
                    sessionId,
                    frameId: frameData.sessionId
                };

                this.sendMessage(session.websocket, {
                    type: 'SCREENCAST_FRAME',
                    ...frame
                });

                // Update stats
                stats.framesSent++;
                const frameSize = Buffer.byteLength(frameData.data, 'base64');
                stats.bytesTransmitted += frameSize;
                stats.averageFrameSize = stats.bytesTransmitted / stats.framesSent;
            } else {
                stats.framesSkipped++;
            }

            // Update skip percentage
            const totalFrames = stats.framesSent + stats.framesSkipped;
            stats.skipPercentage = totalFrames > 0 ? (stats.framesSkipped / totalFrames) * 100 : 0;

            // Always acknowledge frame to CDP
            await session.cdpSession.send('Page.screencastFrameAck', {
                sessionId: frameData.sessionId
            });

        } catch (error) {
            console.error(`Error handling screencast frame for session ${sessionId}:`, error);
        }
    }

    /**
     * Determine if frame should be sent based on change detection
     */
    private async shouldSendFrame(
        frameData: string,
        state: FrameDetectionState
    ): Promise<boolean> {
        if (!state.options.detectIdle) {
            return true; // Send all frames if idle detection is disabled
        }

        try {
            const currentHash = this.computeFrameHash(frameData);
            const now = Date.now();

            // Always send first frame
            if (state.lastFrameHash === null) {
                state.lastFrameHash = currentHash;
                return true;
            }

            // Check for visual changes
            const hasChanged = currentHash !== state.lastFrameHash;

            // Force frame every 5 seconds to keep connection alive
            const shouldForce = (now - state.lastForcedTime) > 5000;

            if (hasChanged || shouldForce) {
                state.lastFrameHash = currentHash;
                state.idleFrameCount = 0;
                if (shouldForce) {
                    state.lastForcedTime = now;
                }
                return true;
            }

            // Skip idle frame
            state.idleFrameCount++;
            return false;

        } catch (error) {
            console.error('Error in frame change detection, sending frame:', error);
            return true; // Fall back to sending frame on error
        }
    }

    /**
     * Compute hash of frame data for change detection
     */
    private computeFrameHash(frameData: string): string {
        // Create hash of base64 data
        return createHash('md5').update(frameData).digest('hex');
    }

    /**
     * Send message over WebSocket
     */
    private sendMessage(websocket: WebSocket, message: any): void {
        if (websocket.readyState === WebSocket.OPEN) {
            websocket.send(JSON.stringify(message));
        }
    }

    /**
     * Get stats for a session
     */
    getSessionStats(sessionId: string): ScreencastStats | null {
        const session = this.activeSessions.get(sessionId);
        return session ? { ...session.stats } : null;
    }

    /**
     * Get all active session IDs
     */
    getActiveSessions(): string[] {
        return Array.from(this.activeSessions.keys());
    }

    /**
     * Stop all active screencasts (cleanup)
     */
    async stopAllScreencasts(): Promise<void> {
        const stopPromises = Array.from(this.activeSessions.keys()).map(sessionId =>
            this.stopScreencast(sessionId)
        );
        await Promise.all(stopPromises);
    }

    /**
     * Check if session has active screencast
     */
    isScreencastActive(sessionId: string): boolean {
        const session = this.activeSessions.get(sessionId);
        return session ? session.isActive : false;
    }
} 