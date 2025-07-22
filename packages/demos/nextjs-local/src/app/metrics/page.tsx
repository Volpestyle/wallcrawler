'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Activity, TrendingUp, Clock, Zap, DollarSign, BarChart3, RefreshCw, Download } from 'lucide-react';
import { useRealTimeMetrics } from '@/hooks/useMetrics';

export default function MetricsPage() {
  const { metrics, loading, refresh } = useRealTimeMetrics();

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('en-US').format(num);
  };

  const formatTime = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Metrics & Analytics</h1>
          <p className="text-muted-foreground">Monitor performance, usage, and costs across all sessions</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={refresh} disabled={loading} className="gap-2">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button variant="outline" className="gap-2">
            <Download className="h-4 w-4" />
            Export
          </Button>
        </div>
      </div>

      {/* Key Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Tokens</CardTitle>
            <Zap className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatNumber(metrics.totalTokens)}</div>
            <p className="text-xs text-muted-foreground">+2,543 from last hour</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Cost</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(metrics.totalCost)}</div>
            <p className="text-xs text-muted-foreground">{formatCurrency(0.89)} this hour</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Response Time</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatTime(metrics.avgResponseTime)}</div>
            <p className="text-xs text-muted-foreground">-340ms from last hour</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Success Rate</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics.successRate}%</div>
            <p className="text-xs text-muted-foreground">+1.2% from yesterday</p>
          </CardContent>
        </Card>
      </div>

      {/* Charts and Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              Hourly Usage
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {metrics.hourlyUsage.map((hour) => (
                <div key={hour.hour} className="flex items-center gap-4">
                  <div className="w-12 text-sm text-muted-foreground">{hour.hour}</div>
                  <div className="flex-1">
                    <div className="flex justify-between text-sm mb-1">
                      <span>{formatNumber(hour.tokens)} tokens</span>
                      <span>{hour.actions} actions</span>
                    </div>
                    <div className="w-full bg-muted rounded-full h-2">
                      <div
                        className="bg-primary h-2 rounded-full transition-all"
                        style={{ width: `${(hour.tokens / 25000) * 100}%` }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-4 w-4" />
              Recent Activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {metrics.recentActivity.map((activity) => (
                <div key={activity.id} className="flex items-center justify-between p-3 border rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${activity.success ? 'bg-green-500' : 'bg-red-500'}`} />
                    <div>
                      <div className="font-medium text-sm">{activity.action.toUpperCase()}</div>
                      <div className="text-xs text-muted-foreground">{activity.session.slice(-8)}</div>
                    </div>
                  </div>
                  <div className="text-right text-sm">
                    <div>{formatNumber(activity.tokens)} tokens</div>
                    <div className="text-xs text-muted-foreground">{formatTime(activity.responseTime)}</div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Performance Insights */}
      <Card>
        <CardHeader>
          <CardTitle>Performance Insights</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div className="space-y-2">
              <h4 className="font-semibold text-sm">Most Used Action</h4>
              <div className="text-2xl font-bold text-primary">ACT</div>
              <p className="text-xs text-muted-foreground">65% of all operations</p>
            </div>
            <div className="space-y-2">
              <h4 className="font-semibold text-sm">Peak Usage Hour</h4>
              <div className="text-2xl font-bold text-primary">2:00 PM</div>
              <p className="text-xs text-muted-foreground">22,100 tokens processed</p>
            </div>
            <div className="space-y-2">
              <h4 className="font-semibold text-sm">Cost per Token</h4>
              <div className="text-2xl font-bold text-primary">$0.0001</div>
              <p className="text-xs text-muted-foreground">Average across all models</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Usage Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>Usage Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-4">Action Type</th>
                  <th className="text-left p-4">Count</th>
                  <th className="text-left p-4">Tokens</th>
                  <th className="text-left p-4">Avg Time</th>
                  <th className="text-left p-4">Success Rate</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { type: 'act', count: 89, tokens: 65432, avgTime: 2100, successRate: 96.6 },
                  { type: 'extract', count: 34, tokens: 28901, avgTime: 1800, successRate: 94.1 },
                  { type: 'observe', count: 23, tokens: 18456, avgTime: 1200, successRate: 98.9 },
                  { type: 'agent', count: 10, tokens: 14754, avgTime: 4500, successRate: 85.0 },
                ].map((row) => (
                  <tr key={row.type} className="border-b hover:bg-muted/50">
                    <td className="p-4">
                      <code className="text-sm bg-muted px-2 py-1 rounded">{row.type.toUpperCase()}</code>
                    </td>
                    <td className="p-4">{row.count}</td>
                    <td className="p-4">{formatNumber(row.tokens)}</td>
                    <td className="p-4">{formatTime(row.avgTime)}</td>
                    <td className="p-4">
                      <span
                        className={`px-2 py-1 rounded-full text-xs ${
                          row.successRate > 95
                            ? 'bg-green-500/10 text-green-500'
                            : row.successRate > 90
                              ? 'bg-yellow-500/10 text-yellow-500'
                              : 'bg-red-500/10 text-red-500'
                        }`}
                      >
                        {row.successRate}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
