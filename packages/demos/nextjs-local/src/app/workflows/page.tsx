'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus, Play, Edit3, Trash2, Clock, CheckCircle } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { useWorkflowMetrics, useWorkflowData } from '@/hooks/useMetrics';
import type { Workflow } from '@/types/stagehand';

export default function WorkflowsPage() {
  const router = useRouter();
  const { metrics, loading: metricsLoading } = useWorkflowMetrics();
  const { data, loading: dataLoading, refresh, getWorkflowStatus } = useWorkflowData();

  const loading = metricsLoading || dataLoading;

  const handleDeleteWorkflow = async (workflowId: string) => {
    if (!confirm('Are you sure you want to delete this workflow?')) {
      return;
    }

    try {
      const response = await fetch(`/api/workflows/${workflowId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to delete workflow');
      }

      refresh(); // Refresh data to update the workflows list
    } catch (error) {
      console.error('Failed to delete workflow:', error);
      alert('Failed to delete workflow');
    }
  };

  const handleRunWorkflow = async (workflow: Workflow) => {
    // Check for active sessions
    const sessionsRes = await fetch('/api/sessions');
    const sessionsData = await sessionsRes.json();

    if (!sessionsData.sessions || sessionsData.sessions.length === 0) {
      alert('No active sessions found. Please create a session first.');
      return;
    }

    const sessionId = sessionsData.sessions[0].id;

    try {
      const response = await fetch(`/api/workflows/${workflow.id}/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sessionId }),
      });

      if (!response.ok) {
        throw new Error('Failed to start workflow');
      }

      const data = await response.json();
      router.push(`/workflows/editor?runId=${data.workflowRun.id}`);
    } catch (error) {
      console.error('Failed to run workflow:', error);
      alert('Failed to run workflow');
    }
  };

  const getStatusBadge = (status: 'draft' | 'active') => {
    const styles = {
      active: 'bg-green-500/10 text-green-500 border-green-500/20',
      draft: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
    };

    const icons = {
      active: CheckCircle,
      draft: Clock,
    };

    const Icon = icons[status];

    return (
      <span className={`inline-flex items-center gap-1 px-2 py-1 text-xs rounded-full border ${styles[status]}`}>
        <Icon className="h-3 w-3" />
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Workflows</h1>
          <p className="text-muted-foreground">Create and manage automation workflows for complex tasks</p>
        </div>
        <Link href="/workflows/editor">
          <Button className="gap-2">
            <Plus className="h-4 w-4" />
            Create Workflow
          </Button>
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Workflows</CardTitle>
            <Play className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics.totalWorkflows}</div>
            <p className="text-xs text-muted-foreground">
              {data.workflows.filter((w) => getWorkflowStatus(w).status === 'active').length} active
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Success Rate</CardTitle>
            <CheckCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {data.workflows.length > 0
                ? Math.round(
                    data.workflows.reduce((acc, w) => acc + getWorkflowStatus(w).successRate, 0) / data.workflows.length
                  )
                : 0}
              %
            </div>
            <p className="text-xs text-muted-foreground">Average across all workflows</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Steps</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.workflows.reduce((acc, w) => acc + w.steps.length, 0)}</div>
            <p className="text-xs text-muted-foreground">Across all workflows</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Your Workflows</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8 text-muted-foreground">
              <div className="animate-spin h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
              <p>Loading workflows...</p>
            </div>
          ) : data.workflows.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Play className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No workflows created yet</p>
              <Link href="/workflows/editor">
                <Button variant="outline" className="mt-4">
                  Create Your First Workflow
                </Button>
              </Link>
            </div>
          ) : (
            <div className="space-y-4">
              {data.workflows.map((workflow) => {
                const workflowStatus = getWorkflowStatus(workflow);
                return (
                  <div key={workflow.id} className="border rounded-lg p-4 hover:bg-muted/50 transition-colors">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <h3 className="font-semibold">{workflow.name}</h3>
                          {getStatusBadge(workflowStatus.status)}
                        </div>
                        <p className="text-sm text-muted-foreground mb-3">
                          {workflow.description || 'No description provided'}
                        </p>
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          <span>{workflow.steps.length} steps</span>
                          <span>Success rate: {workflowStatus.successRate}%</span>
                          {workflow.lastRun && (
                            <span>Last run: {format(new Date(workflow.lastRun), 'MMM dd, HH:mm')}</span>
                          )}
                          <span>Created: {format(new Date(workflow.createdAt), 'MMM dd, yyyy')}</span>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1"
                          onClick={() => handleRunWorkflow(workflow)}
                          disabled={workflow.steps.length === 0}
                        >
                          <Play className="h-3 w-3" />
                          Run
                        </Button>
                        <Link href={`/workflows/editor?id=${workflow.id}`}>
                          <Button variant="outline" size="sm" className="gap-1">
                            <Edit3 className="h-3 w-3" />
                            Edit
                          </Button>
                        </Link>
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1 text-red-500 hover:text-red-400"
                          onClick={() => handleDeleteWorkflow(workflow.id)}
                        >
                          <Trash2 className="h-3 w-3" />
                          Delete
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Getting Started with Workflows</CardTitle>
        </CardHeader>
        <CardContent className="prose prose-sm max-w-none text-foreground">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h4 className="font-semibold mb-2">What are workflows?</h4>
              <p className="text-sm text-muted-foreground">
                Workflows are sequences of automated actions that can be executed together. Create complex automation by
                chaining together act, extract, observe, and agent operations.
              </p>
            </div>
            <div>
              <h4 className="font-semibold mb-2">Workflow Builder</h4>
              <p className="text-sm text-muted-foreground">
                Use our visual drag-and-drop interface to create workflows without writing code. Add conditions, loops,
                and error handling to make your automation robust.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
