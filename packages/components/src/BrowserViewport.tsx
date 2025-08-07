import React, { useEffect, useRef, useState, useCallback } from 'react';

interface BrowserViewportProps {
  sessionId: string;
  stagehandPage: any; // Should be StagehandPage type from SDK
  width?: number;
  height?: number;
  quality?: number;
  frameRate?: number;
  onError?: (error: Error) => void;
  onFrame?: (frame: FrameData) => void;
  enableInteraction?: boolean;
  className?: string;
}

interface FrameData {
  data: string;
  metadata: {
    timestamp: number;
    deviceWidth: number;
    deviceHeight: number;
  };
}

interface ViewportDimensions {
  width: number;
  height: number;
  deviceWidth: number;
  deviceHeight: number;
}

export const BrowserViewport: React.FC<BrowserViewportProps> = ({
  sessionId,
  stagehandPage,
  width = 1280,
  height = 720,
  quality = 80,
  frameRate = 10,
  onError,
  onFrame,
  enableInteraction = true,
  className = ''
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [dimensions, setDimensions] = useState<ViewportDimensions>({
    width,
    height,
    deviceWidth: width,
    deviceHeight: height
  });
  const frameIntervalRef = useRef<number>();
  const lastFrameTime = useRef<number>(0);

  // Start screencast
  const startScreencast = useCallback(async () => {
    try {
      await stagehandPage.sendCDP('Page.startScreencast', {
        format: 'jpeg',
        quality,
        maxWidth: width,
        maxHeight: height,
        everyNthFrame: Math.max(1, Math.floor(60 / frameRate))
      });
      setIsStreaming(true);
    } catch (error) {
      onError?.(error as Error);
    }
  }, [stagehandPage, width, height, quality, frameRate, onError]);

  // Stop screencast
  const stopScreencast = useCallback(async () => {
    try {
      await stagehandPage.sendCDP('Page.stopScreencast');
      setIsStreaming(false);
    } catch (error) {
      onError?.(error as Error);
    }
  }, [stagehandPage, onError]);

  // Handle incoming frames
  const handleScreencastFrame = useCallback(async (params: any) => {
    const now = Date.now();
    const frameDelay = 1000 / frameRate;
    
    if (now - lastFrameTime.current < frameDelay) {
      // Skip frame to maintain target frame rate
      await stagehandPage.sendCDP('Page.screencastFrameAck', {
        sessionId: params.sessionId
      });
      return;
    }

    lastFrameTime.current = now;

    const frameData: FrameData = {
      data: params.data,
      metadata: {
        timestamp: params.metadata.timestamp,
        deviceWidth: params.metadata.deviceWidth,
        deviceHeight: params.metadata.deviceHeight
      }
    };

    setDimensions(prev => ({
      ...prev,
      deviceWidth: params.metadata.deviceWidth,
      deviceHeight: params.metadata.deviceHeight
    }));

    // Draw frame to canvas
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) {
        const img = new Image();
        img.onload = () => {
          ctx.drawImage(img, 0, 0, width, height);
        };
        img.src = `data:image/jpeg;base64,${params.data}`;
      }
    }

    onFrame?.(frameData);

    // Acknowledge frame
    await stagehandPage.sendCDP('Page.screencastFrameAck', {
      sessionId: params.sessionId
    });
  }, [stagehandPage, width, height, frameRate, onFrame]);

  // Coordinate mapping from viewport to device
  const mapCoordinates = useCallback((clientX: number, clientY: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };

    const scaleX = dimensions.deviceWidth / rect.width;
    const scaleY = dimensions.deviceHeight / rect.height;

    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY
    };
  }, [dimensions]);

  // Mouse event handlers
  const handleMouseEvent = useCallback(async (
    event: React.MouseEvent,
    type: 'mousePressed' | 'mouseReleased' | 'mouseMoved'
  ) => {
    if (!enableInteraction) return;

    event.preventDefault();
    const { x, y } = mapCoordinates(event.clientX, event.clientY);

    try {
      await stagehandPage.sendCDP('Input.dispatchMouseEvent', {
        type,
        x: Math.round(x),
        y: Math.round(y),
        button: event.button === 0 ? 'left' : event.button === 2 ? 'right' : 'middle',
        buttons: event.buttons,
        modifiers: 
          (event.shiftKey ? 1 : 0) | 
          (event.ctrlKey ? 2 : 0) | 
          (event.altKey ? 4 : 0) | 
          (event.metaKey ? 8 : 0),
        timestamp: Date.now()
      });
    } catch (error) {
      onError?.(error as Error);
    }
  }, [stagehandPage, enableInteraction, mapCoordinates, onError]);

  // Keyboard event handlers
  const handleKeyEvent = useCallback(async (
    event: React.KeyboardEvent,
    type: 'keyDown' | 'keyUp'
  ) => {
    if (!enableInteraction) return;

    event.preventDefault();

    try {
      await stagehandPage.sendCDP('Input.dispatchKeyEvent', {
        type,
        key: event.key,
        code: event.code,
        text: type === 'keyDown' ? event.key : undefined,
        windowsVirtualKeyCode: event.keyCode,
        nativeVirtualKeyCode: event.keyCode,
        modifiers: 
          (event.shiftKey ? 1 : 0) | 
          (event.ctrlKey ? 2 : 0) | 
          (event.altKey ? 4 : 0) | 
          (event.metaKey ? 8 : 0),
        timestamp: Date.now()
      });
    } catch (error) {
      onError?.(error as Error);
    }
  }, [stagehandPage, enableInteraction, onError]);

  // Wheel event handler
  const handleWheel = useCallback(async (event: React.WheelEvent) => {
    if (!enableInteraction) return;

    event.preventDefault();
    const { x, y } = mapCoordinates(event.clientX, event.clientY);

    try {
      await stagehandPage.sendCDP('Input.dispatchMouseEvent', {
        type: 'mouseWheel',
        x: Math.round(x),
        y: Math.round(y),
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        modifiers: 
          (event.shiftKey ? 1 : 0) | 
          (event.ctrlKey ? 2 : 0) | 
          (event.altKey ? 4 : 0) | 
          (event.metaKey ? 8 : 0),
        timestamp: Date.now()
      });
    } catch (error) {
      onError?.(error as Error);
    }
  }, [stagehandPage, enableInteraction, mapCoordinates, onError]);

  // Set up CDP event listeners
  useEffect(() => {
    if (!stagehandPage) return;

    const cdpSession = stagehandPage._cdpSession || stagehandPage.cdpSession;
    if (!cdpSession) return;

    cdpSession.on('Page.screencastFrame', handleScreencastFrame);

    startScreencast();

    return () => {
      cdpSession.off('Page.screencastFrame', handleScreencastFrame);
      stopScreencast();
    };
  }, [stagehandPage, startScreencast, stopScreencast, handleScreencastFrame]);

  return (
    <div className={`browser-viewport ${className}`}>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        tabIndex={0}
        style={{
          width: '100%',
          height: '100%',
          cursor: enableInteraction ? 'pointer' : 'default',
          outline: 'none'
        }}
        onMouseDown={(e) => handleMouseEvent(e, 'mousePressed')}
        onMouseUp={(e) => handleMouseEvent(e, 'mouseReleased')}
        onMouseMove={(e) => handleMouseEvent(e, 'mouseMoved')}
        onKeyDown={(e) => handleKeyEvent(e, 'keyDown')}
        onKeyUp={(e) => handleKeyEvent(e, 'keyUp')}
        onWheel={handleWheel}
        onContextMenu={(e) => e.preventDefault()}
      />
      {!isStreaming && (
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          color: '#666'
        }}>
          Connecting to browser...
        </div>
      )}
    </div>
  );
};