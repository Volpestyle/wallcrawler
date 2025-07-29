'use client';

import { useRouter } from 'next/navigation';
import { useWorkflowStore } from '@/lib/stores/workflow-store';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Plus, Play, Edit, Trash2, Clock, ChevronRight } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

export default function WorkflowsPage() {
  const router = useRouter();
  const { workflows, createWorkflow, deleteWorkflow } = useWorkflowStore();

  const handleCreateWorkflow = () => {
    const name = prompt('Enter workflow name:');
    if (name) {
      const description = prompt('Enter workflow description (optional):');
      createWorkflow(name, description || undefined);
    }
  };

  const handleRunWorkflow = (workflowId: string) => {
    router.push(`/workflows/${workflowId}`);
  };

  return (
    <div className="container mx-auto p-6 max-w-7xl">
      <div className="mb-8">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-3xl font-bold">Workflows</h1>
          <Button onClick={handleCreateWorkflow}>
            <Plus className="mr-2 h-4 w-4" />
            New Workflow
          </Button>
        </div>
        <p className="text-muted-foreground">
          Create and manage automated browser workflows with Stagehand
        </p>
      </div>

      {workflows.length === 0 ? (
        <Card>
          <CardContent className="text-center py-12">
            <p className="text-muted-foreground mb-4">
              No workflows created yet. Create your first workflow to get started.
            </p>
            <Button onClick={handleCreateWorkflow}>
              <Plus className="mr-2 h-4 w-4" />
              Create First Workflow
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {workflows.map((workflow) => (
            <Card key={workflow.id} className="hover:shadow-md transition-shadow cursor-pointer"
                  onClick={() => handleRunWorkflow(workflow.id)}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <CardTitle className="text-lg">{workflow.name}</CardTitle>
                    {workflow.description && (
                      <CardDescription className="mt-1">
                        {workflow.description}
                      </CardDescription>
                    )}
                  </div>
                  <ChevronRight className="h-5 w-5 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-4">
                    <span className="text-muted-foreground">
                      {workflow.steps.length} steps
                    </span>
                    <span className="text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatDistanceToNow(workflow.updatedAt, { addSuffix: true })}
                    </span>
                  </div>
                  <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleRunWorkflow(workflow.id)}
                    >
                      <Play className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        // TODO: Implement edit functionality
                        console.log('Edit workflow:', workflow.id);
                      }}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        if (confirm('Are you sure you want to delete this workflow?')) {
                          deleteWorkflow(workflow.id);
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}