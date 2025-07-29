"use client";

import { Home, Server, FileText, Settings, ChevronLeft } from "lucide-react";
import { useUIStore } from "@/lib/stores/ui-store";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const navigationItems = [
  { id: "dashboard", label: "Dashboard", icon: Home },
  { id: "sessions", label: "Sessions", icon: Server },
  { id: "workflows", label: "Workflows", icon: FileText },
  { id: "settings", label: "Settings", icon: Settings },
] as const;

export function Sidebar() {
  const { sidebarOpen, setSidebarOpen, activeView, setActiveView } = useUIStore();

  return (
    <aside
      className={cn(
        "relative h-full bg-surface border-r border-border transition-all duration-300",
        sidebarOpen ? "w-64" : "w-16"
      )}
    >
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="p-4 border-b border-border">
          <div className="flex items-center justify-between">
            <h1
              className={cn(
                "font-light text-lg transition-opacity duration-200",
                !sidebarOpen && "opacity-0"
              )}
            >
              Wallcrawler
            </h1>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="h-8 w-8"
            >
              <ChevronLeft
                className={cn(
                  "h-4 w-4 transition-transform",
                  !sidebarOpen && "rotate-180"
                )}
              />
            </Button>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-2">
          <ul className="space-y-1">
            {navigationItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeView === item.id;
              return (
                <li key={item.id}>
                  <Button
                    variant={isActive ? "secondary" : "ghost"}
                    className={cn(
                      "w-full justify-start",
                      !sidebarOpen && "px-2"
                    )}
                    onClick={() => setActiveView(item.id as any)}
                  >
                    <Icon className="h-4 w-4" />
                    {sidebarOpen && <span className="ml-2">{item.label}</span>}
                  </Button>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Footer */}
        <div className="p-4 border-t border-border">
          <div
            className={cn(
              "text-xs text-text-secondary transition-opacity duration-200",
              !sidebarOpen && "opacity-0"
            )}
          >
            <p>Version 1.0.0</p>
          </div>
        </div>
      </div>
    </aside>
  );
}