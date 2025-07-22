'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, Button, Badge } from '@/components/ui';
import { Activity, Cpu, MemoryStick, Trash2, RefreshCw, AlertTriangle } from 'lucide-react';

interface BrowserStats {
  pool: {
    activeInstances: number;
    maxSize: number;
    utilization: number;
  };
  browser: {
    totalInstances: number;
    healthyInstances: number;
    orphanedProcesses: number;
    memoryUsage: number;
    cpuUsage: number;
  };
  timestamp: string;
}

interface BrowserMonitorProps {
  refreshInterval?: number;
}

export function BrowserMonitor({ refreshInterval = 10000 }: BrowserMonitorProps) {
  const [stats, setStats] = useState<BrowserStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [cleanupLoading, setCleanupLoading] = useState(false);

  const fetchStats = async () => {
    try {
      const response = await fetch('/api/browser/stats');
      const data = await response.json();

      if (data.success) {
        setStats(data.stats);
        setLastUpdated(new Date());
        setError(null);
      } else {
        setError(data.error || 'Failed to fetch browser stats');
      }
    } catch (err) {
      setError('Network error fetching browser stats');
      console.error('Error fetching browser stats:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCleanup = async () => {
    setCleanupLoading(true);
    try {
      const response = await fetch('/api/browser/cleanup', {
        method: 'POST',
      });
      const data = await response.json();

      if (data.success) {
        // Refresh stats after cleanup
        await fetchStats();
      } else {
        setError(data.error || 'Failed to cleanup browser processes');
      }
    } catch (err) {
      setError('Network error during cleanup');
      console.error('Error during cleanup:', err);
    } finally {
      setCleanupLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, refreshInterval);
    return () => clearInterval(interval);
  }, [refreshInterval]);

  const getUtilizationColor = (utilization: number) => {
    if (utilization >= 90) return 'bg-red-500';
    if (utilization >= 70) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  const getHealthStatus = () => {
    if (!stats) return { status: 'unknown', color: 'bg-gray-500' };

    const { browser } = stats;
    if (browser.orphanedProcesses > 0) {
      return { status: 'warning', color: 'bg-yellow-500' };
    }
    if (browser.healthyInstances === browser.totalInstances && browser.totalInstances > 0) {
      return { status: 'healthy', color: 'bg-green-500' };
    }
    if (browser.totalInstances === 0) {
      return { status: 'idle', color: 'bg-blue-500' };
    }
    return { status: 'degraded', color: 'bg-red-500' };
  };

  if (loading && !stats) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Browser Process Monitor
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="h-6 w-6 animate-spin" />
            <span className="ml-2">Loading browser stats...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  const healthStatus = getHealthStatus();

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Browser Process Monitor
            <div className={`h-3 w-3 rounded-full ${healthStatus.color}`} />
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={fetchStats} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
            <Button variant="destructive" size="sm" onClick={handleCleanup} disabled={cleanupLoading}>
              <Trash2 className="h-4 w-4" />
              {cleanupLoading ? 'Cleaning...' : 'Cleanup'}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
            <div className="flex items-center gap-2 text-red-800">
              <AlertTriangle className="h-4 w-4" />
              <span className="text-sm font-medium">Error</span>
            </div>
            <p className="text-sm text-red-700 mt-1">{error}</p>
          </div>
        )}

        {stats && (
          <div className="space-y-6">
            {/* Session Pool Stats */}
            <div>
              <h3 className="text-sm font-medium text-gray-700 mb-3">Session Pool</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div className="bg-gray-50 p-3 rounded-lg">
                  <div className="text-2xl font-bold text-gray-900">{stats.pool.activeInstances}</div>
                  <div className="text-sm text-gray-600">Active Sessions</div>
                </div>
                <div className="bg-gray-50 p-3 rounded-lg">
                  <div className="text-2xl font-bold text-gray-900">{stats.pool.maxSize}</div>
                  <div className="text-sm text-gray-600">Max Capacity</div>
                </div>
                <div className="bg-gray-50 p-3 rounded-lg">
                  <div className="flex items-center gap-2">
                    <div className="text-2xl font-bold text-gray-900">{stats.pool.utilization}%</div>
                    <div className={`h-2 w-2 rounded-full ${getUtilizationColor(stats.pool.utilization)}`} />
                  </div>
                  <div className="text-sm text-gray-600">Utilization</div>
                </div>
              </div>
            </div>

            {/* Browser Process Stats */}
            <div>
              <h3 className="text-sm font-medium text-gray-700 mb-3">Browser Processes</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div className="bg-blue-50 p-3 rounded-lg">
                  <div className="text-2xl font-bold text-blue-900">{stats.browser.totalInstances}</div>
                  <div className="text-sm text-blue-700">Total Instances</div>
                </div>
                <div className="bg-green-50 p-3 rounded-lg">
                  <div className="text-2xl font-bold text-green-900">{stats.browser.healthyInstances}</div>
                  <div className="text-sm text-green-700">Healthy</div>
                </div>
                <div className="bg-red-50 p-3 rounded-lg">
                  <div className="flex items-center gap-2">
                    <div className="text-2xl font-bold text-red-900">{stats.browser.orphanedProcesses}</div>
                    {stats.browser.orphanedProcesses > 0 && <AlertTriangle className="h-4 w-4 text-red-600" />}
                  </div>
                  <div className="text-sm text-red-700">Orphaned</div>
                </div>
              </div>
            </div>

            {/* Resource Usage */}
            <div>
              <h3 className="text-sm font-medium text-gray-700 mb-3">Resource Usage</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-purple-50 p-3 rounded-lg">
                  <div className="flex items-center gap-2 mb-1">
                    <MemoryStick className="h-4 w-4 text-purple-600" />
                    <span className="text-sm font-medium text-purple-900">Memory</span>
                  </div>
                  <div className="text-xl font-bold text-purple-900">{stats.browser.memoryUsage.toFixed(1)}%</div>
                </div>
                <div className="bg-orange-50 p-3 rounded-lg">
                  <div className="flex items-center gap-2 mb-1">
                    <Cpu className="h-4 w-4 text-orange-600" />
                    <span className="text-sm font-medium text-orange-900">CPU</span>
                  </div>
                  <div className="text-xl font-bold text-orange-900">{stats.browser.cpuUsage.toFixed(1)}%</div>
                </div>
              </div>
            </div>

            {/* Status Indicators */}
            <div className="flex items-center justify-between pt-4 border-t border-gray-200">
              <div className="flex items-center gap-2">
                <Badge variant={healthStatus.status === 'healthy' ? 'default' : 'destructive'}>
                  {healthStatus.status.charAt(0).toUpperCase() + healthStatus.status.slice(1)}
                </Badge>
                {stats.browser.orphanedProcesses > 0 && (
                  <Badge variant="destructive">{stats.browser.orphanedProcesses} Orphaned</Badge>
                )}
              </div>
              <div className="text-xs text-gray-500">Last updated: {lastUpdated?.toLocaleTimeString()}</div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
