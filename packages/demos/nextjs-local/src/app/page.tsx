'use client';

import { useState } from 'react';
import WallcrawlerDemo from '@/components/WallcrawlerDemo';
import { WallcrawlerAgentDemo } from '@/components/WallcrawlerAgentDemo';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Code2, Globe, Database, Zap, Bot } from 'lucide-react';

export default function Home() {
  const [activeDemo, setActiveDemo] = useState<'agent' | 'scraping' | 'form' | 'navigation' | 'extraction'>('agent');

  const features = [
    {
      icon: <Bot className="w-5 h-5" />,
      title: 'AI Agent',
      description: 'Multi-step task automation with intelligent planning',
    },
    {
      icon: <Globe className="w-5 h-5" />,
      title: 'Natural Language Commands',
      description: 'Control browsers using simple English instructions',
    },
    {
      icon: <Code2 className="w-5 h-5" />,
      title: 'Schema Validation',
      description: 'Extract structured data with Zod schema validation',
    },
    {
      icon: <Database className="w-5 h-5" />,
      title: 'Local Storage',
      description: 'Filesystem-based caching and artifact storage',
    },
    {
      icon: <Zap className="w-5 h-5" />,
      title: 'Real-time Updates',
      description: 'Live status updates and intervention handling',
    },
  ];

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      {/* Hero Section */}
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold text-gray-900 mb-4">
          WallCrawler Demo with Local Provider
        </h1>
        <p className="text-lg text-gray-600 max-w-2xl mx-auto">
          Experience AI-powered browser automation using natural language commands.
          This demo showcases WallCrawler with a local filesystem provider.
        </p>
      </div>

      {/* Features Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6 mb-12">
        {features.map((feature, index) => (
          <Card key={index} className="demo-card">
            <CardHeader className="pb-4">
              <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center text-blue-600 mb-3">
                {feature.icon}
              </div>
              <CardTitle className="text-lg">{feature.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>{feature.description}</CardDescription>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Demo Section */}
      <div className="mb-12">
        <h2 className="text-2xl font-semibold text-gray-900 mb-6">
          Try It Out
        </h2>
        
        <Tabs value={activeDemo} onValueChange={(value) => setActiveDemo(value as any)}>
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="agent">AI Agent</TabsTrigger>
            <TabsTrigger value="scraping">Web Scraping</TabsTrigger>
            <TabsTrigger value="form">Form Automation</TabsTrigger>
            <TabsTrigger value="navigation">Navigation</TabsTrigger>
            <TabsTrigger value="extraction">Data Extraction</TabsTrigger>
          </TabsList>
          
          <TabsContent value="agent" className="mt-6">
            <WallcrawlerAgentDemo />
          </TabsContent>
          
          <TabsContent value="scraping" className="mt-6">
            <WallcrawlerDemo scenario="scraping" />
          </TabsContent>
          
          <TabsContent value="form" className="mt-6">
            <WallcrawlerDemo scenario="form" />
          </TabsContent>
          
          <TabsContent value="navigation" className="mt-6">
            <WallcrawlerDemo scenario="navigation" />
          </TabsContent>
          
          <TabsContent value="extraction" className="mt-6">
            <WallcrawlerDemo scenario="extraction" />
          </TabsContent>
        </Tabs>
      </div>

      {/* Configuration Section */}
      <div className="mb-12">
        <h2 className="text-2xl font-semibold text-gray-900 mb-6">
          Configuration
        </h2>
        
        <Card>
          <CardHeader>
            <CardTitle>Environment Variables</CardTitle>
            <CardDescription>
              Configure these environment variables to use WallCrawler
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 bg-gray-50 rounded-md">
                <code className="text-sm font-mono">OPENAI_API_KEY</code>
                <Badge variant="outline">Required for OpenAI</Badge>
              </div>
              <div className="flex items-center justify-between p-3 bg-gray-50 rounded-md">
                <code className="text-sm font-mono">ANTHROPIC_API_KEY</code>
                <Badge variant="outline">Required for Claude</Badge>
              </div>
              <div className="flex items-center justify-between p-3 bg-gray-50 rounded-md">
                <code className="text-sm font-mono">WALLCRAWLER_DEBUG</code>
                <Badge variant="secondary">Optional</Badge>
              </div>
              <div className="flex items-center justify-between p-3 bg-gray-50 rounded-md">
                <code className="text-sm font-mono">WALLCRAWLER_CACHE_DIR</code>
                <Badge variant="secondary">Optional</Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Local Storage Info */}
      <div className="mb-12">
        <h2 className="text-2xl font-semibold text-gray-900 mb-6">
          Local Storage
        </h2>
        
        <Card>
          <CardHeader>
            <CardTitle>Artifacts Directory</CardTitle>
            <CardDescription>
              WallCrawler stores screenshots and data in the <code className="font-mono">.wallcrawler</code> directory
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="bg-gray-50 p-4 rounded-md">
              <pre className="text-sm font-mono overflow-x-auto">
{`.wallcrawler/
├── cache/
│   ├── screenshots/
│   └── data/
├── logs/
└── artifacts/
    ├── [session-id]/
    │   ├── screenshot-*.png
    │   └── data-*.json`}
              </pre>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}