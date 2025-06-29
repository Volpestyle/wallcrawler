'use client';

import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { WorkflowStep, StepType } from './types';

interface StepTypeSelectorProps {
  step: WorkflowStep;
  stepTypes: StepType[];
  onStepUpdate: (stepId: string, updates: Partial<WorkflowStep>) => void;
  isRunning: boolean;
}

export function StepTypeSelector({ step, stepTypes, onStepUpdate, isRunning }: StepTypeSelectorProps) {
  return (
    <div>
      <Label htmlFor={`type-${step.id}`}>Step Type</Label>
      <Select
        value={step.type}
        onValueChange={(value) =>
          onStepUpdate(step.id, {
            type: value as WorkflowStep['type'],
          })
        }
        disabled={isRunning}
      >
        <SelectTrigger className="w-auto min-w-fit text-left">
          <SelectValue placeholder="Select type">{stepTypes.find((t) => t.value === step.type)?.label}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {stepTypes.map((type) => (
            <SelectItem key={type.value} value={type.value}>
              <div className="flex items-center w-full">
                <div className="flex items-center gap-2 flex-1">
                  {type.icon}
                  <div className="flex flex-col">
                    <span>{type.label}</span>
                    <span className="text-xs text-gray-500 whitespace-nowrap">{type.description}</span>
                  </div>
                </div>
                <Badge
                  variant={type.cost === 'High' ? 'destructive' : type.cost === 'Low' ? 'default' : 'secondary'}
                  className="text-xs ml-2 flex-shrink-0"
                >
                  {type.cost}
                </Badge>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
