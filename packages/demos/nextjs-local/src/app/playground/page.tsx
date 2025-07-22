'use client';

import { useState, useEffect } from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Label,
  Textarea,
  Input,
} from '@/components/ui';
import { Play, Activity } from 'lucide-react';
import { Session } from '@/types/stagehand';

export default function PlaygroundPage() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);

  // States for inputs
  const [actInstruction, setActInstruction] = useState('');
  const [extractInstruction, setExtractInstruction] = useState('');
  const [extractSchema, setExtractSchema] = useState('');
  const [observeInstruction, setObserveInstruction] = useState('');
  const [agentInstruction, setAgentInstruction] = useState('');
  const [agentMaxSteps, setAgentMaxSteps] = useState('10');

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

  const executeAction = async (method: 'act' | 'extract' | 'observe' | 'agent', options: Record<string, unknown>) => {
    if (!selectedSession) {
      setResult({ error: 'Please select a session first' });
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      const response = await fetch(`/api/stagehand/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: selectedSession, ...options }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const data = await response.json();
      setResult(data.result);
    } catch (error) {
      setResult({ error: (error as Error).message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Stagehand Playground</h1>
        <p className="text-muted-foreground">Experiment with Stagehand methods in real-time</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Method Selection</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="session-select">Select Active Session</Label>
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
                {sessions.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No active sessions. Create one from the Sessions page.
                  </p>
                )}
              </div>

              <Tabs defaultValue="act" className="w-full">
                <TabsList className="grid w-full grid-cols-4">
                  <TabsTrigger value="act">Act</TabsTrigger>
                  <TabsTrigger value="extract">Extract</TabsTrigger>
                  <TabsTrigger value="observe">Observe</TabsTrigger>
                  <TabsTrigger value="agent">Agent</TabsTrigger>
                </TabsList>

                <TabsContent value="act" className="mt-6 space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="act-instruction">Action Instruction</Label>
                    <Textarea
                      id="act-instruction"
                      placeholder="Enter action description (e.g., 'Click the login button')"
                      rows={3}
                      value={actInstruction}
                      onChange={(e) => setActInstruction(e.target.value)}
                    />
                  </div>
                  <Button
                    onClick={() => executeAction('act', { action: actInstruction })}
                    disabled={loading || !selectedSession}
                    className="w-full gap-2"
                  >
                    <Play className="h-4 w-4" />
                    {loading ? 'Executing...' : 'Execute Act'}
                  </Button>
                </TabsContent>

                <TabsContent value="extract" className="mt-6 space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="extract-instruction">Extraction Instruction</Label>
                    <Textarea
                      id="extract-instruction"
                      placeholder="Describe what to extract (e.g., 'Extract all product names')"
                      rows={2}
                      value={extractInstruction}
                      onChange={(e) => setExtractInstruction(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="extract-schema">Schema (JSON)</Label>
                    <Textarea
                      id="extract-schema"
                      className="font-mono"
                      placeholder='{"products": [{"name": "string", "price": "string"}]}'
                      rows={3}
                      value={extractSchema}
                      onChange={(e) => setExtractSchema(e.target.value)}
                    />
                  </div>
                  <Button
                    onClick={() => {
                      let schemaObj;
                      try {
                        schemaObj = JSON.parse(extractSchema);
                      } catch {
                        setResult({ error: 'Invalid JSON schema' });
                        return;
                      }
                      executeAction('extract', {
                        instruction: extractInstruction,
                        schema: schemaObj,
                      });
                    }}
                    disabled={loading || !selectedSession}
                    className="w-full gap-2"
                  >
                    <Play className="h-4 w-4" />
                    {loading ? 'Extracting...' : 'Execute Extract'}
                  </Button>
                </TabsContent>

                <TabsContent value="observe" className="mt-6 space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="observe-instruction">Observation Instruction</Label>
                    <Textarea
                      id="observe-instruction"
                      placeholder="What should be observed (e.g., 'Find all clickable buttons')"
                      rows={3}
                      value={observeInstruction}
                      onChange={(e) => setObserveInstruction(e.target.value)}
                    />
                  </div>
                  <Button
                    onClick={() => executeAction('observe', { instruction: observeInstruction })}
                    disabled={loading || !selectedSession}
                    className="w-full gap-2"
                  >
                    <Play className="h-4 w-4" />
                    {loading ? 'Observing...' : 'Execute Observe'}
                  </Button>
                </TabsContent>

                <TabsContent value="agent" className="mt-6 space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="agent-instruction">Agent Instruction</Label>
                    <Textarea
                      id="agent-instruction"
                      placeholder="High-level goal for the agent (e.g., 'Login to the website using demo credentials')"
                      rows={3}
                      value={agentInstruction}
                      onChange={(e) => setAgentInstruction(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="agent-max-steps">Max Steps</Label>
                    <Input
                      id="agent-max-steps"
                      type="number"
                      placeholder="10"
                      min="1"
                      max="50"
                      value={agentMaxSteps}
                      onChange={(e) => setAgentMaxSteps(e.target.value)}
                    />
                  </div>
                  <Button
                    onClick={() =>
                      executeAction('agent', {
                        instruction: agentInstruction,
                        maxSteps: parseInt(agentMaxSteps) || 10,
                      })
                    }
                    disabled={loading || !selectedSession}
                    className="w-full gap-2"
                  >
                    <Play className="h-4 w-4" />
                    {loading ? 'Running Agent...' : 'Execute Agent'}
                  </Button>
                </TabsContent>
              </Tabs>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Results</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Activity className="h-6 w-6 animate-spin" />
              </div>
            ) : result ? (
              <pre className="bg-muted p-4 rounded-md overflow-auto text-sm font-mono">
                {JSON.stringify(result, null, 2)}
              </pre>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                <Activity className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No results yet</p>
                <p className="text-sm">Execute a method to see results here</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Quick Start</CardTitle>
        </CardHeader>
        <CardContent className="prose prose-sm max-w-none text-foreground">
          <ol className="space-y-2 text-sm">
            <li>1. Create a session from the Sessions page</li>
            <li>2. Navigate to a website using the session</li>
            <li>3. Use the playground to experiment with different methods</li>
            <li>4. View results and iterate on your automation</li>
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
