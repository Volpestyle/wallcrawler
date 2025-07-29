"use client";

import { useEffect } from "react";
import { Plus, RefreshCw, Server } from "lucide-react";
import { useSessionStore } from "@/lib/stores/session-store";
import { useUIStore } from "@/lib/stores/ui-store";
import { SessionCard } from "./session-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function SessionManager() {
  const {
    sessions,
    activeSessionId,
    isLoading,
    error,
    setActiveSession,
    removeSession,
    refreshSessions,
    clearError,
  } = useSessionStore();

  const { setSessionModalOpen } = useUIStore();

  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => {
        clearError();
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [error, clearError]);

  const handleDeleteSession = async (sessionId: string) => {
    if (confirm("Are you sure you want to close this session?")) {
      await removeSession(sessionId);
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-6 border-b border-border">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Server className="h-5 w-5 text-text-secondary" />
            <h2 className="text-xl font-light">Sessions</h2>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => refreshSessions()}
              disabled={isLoading}
            >
              <RefreshCw
                className={cn("h-4 w-4", isLoading && "animate-spin")}
              />
            </Button>
            <Button
              size="sm"
              onClick={() => setSessionModalOpen(true)}
            >
              <Plus className="h-4 w-4 mr-1" />
              New Session
            </Button>
          </div>
        </div>
        <p className="text-sm text-text-secondary">
          Manage your Stagehand browser sessions
        </p>
      </div>

      {/* Error display */}
      {error && (
        <div className="mx-6 mt-4 p-3 bg-error/10 border border-error/20 rounded-lg">
          <p className="text-sm text-error">{error}</p>
        </div>
      )}

      {/* Sessions list */}
      <div className="flex-1 overflow-y-auto p-6">
        {isLoading && sessions.length === 0 ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-32" />
            ))}
          </div>
        ) : sessions.length === 0 ? (
          <div className="text-center py-12">
            <Server className="h-12 w-12 text-text-secondary/30 mx-auto mb-4" />
            <p className="text-text-secondary">No active sessions</p>
            <p className="text-sm text-text-secondary/70 mt-1">
              Create a new session to get started
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {sessions.map((session) => (
              <SessionCard
                key={session.id}
                session={session}
                isActive={session.id === activeSessionId}
                onSelect={() => setActiveSession(session.id)}
                onDelete={() => handleDeleteSession(session.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer stats */}
      <div className="p-4 border-t border-border bg-surface/50">
        <div className="flex justify-between text-xs text-text-secondary">
          <span>Active Sessions: {sessions.filter(s => s.status === "running").length}</span>
          <span>Total: {sessions.length}</span>
        </div>
      </div>
    </div>
  );
}