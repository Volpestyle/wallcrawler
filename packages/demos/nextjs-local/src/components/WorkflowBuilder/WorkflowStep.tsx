'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Trash2, MoveUp, MoveDown, DollarSign, Zap, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { WorkflowStep as WorkflowStepType, StepType } from './types';
import { StepTypeSelector } from './StepTypeSelector';
import { StepInputs } from './StepInputs';

interface WorkflowStepProps {
  step: WorkflowStepType;
  index: number;
  stepTypes: StepType[];
  currentStepIndex: number;
  totalSteps: number;
  isRunning: boolean;
  onStepUpdate: (stepId: string, updates: Partial<WorkflowStepType>) => void;
  onStepMove: (stepId: string, direction: 'up' | 'down') => void;
  onStepRemove: (stepId: string) => void;
  getStepIcon: (type: WorkflowStepType['type']) => React.ReactNode;
  getStatusColor: (status: WorkflowStepType['status']) => string;
}

export function WorkflowStep({
  step,
  index,
  stepTypes,
  currentStepIndex,
  totalSteps,
  isRunning,
  onStepUpdate,
  onStepMove,
  onStepRemove,
  getStepIcon,
  getStatusColor,
}: WorkflowStepProps) {
  return (
    <Card
      className={cn(
        'border',
        currentStepIndex === index && 'ring-2 ring-blue-500',
        step.status === 'error' && 'border-red-200',
        step.status === 'completed' && 'border-green-200'
      )}
    >
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3 flex-1">
            <div className={cn('p-2 rounded-md', getStatusColor(step.status))}>{getStepIcon(step.type)}</div>

            <div className="flex-1">
              <Input
                value={step.title}
                onChange={(e) => onStepUpdate(step.id, { title: e.target.value })}
                className="font-medium border-none p-0 h-auto bg-transparent"
                disabled={isRunning}
              />
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="outline" className="text-xs">
                  Step {index + 1}
                </Badge>
                <Badge variant="secondary" className="text-xs capitalize">
                  {step.status}
                </Badge>
                {step.tokens && (
                  <>
                    <Badge
                      variant="outline"
                      className="text-xs"
                      title={`Prompt: ${step.tokens.prompt_tokens.toLocaleString()} | Completion: ${step.tokens.completion_tokens.toLocaleString()} | Total: ${step.tokens.total_tokens.toLocaleString()}`}
                    >
                      <Zap className="w-3 h-3 mr-1" />
                      {step.tokens.prompt_tokens.toLocaleString()} prompt +{' '}
                      {step.tokens.completion_tokens.toLocaleString()} completion
                    </Badge>
                    {step.tokens.inference_time_ms && step.tokens.inference_time_ms > 0 && (
                      <Badge
                        variant="outline"
                        className="text-xs"
                        title={`Inference time: ${step.tokens.inference_time_ms}ms`}
                      >
                        <Clock className="w-3 h-3 mr-1" />
                        {step.tokens.inference_time_ms}ms
                      </Badge>
                    )}
                    {!!step.tokens.cost && (
                      <Badge variant="outline" className="text-xs">
                        <DollarSign className="w-3 h-3 mr-1" />${step.tokens.cost.toFixed(4)}
                      </Badge>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <Button
              onClick={() => onStepMove(step.id, 'up')}
              size="sm"
              variant="ghost"
              disabled={isRunning || index === 0}
            >
              <MoveUp className="w-4 h-4" />
            </Button>
            <Button
              onClick={() => onStepMove(step.id, 'down')}
              size="sm"
              variant="ghost"
              disabled={isRunning || index === totalSteps - 1}
            >
              <MoveDown className="w-4 h-4" />
            </Button>
            <Button onClick={() => onStepRemove(step.id)} size="sm" variant="ghost" disabled={isRunning}>
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="space-y-4">
          <StepTypeSelector step={step} stepTypes={stepTypes} onStepUpdate={onStepUpdate} isRunning={isRunning} />

          <StepInputs step={step} onStepUpdate={onStepUpdate} isRunning={isRunning} />
        </div>

        {/* Step Result */}
        {step.result && (
          <div>
            <Label>Result</Label>
            <pre className="bg-gray-50 p-3 rounded-md text-sm overflow-auto max-h-32">
              {JSON.stringify(step.result, null, 2)}
            </pre>
          </div>
        )}

        {/* Step Error */}
        {step.error && (
          <div>
            <Label className="text-red-600">Error</Label>
            <div className="bg-red-50 border border-red-200 p-3 rounded-md text-sm text-red-700">{step.error}</div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
