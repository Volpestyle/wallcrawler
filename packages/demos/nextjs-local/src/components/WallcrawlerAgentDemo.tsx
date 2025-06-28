'use client';

import { useState } from 'react';
import { agentDemoScenarios } from '@/lib/demo-scenarios-agent';

interface AgentResult {
  success: boolean;
  steps: Array<{
    instruction: string;
    action: string;
    result: any;
    timestamp: number;
    duration: number;
  }>;
  finalOutput?: any;
  error?: string;
}

export function WallcrawlerAgentDemo() {
  const [selectedScenario, setSelectedScenario] = useState<string>('');
  const [customTask, setCustomTask] = useState('');
  const [customUrl, setCustomUrl] = useState('https://www.google.com');
  const [isRunning, setIsRunning] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [result, setResult] = useState<AgentResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number>(0);
  const [statusMessage, setStatusMessage] = useState<string>('');

  const runAgentTask = async () => {
    setIsRunning(true);
    setError(null);
    setResult(null);
    setProgress(0);
    setStatusMessage('Initializing agent...');

    try {
      const scenario = agentDemoScenarios.find(s => s.id === selectedScenario);
      const task = scenario ? scenario.task : customTask;
      const url = scenario ? 'https://www.google.com' : customUrl;
      const agentOptions = scenario?.agentOptions || {
        maxSteps: 10,
        planningStrategy: 'sequential',
      };

      if (!task) {
        throw new Error('Please select a scenario or enter a custom task');
      }

      // Start the automation
      const response = await fetch('/api/wallcrawler', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          command: task,
          model: 'openai',
          isAgent: true,
          agentOptions,
          scenario: selectedScenario,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to start automation');
      }

      const { sessionId } = await response.json();
      setSessionId(sessionId);

      // Poll for results
      const pollInterval = setInterval(async () => {
        const statusResponse = await fetch(
          `/api/wallcrawler/status?sessionId=${sessionId}`
        );
        
        if (statusResponse.ok) {
          const status = await statusResponse.json();
          
          if (status.message) {
            setStatusMessage(status.message);
          }
          
          if (status.progress) {
            setProgress(status.progress);
          }

          if (status.status === 'success') {
            clearInterval(pollInterval);
            setResult(status.result.data);
            setIsRunning(false);
          } else if (status.status === 'error') {
            clearInterval(pollInterval);
            setError(status.message || 'Task failed');
            setIsRunning(false);
          }
        }
      }, 1000);

      // Cleanup after 2 minutes
      setTimeout(() => {
        clearInterval(pollInterval);
        if (isRunning) {
          setError('Task timed out');
          setIsRunning(false);
        }
      }, 120000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      setIsRunning(false);
    }
  };

  const selectedScenarioData = agentDemoScenarios.find(
    s => s.id === selectedScenario
  );

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-8">WallCrawler Agent Demo</h1>
      
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
        <h2 className="text-lg font-semibold text-blue-900 mb-2">
          What is the WallCrawler Agent?
        </h2>
        <p className="text-blue-800">
          The WallCrawler Agent can execute complex multi-step tasks by breaking them
          down into individual actions. It uses AI to plan and execute sequences of
          navigation, interaction, and data extraction operations automatically.
        </p>
      </div>

      <div className="space-y-6">
        {/* Scenario Selection */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Select a Demo Scenario
          </label>
          <select
            value={selectedScenario}
            onChange={(e) => setSelectedScenario(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={isRunning}
          >
            <option value="">Custom Task</option>
            {agentDemoScenarios.map((scenario) => (
              <option key={scenario.id} value={scenario.id}>
                {scenario.name} - {scenario.category}
              </option>
            ))}
          </select>
        </div>

        {/* Scenario Details */}
        {selectedScenarioData && (
          <div className="bg-gray-50 rounded-lg p-4">
            <h3 className="font-semibold mb-2">{selectedScenarioData.name}</h3>
            <p className="text-sm text-gray-600 mb-2">
              {selectedScenarioData.description}
            </p>
            <div className="bg-white rounded p-3 font-mono text-sm">
              {selectedScenarioData.task}
            </div>
            {selectedScenarioData.agentOptions && (
              <div className="mt-2 text-sm text-gray-500">
                Max Steps: {selectedScenarioData.agentOptions.maxSteps} |
                Strategy: {selectedScenarioData.agentOptions.planningStrategy}
              </div>
            )}
          </div>
        )}

        {/* Custom Task Input */}
        {!selectedScenario && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Starting URL
              </label>
              <input
                type="url"
                value={customUrl}
                onChange={(e) => setCustomUrl(e.target.value)}
                placeholder="https://www.example.com"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={isRunning}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Task Description
              </label>
              <textarea
                value={customTask}
                onChange={(e) => setCustomTask(e.target.value)}
                placeholder="Describe the task you want the agent to perform..."
                rows={4}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={isRunning}
              />
            </div>
          </>
        )}

        {/* Run Button */}
        <button
          onClick={runAgentTask}
          disabled={isRunning || (!selectedScenario && !customTask)}
          className={`w-full py-3 px-4 rounded-md font-medium transition-colors ${
            isRunning || (!selectedScenario && !customTask)
              ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
              : 'bg-blue-600 text-white hover:bg-blue-700'
          }`}
        >
          {isRunning ? 'Running Agent Task...' : 'Run Agent Task'}
        </button>

        {/* Progress */}
        {isRunning && (
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>{statusMessage}</span>
              <span>{progress}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {/* Error Display */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-red-800">Error: {error}</p>
          </div>
        )}

        {/* Results */}
        {result && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <h3 className="text-lg font-semibold text-green-900 mb-3">
              Task Completed Successfully
            </h3>
            
            {/* Steps Summary */}
            <div className="mb-4">
              <h4 className="font-medium mb-2">Execution Steps:</h4>
              <div className="space-y-2">
                {result.steps.map((step, index) => (
                  <div
                    key={index}
                    className="bg-white rounded p-3 text-sm"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <span className="font-medium text-green-700">
                          Step {index + 1} ({step.action}):
                        </span>
                        <span className="ml-2">{step.instruction}</span>
                      </div>
                      <span className="text-gray-500 text-xs">
                        {step.duration}ms
                      </span>
                    </div>
                    {step.result?.error && (
                      <div className="text-red-600 text-xs mt-1">
                        Error: {step.result.error}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Final Output */}
            {result.finalOutput && (
              <div>
                <h4 className="font-medium mb-2">Extracted Data:</h4>
                <pre className="bg-white rounded p-3 overflow-x-auto text-sm">
                  {JSON.stringify(result.finalOutput, null, 2)}
                </pre>
              </div>
            )}

            {/* Screenshots */}
            {sessionId && (
              <div className="mt-4">
                <a
                  href={`/api/wallcrawler/artifacts?type=screenshot&id=${sessionId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline text-sm"
                >
                  View Final Screenshot →
                </a>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}