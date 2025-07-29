import { create } from "zustand";
import { devtools } from "zustand/middleware";

interface UIState {
  // Sidebar state
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;

  // Modal states
  sessionModalOpen: boolean;
  setSessionModalOpen: (open: boolean) => void;
  workflowModalOpen: boolean;
  setWorkflowModalOpen: (open: boolean) => void;

  // View states
  activeView: "dashboard" | "sessions" | "workflows" | "settings";
  setActiveView: (view: "dashboard" | "sessions" | "workflows" | "settings") => void;

  // Theme
  theme: "light" | "dark" | "system";
  setTheme: (theme: "light" | "dark" | "system") => void;
}

export const useUIStore = create<UIState>()(
  devtools((set) => ({
    // Initial state
    sidebarOpen: true,
    sessionModalOpen: false,
    workflowModalOpen: false,
    activeView: "dashboard",
    theme: "dark",

    // Actions
    setSidebarOpen: (open: boolean) => set({ sidebarOpen: open }),
    toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),

    setSessionModalOpen: (open: boolean) => set({ sessionModalOpen: open }),
    setWorkflowModalOpen: (open: boolean) => set({ workflowModalOpen: open }),

    setActiveView: (view) => set({ activeView: view }),
    setTheme: (theme) => set({ theme }),
  }))
);