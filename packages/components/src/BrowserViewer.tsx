import React, { useEffect, useRef, useState } from 'react';
import { Wallcrawler } from '@wallcrawler/sdk';
import { StreamData } from '@wallcrawler/util-ts';

interface BrowserViewerProps {
  sessionId: string;
  apiKey?: string;
  onError?: (error: Error) => void;
  width?: number;
  height?: number;
  frameRate?: number;
}

const BrowserViewer: React.FC<BrowserViewerProps> = ({
  sessionId,
  apiKey,
  onError,
  width = 1280,
  height = 720,
  frameRate = 30,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loading, setLoading] = useState(true);
  const wallcrawler = new Wallcrawler({ apiKey });
  const lastFrameTime = useRef(0);

  useEffect(() => {
    const connect = async () => {
      try {
        const wsUrl = `wss://api.yourdomain.com/screencast/${sessionId}`;
        const ws = new WebSocket(wsUrl);

        ws.onopen = () => setLoading(false);
        ws.onmessage = (event) => {
          const now = performance.now();
          if (now - lastFrameTime.current < 1000 / frameRate) return;

          const data: StreamData = JSON.parse(event.data);
          if (data.type === 'frame') {
            const img = new Image();
            img.src = `data:image/jpeg;base64,${data.data}`;
            img.onload = () => {
              const ctx = canvasRef.current?.getContext('2d');
              if (ctx) {
                ctx.drawImage(img, 0, 0, width, height);
              }
              lastFrameTime.current = now;
            };
          }
        };
        ws.onclose = () => {
          setLoading(true);
          setTimeout(connect, 1000);
        };
        ws.onerror = (err) => onError?.(new Error('WebSocket error'));

        return () => ws.close();
      } catch (err) {
        onError?.(err as Error);
      }
    };

    connect();
  }, [sessionId, apiKey, onError, frameRate, width, height]);

  return (
    <div>
      {loading && <p>Loading stream...</p>}
      <canvas ref={canvasRef} width={width} height={height} style={{ border: '1px solid black' }} />
    </div>
  );
};

export default BrowserViewer;
