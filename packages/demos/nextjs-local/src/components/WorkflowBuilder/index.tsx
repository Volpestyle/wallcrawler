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
  const [selectedProvider, setSelectedProvider] = useState<string>('');
  const [selectedModel, setSelectedModel] = useState<ModelInfo | null>(null);
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([]);
  const [modelPricing, setModelPricing] = useState<Record<string, ProviderPricing>>({});
  const [pricingStatus, setPricingStatus] = useState<PricingResponse | null>(null);
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
          
          // Auto-select first provider and its first model
          const providers = [...new Set(modelsData.models.map((m: ModelInfo) => m.provider))];
          if (providers.length > 0) {
            const firstProvider = providers[0] as string;
            setSelectedProvider(firstProvider);
            
            const firstProviderModels = modelsData.models.filter((m: ModelInfo) => m.provider === firstProvider);
            if (firstProviderModels.length > 0) {
              setSelectedModel(firstProviderModels[0]);
            }
          }
        }

        // Load real-time pricing
        try {
          const pricingResponse = await fetch('/api/pricing');
          const pricingData: PricingResponse = await pricingResponse.json();

          // Store the full pricing response for status display
          setPricingStatus(pricingData);

          if (pricingData.available === true) {
            // Extract only the provider pricing data (for backward compatibility)
            const { available, note, reason, lastFetched, sources, modelsCount, models, ...providerPricing } =
              pricingData;
            setModelPricing(providerPricing);
          } else {
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
    return selectedModel;
  };

  // Calculate cost for a step using the selected model
  const calculateStepCost = (tokens: { prompt_tokens: number; completion_tokens: number }, modelId: string): number => {
    const model = availableModels.find((m) => m.id === modelId) || selectedModel;
    if (!model || !model.pricing) return 0;

    const inputCost = (tokens.prompt_tokens / 1000000) * model.pricing.input;
    const outputCost = (tokens.completion_tokens / 1000000) * model.pricing.output;
    return inputCost + outputCost;
  };

  // Get available providers
  const getAvailableProviders = (): Array<{ value: string; label: string; count: number; hasApiKey: boolean }> => {
    const providers = new Map<string, { count: number; hasApiKey: boolean }>();
    
    availableModels.forEach(model => {
      const existing = providers.get(model.provider) || { count: 0, hasApiKey: false };
      providers.set(model.provider, {
        count: existing.count + 1,
        hasApiKey: existing.hasApiKey || model.apiKeyStatus === 'configured'
      });
    });
    
    return Array.from(providers.entries()).map(([provider, info]) => ({
      value: provider,
      label: provider.charAt(0).toUpperCase() + provider.slice(1),
      count: info.count,
      hasApiKey: info.hasApiKey
    }));
  };

  // Get models for selected provider
  const getModelsForProvider = (provider: string): ModelInfo[] => {
    return availableModels.filter(model => model.provider === provider);
  };

  // Handle provider selection
  const handleProviderChange = (provider: string) => {
    setSelectedProvider(provider);
    setSelectedModel(null); // Reset model when provider changes
    
    // Auto-select first available model for the provider
    const providerModels = getModelsForProvider(provider);
    if (providerModels.length > 0) {
      setSelectedModel(providerModels[0]);
    }
  };

  // Handle model selection
  const handleModelChange = (modelId: string) => {
    const model = availableModels.find(m => m.id === modelId);
    if (model) {
      setSelectedModel(model);
    }
  };

  const generateStepId = () => `step_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  const addStep = (type: WorkflowStepType['type'] = 'navigate') => {
    const newStep: WorkflowStepType = {
      id: generateStepId(),
      type,
      title: `${stepTypes.find((t) => t.value === type)?.label} Step`,
      config: {},
      status: 'pending' as const,
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
    const newSteps = preset.steps.map((step) => ({
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
          status: 'pending' as const,
          result: undefined,
          error: undefined,
        }))
      );

      for (let i = 0; i < steps.length; i++) {
        setCurrentStepIndex(i);
        const step = steps[i];

        // Update step status to running
        setSteps((prevSteps) => prevSteps.map((s, index) => (index === i ? { ...s, status: 'running' as const } : s)));

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
              model: selectedModel?.id || 'openai/gpt-4o', // Use model ID
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
          let stepTokens: WorkflowStepType['tokens'] | undefined = undefined;

          // Check for usage data in the API response (now at top level)
          if (result.usage) {
            const usage = result.usage;
            if (usage.prompt_tokens !== undefined && usage.completion_tokens !== undefined) {
              const prompt_tokens = usage.prompt_tokens;
              const completion_tokens = usage.completion_tokens;
              const total_tokens = usage.total_tokens || prompt_tokens + completion_tokens;
              const cost = calculateStepCost({ prompt_tokens, completion_tokens }, selectedModel?.id || '');

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
                    status: 'completed' as const,
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
                    status: 'error' as const,
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
        status: 'pending' as const,
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
                    <Button
                      onClick={runWorkflow}
                      size="sm"
                      disabled={steps.length === 0 || selectedModel?.apiKeyStatus === 'missing'}
                    >
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
            {/* Model Selection Row */}
            <div className="flex items-center gap-4">
              {/* Provider Selection */}
              <div className="flex items-center gap-2">
                <Label htmlFor="provider-select">Provider:</Label>
                <Select
                  value={selectedProvider}
                  onValueChange={handleProviderChange}
                  disabled={isRunning || availableModels.length === 0}
                >
                  <SelectTrigger className="w-40" id="provider-select">
                    <SelectValue
                      placeholder={availableModels.length === 0 ? 'No providers' : 'Select provider'}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {getAvailableProviders().map((provider) => (
                      <SelectItem key={provider.value} value={provider.value}>
                        <div className="flex items-center gap-2">
                          <div
                            className={cn(
                              'w-2 h-2 rounded-full',
                              provider.value === 'ollama'
                                ? 'bg-blue-500'
                                : provider.value === 'openai'
                                  ? 'bg-green-500'
                                  : provider.value === 'anthropic'
                                    ? 'bg-orange-500'
                                    : 'bg-purple-500'
                            )}
                          ></div>
                          <span>{provider.label}</span>
                          <Badge variant="secondary" className="text-xs ml-1">
                            {provider.count}
                          </Badge>
                          {!provider.hasApiKey && provider.value !== 'ollama' && (
                            <Badge variant="destructive" className="text-[8px] px-1 py-0 ml-1 h-4">
                              !
                            </Badge>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Model Selection - only show if provider is selected */}
              {selectedProvider && (
                <div className="flex items-center gap-2">
                  <Label htmlFor="model-select">Model:</Label>
                  <Select
                    value={selectedModel?.id || ''}
                    onValueChange={handleModelChange}
                    disabled={isRunning || getModelsForProvider(selectedProvider).length === 0}
                  >
                    <SelectTrigger className="w-60" id="model-select">
                      <SelectValue
                        placeholder={getModelsForProvider(selectedProvider).length === 0 ? 'No models' : 'Select model'}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {getModelsForProvider(selectedProvider).map((model) => (
                        <SelectItem key={model.id} value={model.id}>
                          <div className="flex items-center gap-2">
                            <span className="truncate">{model.displayName}</span>
                            {model.type === 'local' && (
                              <Badge variant="secondary" className="text-xs ml-1">
                                FREE
                              </Badge>
                            )}
                            {model.apiKeyStatus === 'missing' && (
                              <Badge variant="destructive" className="text-[8px] px-1 py-0 ml-1 h-4">
                                !
                              </Badge>
                            )}
                            {model.pricing && (
                              <span className="text-xs text-gray-500 ml-1 truncate">
                                ${model.pricing.input.toFixed(3)}/${model.pricing.output.toFixed(3)}
                              </span>
                            )}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Display current model info */}
              {selectedModel && (
                <div className="flex items-center gap-2 px-3 py-1 bg-gray-100 rounded-md">
                  <span className="text-xs text-gray-500">Model:</span>
                  <code className="text-xs font-mono text-gray-700 bg-white px-2 py-1 rounded">
                    {selectedModel.name}
                  </code>
                  {selectedModel.pricing && (
                    <span className="text-xs text-gray-500">
                      (${selectedModel.pricing.input.toFixed(3)} in / ${selectedModel.pricing.output.toFixed(3)} out per
                      1M)
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Usage Stats Row */}
            <div className="flex justify-center">
              <WorkflowStats stats={workflowStats} isRunning={isRunning} currentStepIndex={currentStepIndex} />
            </div>

            {/* API Key Missing Alert */}
            {selectedModel && selectedModel.apiKeyStatus === 'missing' && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 bg-red-500 rounded-full flex items-center justify-center">
                    <span className="text-white text-xs font-bold">!</span>
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-red-800">API Key Required</div>
                    <div className="text-xs text-red-600">
                      Add <code className="bg-red-100 px-1 rounded">{selectedModel.provider.toUpperCase()}_API_KEY</code> to your .env.local file to use this model
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Selected Model Pricing Display */}
            {selectedModel && (
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <DollarSign className="w-4 h-4 text-blue-600" />
                    <span className="text-sm font-semibold text-blue-800">{selectedModel.displayName}</span>
                    {selectedModel.type === 'local' && (
                      <Badge variant="secondary" className="bg-green-100 text-green-700 border-green-200">
                        FREE
                      </Badge>
                    )}
                  </div>
                  {selectedModel.pricing && (
                    <div className="flex items-center gap-3 text-xs">
                      <div className="flex items-center gap-1">
                        <span className="text-gray-500">Input:</span>
                        <span className="font-mono font-medium text-gray-800">
                          ${selectedModel.pricing.input.toFixed(6)}/1M
                        </span>
                      </div>
                      <div className="w-px h-4 bg-gray-300"></div>
                      <div className="flex items-center gap-1">
                        <span className="text-gray-500">Output:</span>
                        <span className="font-mono font-medium text-gray-800">
                          ${selectedModel.pricing.output.toFixed(6)}/1M
                        </span>
                      </div>
                    </div>
                  )}
                </div>
                {selectedModel.note && <div className="mt-2 text-xs text-gray-600">{selectedModel.note}</div>}
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
