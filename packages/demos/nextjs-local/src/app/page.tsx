'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Code2, Globe, Database, Zap, Workflow } from 'lucide-react';
import WorkflowBuilder from '@/components/WorkflowBuilder';

export default function Home() {
  const features = [
    {
      icon: <Workflow className="w-5 h-5" />,
      title: 'Multi-Step Workflows',
      description: 'Build complex automation sequences with multiple steps',
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
      description: 'Live status updates and visual workflow progress',
    },
  ];

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      {/* Hero Section */}
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold text-gray-900 mb-4">WallCrawler Workflow Builder</h1>
        <p className="text-lg text-gray-600 max-w-2xl mx-auto">
          Build and execute multi-step browser automation workflows using natural language commands. Create complex
          sequences that navigate, interact, observe, and extract data from web pages.
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

      {/* Workflow Builder Section */}
      <div className="mb-12">
        <h2 className="text-2xl font-semibold text-gray-900 mb-6">Build Your Workflow</h2>

        <WorkflowBuilder />
      </div>

      {/* Local Storage Info */}
      <div className="mb-12">
        <h2 className="text-2xl font-semibold text-gray-900 mb-6">Local Storage</h2>

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
