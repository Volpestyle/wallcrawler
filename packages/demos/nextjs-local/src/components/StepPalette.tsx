'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { MousePointer, Download, Eye, Bot, Plus } from 'lucide-react';
import type { WorkflowStep } from '@/types/stagehand';

interface StepPaletteProps {
  onAddStep: (stepType: WorkflowStep['type']) => void;
}

const stepTypes = [
  {
    type: 'act' as const,
    name: 'Act',
    description: 'Perform actions on the page',
    icon: MousePointer,
    color: 'text-blue-600',
    bgColor: 'bg-blue-50 hover:bg-blue-100',
    borderColor: 'border-blue-200',
  },
  {
    type: 'extract' as const,
    name: 'Extract',
    description: 'Extract data from the page',
    icon: Download,
    color: 'text-green-600',
    bgColor: 'bg-green-50 hover:bg-green-100',
    borderColor: 'border-green-200',
  },
  {
    type: 'observe' as const,
    name: 'Observe',
    description: 'Observe elements on the page',
    icon: Eye,
    color: 'text-purple-600',
    bgColor: 'bg-purple-50 hover:bg-purple-100',
    borderColor: 'border-purple-200',
  },
  {
    type: 'agent' as const,
    name: 'Agent',
    description: 'Let AI agent complete a task',
    icon: Bot,
    color: 'text-orange-600',
    bgColor: 'bg-orange-50 hover:bg-orange-100',
    borderColor: 'border-orange-200',
  },
];

export function StepPalette({ onAddStep }: StepPaletteProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Step Palette</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {stepTypes.map((stepType) => {
          const Icon = stepType.icon;

          return (
            <Button
              key={stepType.type}
              variant="outline"
              className={`w-full justify-start text-left h-auto p-3 ${stepType.bgColor} ${stepType.borderColor}`}
              onClick={() => onAddStep(stepType.type)}
            >
              <div className="flex items-start gap-3">
                <Icon className={`h-5 w-5 mt-0.5 ${stepType.color}`} />
                <div className="flex-1 min-w-0">
                  <div className={`font-medium ${stepType.color}`}>{stepType.name}</div>
                  <div className="text-xs text-muted-foreground mt-1">{stepType.description}</div>
                </div>
                <Plus className="h-4 w-4 text-muted-foreground" />
              </div>
            </Button>
          );
        })}
      </CardContent>
    </Card>
  );
}
