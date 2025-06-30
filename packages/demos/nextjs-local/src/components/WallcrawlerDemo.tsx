'use client';

import { useState } from 'react';
import ActionForm from './ActionForm';
import ResultsDisplay from './ResultsDisplay';
import StatusIndicator from './StatusIndicator';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface WallcrawlerDemoProps {
  scenario: 'scraping' | 'form' | 'navigation' | 'extraction';
}

export interface TaskResult {
  success: boolean;
  data?: any;
  error?: string;
  screenshots?: string[];
  logs?: string[];
}

export interface TaskStatus {
  status: 'idle' | 'running' | 'success' | 'error';
  message?: string;
  progress?: number;
}

export default function WallcrawlerDemo({ scenario }: WallcrawlerDemoProps) {
  const [taskStatus, setTaskStatus] = useState<TaskStatus>({ status: 'idle' });
  const [taskResult, setTaskResult] = useState<TaskResult | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  // Placeholder scenario info - was previously using getDemoScenario
  const scenarioInfo = {
    title: `${scenario.charAt(0).toUpperCase() + scenario.slice(1)} Demo`,
    description: `Demo for ${scenario} functionality`,
    url: 'https://example.com',
    instruction: 'Demo scenario placeholder',
  };

  const handleSubmit = async (formData: { url: string; command: string; schema?: string; model?: string }) => {
    setTaskStatus({ status: 'running', message: 'Initializing browser...' });
    setTaskResult(null);

    try {
      // Start the task
      const response = await fetch('/api/wallcrawler', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const { sessionId: newSessionId } = await response.json();
      setSessionId(newSessionId);

      // Poll for status updates
      const pollInterval = setInterval(async () => {
        try {
          const statusResponse = await fetch(`/api/wallcrawler/status?sessionId=${newSessionId}`);
          const statusData = await statusResponse.json();

          setTaskStatus({
            status: statusData.status,
            message: statusData.message,
            progress: statusData.progress,
          });

          if (statusData.status === 'success' || statusData.status === 'error') {
            clearInterval(pollInterval);

            // Get final results
            const resultsResponse = await fetch(`/api/wallcrawler/artifacts?sessionId=${newSessionId}`);
            const resultsData = await resultsResponse.json();

            setTaskResult(resultsData);
          }
        } catch (error) {
          console.error('Status polling error:', error);
          clearInterval(pollInterval);
          setTaskStatus({ status: 'error', message: 'Failed to get status' });
        }
      }, 1000);

      // Cleanup after 5 minutes
      setTimeout(() => clearInterval(pollInterval), 300000);
    } catch (error) {
      console.error('Task submission error:', error);
      setTaskStatus({
        status: 'error',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
      setTaskResult({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{scenarioInfo.title}</CardTitle>
          <CardDescription>{scenarioInfo.description}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <ActionForm
              defaultValues={scenarioInfo.defaultValues}
              onSubmit={handleSubmit}
              isRunning={taskStatus.status === 'running'}
              showSchema={scenario === 'extraction'}
            />

            <div className="flex items-center justify-between">
              <StatusIndicator status={taskStatus} />
              {sessionId && <span className="text-xs text-gray-500">Session: {sessionId.slice(0, 8)}...</span>}
            </div>
          </div>
        </CardContent>
      </Card>

      {taskResult && <ResultsDisplay result={taskResult} scenario={scenario} />}

      {/* Example Commands */}
      <Card>
        <CardHeader>
          <CardTitle>Example Commands</CardTitle>
          <CardDescription>Try these natural language commands for this scenario</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2">
            {scenarioInfo.exampleCommands.map((command, index) => (
              <li key={index} className="flex items-start">
                <span className="text-gray-400 mr-2">•</span>
                <code className="text-sm bg-gray-50 px-2 py-1 rounded">{command}</code>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
