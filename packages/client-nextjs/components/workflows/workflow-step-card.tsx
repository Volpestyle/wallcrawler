import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Globe,
  MousePointer,
  Database,
  Camera,
  Clock,
  GitBranch,
  GripVertical,
  Settings,
  Trash2,
} from "lucide-react";
import { WorkflowStep, WorkflowStepType } from "@/lib/types/stagehand";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface WorkflowStepCardProps {
  step: WorkflowStep;
  onEdit: () => void;
  onDelete: () => void;
}

const stepIcons: Record<WorkflowStepType, React.ElementType> = {
  navigate: Globe,
  interact: MousePointer,
  extract: Database,
  screenshot: Camera,
  wait: Clock,
  conditional: GitBranch,
};

export function WorkflowStepCard({ step, onEdit, onDelete }: WorkflowStepCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: step.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const Icon = stepIcons[step.type];

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "relative group",
        isDragging && "opacity-50"
      )}
    >
      <Card className="overflow-hidden hover:border-accent/50 transition-colors">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <div
              {...attributes}
              {...listeners}
              className="mt-1 cursor-grab active:cursor-grabbing"
            >
              <GripVertical className="h-4 w-4 text-text-secondary" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <Icon className="h-4 w-4 text-text-secondary" />
                <h4 className="font-medium text-sm">{step.name}</h4>
                <Badge variant="secondary" className="text-xs">
                  {step.type}
                </Badge>
              </div>
              {step.description && (
                <p className="text-xs text-text-secondary line-clamp-2">
                  {step.description}
                </p>
              )}
            </div>
            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={onEdit}
              >
                <Settings className="h-3 w-3" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={onDelete}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
      {step.nextStepId && (
        <div className="absolute left-1/2 -bottom-4 transform -translate-x-1/2 w-0.5 h-4 bg-border" />
      )}
    </div>
  );
}