'use client';

import { TaskStatus } from './WallcrawlerDemo';
import { CheckCircle, XCircle, Loader2, Circle } from 'lucide-react';

interface StatusIndicatorProps {
  status: TaskStatus;
}

export default function StatusIndicator({ status }: StatusIndicatorProps) {
  const getStatusIcon = () => {
    switch (status.status) {
      case 'idle':
        return <Circle className="w-4 h-4" />;
      case 'running':
        return <Loader2 className="w-4 h-4 animate-spin" />;
      case 'success':
        return <CheckCircle className="w-4 h-4" />;
      case 'error':
        return <XCircle className="w-4 h-4" />;
    }
  };

  const getStatusClass = () => {
    switch (status.status) {
      case 'idle':
        return 'status-idle';
      case 'running':
        return 'status-running';
      case 'success':
        return 'status-success';
      case 'error':
        return 'status-error';
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center space-x-2">
        <span className={`status-indicator ${getStatusClass()}`}>
          {getStatusIcon()}
          <span className="ml-1.5">
            {status.status === 'idle' && 'Ready'}
            {status.status === 'running' && 'Running'}
            {status.status === 'success' && 'Complete'}
            {status.status === 'error' && 'Error'}
          </span>
        </span>
        {status.message && <span className="text-sm text-gray-600">{status.message}</span>}
        {status.progress !== undefined && status.status === 'running' && (
          <span className="text-sm text-gray-500">({status.progress}%)</span>
        )}
      </div>

      {/* Progress Bar */}
      {status.progress !== undefined && status.status === 'running' && (
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className="bg-blue-600 h-2 rounded-full transition-all duration-300 ease-out"
            style={{ width: `${status.progress}%` }}
          />
        </div>
      )}
    </div>
  );
}
