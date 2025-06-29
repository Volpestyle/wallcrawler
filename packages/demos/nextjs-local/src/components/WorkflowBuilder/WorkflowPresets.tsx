'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { WorkflowPreset } from './types';

interface WorkflowPresetsProps {
  presets: WorkflowPreset[];
  onPresetLoad: (preset: WorkflowPreset) => void;
}

export function WorkflowPresets({ presets, onPresetLoad }: WorkflowPresetsProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Workflow Presets</CardTitle>
        <CardDescription>Start with a pre-built workflow or create your own from scratch</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {presets.map((preset, index) => (
            <Card
              key={index}
              className="cursor-pointer hover:bg-gray-50 transition-colors"
              onClick={() => onPresetLoad(preset)}
            >
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">{preset.name}</CardTitle>
                <CardDescription className="text-xs">{preset.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-xs text-gray-500">{preset.steps.length} steps</div>
              </CardContent>
            </Card>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
