"use client";

import { formatDistanceToNow } from "date-fns";
import { FileText, Plus, Trash2, Edit, Play } from "lucide-react";
import { useWorkflowStore } from "@/lib/stores/workflow-store";
import { useUIStore } from "@/lib/stores/ui-store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function WorkflowList() {
  const {
    workflows,
    activeWorkflowId,
    setActiveWorkflow,
    setEditingWorkflow,
    deleteWorkflow,
  } = useWorkflowStore();
  const { setWorkflowModalOpen } = useUIStore();

  const handleEdit = (workflowId: string) => {
    const workflow = workflows.find((w) => w.id === workflowId);
    if (workflow) {
      setEditingWorkflow(workflow);
    }
  };

  const handleDelete = (workflowId: string) => {
    if (confirm("Are you sure you want to delete this workflow?")) {
      deleteWorkflow(workflowId);
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-6 border-b border-border">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-text-secondary" />
            <h2 className="text-xl font-light">Workflows</h2>
          </div>
          <Button size="sm" onClick={() => setWorkflowModalOpen(true)}>
            <Plus className="h-4 w-4 mr-1" />
            New Workflow
          </Button>
        </div>
        <p className="text-sm text-text-secondary">
          Create and manage automation workflows
        </p>
      </div>

      {/* Workflow list */}
      <div className="flex-1 overflow-y-auto p-6">
        {workflows.length === 0 ? (
          <div className="text-center py-12">
            <FileText className="h-12 w-12 text-text-secondary/30 mx-auto mb-4" />
            <p className="text-text-secondary">No workflows created</p>
            <p className="text-sm text-text-secondary/70 mt-1">
              Create your first workflow to automate tasks
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {workflows.map((workflow) => (
              <Card
                key={workflow.id}
                className={cn(
                  "cursor-pointer transition-all hover:border-accent/50",
                  activeWorkflowId === workflow.id &&
                    "border-accent ring-1 ring-accent/20"
                )}
                onClick={() => setActiveWorkflow(workflow.id)}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{workflow.name}</CardTitle>
                    <Badge variant="secondary" className="text-xs">
                      {workflow.steps.length} steps
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {workflow.description && (
                      <p className="text-sm text-text-secondary line-clamp-2">
                        {workflow.description}
                      </p>
                    )}
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-text-secondary">
                        Updated{" "}
                        {formatDistanceToNow(new Date(workflow.updatedAt), {
                          addSuffix: true,
                        })}
                      </span>
                      <div
                        className="flex gap-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() => handleEdit(workflow.id)}
                        >
                          <Edit className="h-3 w-3" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                        >
                          <Play className="h-3 w-3" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() => handleDelete(workflow.id)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}