'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Plus, Play, Square, MousePointer, DollarSign } from 'lucide-react';
import { cn } from '@/lib/utils';

import { WorkflowPresets } from './WorkflowPresets';
import { WorkflowStats } from './WorkflowStats';
import { WorkflowStep } from './WorkflowStep';
import { stepTypes, presets } from './constants';
import { calculateStepCostWithFuzzyMatch } from './utils';
import {
  WorkflowStep as WorkflowStepType,
  ModelInfo,
  WorkflowStats as WorkflowStatsType,
  ProviderPricing,
  PricingResponse,
  WallcrawlerResponse,
  ModelPricing,
} from './types';

export default function WorkflowBuilder() {
  const [steps, setSteps] = useState<WorkflowStepType[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(-1);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState('');
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([]);
  const [modelPricing, setModelPricing] = useState<Record<string, ProviderPricing>>({});
  const [workflowStats, setWorkflowStats] = useState<WorkflowStatsType>({
    totalTokens: 0,
    totalCost: 0,
    totalInferenceTime: 0,
    stepCosts: [],
  });

  // Load available models and pricing on component mount
  useEffect(() => {
    const loadModelsAndPricing = async () => {
      try {
        // Load available models
        const modelsResponse = await fetch('/api/wallcrawler/models');
        const modelsData = await modelsResponse.json();

        if (modelsData.models && modelsData.models.length > 0) {
          setAvailableModels(modelsData.models);
          setSelectedModel(modelsData.models[0].provider);
        }

        // Load real-time pricing
        try {
          const pricingResponse = await fetch('/api/pricing');
          const pricingData: PricingResponse = await pricingResponse.json();

          if (pricingData.available === true) {
            setModelPricing(pricingData);
            console.log('Real-time pricing loaded successfully');
          } else {
            console.warn('Real-time pricing unavailable:', pricingData.note || pricingData.reason);
            setModelPricing({});
          }
        } catch (pricingError) {
          console.warn('Failed to load pricing, costs will not be displayed:', pricingError);
          setModelPricing({});
        }
      } catch (error) {
        console.error('Failed to load models:', error);
      }
    };

    loadModelsAndPricing();
  }, []);

  // Calculate workflow statistics
  useEffect(() => {
    const totalTokens = steps.reduce((sum, step) => sum + (step.tokens?.total_tokens || 0), 0);
    const totalCost = steps.reduce((sum, step) => sum + (step.tokens?.cost || 0), 0);
    const totalInferenceTime = steps.reduce((sum, step) => sum + (step.tokens?.inference_time_ms || 0), 0);
    const stepCosts = steps.map((step) => step.tokens?.cost || 0);

    setWorkflowStats({ totalTokens, totalCost, totalInferenceTime, stepCosts });
  }, [steps]);

  // Get the currently selected model info
  const getSelectedModelInfo = (): ModelInfo | null => {
    return availableModels.find((model) => model.provider === selectedModel) || null;
  };

  // Calculate cost for a step using fuzzy matching
  const calculateStepCost = (
    tokens: { prompt_tokens: number; completion_tokens: number },
    modelProvider: string
  ): number => {
    const modelInfo = availableModels.find((model) => model.provider === modelProvider);
    const actualModelName = modelInfo?.modelName || modelProvider;

    const result = calculateStepCostWithFuzzyMatch(tokens, actualModelName, modelPricing);
    return result.cost;
  };

  const generateStepId = () => `step_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  const addStep = (type: WorkflowStepType['type'] = 'navigate') => {
    const newStep: WorkflowStepType = {
      id: generateStepId(),
      type,
      title: `${stepTypes.find((t) => t.value === type)?.label} Step`,
      config: {},
      status: 'pending',
    };
    setSteps([...steps, newStep]);
  };

  const updateStep = (stepId: string, updates: Partial<WorkflowStepType>) => {
    setSteps(steps.map((step) => (step.id === stepId ? { ...step, ...updates } : step)));
  };

  const removeStep = (stepId: string) => {
    setSteps(steps.filter((step) => step.id !== stepId));
  };

  const moveStep = (stepId: string, direction: 'up' | 'down') => {
    const currentIndex = steps.findIndex((step) => step.id === stepId);
    if ((direction === 'up' && currentIndex === 0) || (direction === 'down' && currentIndex === steps.length - 1)) {
      return;
    }

    const newSteps = [...steps];
    const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    [newSteps[currentIndex], newSteps[targetIndex]] = [newSteps[targetIndex], newSteps[currentIndex]];
    setSteps(newSteps);
  };

  const loadPreset = (preset: (typeof presets)[0]) => {
    const newSteps = preset.steps.map((step, index) => ({
      id: generateStepId(),
      type: step.type as WorkflowStepType['type'],
      title: step.title,
      config: step.config,
      status: 'pending' as const,
    }));
    setSteps(newSteps);
  };

  const runWorkflow = async () => {
    if (steps.length === 0) return;

    setIsRunning(true);
    setCurrentStepIndex(0);

    let workflowSessionId: string | null = null;

    try {
      // Reset all step statuses
      setSteps(
        steps.map((step) => ({
          ...step,
          status: 'pending',
          result: undefined,
          error: undefined,
        }))
      );

      for (let i = 0; i < steps.length; i++) {
        setCurrentStepIndex(i);
        const step = steps[i];

        // Update step status to running
        setSteps((prevSteps) => prevSteps.map((s, index) => (index === i ? { ...s, status: 'running' } : s)));

        try {
          // Use workflowSessionId for this step, will be null for first step
          const currentSessionId: string | null = workflowSessionId;

          console.log(`[DEBUG] Step ${i + 1}: Using sessionId: ${currentSessionId || 'null'}`);

          const response: Response = await fetch('/api/wallcrawler', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: step.type,
              config: step.config,
              sessionId: currentSessionId,
              model: selectedModel,
              includeUsage: true,
            }),
          });

          const result: WallcrawlerResponse = await response.json();

          if (!response.ok) {
            throw new Error(result.error || 'Request failed');
          }

          // Store session ID from first step for subsequent steps
          if (i === 0 && result.sessionId) {
            console.log(`[DEBUG] Storing session ID for future steps: ${result.sessionId}`);
            workflowSessionId = result.sessionId;
            setSessionId(result.sessionId);
          }

          // Calculate tokens and cost for this step
          let stepTokens = undefined;

          // Check for usage data in the API response (now at top level)
          if (result.usage) {
            const usage = result.usage;
            if (usage.prompt_tokens !== undefined && usage.completion_tokens !== undefined) {
              const prompt_tokens = usage.prompt_tokens;
              const completion_tokens = usage.completion_tokens;
              const total_tokens = usage.total_tokens || prompt_tokens + completion_tokens;
              const cost = calculateStepCost({ prompt_tokens, completion_tokens }, selectedModel);

              stepTokens = {
                prompt_tokens,
                completion_tokens,
                total_tokens,
                inference_time_ms: usage.inference_time_ms || 0,
                cost,
              };
            }
          }

          // Update step with result and token usage
          setSteps((prevSteps) => {
            const updatedSteps = prevSteps.map((s, index) =>
              index === i
                ? {
                    ...s,
                    status: 'completed',
                    result: result.result,
                    tokens: stepTokens,
                  }
                : s
            );

            // Immediately update stats with the new step data
            const totalTokens = updatedSteps.reduce((sum, step) => sum + (step.tokens?.total_tokens || 0), 0);
            const totalCost = updatedSteps.reduce((sum, step) => sum + (step.tokens?.cost || 0), 0);
            const totalInferenceTime = updatedSteps.reduce(
              (sum, step) => sum + (step.tokens?.inference_time_ms || 0),
              0
            );
            const stepCosts = updatedSteps.map((step) => step.tokens?.cost || 0);

            setWorkflowStats({ totalTokens, totalCost, totalInferenceTime, stepCosts });

            return updatedSteps;
          });

          // Small delay between steps
          if (i < steps.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';

          // If it's a session corruption error, reset the session ID
          if (errorMessage.includes('Session corrupted')) {
            workflowSessionId = null;
            setSessionId(null);
          }

          // Update step with error
          setSteps((prevSteps) =>
            prevSteps.map((s, index) =>
              index === i
                ? {
                    ...s,
                    status: 'error',
                    error: errorMessage,
                  }
                : s
            )
          );
          break; // Stop workflow on error
        }
      }
    } finally {
      setIsRunning(false);
      setCurrentStepIndex(-1);

      // Clean up the session when workflow is complete
      if (workflowSessionId) {
        try {
          console.log(`[DEBUG] Cleaning up session: ${workflowSessionId}`);
          await fetch(`/api/wallcrawler?sessionId=${workflowSessionId}`, {
            method: 'DELETE',
          });
          console.log(`[DEBUG] Session ${workflowSessionId} cleaned up successfully`);
        } catch (error) {
          console.warn('Failed to cleanup session:', error);
        }
        setSessionId(null);
      }
    }
  };

  const stopWorkflow = async () => {
    setIsRunning(false);
    setCurrentStepIndex(-1);

    // Clean up the session when workflow is stopped
    if (sessionId) {
      try {
        console.log(`[DEBUG] Stopping workflow, cleaning up session: ${sessionId}`);
        await fetch(`/api/wallcrawler?sessionId=${sessionId}`, {
          method: 'DELETE',
        });
        console.log(`[DEBUG] Session ${sessionId} cleaned up after stop`);
      } catch (error) {
        console.warn('Failed to cleanup session on stop:', error);
      }
      setSessionId(null);
    }
  };

  const resetWorkflow = async () => {
    // Clean up the existing session if it exists
    if (sessionId) {
      try {
        await fetch(`/api/wallcrawler?sessionId=${sessionId}`, {
          method: 'DELETE',
        });
      } catch (error) {
        console.warn('Failed to cleanup session:', error);
      }
    }

    setSteps(
      steps.map((step) => ({
        ...step,
        status: 'pending',
        result: undefined,
        error: undefined,
      }))
    );
    setSessionId(null);
    setCurrentStepIndex(-1);
  };

  const getStepIcon = (type: WorkflowStepType['type']) => {
    return stepTypes.find((t) => t.value === type)?.icon || <MousePointer className="w-4 h-4" />;
  };

  const getStatusColor = (status: WorkflowStepType['status']) => {
    switch (status) {
      case 'pending':
        return 'bg-gray-100 text-gray-600';
      case 'running':
        return 'bg-blue-100 text-blue-600 animate-pulse';
      case 'completed':
        return 'bg-green-100 text-green-600';
      case 'error':
        return 'bg-red-100 text-red-600';
      default:
        return 'bg-gray-100 text-gray-600';
    }
  };

  return (
    <div className="space-y-6">
      {/* Presets */}
      <WorkflowPresets presets={presets} onPresetLoad={loadPreset} />

      {/* Workflow Builder */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            Workflow Steps
            <div className="flex gap-2">
              <Button onClick={() => addStep()} size="sm" variant="outline" disabled={isRunning}>
                <Plus className="w-4 h-4 mr-1" />
                Add Step
              </Button>
              {steps.length > 0 && (
                <>
                  <Button onClick={resetWorkflow} size="sm" variant="outline" disabled={isRunning}>
                    Reset
                  </Button>
                  {sessionId && !isRunning && (
                    <Button
                      onClick={async () => {
                        try {
                          console.log(`[DEBUG] Manually closing session: ${sessionId}`);
                          await fetch(`/api/wallcrawler?sessionId=${sessionId}`, {
                            method: 'DELETE',
                          });
                          console.log(`[DEBUG] Session ${sessionId} manually closed`);
                          setSessionId(null);
                        } catch (error) {
                          console.warn('Failed to close session:', error);
                        }
                      }}
                      size="sm"
                      variant="outline"
                    >
                      Close Session
                    </Button>
                  )}
                  {isRunning ? (
                    <Button onClick={stopWorkflow} size="sm" variant="destructive">
                      <Square className="w-4 h-4 mr-1" />
                      Stop
                    </Button>
                  ) : (
                    <Button onClick={runWorkflow} size="sm" disabled={steps.length === 0}>
                      <Play className="w-4 h-4 mr-1" />
                      Run Workflow
                    </Button>
                  )}
                </>
              )}
            </div>
          </CardTitle>

          {/* Model Selection and Stats */}
          <div className="mt-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <Label htmlFor="model-select">LLM Provider:</Label>
                <Select
                  value={selectedModel}
                  onValueChange={setSelectedModel}
                  disabled={isRunning || availableModels.length === 0}
                >
                  <SelectTrigger className="w-64">
                    <SelectValue
                      placeholder={availableModels.length === 0 ? 'No models configured' : 'Select a model'}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {availableModels.map((model) => (
                      <SelectItem key={model.provider} value={model.provider}>
                        <div className="flex items-center gap-2">
                          <div
                            className={cn(
                              'w-2 h-2 rounded-full',
                              model.provider === 'ollama'
                                ? 'bg-blue-500'
                                : model.provider === 'openai'
                                  ? 'bg-green-500'
                                  : 'bg-orange-500'
                            )}
                          ></div>
                          <span>{model.displayName}</span>
                          {model.input === 0 && model.output === 0 && (
                            <Badge variant="secondary" className="text-xs ml-1">
                              FREE
                            </Badge>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Display current model name */}
                {(() => {
                  const currentModel = getSelectedModelInfo();
                  return currentModel ? (
                    <div className="flex items-center gap-2 px-3 py-1 bg-gray-100 rounded-md">
                      <span className="text-xs text-gray-500">Model:</span>
                      <code className="text-xs font-mono text-gray-700 bg-white px-2 py-1 rounded">
                        {currentModel.modelName}
                      </code>
                    </div>
                  ) : null;
                })()}
              </div>

              <WorkflowStats stats={workflowStats} isRunning={isRunning} currentStepIndex={currentStepIndex} />
            </div>

            {/* Full-width Pricing display for selected provider */}
            {selectedModel && (
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                {(() => {
                  // Find pricing data for the selected provider
                  const providerPricing = modelPricing[selectedModel];
                  if (!providerPricing || typeof providerPricing !== 'object') {
                    return selectedModel === 'ollama' ? (
                      <div className="flex items-center gap-2">
                        <DollarSign className="w-4 h-4 text-green-600" />
                        <span className="text-sm font-medium text-green-700">Free (local model)</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <DollarSign className="w-4 h-4 text-gray-500" />
                        <span className="text-sm text-gray-600">Pricing not available</span>
                      </div>
                    );
                  }

                  return (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <DollarSign className="w-4 h-4 text-blue-600" />
                        <span className="text-sm font-semibold text-blue-800">Pricing (per 1M tokens)</span>
                      </div>
                      <div className="grid gap-2">
                        {Object.entries(providerPricing).map(([model, pricing]) => {
                          if (
                            typeof pricing !== 'object' ||
                            !pricing ||
                            !('input' in pricing) ||
                            !('output' in pricing)
                          ) {
                            return (
                              <div
                                key={model}
                                className="flex items-center justify-between p-2 bg-white rounded border"
                              >
                                <span className="text-sm font-medium text-gray-700">{model}</span>
                                <Badge variant="secondary" className="bg-green-100 text-green-700 border-green-200">
                                  Free
                                </Badge>
                              </div>
                            );
                          }
                          const modelPricingData = pricing as ModelPricing;
                          return (
                            <div key={model} className="flex items-center justify-between p-2 bg-white rounded border">
                              <span className="text-sm font-medium text-gray-700">{model}</span>
                              <div className="flex items-center gap-3 text-xs">
                                <div className="flex items-center gap-1">
                                  <span className="text-gray-500">Input:</span>
                                  <span className="font-mono font-medium text-gray-800">
                                    ${modelPricingData.input.toFixed(3)}
                                  </span>
                                </div>
                                <div className="w-px h-4 bg-gray-300"></div>
                                <div className="flex items-center gap-1">
                                  <span className="text-gray-500">Output:</span>
                                  <span className="font-mono font-medium text-gray-800">
                                    ${modelPricingData.output.toFixed(3)}
                                  </span>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        </CardHeader>

        {steps.length > 0 && (
          <CardContent className="space-y-4">
            {steps.map((step, index) => (
              <WorkflowStep
                key={step.id}
                step={step}
                index={index}
                stepTypes={stepTypes}
                currentStepIndex={currentStepIndex}
                totalSteps={steps.length}
                isRunning={isRunning}
                onStepUpdate={updateStep}
                onStepMove={moveStep}
                onStepRemove={removeStep}
                getStepIcon={getStepIcon}
                getStatusColor={getStatusColor}
              />
            ))}
          </CardContent>
        )}
      </Card>
    </div>
  );
}
