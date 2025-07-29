"use client";

import { useState } from "react";
import {
  Globe,
  MousePointer,
  Database,
  Camera,
  Clock,
  Activity,
  RefreshCw,
} from "lucide-react";
import { useSessionStore } from "@/lib/stores/session-store";
import { useWorkflowStore } from "@/lib/stores/workflow-store";
import { useUIStore } from "@/lib/stores/ui-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface TestFeature {
  id: string;
  name: string;
  description: string;
  icon: React.ElementType;
}

const features: TestFeature[] = [
  {
    id: "navigation",
    name: "Navigation",
    description: "Test page navigation and routing capabilities",
    icon: Globe,
  },
  {
    id: "interaction",
    name: "Element Interaction",
    description: "Click, type, and interact with page elements",
    icon: MousePointer,
  },
  {
    id: "extraction",
    name: "Data Extraction",
    description: "Extract text, links, and structured data",
    icon: Database,
  },
  {
    id: "screenshot",
    name: "Screenshots",
    description: "Capture full page or element screenshots",
    icon: Camera,
  },
  {
    id: "automation",
    name: "Automation Flows",
    description: "Build and test complex automation sequences",
    icon: RefreshCw,
  },
  {
    id: "performance",
    name: "Performance",
    description: "Monitor page load times and resource usage",
    icon: Activity,
  },
];

export default function Dashboard() {
  const { sessions, activeSessionId, addSession, isLoading } = useSessionStore();
  const { workflows } = useWorkflowStore();
  const { setActiveView, setSessionModalOpen } = useUIStore();
  const [selectedFeature, setSelectedFeature] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<string>("");

  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const isConnected = !!activeSession;

  const handleConnect = () => {
    setSessionModalOpen(true);
  };

  const handleRunTest = (featureId: string) => {
    setSelectedFeature(featureId);
    setTestResults(`Running ${featureId} test...\n\nTest results will appear here.`);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="border-b border-border">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-light tracking-wide text-text-primary">
                Wallcrawler Dashboard
              </h1>
              <p className="text-sm text-text-secondary mt-1">
                Test automation features through Stagehand
              </p>
            </div>
            <div className="flex items-center gap-6">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setActiveView("workflows")}
              >
                Workflows ({workflows.length})
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setActiveView("sessions")}
              >
                Sessions ({sessions.length})
              </Button>
              <div className="flex items-center gap-2">
                <div
                  className={cn(
                    "w-2 h-2 rounded-full",
                    isConnected ? "bg-success" : "bg-text-secondary"
                  )}
                />
                <span className="text-sm text-text-secondary">
                  {isConnected ? "Connected" : "Disconnected"}
                </span>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Connection Bar */}
      <div className="border-b border-border bg-surface">
        <div className="container mx-auto px-6 py-4">
          {isConnected ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <Badge variant="success">Connected</Badge>
                <span className="text-sm text-text-secondary">
                  {activeSession?.name} - {activeSession?.url}
                </span>
              </div>
              <Button size="sm" variant="outline" onClick={handleConnect}>
                New Session
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <p className="text-sm text-text-secondary">
                No active session. Connect to a Stagehand instance to begin.
              </p>
              <Button size="sm" onClick={handleConnect}>
                Connect to Stagehand
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Main Content */}
      <main className="container mx-auto px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Features Grid */}
          <div className="lg:col-span-2">
            <h2 className="text-lg font-light text-text-primary mb-6">
              Available Tests
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {isLoading ? (
                <>
                  {[1, 2, 3, 4].map((i) => (
                    <Skeleton key={i} className="h-32" />
                  ))}
                </>
              ) : (
                features.map((feature) => {
                  const Icon = feature.icon;
                  return (
                    <Card
                      key={feature.id}
                      className={cn(
                        "cursor-pointer transition-all hover:border-accent/50",
                        selectedFeature === feature.id &&
                          "border-accent ring-1 ring-accent/20",
                        !isConnected && "opacity-50 cursor-not-allowed"
                      )}
                      onClick={() => isConnected && handleRunTest(feature.id)}
                    >
                      <CardContent className="p-6">
                        <div className="flex items-start gap-4">
                          <div className="p-2 bg-surface-hover rounded-lg">
                            <Icon className="h-5 w-5 text-text-secondary" />
                          </div>
                          <div className="flex-1">
                            <h3 className="text-base font-medium text-text-primary mb-1">
                              {feature.name}
                            </h3>
                            <p className="text-sm text-text-secondary font-light leading-relaxed">
                              {feature.description}
                            </p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })
              )}
            </div>
          </div>

          {/* Test Output */}
          <div className="lg:col-span-1">
            <h2 className="text-lg font-light text-text-primary mb-6">
              Test Output
            </h2>
            <Card className="h-[600px]">
              <CardContent className="p-6 h-full overflow-y-auto">
                <pre className="font-mono text-sm text-text-secondary whitespace-pre-wrap">
                  {testResults || "No tests run yet. Connect to Stagehand and select a test to begin."}
                </pre>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Status Bar */}
        <div className="mt-8 pt-8 border-t border-border">
          <div className="flex items-center justify-between text-sm text-text-secondary">
            <div className="flex items-center gap-6">
              <span>Status: {isConnected ? "Ready" : "Not connected"}</span>
              <span>Tests run: 0</span>
              <span>Last test: -</span>
            </div>
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setTestResults("")}
              >
                Clear output
              </Button>
              <Button variant="ghost" size="sm">
                Export results
              </Button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
