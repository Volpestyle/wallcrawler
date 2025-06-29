'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import {
  Trash2,
  Plus,
  Play,
  Square,
  Camera,
  FileText,
  MousePointer,
  Eye,
  Database,
  MoveUp,
  MoveDown,
  DollarSign,
  Zap,
  Clock,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface WorkflowStep {
  id: string;
  type: 'navigate' | 'act' | 'observe' | 'extract' | 'agent';
  title: string;
  config: {
    url?: string;
    instruction?: string;
    schema?: string;
    waitTime?: number;
  };
  result?: any;
  status: 'pending' | 'running' | 'completed' | 'error';
  error?: string;
  // Token usage tracking
  tokens?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    inference_time_ms?: number;
    cost?: number;
  };
}

interface ModelInfo {
  provider: string;
  displayName: string;
  input: number;
  output: number;
  available: boolean;
}

interface WorkflowStats {
  totalTokens: number;
  totalCost: number;
  totalInferenceTime: number;
  stepCosts: number[];
}

const stepTypes = [
  {
    value: 'navigate',
    label: 'Navigate',
    icon: <MousePointer className="w-4 h-4" />,
    description: 'Go to a URL',
    cost: 'Free',
  },
  {
    value: 'act',
    label: 'Act',
    icon: <Play className="w-4 h-4" />,
    description: 'Perform an action (DOM-based)',
    cost: 'Low',
  },
  {
    value: 'observe',
    label: 'Observe',
    icon: <Eye className="w-4 h-4" />,
    description: 'Find elements (DOM-based)',
    cost: 'Low',
  },
  {
    value: 'extract',
    label: 'Extract',
    icon: <Database className="w-4 h-4" />,
    description: 'Extract data (DOM-based)',
    cost: 'Low',
  },
  {
    value: 'agent',
    label: 'Agent',
    icon: <FileText className="w-4 h-4" />,
    description: 'AI-driven multi-step (Screenshot-based)',
    cost: 'High',
  },
];

const presets = [
  {
    name: 'Simple Search',
    description: 'Navigate to Google and perform a search',
    steps: [
      {
        type: 'navigate',
        title: 'Go to Google',
        config: { url: 'https://google.com' },
      },
      {
        type: 'act',
        title: 'Search for something',
        config: {
          instruction: 'Search for "web scraping tools" and press Enter',
        },
      },
      {
        type: 'extract',
        title: 'Extract search results',
        config: {
          instruction: 'Extract the first 5 search results',
          schema:
            '{"results": [{"title": "string", "url": "string", "description": "string"}]}',
        },
      },
    ],
  },
  {
    name: 'E-commerce Flow',
    description: 'Search for a product and add to cart',
    steps: [
      {
        type: 'navigate',
        title: 'Go to Amazon',
        config: { url: 'https://amazon.com' },
      },
      {
        type: 'act',
        title: 'Search for product',
        config: { instruction: 'Search for "wireless headphones"' },
      },
      {
        type: 'observe',
        title: 'Find product listings',
        config: { instruction: 'Find all product cards on the page' },
      },
      {
        type: 'act',
        title: 'Click first product',
        config: {
          instruction: 'Click on the first product in the search results',
        },
      },
      {
        type: 'extract',
        title: 'Extract product details',
        config: {
          instruction: 'Extract product information',
          schema:
            '{"name": "string", "price": "string", "rating": "string", "availability": "string"}',
        },
      },
    ],
  },
  {
    name: 'Form Automation',
    description: 'Fill out a contact form',
    steps: [
      {
        type: 'navigate',
        title: 'Go to demo form',
        config: { url: 'https://httpbin.org/forms/post' },
      },
      {
        type: 'observe',
        title: 'Find form fields',
        config: { instruction: 'Find all form input fields' },
      },
      {
        type: 'act',
        title: 'Fill out form',
        config: {
          instruction:
            'Fill out the form with: name "John Doe", email "john@example.com", comments "This is a test"',
        },
      },
      {
        type: 'act',
        title: 'Submit form',
        config: { instruction: 'Click the submit button' },
      },
    ],
  },
];

export default function WorkflowBuilder() {
  const [steps, setSteps] = useState<WorkflowStep[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(-1);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState('');
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([]);
  const [modelPricing, setModelPricing] = useState<
    Record<string, { input: number; output: number }>
  >({});
  const [workflowStats, setWorkflowStats] = useState<WorkflowStats>({
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
          const pricingData = await pricingResponse.json();

          if (pricingData.available !== false) {
            setModelPricing(pricingData);
          } else {
            console.warn('Real-time pricing unavailable:', pricingData.note);
            // Set empty pricing to hide cost calculations
            setModelPricing({});
          }
        } catch (pricingError) {
          console.warn(
            'Failed to load pricing, costs will not be displayed:',
            pricingError
          );
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
    const totalTokens = steps.reduce(
      (sum, step) => sum + (step.tokens?.total_tokens || 0),
      0
    );
    const totalCost = steps.reduce(
      (sum, step) => sum + (step.tokens?.cost || 0),
      0
    );
    const totalInferenceTime = steps.reduce(
      (sum, step) => sum + (step.tokens?.inference_time_ms || 0),
      0
    );
    const stepCosts = steps.map((step) => step.tokens?.cost || 0);

    setWorkflowStats({ totalTokens, totalCost, totalInferenceTime, stepCosts });
  }, [steps]);

  // Calculate cost for a step using real-time pricing
  const calculateStepCost = (
    tokens: { prompt_tokens: number; completion_tokens: number },
    provider: string
  ): number => {
    const pricing = modelPricing[provider];
    if (!pricing || (pricing.input === 0 && pricing.output === 0)) {
      return 0; // Free for local models
    }

    const inputCost = (tokens.prompt_tokens / 1_000_000) * pricing.input;
    const outputCost = (tokens.completion_tokens / 1_000_000) * pricing.output;
    return inputCost + outputCost;
  };

  const generateStepId = () =>
    `step_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  const addStep = (type: WorkflowStep['type'] = 'navigate') => {
    const newStep: WorkflowStep = {
      id: generateStepId(),
      type,
      title: `${stepTypes.find((t) => t.value === type)?.label} Step`,
      config: {},
      status: 'pending',
    };
    setSteps([...steps, newStep]);
  };

  const updateStep = (stepId: string, updates: Partial<WorkflowStep>) => {
    setSteps(
      steps.map((step) => (step.id === stepId ? { ...step, ...updates } : step))
    );
  };

  const removeStep = (stepId: string) => {
    setSteps(steps.filter((step) => step.id !== stepId));
  };

  const moveStep = (stepId: string, direction: 'up' | 'down') => {
    const currentIndex = steps.findIndex((step) => step.id === stepId);
    if (
      (direction === 'up' && currentIndex === 0) ||
      (direction === 'down' && currentIndex === steps.length - 1)
    ) {
      return;
    }

    const newSteps = [...steps];
    const targetIndex =
      direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    [newSteps[currentIndex], newSteps[targetIndex]] = [
      newSteps[targetIndex],
      newSteps[currentIndex],
    ];
    setSteps(newSteps);
  };

  const loadPreset = (preset: (typeof presets)[0]) => {
    const newSteps = preset.steps.map((step, index) => ({
      id: generateStepId(),
      type: step.type as WorkflowStep['type'],
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
        setSteps((prevSteps) =>
          prevSteps.map((s, index) =>
            index === i ? { ...s, status: 'running' } : s
          )
        );

        try {
          // Use workflowSessionId for this step, will be null for first step
          const currentSessionId: string | null = workflowSessionId;

          console.log(
            `[DEBUG] Step ${i + 1}: Using sessionId: ${currentSessionId || 'null'}`
          );

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

          const result: any = await response.json();

          if (!response.ok) {
            throw new Error(result.error || 'Request failed');
          }

          // Store session ID from first step for subsequent steps
          if (i === 0 && result.sessionId) {
            console.log(
              `[DEBUG] Storing session ID for future steps: ${result.sessionId}`
            );
            workflowSessionId = result.sessionId;
            setSessionId(result.sessionId);
          }

          // Calculate tokens and cost for this step
          let stepTokens = undefined;

          // Check for usage data in the API response (now at top level)
          if (result.usage) {
            const usage = result.usage;
            if (
              usage.prompt_tokens !== undefined &&
              usage.completion_tokens !== undefined
            ) {
              const prompt_tokens = usage.prompt_tokens;
              const completion_tokens = usage.completion_tokens;
              const total_tokens =
                usage.total_tokens || prompt_tokens + completion_tokens;
              const cost = calculateStepCost(
                { prompt_tokens, completion_tokens },
                selectedModel
              );

              stepTokens = {
                prompt_tokens,
                completion_tokens,
                total_tokens,
                inference_time_ms: usage.inference_time_ms || 0,
                cost,
              };
              console.log(
                `[DEBUG] Step ${i + 1} tokens extracted:`,
                stepTokens
              );
            }
          }

          // Update step with result and token usage
          setSteps((prevSteps) =>
            prevSteps.map((s, index) =>
              index === i
                ? {
                    ...s,
                    status: 'completed',
                    result: result.result,
                    tokens: stepTokens,
                  }
                : s
            )
          );

          // Small delay between steps
          if (i < steps.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : 'Unknown error';

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
          console.log(
            `[DEBUG] Session ${workflowSessionId} cleaned up successfully`
          );
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
        console.log(
          `[DEBUG] Stopping workflow, cleaning up session: ${sessionId}`
        );
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

  const getStepIcon = (type: WorkflowStep['type']) => {
    return (
      stepTypes.find((t) => t.value === type)?.icon || (
        <MousePointer className="w-4 h-4" />
      )
    );
  };

  const getStatusColor = (status: WorkflowStep['status']) => {
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
      <Card>
        <CardHeader>
          <CardTitle>Workflow Presets</CardTitle>
          <CardDescription>
            Start with a pre-built workflow or create your own from scratch
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {presets.map((preset, index) => (
              <Card
                key={index}
                className="cursor-pointer hover:bg-gray-50 transition-colors"
                onClick={() => loadPreset(preset)}
              >
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">{preset.name}</CardTitle>
                  <CardDescription className="text-xs">
                    {preset.description}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-xs text-gray-500">
                    {preset.steps.length} steps
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Workflow Builder */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            Workflow Steps
            <div className="flex gap-2">
              <Button
                onClick={() => addStep()}
                size="sm"
                variant="outline"
                disabled={isRunning}
              >
                <Plus className="w-4 h-4 mr-1" />
                Add Step
              </Button>
              {steps.length > 0 && (
                <>
                  <Button
                    onClick={resetWorkflow}
                    size="sm"
                    variant="outline"
                    disabled={isRunning}
                  >
                    Reset
                  </Button>
                  {sessionId && !isRunning && (
                    <Button
                      onClick={async () => {
                        try {
                          console.log(
                            `[DEBUG] Manually closing session: ${sessionId}`
                          );
                          await fetch(
                            `/api/wallcrawler?sessionId=${sessionId}`,
                            {
                              method: 'DELETE',
                            }
                          );
                          console.log(
                            `[DEBUG] Session ${sessionId} manually closed`
                          );
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
                    <Button
                      onClick={stopWorkflow}
                      size="sm"
                      variant="destructive"
                    >
                      <Square className="w-4 h-4 mr-1" />
                      Stop
                    </Button>
                  ) : (
                    <Button
                      onClick={runWorkflow}
                      size="sm"
                      disabled={steps.length === 0}
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
          <div className="flex items-center justify-between mt-4">
            <div className="flex items-center gap-4">
              <Label htmlFor="model-select">LLM Provider:</Label>
              <Select
                value={selectedModel}
                onValueChange={setSelectedModel}
                disabled={isRunning || availableModels.length === 0}
              >
                <SelectTrigger className="w-64">
                  <SelectValue
                    placeholder={
                      availableModels.length === 0
                        ? 'No models configured'
                        : 'Select a model'
                    }
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
            </div>

            {/* Workflow Statistics */}
            {(workflowStats.totalTokens > 0 ||
              workflowStats.totalCost > 0 ||
              workflowStats.totalInferenceTime > 0) && (
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2 text-sm">
                  <Zap className="w-4 h-4 text-blue-500" />
                  <span className="font-medium">
                    {workflowStats.totalTokens.toLocaleString()}
                  </span>
                  <span className="text-gray-500">tokens</span>
                </div>
                {workflowStats.totalInferenceTime > 0 && (
                  <div className="flex items-center gap-2 text-sm">
                    <Clock className="w-4 h-4 text-purple-500" />
                    <span className="font-medium">
                      {(workflowStats.totalInferenceTime / 1000).toFixed(1)}s
                    </span>
                    <span className="text-gray-500">inference</span>
                  </div>
                )}
                {workflowStats.totalCost > 0 && (
                  <div className="flex items-center gap-2 text-sm">
                    <DollarSign className="w-4 h-4 text-green-500" />
                    <span className="font-medium">
                      ${workflowStats.totalCost.toFixed(4)}
                    </span>
                    <span className="text-gray-500">estimated</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </CardHeader>

        {steps.length > 0 && (
          <CardContent className="space-y-4">
            {steps.map((step, index) => (
              <Card
                key={step.id}
                className={cn(
                  'border',
                  currentStepIndex === index && 'ring-2 ring-blue-500',
                  step.status === 'error' && 'border-red-200',
                  step.status === 'completed' && 'border-green-200'
                )}
              >
                <CardHeader className="pb-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className={cn(
                          'p-2 rounded-md',
                          getStatusColor(step.status)
                        )}
                      >
                        {getStepIcon(step.type)}
                      </div>
                      <div>
                        <Input
                          value={step.title}
                          onChange={(e) =>
                            updateStep(step.id, { title: e.target.value })
                          }
                          className="font-medium border-none p-0 h-auto bg-transparent"
                          disabled={isRunning}
                        />
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant="outline" className="text-xs">
                            Step {index + 1}
                          </Badge>
                          <Badge
                            variant="secondary"
                            className="text-xs capitalize"
                          >
                            {step.status}
                          </Badge>
                          {step.tokens && (
                            <>
                              <Badge
                                variant="outline"
                                className="text-xs"
                                title={`Prompt: ${step.tokens.prompt_tokens.toLocaleString()} | Completion: ${step.tokens.completion_tokens.toLocaleString()} | Total: ${step.tokens.total_tokens.toLocaleString()}`}
                              >
                                <Zap className="w-3 h-3 mr-1" />
                                {step.tokens.prompt_tokens.toLocaleString()}{' '}
                                prompt +{' '}
                                {step.tokens.completion_tokens.toLocaleString()}{' '}
                                completion
                              </Badge>
                              {step.tokens.inference_time_ms &&
                                step.tokens.inference_time_ms > 0 && (
                                  <Badge
                                    variant="outline"
                                    className="text-xs"
                                    title={`Inference time: ${step.tokens.inference_time_ms}ms`}
                                  >
                                    <Clock className="w-3 h-3 mr-1" />
                                    {step.tokens.inference_time_ms}ms
                                  </Badge>
                                )}
                              {!!step.tokens.cost && (
                                <Badge variant="outline" className="text-xs">
                                  <DollarSign className="w-3 h-3 mr-1" />$
                                  {step.tokens.cost.toFixed(4)}
                                </Badge>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1">
                      <Button
                        onClick={() => moveStep(step.id, 'up')}
                        size="sm"
                        variant="ghost"
                        disabled={isRunning || index === 0}
                      >
                        <MoveUp className="w-4 h-4" />
                      </Button>
                      <Button
                        onClick={() => moveStep(step.id, 'down')}
                        size="sm"
                        variant="ghost"
                        disabled={isRunning || index === steps.length - 1}
                      >
                        <MoveDown className="w-4 h-4" />
                      </Button>
                      <Button
                        onClick={() => removeStep(step.id)}
                        size="sm"
                        variant="ghost"
                        disabled={isRunning}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div>
                      <Label htmlFor={`type-${step.id}`}>Step Type</Label>
                      <Select
                        value={step.type}
                        onValueChange={(value) =>
                          updateStep(step.id, {
                            type: value as WorkflowStep['type'],
                          })
                        }
                        disabled={isRunning}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {stepTypes.map((type) => (
                            <SelectItem key={type.value} value={type.value}>
                              <div className="flex items-center justify-between w-full">
                                <div className="flex items-center gap-2">
                                  {type.icon}
                                  <div className="flex flex-col">
                                    <span>{type.label}</span>
                                    <span className="text-xs text-gray-500 whitespace-nowrap overflow-hidden text-ellipsis max-w-32">
                                      {type.description}
                                    </span>
                                  </div>
                                </div>
                                <Badge
                                  variant={
                                    type.cost === 'High'
                                      ? 'destructive'
                                      : type.cost === 'Low'
                                        ? 'default'
                                        : 'secondary'
                                  }
                                  className="text-xs ml-2"
                                >
                                  {type.cost}
                                </Badge>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {step.type === 'navigate' && (
                      <div className="md:col-span-3">
                        <Label htmlFor={`url-${step.id}`}>URL</Label>
                        <Input
                          id={`url-${step.id}`}
                          value={step.config.url || ''}
                          onChange={(e) =>
                            updateStep(step.id, {
                              config: { ...step.config, url: e.target.value },
                            })
                          }
                          placeholder="https://example.com"
                          disabled={isRunning}
                        />
                      </div>
                    )}

                    {(step.type === 'act' ||
                      step.type === 'observe' ||
                      step.type === 'agent') && (
                      <div className="md:col-span-3">
                        <Label htmlFor={`instruction-${step.id}`}>
                          Instruction
                        </Label>
                        <Textarea
                          id={`instruction-${step.id}`}
                          value={step.config.instruction || ''}
                          onChange={(e) =>
                            updateStep(step.id, {
                              config: {
                                ...step.config,
                                instruction: e.target.value,
                              },
                            })
                          }
                          placeholder="Describe what you want to do..."
                          disabled={isRunning}
                          rows={2}
                        />
                      </div>
                    )}

                    {step.type === 'extract' && (
                      <>
                        <div className="md:col-span-2">
                          <Label htmlFor={`instruction-${step.id}`}>
                            Instruction
                          </Label>
                          <Textarea
                            id={`instruction-${step.id}`}
                            value={step.config.instruction || ''}
                            onChange={(e) =>
                              updateStep(step.id, {
                                config: {
                                  ...step.config,
                                  instruction: e.target.value,
                                },
                              })
                            }
                            placeholder="What data to extract..."
                            disabled={isRunning}
                            rows={2}
                          />
                        </div>
                        <div className="md:col-span-1">
                          <Label htmlFor={`schema-${step.id}`}>
                            Schema (JSON)
                          </Label>
                          <Textarea
                            id={`schema-${step.id}`}
                            value={step.config.schema || ''}
                            onChange={(e) =>
                              updateStep(step.id, {
                                config: {
                                  ...step.config,
                                  schema: e.target.value,
                                },
                              })
                            }
                            placeholder='{"key": "type"}'
                            disabled={isRunning}
                            rows={2}
                          />
                        </div>
                      </>
                    )}
                  </div>

                  {/* Step Result */}
                  {step.result && (
                    <div>
                      <Label>Result</Label>
                      <pre className="bg-gray-50 p-3 rounded-md text-sm overflow-auto max-h-32">
                        {JSON.stringify(step.result, null, 2)}
                      </pre>
                    </div>
                  )}

                  {/* Step Error */}
                  {step.error && (
                    <div>
                      <Label className="text-red-600">Error</Label>
                      <div className="bg-red-50 border border-red-200 p-3 rounded-md text-sm text-red-700">
                        {step.error}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </CardContent>
        )}
      </Card>
    </div>
  );
}
