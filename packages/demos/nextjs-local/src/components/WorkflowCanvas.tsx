'use client';

import { useRef } from 'react';
import { useDrag, useDrop } from 'react-dnd';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  MousePointer,
  Download,
  Eye,
  Bot,
  Trash2,
  GripVertical,
  CheckCircle,
  XCircle,
  Loader2,
  ArrowDown,
} from 'lucide-react';
import type { WorkflowStep, WorkflowRun } from '@/types/stagehand';

interface WorkflowCanvasProps {
  steps: WorkflowStep[];
  onUpdateStep: (stepId: string, updates: Partial<WorkflowStep>) => void;
  onDeleteStep: (stepId: string) => void;
  onMoveStep: (dragIndex: number, hoverIndex: number) => void;
  workflowRun?: WorkflowRun | null;
  isRunMode?: boolean;
}

interface DragItem {
  index: number;
  id: string;
  type: string;
}

const stepIcons = {
  act: MousePointer,
  extract: Download,
  observe: Eye,
  agent: Bot,
};

const stepColors = {
  act: {
    color: 'text-blue-600',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200',
  },
  extract: {
    color: 'text-green-600',
    bgColor: 'bg-green-50',
    borderColor: 'border-green-200',
  },
  observe: {
    color: 'text-purple-600',
    bgColor: 'bg-purple-50',
    borderColor: 'border-purple-200',
  },
  agent: {
    color: 'text-orange-600',
    bgColor: 'bg-orange-50',
    borderColor: 'border-orange-200',
  },
};

function StepCard({
  step,
  index,
  onUpdate,
  onDelete,
  onMove,
  workflowRun,
  isRunMode,
}: {
  step: WorkflowStep;
  index: number;
  onUpdate: (updates: Partial<WorkflowStep>) => void;
  onDelete: () => void;
  onMove: (dragIndex: number, hoverIndex: number) => void;
  workflowRun?: WorkflowRun | null;
  isRunMode?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  const [{ handlerId }, drop] = useDrop<DragItem, void, { handlerId: string | symbol | null }>({
    accept: 'step',
    collect(monitor) {
      return {
        handlerId: monitor.getHandlerId(),
      };
    },
    hover(item: DragItem, monitor) {
      if (!ref.current) {
        return;
      }
      const dragIndex = item.index;
      const hoverIndex = index;

      if (dragIndex === hoverIndex) {
        return;
      }

      const hoverBoundingRect = ref.current?.getBoundingClientRect();
      const hoverMiddleY = (hoverBoundingRect.bottom - hoverBoundingRect.top) / 2;
      const clientOffset = monitor.getClientOffset();
      const hoverClientY = (clientOffset?.y ?? 0) - hoverBoundingRect.top;

      if (dragIndex < hoverIndex && hoverClientY < hoverMiddleY) {
        return;
      }

      if (dragIndex > hoverIndex && hoverClientY > hoverMiddleY) {
        return;
      }

      onMove(dragIndex, hoverIndex);
      item.index = hoverIndex;
    },
  });

  const [{ isDragging }, drag, preview] = useDrag({
    type: 'step',
    item: () => {
      return { id: step.id, index };
    },
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
  });

  const opacity = isDragging ? 0.4 : 1;
  preview(drop(ref));

  const dragRef = useRef<HTMLDivElement>(null);
  drag(dragRef);

  const Icon = stepIcons[step.type];
  const colors = stepColors[step.type];

  // Get execution status for this step
  const stepResult = workflowRun?.results?.find(
    (r) => typeof r === 'object' && r !== null && 'stepId' in r && r.stepId === step.id
  );
  const isExecuted = !!stepResult;
  const isCurrentlyExecuting = workflowRun?.status === 'running' && (workflowRun.results?.length || 0) === index;

  const getStepExecutionStatus = () => {
    if (isRunMode) {
      if (isExecuted) {
        return <CheckCircle className="h-4 w-4 text-green-600" />;
      } else if (isCurrentlyExecuting) {
        return <Loader2 className="h-4 w-4 text-blue-600 animate-spin" />;
      } else if (workflowRun?.status === 'failed' && (workflowRun.results?.length || 0) === index) {
        return <XCircle className="h-4 w-4 text-red-600" />;
      }
      return <div className="h-4 w-4 rounded-full border-2 border-gray-300" />;
    }
    return null;
  };

  const renderStepParameters = () => {
    switch (step.type) {
      case 'act':
        return (
          <div className="space-y-3">
            <div>
              <Label htmlFor={`action-${step.id}`}>Action</Label>
              <Textarea
                id={`action-${step.id}`}
                value={(step.parameters.action as string) || ''}
                onChange={(e) =>
                  onUpdate({
                    parameters: { ...step.parameters, action: e.target.value },
                  })
                }
                placeholder="Describe the action to perform (e.g., 'Click the login button')"
                disabled={isRunMode}
              />
            </div>
          </div>
        );

      case 'extract':
        return (
          <div className="space-y-3">
            <div>
              <Label htmlFor={`instruction-${step.id}`}>Instruction</Label>
              <Textarea
                id={`instruction-${step.id}`}
                value={(step.parameters.instruction as string) || ''}
                onChange={(e) =>
                  onUpdate({
                    parameters: { ...step.parameters, instruction: e.target.value },
                  })
                }
                placeholder="What data to extract (e.g., 'Extract all product names and prices')"
                disabled={isRunMode}
              />
            </div>
            <div>
              <Label htmlFor={`schema-${step.id}`}>Schema (JSON)</Label>
              <Textarea
                id={`schema-${step.id}`}
                value={(step.parameters.schema as string) || ''}
                onChange={(e) =>
                  onUpdate({
                    parameters: { ...step.parameters, schema: e.target.value },
                  })
                }
                placeholder='{"products": [{"name": "string", "price": "string"}]}'
                disabled={isRunMode}
              />
            </div>
          </div>
        );

      case 'observe':
        return (
          <div className="space-y-3">
            <div>
              <Label htmlFor={`instruction-${step.id}`}>Instruction</Label>
              <Textarea
                id={`instruction-${step.id}`}
                value={(step.parameters.instruction as string) || ''}
                onChange={(e) =>
                  onUpdate({
                    parameters: { ...step.parameters, instruction: e.target.value },
                  })
                }
                placeholder="What to observe (e.g., 'Check if login form is visible')"
                disabled={isRunMode}
              />
            </div>
          </div>
        );

      case 'agent':
        return (
          <div className="space-y-3">
            <div>
              <Label htmlFor={`instruction-${step.id}`}>Instructions</Label>
              <Textarea
                id={`instruction-${step.id}`}
                value={(step.parameters.instruction as string) || ''}
                onChange={(e) =>
                  onUpdate({
                    parameters: { ...step.parameters, instruction: e.target.value },
                  })
                }
                placeholder="High-level task for the agent (e.g., 'Fill out the contact form with my details')"
                disabled={isRunMode}
              />
            </div>
            <div>
              <Label htmlFor={`maxSteps-${step.id}`}>Max Steps</Label>
              <Input
                id={`maxSteps-${step.id}`}
                type="number"
                value={(step.parameters.maxSteps as number) || 10}
                onChange={(e) =>
                  onUpdate({
                    parameters: { ...step.parameters, maxSteps: parseInt(e.target.value) || 10 },
                  })
                }
                min="1"
                max="50"
                disabled={isRunMode}
              />
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div ref={ref} style={{ opacity }} data-handler-id={handlerId}>
      <Card
        className={`${colors.borderColor} ${isExecuted ? 'ring-2 ring-green-200' : ''} ${isCurrentlyExecuting ? 'ring-2 ring-blue-200' : ''}`}
      >
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {!isRunMode && (
                <div ref={dragRef} className="cursor-move">
                  <GripVertical className="h-4 w-4 text-gray-400" />
                </div>
              )}
              <Icon className={`h-5 w-5 ${colors.color}`} />
              <div className="flex-1">
                <Input
                  value={step.name}
                  onChange={(e) => onUpdate({ name: e.target.value })}
                  className="text-sm font-medium border-none p-0 h-auto focus-visible:ring-0"
                  disabled={isRunMode}
                />
              </div>
              <div className="flex items-center gap-2">
                {getStepExecutionStatus()}
                {!isRunMode && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={onDelete}
                    className="h-6 w-6 p-0 text-red-500 hover:text-red-700"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                )}
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {renderStepParameters()}

          {isRunMode && stepResult && (
            <div className="mt-4 p-3 bg-gray-50 rounded-md">
              <div className="text-sm font-medium mb-2">Result:</div>
              <pre className="text-xs bg-white p-2 rounded border overflow-auto max-h-32">
                {JSON.stringify(
                  typeof stepResult === 'object' && stepResult !== null && 'result' in stepResult
                    ? stepResult.result
                    : stepResult,
                  null,
                  2
                )}
              </pre>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function WorkflowCanvas({
  steps,
  onUpdateStep,
  onDeleteStep,
  onMoveStep,
  workflowRun,
  isRunMode,
}: WorkflowCanvasProps) {
  return (
    <Card className="min-h-[600px]">
      <CardHeader>
        <CardTitle className="text-lg">{isRunMode ? 'Workflow Execution' : 'Workflow Steps'}</CardTitle>
      </CardHeader>
      <CardContent>
        {steps.length === 0 ? (
          <div className="flex items-center justify-center h-64 text-center">
            <div>
              <div className="text-muted-foreground mb-4">No steps added yet</div>
              {!isRunMode && (
                <div className="text-sm text-muted-foreground">Add steps from the palette to build your workflow</div>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {steps.map((step, index) => (
              <div key={step.id}>
                <StepCard
                  step={step}
                  index={index}
                  onUpdate={(updates) => onUpdateStep(step.id, updates)}
                  onDelete={() => onDeleteStep(step.id)}
                  onMove={onMoveStep}
                  workflowRun={workflowRun}
                  isRunMode={isRunMode}
                />
                {index < steps.length - 1 && (
                  <div className="flex justify-center py-2">
                    <ArrowDown className="h-4 w-4 text-gray-400" />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
