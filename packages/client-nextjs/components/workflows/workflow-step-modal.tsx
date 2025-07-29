'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Globe,
  MousePointer,
  Database,
  Camera,
  Clock,
  GitBranch,
  AlertCircle,
  ChevronRight,
} from 'lucide-react';
import { WorkflowStep, WorkflowStepType } from '@/lib/types/stagehand';
import { cn } from '@/lib/utils';

interface WorkflowStepModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  step?: WorkflowStep | null;
  onSave: (step: WorkflowStep) => void;
}

const stepTypeConfig: Record<
  WorkflowStepType,
  {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    description: string;
    color: string;
  }
> = {
  navigate: {
    label: 'Navigate',
    icon: Globe,
    description: 'Navigate to a URL',
    color: 'text-blue-500',
  },
  interact: {
    label: 'Interact',
    icon: MousePointer,
    description: 'Click, type, or interact with elements',
    color: 'text-green-500',
  },
  extract: {
    label: 'Extract',
    icon: Database,
    description: 'Extract data from the page',
    color: 'text-purple-500',
  },
  screenshot: {
    label: 'Screenshot',
    icon: Camera,
    description: 'Capture a screenshot',
    color: 'text-orange-500',
  },
  wait: {
    label: 'Wait',
    icon: Clock,
    description: 'Wait for a condition or duration',
    color: 'text-yellow-500',
  },
  conditional: {
    label: 'Conditional',
    icon: GitBranch,
    description: 'Execute based on conditions',
    color: 'text-pink-500',
  },
};

export function WorkflowStepModal({
  open,
  onOpenChange,
  step,
  onSave,
}: WorkflowStepModalProps) {
  const [formData, setFormData] = useState<WorkflowStep>({
    id: '',
    type: 'navigate',
    name: '',
    description: '',
    config: {},
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (step) {
      setFormData(step);
    } else {
      setFormData({
        id: `step-${Date.now()}`,
        type: 'navigate',
        name: '',
        description: '',
        config: {},
      });
    }
    setErrors({});
  }, [step, open]);

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.name.trim()) {
      newErrors.name = 'Step name is required';
    }

    // Type-specific validation
    switch (formData.type) {
      case 'navigate':
        if (!formData.config.url) {
          newErrors.url = 'URL is required';
        } else {
          try {
            new URL(formData.config.url);
          } catch {
            newErrors.url = 'Invalid URL format';
          }
        }
        break;
      case 'interact':
        if (!formData.config.selector) {
          newErrors.selector = 'Element selector is required';
        }
        if (!formData.config.action) {
          newErrors.action = 'Action is required';
        }
        if (
          ['type', 'select'].includes(formData.config.action) &&
          !formData.config.value
        ) {
          newErrors.value = 'Value is required for this action';
        }
        break;
      case 'extract':
        if (!formData.config.extractType) {
          newErrors.extractType = 'Extraction type is required';
        }
        if (
          ['text', 'links', 'images', 'table'].includes(
            formData.config.extractType
          ) &&
          !formData.config.selector
        ) {
          newErrors.selector = 'Selector is required for this extraction type';
        }
        if (
          formData.config.extractType === 'json' &&
          !formData.config.jsonPath
        ) {
          newErrors.jsonPath = 'JSON path is required';
        }
        break;
      case 'wait':
        if (!formData.config.waitType) {
          newErrors.waitType = 'Wait type is required';
        }
        if (
          formData.config.waitType === 'duration' &&
          (!formData.config.duration || formData.config.duration <= 0)
        ) {
          newErrors.duration = 'Duration must be greater than 0';
        }
        if (
          formData.config.waitType === 'selector' &&
          !formData.config.selector
        ) {
          newErrors.selector = 'Selector is required';
        }
        break;
      case 'conditional':
        if (!formData.config.condition) {
          newErrors.condition = 'Condition is required';
        }
        break;
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = () => {
    if (validateForm()) {
      onSave(formData);
      onOpenChange(false);
    }
  };

  const updateConfig = (key: string, value: any) => {
    setFormData((prev) => ({
      ...prev,
      config: {
        ...prev.config,
        [key]: value,
      },
    }));
    // Clear error when field is updated
    if (errors[key]) {
      setErrors((prev) => ({ ...prev, [key]: '' }));
    }
  };

  const renderTypeSpecificFields = () => {
    switch (formData.type) {
      case 'navigate':
        return (
          <div className="space-y-4">
            <div>
              <Label htmlFor="url">URL</Label>
              <Input
                id="url"
                placeholder="https://example.com"
                value={formData.config.url || ''}
                onChange={(e) => updateConfig('url', e.target.value)}
                className={cn(errors.url && 'border-red-500')}
              />
              {errors.url && (
                <p className="text-sm text-red-500 mt-1">{errors.url}</p>
              )}
            </div>
            <div>
              <Label htmlFor="waitUntil">Wait Until</Label>
              <Select
                value={formData.config.waitUntil || 'load'}
                onValueChange={(value) => updateConfig('waitUntil', value)}
              >
                <SelectTrigger id="waitUntil">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="load">Load</SelectItem>
                  <SelectItem value="domcontentloaded">
                    DOM Content Loaded
                  </SelectItem>
                  <SelectItem value="networkidle0">Network Idle (0)</SelectItem>
                  <SelectItem value="networkidle2">Network Idle (2)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="timeout">Timeout (ms)</Label>
              <Input
                id="timeout"
                type="number"
                placeholder="30000"
                value={formData.config.timeout || ''}
                onChange={(e) =>
                  updateConfig('timeout', parseInt(e.target.value) || undefined)
                }
              />
            </div>
          </div>
        );

      case 'interact':
        return (
          <div className="space-y-4">
            <div>
              <Label htmlFor="selector">Element Selector</Label>
              <Input
                id="selector"
                placeholder="#submit-button, .form-input, [data-testid='submit']"
                value={formData.config.selector || ''}
                onChange={(e) => updateConfig('selector', e.target.value)}
                className={cn(errors.selector && 'border-red-500')}
              />
              {errors.selector && (
                <p className="text-sm text-red-500 mt-1">{errors.selector}</p>
              )}
            </div>
            <div>
              <Label htmlFor="action">Action</Label>
              <Select
                value={formData.config.action || ''}
                onValueChange={(value) => updateConfig('action', value)}
              >
                <SelectTrigger
                  id="action"
                  className={cn(errors.action && 'border-red-500')}
                >
                  <SelectValue placeholder="Select an action" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="click">Click</SelectItem>
                  <SelectItem value="type">Type</SelectItem>
                  <SelectItem value="select">Select</SelectItem>
                  <SelectItem value="hover">Hover</SelectItem>
                  <SelectItem value="clear">Clear</SelectItem>
                </SelectContent>
              </Select>
              {errors.action && (
                <p className="text-sm text-red-500 mt-1">{errors.action}</p>
              )}
            </div>
            {['type', 'select'].includes(formData.config.action) && (
              <div>
                <Label htmlFor="value">Value</Label>
                <Input
                  id="value"
                  placeholder={
                    formData.config.action === 'type'
                      ? 'Text to type'
                      : 'Option to select'
                  }
                  value={formData.config.value || ''}
                  onChange={(e) => updateConfig('value', e.target.value)}
                  className={cn(errors.value && 'border-red-500')}
                />
                {errors.value && (
                  <p className="text-sm text-red-500 mt-1">{errors.value}</p>
                )}
              </div>
            )}
          </div>
        );

      case 'extract':
        return (
          <div className="space-y-4">
            <div>
              <Label htmlFor="extractType">Extraction Type</Label>
              <Select
                value={formData.config.extractType || ''}
                onValueChange={(value) => updateConfig('extractType', value)}
              >
                <SelectTrigger
                  id="extractType"
                  className={cn(errors.extractType && 'border-red-500')}
                >
                  <SelectValue placeholder="Select extraction type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="text">Text</SelectItem>
                  <SelectItem value="links">Links</SelectItem>
                  <SelectItem value="images">Images</SelectItem>
                  <SelectItem value="table">Table</SelectItem>
                  <SelectItem value="json">JSON</SelectItem>
                </SelectContent>
              </Select>
              {errors.extractType && (
                <p className="text-sm text-red-500 mt-1">
                  {errors.extractType}
                </p>
              )}
            </div>
            {['text', 'links', 'images', 'table'].includes(
              formData.config.extractType
            ) && (
              <div>
                <Label htmlFor="extractSelector">Selector</Label>
                <Input
                  id="extractSelector"
                  placeholder=".content, #main-text, table.data"
                  value={formData.config.selector || ''}
                  onChange={(e) => updateConfig('selector', e.target.value)}
                  className={cn(errors.selector && 'border-red-500')}
                />
                {errors.selector && (
                  <p className="text-sm text-red-500 mt-1">
                    {errors.selector}
                  </p>
                )}
              </div>
            )}
            {formData.config.extractType === 'json' && (
              <div>
                <Label htmlFor="jsonPath">JSON Path</Label>
                <Input
                  id="jsonPath"
                  placeholder="$.data.items[*].name"
                  value={formData.config.jsonPath || ''}
                  onChange={(e) => updateConfig('jsonPath', e.target.value)}
                  className={cn(errors.jsonPath && 'border-red-500')}
                />
                {errors.jsonPath && (
                  <p className="text-sm text-red-500 mt-1">
                    {errors.jsonPath}
                  </p>
                )}
              </div>
            )}
          </div>
        );

      case 'screenshot':
        return (
          <div className="space-y-4">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="fullPage"
                checked={formData.config.fullPage || false}
                onCheckedChange={(checked) => updateConfig('fullPage', checked)}
              />
              <Label htmlFor="fullPage" className="cursor-pointer">Capture full page</Label>
            </div>
            {!formData.config.fullPage && (
              <div>
                <Label htmlFor="screenshotSelector">
                  Selector (optional)
                </Label>
                <Input
                  id="screenshotSelector"
                  placeholder="Capture specific element"
                  value={formData.config.selector || ''}
                  onChange={(e) => updateConfig('selector', e.target.value)}
                />
              </div>
            )}
            <div>
              <Label htmlFor="screenshotType">Format</Label>
              <Select
                value={formData.config.type || 'png'}
                onValueChange={(value) => updateConfig('type', value)}
              >
                <SelectTrigger id="screenshotType">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="png">PNG</SelectItem>
                  <SelectItem value="jpeg">JPEG</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {formData.config.type === 'jpeg' && (
              <div>
                <Label htmlFor="quality">Quality (0-100)</Label>
                <Input
                  id="quality"
                  type="number"
                  min="0"
                  max="100"
                  value={formData.config.quality || 80}
                  onChange={(e) =>
                    updateConfig('quality', parseInt(e.target.value))
                  }
                />
              </div>
            )}
          </div>
        );

      case 'wait':
        return (
          <div className="space-y-4">
            <div>
              <Label htmlFor="waitType">Wait Type</Label>
              <Select
                value={formData.config.waitType || ''}
                onValueChange={(value) => updateConfig('waitType', value)}
              >
                <SelectTrigger
                  id="waitType"
                  className={cn(errors.waitType && 'border-red-500')}
                >
                  <SelectValue placeholder="Select wait type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="duration">Duration</SelectItem>
                  <SelectItem value="selector">Element</SelectItem>
                  <SelectItem value="navigation">Navigation</SelectItem>
                </SelectContent>
              </Select>
              {errors.waitType && (
                <p className="text-sm text-red-500 mt-1">{errors.waitType}</p>
              )}
            </div>
            {formData.config.waitType === 'duration' && (
              <div>
                <Label htmlFor="duration">Duration (ms)</Label>
                <Input
                  id="duration"
                  type="number"
                  placeholder="1000"
                  value={formData.config.duration || ''}
                  onChange={(e) =>
                    updateConfig('duration', parseInt(e.target.value))
                  }
                  className={cn(errors.duration && 'border-red-500')}
                />
                {errors.duration && (
                  <p className="text-sm text-red-500 mt-1">
                    {errors.duration}
                  </p>
                )}
              </div>
            )}
            {formData.config.waitType === 'selector' && (
              <div>
                <Label htmlFor="waitSelector">Wait for Selector</Label>
                <Input
                  id="waitSelector"
                  placeholder="#loading-complete"
                  value={formData.config.selector || ''}
                  onChange={(e) => updateConfig('selector', e.target.value)}
                  className={cn(errors.selector && 'border-red-500')}
                />
                {errors.selector && (
                  <p className="text-sm text-red-500 mt-1">
                    {errors.selector}
                  </p>
                )}
              </div>
            )}
          </div>
        );

      case 'conditional':
        return (
          <div className="space-y-4">
            <div>
              <Label htmlFor="condition">Condition</Label>
              <Textarea
                id="condition"
                placeholder="e.g., elementExists('#success-message')"
                value={formData.config.condition || ''}
                onChange={(e) => updateConfig('condition', e.target.value)}
                className={cn(errors.condition && 'border-red-500')}
              />
              {errors.condition && (
                <p className="text-sm text-red-500 mt-1">
                  {errors.condition}
                </p>
              )}
            </div>
            <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
              <div className="flex gap-2">
                <AlertCircle className="h-4 w-4 text-yellow-600 dark:text-yellow-500 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-yellow-800 dark:text-yellow-200">
                  Conditional steps require JavaScript expressions that return
                  true or false.
                </p>
              </div>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {step ? 'Edit Workflow Step' : 'Create New Step'}
          </DialogTitle>
          <DialogDescription>
            Configure the step details and behavior for your workflow.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto py-4">
          <Tabs defaultValue="basic" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="basic">Basic Info</TabsTrigger>
              <TabsTrigger value="config">Configuration</TabsTrigger>
              <TabsTrigger value="preview">Preview</TabsTrigger>
            </TabsList>

            <TabsContent value="basic" className="space-y-4 mt-4">
              <div>
                <Label htmlFor="stepType">Step Type</Label>
                <Select
                  value={formData.type}
                  onValueChange={(value: WorkflowStepType) =>
                    setFormData((prev) => ({
                      ...prev,
                      type: value,
                      config: {}, // Reset config when type changes
                    }))
                  }
                  disabled={!!step} // Disable type change when editing
                >
                  <SelectTrigger id="stepType">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(stepTypeConfig).map(([type, config]) => {
                      const Icon = config.icon;
                      return (
                        <SelectItem key={type} value={type}>
                          <div className="flex items-center gap-2">
                            <Icon className={cn('h-4 w-4', config.color)} />
                            <span>{config.label}</span>
                          </div>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                <p className="text-sm text-text-secondary mt-1">
                  {stepTypeConfig[formData.type].description}
                </p>
              </div>

              <div>
                <Label htmlFor="name">Step Name</Label>
                <Input
                  id="name"
                  placeholder="Enter a descriptive name"
                  value={formData.name}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, name: e.target.value }))
                  }
                  className={cn(errors.name && 'border-red-500')}
                />
                {errors.name && (
                  <p className="text-sm text-red-500 mt-1">{errors.name}</p>
                )}
              </div>

              <div>
                <Label htmlFor="description">Description (optional)</Label>
                <Textarea
                  id="description"
                  placeholder="Describe what this step does"
                  value={formData.description || ''}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      description: e.target.value,
                    }))
                  }
                />
              </div>
            </TabsContent>

            <TabsContent value="config" className="mt-4">
              {renderTypeSpecificFields()}
            </TabsContent>

            <TabsContent value="preview" className="mt-4">
              <div className="space-y-4">
                <div className="p-4 border border-border rounded-lg bg-surface">
                  <div className="flex items-center gap-3 mb-3">
                    {(() => {
                      const Icon = stepTypeConfig[formData.type].icon;
                      return (
                        <Icon
                          className={cn(
                            'h-5 w-5',
                            stepTypeConfig[formData.type].color
                          )}
                        />
                      );
                    })()}
                    <h3 className="font-medium">
                      {formData.name || 'Unnamed Step'}
                    </h3>
                    <Badge variant="outline">
                      {stepTypeConfig[formData.type].label}
                    </Badge>
                  </div>
                  {formData.description && (
                    <p className="text-sm text-text-secondary mb-3">
                      {formData.description}
                    </p>
                  )}
                  <Separator className="my-3" />
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium">Configuration:</h4>
                    <div className="text-sm space-y-1">
                      {Object.entries(formData.config).map(([key, value]) => (
                        <div key={key} className="flex items-center gap-2">
                          <ChevronRight className="h-3 w-3 text-text-secondary" />
                          <span className="text-text-secondary">{key}:</span>
                          <span className="font-mono text-xs">
                            {typeof value === 'boolean'
                              ? value.toString()
                              : value}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                  <p className="text-sm text-blue-800 dark:text-blue-200">
                    This is how your step will appear in the workflow builder.
                  </p>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave}>
            {step ? 'Update Step' : 'Create Step'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}