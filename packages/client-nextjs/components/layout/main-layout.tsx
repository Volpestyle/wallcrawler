"use client";

import { useUIStore } from "@/lib/stores/ui-store";
import { Sidebar } from "./sidebar";
import { SessionManager } from "@/components/sessions/session-manager";
import { WorkflowList } from "@/components/workflows/workflow-list";
import { WorkflowBuilder } from "@/components/workflows/workflow-builder";
import { useWorkflowStore } from "@/lib/stores/workflow-store";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function MainLayout({ children }: { children: React.ReactNode }) {
  const { activeView } = useUIStore();
  const { editingWorkflow } = useWorkflowStore();

  const renderContent = () => {
    switch (activeView) {
      case "dashboard":
        return children;
      case "sessions":
        return <SessionManager />;
      case "workflows":
        return (
          <div className="h-full flex">
            <div className="w-96 border-r border-border">
              <WorkflowList />
            </div>
            <div className="flex-1">
              <WorkflowBuilder />
            </div>
          </div>
        );
      case "settings":
        return (
          <div className="p-6">
            <h2 className="text-xl font-light mb-4">Settings</h2>
            <p className="text-text-secondary">Settings page coming soon...</p>
          </div>
        );
      default:
        return children;
    }
  };

  return (
    <div className="flex h-screen bg-background">
      <Sidebar />
      <main className="flex-1 overflow-hidden">{renderContent()}</main>
    </div>
  );
}