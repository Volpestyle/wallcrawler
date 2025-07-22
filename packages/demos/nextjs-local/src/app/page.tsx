'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus, PlayCircle, Activity, Clock } from 'lucide-react';
import Link from 'next/link';
import { useDashboardMetrics } from '@/hooks/useMetrics';
import { BrowserMonitor } from '@/components/BrowserMonitor';

export default function Dashboard() {
  const { metrics } = useDashboardMetrics();

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground">Welcome to your Wallcrawler local experimentation environment</p>
        </div>
        <Link href="/sessions/new">
          <Button className="gap-2">
            <Plus className="h-4 w-4" />
            Start Session
          </Button>
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Sessions</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics.activeSessions}</div>
            <p className="text-xs text-muted-foreground">
              {metrics.activeSessions === 0 ? 'No active sessions' : 'Currently running'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Workflows</CardTitle>
            <PlayCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics.totalWorkflows}</div>
            <p className="text-xs text-muted-foreground">
              {metrics.totalWorkflows === 0 ? 'Ready to create' : 'Created workflows'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Tokens</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics.totalTokens.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">Across all sessions</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Response Time</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {metrics.avgResponseTime > 0 ? `${metrics.avgResponseTime}ms` : '—'}
            </div>
            <p className="text-xs text-muted-foreground">
              {metrics.avgResponseTime > 0 ? 'Average response time' : 'No data yet'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Browser Process Monitor */}
      <BrowserMonitor refreshInterval={10000} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Recent Sessions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-center py-8 text-muted-foreground">
              <Activity className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No sessions created yet</p>
              <Link href="/sessions/new">
                <Button variant="outline" className="mt-4">
                  Create Your First Session
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Link href="/sessions/new">
              <Button variant="outline" className="w-full justify-start gap-3">
                <Plus className="h-4 w-4" />
                Start New Session
              </Button>
            </Link>
            <Link href="/workflows/new">
              <Button variant="outline" className="w-full justify-start gap-3">
                <PlayCircle className="h-4 w-4" />
                Create Workflow
              </Button>
            </Link>
            <Link href="/playground">
              <Button variant="outline" className="w-full justify-start gap-3">
                <Activity className="h-4 w-4" />
                Open Playground
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
