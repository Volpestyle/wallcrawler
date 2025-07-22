'use client';

import { useState, useCallback, useEffect, Suspense } from 'react';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Save, Play, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Workflow, WorkflowStep, WorkflowRun, Session } from '@/types/stagehand';
import { WorkflowCanvas } from '@/components/WorkflowCanvas';
import { StepPalette } from '@/components/StepPalette';

function WorkflowEditorContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const workflowId = searchParams.get('id');
  const runId = searchParams.get('runId');
  const isRunMode = !!runId;

  const [workflow, setWorkflow] = useState<Workflow>({
    id: workflowId || `workflow_${Date.now()}`,
    name: '',
    description: '',
    steps: [],
    createdAt: new Date().toISOString(),
  });

  const [workflowRun, setWorkflowRun] = useState<WorkflowRun | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);

  // Load sessions
  useEffect(() => {
    const fetchSessions = async () => {
      try {
        const response = await fetch('/api/sessions');
        if (!response.ok) throw new Error('Failed to fetch sessions');
        const data = await response.json();
        setSessions(data.sessions || []);
      } catch (error) {
        console.error('Failed to fetch sessions:', error);
      }
    };
    fetchSessions();
  }, []);

  // Load workflow if editing existing one
  useEffect(() => {
    if (workflowId && !isRunMode) {
      fetch(`/api/workflows/${workflowId}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.workflow) {
            setWorkflow(data.workflow);
          }
        })
        .catch((error) => {
          console.error('Failed to load workflow:', error);
        });
    }
  }, [workflowId, isRunMode]);

  // Load workflow run data if in run mode
  useEffect(() => {
    if (runId) {
      const loadRunData = async () => {
        try {
          const runRes = await fetch(`/api/workflows/runs/${runId}`);
          const runData = await runRes.json();

          if (runData.workflowRun) {
            setWorkflowRun(runData.workflowRun);

            // Load the associated workflow
            const workflowRes = await fetch(`/api/workflows/${runData.workflowRun.workflowId}`);
            const workflowData = await workflowRes.json();

            if (workflowData.workflow) {
              setWorkflow(workflowData.workflow);
            }
          }
        } catch (error) {
          console.error('Failed to load run data:', error);
        }
      };

      loadRunData();

      // Poll for updates if workflow is running
      if (workflowRun?.status === 'running') {
        const interval = setInterval(loadRunData, 2000);
        return () => clearInterval(interval);
      }
    }
  }, [runId, workflowRun?.status]);

  const handleSaveWorkflow = async () => {
    if (!workflow.name.trim()) {
      alert('Please enter a workflow name');
      return;
    }

    setIsSaving(true);
    try {
      const method = workflowId ? 'PUT' : 'POST';
      const url = workflowId ? `/api/workflows/${workflowId}` : '/api/workflows';

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(workflow),
      });

      if (!response.ok) {
        throw new Error('Failed to save workflow');
      }

      const data = await response.json();
      setWorkflow(data.workflow);

      if (!workflowId) {
        router.push(`/workflows/editor?id=${data.workflow.id}`);
      }
    } catch (error) {
      console.error('Failed to save workflow:', error);
      alert('Failed to save workflow');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRunWorkflow = async () => {
    if (workflow.steps.length === 0) {
      alert('Please add at least one step to the workflow');
      return;
    }

    if (!selectedSession) {
      alert('Please select a session to run the workflow');
      return;
    }

    setIsRunning(true);
    try {
      const response = await fetch(`/api/workflows/${workflow.id}/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sessionId: selectedSession }),
      });

      if (!response.ok) {
        throw new Error('Failed to start workflow');
      }

      const data = await response.json();
      router.push(`/workflows/editor?runId=${data.workflowRun.id}`);
    } catch (error) {
      console.error('Failed to run workflow:', error);
      alert('Failed to run workflow');
    } finally {
      setIsRunning(false);
    }
  };

  const addStep = useCallback(
    (stepType: WorkflowStep['type']) => {
      const newStep: WorkflowStep = {
        id: `step_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        type: stepType,
        name: `${stepType.charAt(0).toUpperCase() + stepType.slice(1)} Step`,
        parameters: {},
        order: workflow.steps.length,
      };

      setWorkflow((prev) => ({
        ...prev,
        steps: [...prev.steps, newStep],
      }));
    },
    [workflow.steps.length]
  );

  const updateStep = useCallback((stepId: string, updates: Partial<WorkflowStep>) => {
    setWorkflow((prev) => ({
      ...prev,
      steps: prev.steps.map((step) => (step.id === stepId ? { ...step, ...updates } : step)),
    }));
  }, []);

  const deleteStep = useCallback((stepId: string) => {
    setWorkflow((prev) => ({
      ...prev,
      steps: prev.steps.filter((step) => step.id !== stepId),
    }));
  }, []);

  const moveStep = useCallback((dragIndex: number, hoverIndex: number) => {
    setWorkflow((prev) => {
      const dragStep = prev.steps[dragIndex];
      const newSteps = [...prev.steps];
      newSteps.splice(dragIndex, 1);
      newSteps.splice(hoverIndex, 0, dragStep);

      // Update order for all steps
      return {
        ...prev,
        steps: newSteps.map((step, index) => ({ ...step, order: index })),
      };
    });
  }, []);

  return (
    <DndProvider backend={HTML5Backend}>
      <div className="min-h-screen bg-background">
        <div className="border-b bg-card">
          <div className="container mx-auto px-4 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <Link href="/workflows">
                  <Button variant="ghost" size="sm" className="gap-2">
                    <ArrowLeft className="h-4 w-4" />
                    Back to Workflows
                  </Button>
                </Link>
                <div>
                  <h1 className="text-2xl font-bold">{isRunMode ? 'Workflow Run' : 'Workflow Editor'}</h1>
                  <p className="text-sm text-muted-foreground">
                    {isRunMode ? `Monitoring execution: ${workflow.name}` : 'Create and edit automation workflows'}
                  </p>
                </div>
              </div>

              {!isRunMode && (
                <div className="flex gap-2">
                  <Button onClick={handleSaveWorkflow} disabled={isSaving} className="gap-2">
                    <Save className="h-4 w-4" />
                    {isSaving ? 'Saving...' : 'Save'}
                  </Button>
                  <Button
                    onClick={handleRunWorkflow}
                    disabled={isRunning || workflow.steps.length === 0 || !selectedSession}
                    className="gap-2"
                  >
                    <Play className="h-4 w-4" />
                    {isRunning ? 'Starting...' : 'Run'}
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="container mx-auto px-4 py-6">
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            {/* Workflow Details */}
            <div className="lg:col-span-1">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Workflow Details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label htmlFor="name">Name</Label>
                    <Input
                      id="name"
                      value={workflow.name}
                      onChange={(e) => setWorkflow((prev) => ({ ...prev, name: e.target.value }))}
                      placeholder="Enter workflow name"
                      disabled={isRunMode}
                    />
                  </div>
                  <div>
                    <Label htmlFor="description">Description</Label>
                    <Textarea
                      id="description"
                      value={workflow.description || ''}
                      onChange={(e) => setWorkflow((prev) => ({ ...prev, description: e.target.value }))}
                      placeholder="Describe what this workflow does"
                      disabled={isRunMode}
                    />
                  </div>

                  {!isRunMode && (
                    <div>
                      <Label htmlFor="session-select">Select Session for Execution</Label>
                      <Select value={selectedSession ?? ''} onValueChange={setSelectedSession}>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Choose a session" />
                        </SelectTrigger>
                        <SelectContent>
                          {sessions
                            .filter((s) => s.status === 'active')
                            .map((session) => (
                              <SelectItem key={session.id} value={session.id}>
                                {session.id.slice(0, 8)} - Created {new Date(session.createdAt).toLocaleTimeString()}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                      {sessions.filter((s) => s.status === 'active').length === 0 && (
                        <p className="text-sm text-muted-foreground mt-1">
                          No active sessions. Create one from the Sessions page.
                        </p>
                      )}
                    </div>
                  )}

                  {isRunMode && workflowRun && (
                    <div className="space-y-2">
                      <div className="text-sm">
                        <strong>Status:</strong>
                        <span
                          className={`ml-2 px-2 py-1 rounded text-xs ${
                            workflowRun.status === 'running'
                              ? 'bg-blue-100 text-blue-800'
                              : workflowRun.status === 'completed'
                                ? 'bg-green-100 text-green-800'
                                : 'bg-red-100 text-red-800'
                          }`}
                        >
                          {workflowRun.status}
                        </span>
                      </div>
                      <div className="text-sm">
                        <strong>Started:</strong> {new Date(workflowRun.startTime).toLocaleString()}
                      </div>
                      {workflowRun.endTime && (
                        <div className="text-sm">
                          <strong>Ended:</strong> {new Date(workflowRun.endTime).toLocaleString()}
                        </div>
                      )}
                      <div className="text-sm">
                        <strong>Progress:</strong> {workflowRun.results?.length || 0} / {workflow.steps.length} steps
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {!isRunMode && (
                <div className="mt-6">
                  <StepPalette onAddStep={addStep} />
                </div>
              )}
            </div>

            {/* Workflow Canvas */}
            <div className="lg:col-span-3">
              <WorkflowCanvas
                steps={workflow.steps}
                onUpdateStep={updateStep}
                onDeleteStep={deleteStep}
                onMoveStep={moveStep}
                workflowRun={workflowRun}
                isRunMode={isRunMode}
              />
            </div>
          </div>
        </div>
      </div>
    </DndProvider>
  );
}

export default function WorkflowEditorPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background flex items-center justify-center">Loading workflow editor...</div>
      }
    >
      <WorkflowEditorContent />
    </Suspense>
  );
}
