'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Monitor, Pause, Play, RotateCcw, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import { clsx } from 'clsx';

export interface BrowserStreamProps {
  /** WebSocket URL for the browser session */
  websocketUrl: string;
  /** Session ID for the browser automation session */
  sessionId: string;
  /** Optional CSS class name */
  className?: string;
  /** Callback when stream connects */
  onConnect?: () => void;
  /** Callback when stream disconnects */
  onDisconnect?: (error?: Error) => void;
  /** Callback when stream errors occur */
  onError?: (error: Error) => void;
  /** Show browser controls */
  showControls?: boolean;
  /** Allow fullscreen mode */
  allowFullscreen?: boolean;
}

interface StreamControls {
  isPaused: boolean;
  zoom: number;
  isFullscreen: boolean;
}

export function BrowserStream({
  websocketUrl,
  sessionId,
  className,
  onConnect,
  onDisconnect,
  onError,
  showControls = true,
  allowFullscreen = true,
}: BrowserStreamProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [connectionState, setConnectionState] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>(
    'disconnected'
  );
  const [controls, setControls] = useState<StreamControls>({
    isPaused: false,
    zoom: 1,
    isFullscreen: false,
  });

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    setConnectionState('connecting');

    try {
      const ws = new WebSocket(websocketUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnectionState('connected');
        onConnect?.();

        // Send session connection message
        ws.send(
          JSON.stringify({
            type: 'CONNECT_SESSION',
            sessionId,
            requestStream: true,
          })
        );
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);

          if (message.type === 'SCREENSHOT' && message.data) {
            // Handle base64 encoded screenshot
            const canvas = canvasRef.current;
            if (canvas) {
              const ctx = canvas.getContext('2d');
              const img = new Image();

              img.onload = () => {
                if (ctx) {
                  canvas.width = img.width;
                  canvas.height = img.height;
                  ctx.clearRect(0, 0, canvas.width, canvas.height);
                  ctx.drawImage(img, 0, 0);
                }
              };

              img.src = `data:image/png;base64,${message.data}`;
            }
          }
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      };

      ws.onerror = (error) => {
        setConnectionState('error');
        console.error('WebSocket connection error:', error);
        const errorObj = new Error('WebSocket connection error');
        onError?.(errorObj);
      };

      ws.onclose = (event) => {
        setConnectionState('disconnected');
        const error = event.code !== 1000 ? new Error(`Connection closed with code: ${event.code}`) : undefined;
        onDisconnect?.(error);
      };
    } catch (error) {
      setConnectionState('error');
      onError?.(error as Error);
    }
  }, [websocketUrl, sessionId, onConnect, onDisconnect, onError]);

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  const togglePause = useCallback(() => {
    setControls((prev) => ({ ...prev, isPaused: !prev.isPaused }));

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: controls.isPaused ? 'RESUME_STREAM' : 'PAUSE_STREAM',
          sessionId,
        })
      );
    }
  }, [controls.isPaused, sessionId]);

  const handleZoom = useCallback((direction: 'in' | 'out' | 'reset') => {
    setControls((prev) => {
      let newZoom = prev.zoom;

      switch (direction) {
        case 'in':
          newZoom = Math.min(prev.zoom * 1.2, 3);
          break;
        case 'out':
          newZoom = Math.max(prev.zoom / 1.2, 0.5);
          break;
        case 'reset':
          newZoom = 1;
          break;
      }

      return { ...prev, zoom: newZoom };
    });
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (!allowFullscreen) return;

    setControls((prev) => ({ ...prev, isFullscreen: !prev.isFullscreen }));
  }, [allowFullscreen]);

  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  const getStatusColor = () => {
    switch (connectionState) {
      case 'connected':
        return 'text-green-500';
      case 'connecting':
        return 'text-yellow-500';
      case 'error':
        return 'text-red-500';
      default:
        return 'text-gray-500';
    }
  };

  const getStatusText = () => {
    switch (connectionState) {
      case 'connected':
        return 'Connected';
      case 'connecting':
        return 'Connecting...';
      case 'error':
        return 'Error';
      default:
        return 'Disconnected';
    }
  };

  return (
    <div
      className={clsx(
        'relative bg-gray-900 rounded-lg overflow-hidden border border-gray-800',
        controls.isFullscreen && 'fixed inset-0 z-50',
        className
      )}
    >
      {/* Header with connection status and controls */}
      {showControls && (
        <div className="flex items-center justify-between p-3 bg-gray-800 border-b border-gray-700">
          <div className="flex items-center gap-2">
            <Monitor className="h-4 w-4 text-gray-400" />
            <span className="text-sm text-gray-300">Browser Session</span>
            <div className={clsx('flex items-center gap-1 text-xs', getStatusColor())}>
              <div className="w-2 h-2 rounded-full bg-current" />
              {getStatusText()}
            </div>
          </div>

          <div className="flex items-center gap-1">
            {connectionState === 'disconnected' ? (
              <button onClick={connect} className="p-1.5 rounded hover:bg-gray-700 text-green-400" title="Connect">
                <Play className="h-4 w-4" />
              </button>
            ) : (
              <button
                onClick={togglePause}
                className="p-1.5 rounded hover:bg-gray-700 text-gray-400"
                title={controls.isPaused ? 'Resume' : 'Pause'}
              >
                {controls.isPaused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
              </button>
            )}

            <button
              onClick={() => handleZoom('out')}
              className="p-1.5 rounded hover:bg-gray-700 text-gray-400"
              title="Zoom Out"
              disabled={controls.zoom <= 0.5}
            >
              <ZoomOut className="h-4 w-4" />
            </button>

            <span className="text-xs text-gray-400 px-2">{Math.round(controls.zoom * 100)}%</span>

            <button
              onClick={() => handleZoom('in')}
              className="p-1.5 rounded hover:bg-gray-700 text-gray-400"
              title="Zoom In"
              disabled={controls.zoom >= 3}
            >
              <ZoomIn className="h-4 w-4" />
            </button>

            <button
              onClick={() => handleZoom('reset')}
              className="p-1.5 rounded hover:bg-gray-700 text-gray-400"
              title="Reset Zoom"
            >
              <RotateCcw className="h-4 w-4" />
            </button>

            {allowFullscreen && (
              <button
                onClick={toggleFullscreen}
                className="p-1.5 rounded hover:bg-gray-700 text-gray-400"
                title="Toggle Fullscreen"
              >
                <Maximize2 className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Canvas for displaying browser screenshots */}
      <div className="relative bg-black min-h-[400px] flex items-center justify-center">
        <canvas
          ref={canvasRef}
          className="max-w-full max-h-full object-contain"
          style={{
            transform: `scale(${controls.zoom})`,
            transformOrigin: 'center',
          }}
        />

        {connectionState === 'disconnected' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500">
            <Monitor className="h-16 w-16 mb-4" />
            <p className="text-lg font-medium">Browser Not Connected</p>
            <p className="text-sm">Click connect to start streaming</p>
            <button
              onClick={connect}
              className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
            >
              Connect to Session
            </button>
          </div>
        )}

        {connectionState === 'connecting' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mb-4" />
            <p className="text-lg font-medium">Connecting...</p>
          </div>
        )}

        {connectionState === 'error' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-red-500">
            <Monitor className="h-16 w-16 mb-4" />
            <p className="text-lg font-medium">Connection Error</p>
            <p className="text-sm">Failed to connect to browser session</p>
            <button
              onClick={connect}
              className="mt-4 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
            >
              Retry Connection
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
