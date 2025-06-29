'use client';

import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { DollarSign } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ModelInfo, ProviderPricing, ModelPricing } from './types';

interface ModelSelectorProps {
  selectedModel: string;
  availableModels: ModelInfo[];
  modelPricing: Record<string, ProviderPricing>;
  isRunning: boolean;
  onModelChange: (model: string) => void;
}

export function ModelSelector({
  selectedModel,
  availableModels,
  modelPricing,
  isRunning,
  onModelChange,
}: ModelSelectorProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <Label htmlFor="model-select">LLM Provider:</Label>
        <Select
          value={selectedModel}
          onValueChange={onModelChange}
          disabled={isRunning || availableModels.length === 0}
        >
          <SelectTrigger className="w-64">
            <SelectValue placeholder={availableModels.length === 0 ? 'No models configured' : 'Select a model'} />
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

      {/* Minimal Pricing display for selected provider */}
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
                    if (typeof pricing !== 'object' || !pricing || !('input' in pricing) || !('output' in pricing)) {
                      return (
                        <div key={model} className="flex items-center justify-between p-2 bg-white rounded border">
                          <span className="text-sm font-medium text-gray-700">{model}</span>
                          <Badge variant="secondary" className="bg-green-100 text-green-700 border-green-200">
                            Free
                          </Badge>
                        </div>
                      );
                    }
                    const modelPricing = pricing as ModelPricing;
                    return (
                      <div key={model} className="flex items-center justify-between p-2 bg-white rounded border">
                        <span className="text-sm font-medium text-gray-700">{model}</span>
                        <div className="flex items-center gap-3 text-xs">
                          <div className="flex items-center gap-1">
                            <span className="text-gray-500">Input:</span>
                            <span className="font-mono font-medium text-gray-800">
                              ${modelPricing.input.toFixed(3)}
                            </span>
                          </div>
                          <div className="w-px h-4 bg-gray-300"></div>
                          <div className="flex items-center gap-1">
                            <span className="text-gray-500">Output:</span>
                            <span className="font-mono font-medium text-gray-800">
                              ${modelPricing.output.toFixed(3)}
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
  );
}
