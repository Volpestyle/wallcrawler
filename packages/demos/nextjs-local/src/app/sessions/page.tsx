'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Badge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui';
import { Plus, ExternalLink, X, Activity, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { Session } from '@/types/stagehand';
import { format } from 'date-fns';

export default function SessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchSessions = useCallback(async () => {
    try {
      const response = await fetch('/api/sessions');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const data = await response.json();
      setSessions(data.sessions || []);
      setError(null);
    } catch (error) {
      console.error('Failed to fetch sessions:', error);
      setError(`Failed to fetch sessions: ${(error as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshSessions = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await fetch('/api/sessions');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const data = await response.json();
      setSessions(data.sessions || []);
      setError(null);
    } catch (error) {
      console.error('Failed to refresh sessions:', error);
      setError(`Failed to refresh sessions: ${(error as Error).message}`);
    } finally {
      setRefreshing(false);
    }
  }, []);

  const createSession = async () => {
    setCreating(true);
    setError(null);
    try {
      console.log('Creating new session...');
      const response = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          verbose: 1,
          enableCaching: true,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        console.log('Session created successfully:', data.session);
        await fetchSessions();
      } else {
        console.error('Failed to create session:', data);
        setError(`Failed to create session: ${data.error || 'Unknown error occurred'}`);
      }
    } catch (error) {
      console.error('Failed to create session:', error);
      setError(`Failed to create session: ${(error as Error).message}`);
    } finally {
      setCreating(false);
    }
  };

  const closeSession = async (sessionId: string) => {
    try {
      const response = await fetch(`/api/sessions/${sessionId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        console.log(`Session ${sessionId} closed successfully`);
        await fetchSessions();
      } else {
        const data = await response.json();
        setError(`Failed to close session: ${data.error || 'Unknown error occurred'}`);
      }
    } catch (error) {
      console.error('Failed to close session:', error);
      setError(`Failed to close session: ${(error as Error).message}`);
    }
  };

  useEffect(() => {
    fetchSessions();

    // Handle page visibility changes to refresh sessions when user returns to tab
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        console.log('Page became visible, refreshing sessions...');
        refreshSessions();
      }
    };

    // Handle window focus to refresh sessions when user returns to window
    const handleFocus = () => {
      console.log('Window focused, refreshing sessions...');
      refreshSessions();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, [fetchSessions, refreshSessions]);

  const getStatusBadge = (status: Session['status']) => {
    const variants = {
      active: 'default' as const,
      idle: 'secondary' as const,
      stopped: 'destructive' as const,
    };

    return (
      <Badge variant={variants[status]} className="capitalize">
        {status}
      </Badge>
    );
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold">Sessions</h1>
            <p className="text-muted-foreground">Loading sessions...</p>
          </div>
        </div>
        <Card>
          <CardContent className="p-6">
            <div className="text-center py-8 text-muted-foreground">
              <Activity className="h-12 w-12 mx-auto mb-4 opacity-50 animate-pulse" />
              <p>Loading sessions...</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Sessions</h1>
          <p className="text-muted-foreground">Manage your browser automation sessions</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={refreshSessions} disabled={refreshing || loading} variant="outline" className="gap-2">
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </Button>
          <Button onClick={createSession} disabled={creating} className="gap-2">
            <Plus className="h-4 w-4" />
            {creating ? 'Creating...' : 'New Session'}
          </Button>
        </div>
      </div>

      {error && (
        <Card className="border-destructive">
          <CardContent className="p-4">
            <div className="text-destructive-foreground">
              <p className="font-medium">Error</p>
              <p className="text-sm">{error}</p>
              <Button variant="outline" size="sm" className="mt-2" onClick={() => setError(null)}>
                Dismiss
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Active Sessions</CardTitle>
        </CardHeader>
        <CardContent>
          {sessions.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Activity className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No sessions created yet</p>
              <Button onClick={createSession} disabled={creating} variant="outline" className="mt-4">
                Create Your First Session
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Session ID</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Last Activity</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.map((session) => (
                  <TableRow key={session.id}>
                    <TableCell>
                      <code className="text-sm bg-muted px-2 py-1 rounded">{session.id.slice(-8)}</code>
                    </TableCell>
                    <TableCell>{getStatusBadge(session.status)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {format(new Date(session.createdAt), 'MMM dd, HH:mm')}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {session.lastActivity ? format(new Date(session.lastActivity), 'MMM dd, HH:mm') : 'Never'}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Link href={`/sessions/${session.id}`}>
                          <Button variant="outline" size="sm" className="gap-1">
                            <ExternalLink className="h-3 w-3" />
                            View
                          </Button>
                        </Link>
                        {session.status === 'active' && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => closeSession(session.id)}
                            className="gap-1 text-red-500 hover:text-red-400"
                          >
                            <X className="h-3 w-3" />
                            Close
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
