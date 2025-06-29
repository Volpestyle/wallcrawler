'use client';

import { DollarSign, Zap, Clock } from 'lucide-react';
import { WorkflowStats as WorkflowStatsType } from './types';

interface WorkflowStatsProps {
  stats: WorkflowStatsType;
  isRunning?: boolean;
  currentStepIndex?: number;
}

export function WorkflowStats({ stats, isRunning, currentStepIndex }: WorkflowStatsProps) {
  const hasData = stats.totalTokens > 0 || stats.totalCost > 0 || stats.totalInferenceTime > 0;

  // Always show when running or when there's data
  if (!hasData && !isRunning) {
    return null;
  }

  return (
    <div className="flex items-end gap-3">
      {/* Always show tokens counter when running or has data */}
      <div className="flex items-end gap-1.5">
        <Zap className="w-4 h-4 text-blue-500" />
        <span className="font-medium text-sm">{stats.totalTokens.toLocaleString()}</span>
        <span className="text-gray-500 text-[11px]">tokens</span>
        {isRunning && currentStepIndex !== undefined && currentStepIndex >= 0 && (
          <span className="text-[11px] text-blue-600 ml-1 animate-pulse">(step {currentStepIndex + 1})</span>
        )}
      </div>

      {/* Show inference time only when there's actual data */}
      {stats.totalInferenceTime > 0 && (
        <div className="flex items-end gap-1.5">
          <Clock className="w-4 h-4 text-purple-500" />
          <span className="font-medium text-sm">{(stats.totalInferenceTime / 1000).toFixed(1)}s</span>
          <span className="text-gray-500 text-[11px]">inference</span>
        </div>
      )}

      {/* Always show cost when running or has cost data */}
      <div className="flex items-end gap-1.5">
        <DollarSign className="w-4 h-4 text-green-500" />
        <span className="font-medium text-sm">
          ${stats.totalCost.toFixed(4)}
          {isRunning && <span className="animate-pulse">...</span>}
        </span>
        <span className="text-gray-500 text-[11px]">{isRunning ? 'running cost' : 'estimated'}</span>
      </div>
    </div>
  );
}
