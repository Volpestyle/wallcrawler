'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { WorkflowStep } from './types';

interface StepInputsProps {
  step: WorkflowStep;
  onStepUpdate: (stepId: string, updates: Partial<WorkflowStep>) => void;
  isRunning: boolean;
}

export function StepInputs({ step, onStepUpdate, isRunning }: StepInputsProps) {
  if (step.type === 'navigate') {
    return (
      <div>
        <Label htmlFor={`url-${step.id}`}>URL</Label>
        <Input
          id={`url-${step.id}`}
          value={step.config.url || ''}
          onChange={(e) =>
            onStepUpdate(step.id, {
              config: { ...step.config, url: e.target.value },
            })
          }
          placeholder="https://example.com"
          disabled={isRunning}
        />
      </div>
    );
  }

  if (step.type === 'act' || step.type === 'observe' || step.type === 'agent') {
    return (
      <div>
        <Label htmlFor={`instruction-${step.id}`}>Instruction</Label>
        <Textarea
          id={`instruction-${step.id}`}
          value={step.config.instruction || ''}
          onChange={(e) =>
            onStepUpdate(step.id, {
              config: {
                ...step.config,
                instruction: e.target.value,
              },
            })
          }
          placeholder="Describe what you want to do..."
          disabled={isRunning}
          rows={2}
        />
      </div>
    );
  }

  if (step.type === 'extract') {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-2">
          <Label htmlFor={`instruction-${step.id}`}>Instruction</Label>
          <Textarea
            id={`instruction-${step.id}`}
            value={step.config.instruction || ''}
            onChange={(e) =>
              onStepUpdate(step.id, {
                config: {
                  ...step.config,
                  instruction: e.target.value,
                },
              })
            }
            placeholder="What data to extract..."
            disabled={isRunning}
            rows={2}
          />
        </div>
        <div className="md:col-span-1">
          <Label htmlFor={`schema-${step.id}`}>Schema (JSON)</Label>
          <Textarea
            id={`schema-${step.id}`}
            value={step.config.schema || ''}
            onChange={(e) =>
              onStepUpdate(step.id, {
                config: {
                  ...step.config,
                  schema: e.target.value,
                },
              })
            }
            placeholder='{"key": "type"}'
            disabled={isRunning}
            rows={2}
          />
        </div>
      </div>
    );
  }

  return null;
}
