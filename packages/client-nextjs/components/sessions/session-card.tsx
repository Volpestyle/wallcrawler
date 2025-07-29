import { formatDistanceToNow } from "date-fns";
import { Activity, Chrome, Trash2, Cloud, Server } from "lucide-react";
import { Session } from "@/lib/types/stagehand";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useSessionStore } from "@/lib/stores/session-store";
import { cn } from "@/lib/utils";

interface SessionCardProps {
  session: Session;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
}

export function SessionCard({
  session,
  isActive,
  onSelect,
  onDelete,
}: SessionCardProps) {
  const { useWallcrawler } = useSessionStore();
  const isWallcrawlerSession = 'sessionId' in session;
  
  const getStatusBadge = () => {
    switch (session.status) {
      case "running":
        return <Badge variant="success">Running</Badge>;
      case "completed":
        return <Badge variant="secondary">Completed</Badge>;
      case "error":
        return <Badge variant="destructive">Error</Badge>;
      default:
        return <Badge variant="outline">Idle</Badge>;
    }
  };

  return (
    <Card
      className={cn(
        "cursor-pointer transition-all hover:border-accent/50",
        isActive && "border-accent ring-1 ring-accent/20"
      )}
      onClick={onSelect}
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div className="flex items-center gap-2">
          {isWallcrawlerSession ? (
            <Cloud className="h-4 w-4 text-text-secondary" />
          ) : (
            <Server className="h-4 w-4 text-text-secondary" />
          )}
          <CardTitle className="text-sm font-medium">{session.name}</CardTitle>
        </div>
        {getStatusBadge()}
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          <p className="text-xs text-text-secondary truncate">
            {isWallcrawlerSession ? 'AWS Infrastructure' : session.url}
          </p>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1 text-xs text-text-secondary">
              <Activity className="h-3 w-3" />
              <span>
                {formatDistanceToNow(new Date(session.lastActiveAt), {
                  addSuffix: true,
                })}
              </span>
            </div>
            <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={onDelete}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          </div>
          {session.error && (
            <p className="text-xs text-error truncate">{session.error}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}