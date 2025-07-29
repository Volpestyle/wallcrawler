'use client';

import { useState } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { Plus, Save, Play, FileText } from 'lucide-react';
import { useWorkflowStore } from '@/lib/stores/workflow-store';
import { WorkflowStepCard } from './workflow-step-card';
import { WorkflowStepModal } from './workflow-step-modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { WorkflowStep } from '@/lib/types/stagehand';

export function WorkflowBuilder() {
  const { editingWorkflow, updateWorkflow, reorderSteps, addStep, deleteStep, updateStep } = useWorkflowStore();
  const [isEditing, setIsEditing] = useState(false);
  const [workflowName, setWorkflowName] = useState(editingWorkflow?.name || '');
  const [stepModalOpen, setStepModalOpen] = useState(false);
  const [editingStep, setEditingStep] = useState<WorkflowStep | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  if (!editingWorkflow) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <FileText className="h-12 w-12 text-text-secondary/30 mx-auto mb-4" />
          <p className="text-text-secondary">No workflow selected</p>
          <p className="text-sm text-text-secondary/70 mt-1">Create or select a workflow to start building</p>
        </div>
      </div>
    );
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (active.id !== over?.id) {
      const oldIndex = editingWorkflow.steps.findIndex((s) => s.id === active.id);
      const newIndex = editingWorkflow.steps.findIndex((s) => s.id === over?.id);

      if (oldIndex !== -1 && newIndex !== -1) {
        const newSteps = arrayMove(editingWorkflow.steps, oldIndex, newIndex);
        reorderSteps(editingWorkflow.id, newSteps);
      }
    }
  };

  const handleAddStep = () => {
    setEditingStep(null);
    setStepModalOpen(true);
  };

  const handleEditStep = (step: WorkflowStep) => {
    setEditingStep(step);
    setStepModalOpen(true);
  };

  const handleSaveStep = (step: WorkflowStep) => {
    if (editingStep) {
      // Pass only the updated fields when editing
      updateStep(editingWorkflow.id, step.id, {
        type: step.type,
        name: step.name,
        description: step.description,
        config: step.config,
      });
    } else {
      addStep(editingWorkflow.id, step);
    }
  };

  const handleSaveName = () => {
    updateWorkflow(editingWorkflow.id, { name: workflowName });
    setIsEditing(false);
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-6 border-b border-border">
        <div className="flex items-center justify-between mb-4">
          <div className="flex-1">
            {isEditing ? (
              <div className="flex items-center gap-2">
                <Input
                  value={workflowName}
                  onChange={(e) => setWorkflowName(e.target.value)}
                  className="max-w-xs"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveName();
                    if (e.key === 'Escape') {
                      setWorkflowName(editingWorkflow.name);
                      setIsEditing(false);
                    }
                  }}
                  autoFocus
                />
                <Button size="sm" onClick={handleSaveName}>
                  Save
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setWorkflowName(editingWorkflow.name);
                    setIsEditing(false);
                  }}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <h2
                className="text-xl font-light cursor-pointer hover:text-text-secondary"
                onClick={() => setIsEditing(true)}
              >
                {editingWorkflow.name}
              </h2>
            )}
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline">
              <Save className="h-4 w-4 mr-1" />
              Save
            </Button>
            <Button size="sm">
              <Play className="h-4 w-4 mr-1" />
              Run
            </Button>
          </div>
        </div>
        {editingWorkflow.description && <p className="text-sm text-text-secondary">{editingWorkflow.description}</p>}
      </div>

      {/* Canvas */}
      <div className="flex-1 overflow-y-auto p-6">
        {editingWorkflow.steps.length === 0 ? (
          <div className="border-2 border-dashed border-border rounded-lg p-12 text-center">
            <p className="text-text-secondary mb-4">No steps added yet. Start building your workflow!</p>
            <Button onClick={handleAddStep}>
              <Plus className="h-4 w-4 mr-1" />
              Add First Step
            </Button>
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={editingWorkflow.steps.map((s) => s.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-4">
                {editingWorkflow.steps.map((step) => (
                  <WorkflowStepCard
                    key={step.id}
                    step={step}
                    onEdit={() => handleEditStep(step)}
                    onDelete={() => deleteStep(editingWorkflow.id, step.id)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>

      {/* Footer */}
      {editingWorkflow.steps.length > 0 && (
        <div className="p-4 border-t border-border">
          <Button onClick={handleAddStep} className="w-full">
            <Plus className="h-4 w-4 mr-1" />
            Add Step
          </Button>
        </div>
      )}

      <WorkflowStepModal
        open={stepModalOpen}
        onOpenChange={setStepModalOpen}
        step={editingStep}
        onSave={handleSaveStep}
      />
    </div>
  );
}
