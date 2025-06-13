'use client';

import { useState } from 'react';
import { TaskResult } from './WallcrawlerDemo';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Download, Copy, Eye, EyeOff } from 'lucide-react';

interface ResultsDisplayProps {
  result: TaskResult;
  scenario: string;
}

export default function ResultsDisplay({ result, scenario }: ResultsDisplayProps) {
  const [showLogs, setShowLogs] = useState(false);
  const [copiedData, setCopiedData] = useState(false);

  const handleCopyData = () => {
    if (result.data) {
      navigator.clipboard.writeText(JSON.stringify(result.data, null, 2));
      setCopiedData(true);
      setTimeout(() => setCopiedData(false), 2000);
    }
  };

  const handleDownloadData = () => {
    if (result.data) {
      const blob = new Blob([JSON.stringify(result.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `wallcrawler-${scenario}-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  };

  if (!result.success && !result.error) {
    return null;
  }

  return (
    <Card className={result.success ? '' : 'border-red-200'}>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Results</span>
          <div className="flex items-center space-x-2">
            {result.data && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleCopyData}
                  className="text-xs"
                >
                  <Copy className="w-3 h-3 mr-1" />
                  {copiedData ? 'Copied!' : 'Copy'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleDownloadData}
                  className="text-xs"
                >
                  <Download className="w-3 h-3 mr-1" />
                  Download
                </Button>
              </>
            )}
          </div>
        </CardTitle>
        <CardDescription>
          {result.success ? 'Task completed successfully' : 'Task failed with error'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="data" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="data">Data</TabsTrigger>
            <TabsTrigger value="screenshots">Screenshots</TabsTrigger>
            <TabsTrigger value="logs">Logs</TabsTrigger>
          </TabsList>

          {/* Data Tab */}
          <TabsContent value="data" className="space-y-4">
            {result.error ? (
              <div className="p-4 bg-red-50 border border-red-200 rounded-md">
                <p className="text-sm text-red-800 font-mono">{result.error}</p>
              </div>
            ) : result.data ? (
              <div className="bg-gray-50 p-4 rounded-md overflow-x-auto">
                <pre className="text-sm font-mono">
                  {JSON.stringify(result.data, null, 2)}
                </pre>
              </div>
            ) : (
              <p className="text-gray-500">No data extracted</p>
            )}
          </TabsContent>

          {/* Screenshots Tab */}
          <TabsContent value="screenshots" className="space-y-4">
            {result.screenshots && result.screenshots.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {result.screenshots.map((screenshot, index) => (
                  <div key={index} className="space-y-2">
                    <p className="text-sm text-gray-600">Screenshot {index + 1}</p>
                    <img
                      src={screenshot}
                      alt={`Screenshot ${index + 1}`}
                      className="w-full rounded-md border border-gray-200"
                    />
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500">No screenshots available</p>
            )}
          </TabsContent>

          {/* Logs Tab */}
          <TabsContent value="logs" className="space-y-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-gray-600">Execution logs</p>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowLogs(!showLogs)}
                className="text-xs"
              >
                {showLogs ? (
                  <>
                    <EyeOff className="w-3 h-3 mr-1" />
                    Hide
                  </>
                ) : (
                  <>
                    <Eye className="w-3 h-3 mr-1" />
                    Show
                  </>
                )}
              </Button>
            </div>
            {showLogs && result.logs && result.logs.length > 0 ? (
              <div className="bg-gray-900 text-gray-100 p-4 rounded-md overflow-x-auto">
                <pre className="text-xs font-mono">
                  {result.logs.join('\n')}
                </pre>
              </div>
            ) : showLogs ? (
              <p className="text-gray-500">No logs available</p>
            ) : (
              <p className="text-gray-500 text-sm">Click "Show" to view logs</p>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}