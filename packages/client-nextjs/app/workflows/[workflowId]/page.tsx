'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { BrowserViewport } from '@wallcrawler/components';
import { useWorkflowStore } from '@/lib/stores/workflow-store';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, Play, Pause, RotateCcw, Eye } from 'lucide-react';

export default function WorkflowDetailPage() {
  const params = useParams();
  const router = useRouter();
  const workflowId = params.workflowId as string;
  
  const { workflows } = useWorkflowStore();
  const workflow = workflows.find(w => w.id === workflowId);
  
  const [isRunning, setIsRunning] = useState(false);
  const [sessionId, setSessionId] = useState<string>('');
  const [stagehandPage, setStagehandPage] = useState<any>(null);
  const [currentStepIndex, setCurrentStepIndex] = useState(-1);
  const [logs, setLogs] = useState<string[]>([]);

  useEffect(() => {
    if (!workflow) {
      router.push('/');
    }
  }, [workflow, router]);

  if (!workflow) {
    return null;
  }

  const handleStartWorkflow = async () => {
    setIsRunning(true);
    setCurrentStepIndex(0);
    setLogs([`Starting workflow: ${workflow.name}`, `Initializing browser session...`]);
    
    // TODO: Initialize Wallcrawler session and Stagehand
    // const wallcrawler = new Wallcrawler({ apiKey: process.env.NEXT_PUBLIC_WALLCRAWLER_API_KEY });
    // const session = await wallcrawler.sessions.create();
    // const stagehand = new Stagehand({ sessionId: session.id });
    // const page = await stagehand.page();
    // setSessionId(session.id);
    // setStagehandPage(page);
    
    // For now, just simulate
    setSessionId('demo-session-' + Date.now());
    setLogs(prev => [...prev, 'Browser session initialized', 'Ready to execute workflow steps']);
  };

  const handleStopWorkflow = () => {
    setIsRunning(false);
    setCurrentStepIndex(-1);
    setLogs(prev => [...prev, 'Workflow stopped by user']);
    // TODO: Clean up session
  };

  const handleResetWorkflow = () => {
    setIsRunning(false);
    setCurrentStepIndex(-1);
    setSessionId('');
    setStagehandPage(null);
    setLogs([]);
  };

  return (
    <div className="container mx-auto p-6 max-w-7xl">
      {/* Header */}
      <div className="mb-6">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push('/')}
          className="mb-4"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Dashboard
        </Button>
        
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold mb-2">{workflow.name}</h1>
            {workflow.description && (
              <p className="text-muted-foreground">{workflow.description}</p>
            )}
          </div>
          
          <div className="flex gap-2">
            {!isRunning ? (
              <Button onClick={handleStartWorkflow} disabled={workflow.steps.length === 0}>
                <Play className="mr-2 h-4 w-4" />
                Start Workflow
              </Button>
            ) : (
              <Button onClick={handleStopWorkflow} variant="destructive">
                <Pause className="mr-2 h-4 w-4" />
                Stop
              </Button>
            )}
            <Button onClick={handleResetWorkflow} variant="outline">
              <RotateCcw className="mr-2 h-4 w-4" />
              Reset
            </Button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <Tabs defaultValue="viewport" className="space-y-4">
        <TabsList>
          <TabsTrigger value="viewport">
            <Eye className="mr-2 h-4 w-4" />
            Browser Viewport
          </TabsTrigger>
          <TabsTrigger value="steps">Workflow Steps</TabsTrigger>
          <TabsTrigger value="logs">Execution Logs</TabsTrigger>
        </TabsList>

        {/* Viewport Tab */}
        <TabsContent value="viewport" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Browser Session</CardTitle>
              <CardDescription>
                {sessionId ? `Connected to session: ${sessionId}` : 'Start the workflow to connect to a browser session'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="aspect-video bg-muted rounded-lg overflow-hidden relative">
                {sessionId && stagehandPage ? (
                  <BrowserViewport
                    sessionId={sessionId}
                    stagehandPage={stagehandPage}
                    width={1280}
                    height={720}
                    quality={80}
                    frameRate={10}
                    enableInteraction={true}
                    onError={(error) => setLogs(prev => [...prev, `Error: ${error.message}`])}
                    className="w-full h-full"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <div className="text-center">
                      <p className="text-muted-foreground mb-4">
                        {sessionId ? 'Connecting to browser...' : 'No active browser session'}
                      </p>
                      {!sessionId && workflow.steps.length > 0 && (
                        <Button onClick={handleStartWorkflow}>
                          Start Workflow to View Browser
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Steps Tab */}
        <TabsContent value="steps" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Workflow Steps</CardTitle>
              <CardDescription>
                {workflow.steps.length} steps in this workflow
              </CardDescription>
            </CardHeader>
            <CardContent>
              {workflow.steps.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">
                  No steps added yet. Edit the workflow to add steps.
                </p>
              ) : (
                <div className="space-y-2">
                  {workflow.steps.map((step, index) => (
                    <div
                      key={step.id}
                      className={`p-4 rounded-lg border ${
                        currentStepIndex === index
                          ? 'border-primary bg-primary/5'
                          : currentStepIndex > index
                          ? 'border-green-500 bg-green-500/5'
                          : 'border-border'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                            currentStepIndex > index
                              ? 'bg-green-500 text-white'
                              : currentStepIndex === index
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-muted'
                          }`}>
                            {index + 1}
                          </div>
                          <div>
                            <p className="font-medium">{step.type}</p>
                            {step.selector && (
                              <code className="text-xs text-muted-foreground">{step.selector}</code>
                            )}
                          </div>
                        </div>
                        <Badge variant={
                          currentStepIndex > index ? 'default' : 
                          currentStepIndex === index ? 'secondary' : 
                          'outline'
                        }>
                          {currentStepIndex > index ? 'Completed' : 
                           currentStepIndex === index ? 'Running' : 
                           'Pending'}
                        </Badge>
                      </div>
                      {step.data && (
                        <p className="mt-2 text-sm text-muted-foreground ml-11">
                          {JSON.stringify(step.data)}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Logs Tab */}
        <TabsContent value="logs" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Execution Logs</CardTitle>
              <CardDescription>
                Real-time logs from workflow execution
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="bg-black/90 text-green-400 font-mono text-sm p-4 rounded-lg h-96 overflow-y-auto">
                {logs.length === 0 ? (
                  <p className="text-gray-500">No logs yet. Start the workflow to see execution logs.</p>
                ) : (
                  logs.map((log, index) => (
                    <div key={index} className="mb-1">
                      <span className="text-gray-500">[{new Date().toLocaleTimeString()}]</span> {log}
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}