'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Play } from 'lucide-react';

interface ActionFormProps {
  defaultValues?: {
    url?: string;
    command?: string;
    schema?: string;
  };
  onSubmit: (data: {
    url: string;
    command: string;
    schema?: string;
    model?: string;
  }) => void;
  isRunning: boolean;
  showSchema?: boolean;
}

export default function ActionForm({ 
  defaultValues, 
  onSubmit, 
  isRunning,
  showSchema = false 
}: ActionFormProps) {
  const [url, setUrl] = useState(defaultValues?.url || '');
  const [command, setCommand] = useState(defaultValues?.command || '');
  const [schema, setSchema] = useState(defaultValues?.schema || '');
  const [model, setModel] = useState('openai');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({ url, command, schema: showSchema ? schema : undefined, model });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="url">Target URL</Label>
        <Input
          id="url"
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com"
          required
          disabled={isRunning}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="command">Natural Language Command</Label>
        <Textarea
          id="command"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder="Navigate to the products page and extract all product names and prices"
          rows={3}
          required
          disabled={isRunning}
        />
      </div>

      {showSchema && (
        <div className="space-y-2">
          <Label htmlFor="schema">Zod Schema (Optional)</Label>
          <Textarea
            id="schema"
            value={schema}
            onChange={(e) => setSchema(e.target.value)}
            placeholder={`z.object({
  products: z.array(z.object({
    name: z.string(),
    price: z.string()
  }))
})`}
            rows={5}
            disabled={isRunning}
            className="font-mono text-sm"
          />
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="model">AI Model</Label>
        <Select value={model} onValueChange={setModel} disabled={isRunning}>
          <SelectTrigger id="model">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="openai">OpenAI GPT-4</SelectItem>
            <SelectItem value="anthropic">Anthropic Claude</SelectItem>
            <SelectItem value="ollama">Ollama (Local)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Button 
        type="submit" 
        disabled={isRunning || !url || !command}
        className="w-full"
      >
        {isRunning ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Running...
          </>
        ) : (
          <>
            <Play className="mr-2 h-4 w-4" />
            Run Automation
          </>
        )}
      </Button>
    </form>
  );
}