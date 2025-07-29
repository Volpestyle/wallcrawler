import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";
import { Workflow, WorkflowStep } from "@/lib/types/stagehand";

interface WorkflowState {
  // State
  workflows: Workflow[];
  activeWorkflowId: string | null;
  editingWorkflow: Workflow | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  createWorkflow: (name: string, description?: string) => void;
  updateWorkflow: (workflowId: string, updates: Partial<Workflow>) => void;
  deleteWorkflow: (workflowId: string) => void;
  setActiveWorkflow: (workflowId: string | null) => void;
  setEditingWorkflow: (workflow: Workflow | null) => void;
  
  // Step management
  addStep: (workflowId: string, step: WorkflowStep) => void;
  updateStep: (workflowId: string, stepId: string, updates: Partial<WorkflowStep>) => void;
  deleteStep: (workflowId: string, stepId: string) => void;
  reorderSteps: (workflowId: string, steps: WorkflowStep[]) => void;
  
  clearError: () => void;
}

export const useWorkflowStore = create<WorkflowState>()(
  devtools(
    persist(
      (set, get) => ({
        // Initial state
        workflows: [],
        activeWorkflowId: null,
        editingWorkflow: null,
        isLoading: false,
        error: null,

        // Create a new workflow
        createWorkflow: (name: string, description?: string) => {
          const newWorkflow: Workflow = {
            id: `workflow-${Date.now()}`,
            name,
            description,
            steps: [],
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          
          set((state) => ({
            workflows: [...state.workflows, newWorkflow],
            editingWorkflow: newWorkflow,
          }));
        },

        // Update workflow
        updateWorkflow: (workflowId: string, updates: Partial<Workflow>) => {
          set((state) => ({
            workflows: state.workflows.map((w) =>
              w.id === workflowId
                ? { ...w, ...updates, updatedAt: new Date() }
                : w
            ),
            editingWorkflow:
              state.editingWorkflow?.id === workflowId
                ? { ...state.editingWorkflow, ...updates, updatedAt: new Date() }
                : state.editingWorkflow,
          }));
        },

        // Delete workflow
        deleteWorkflow: (workflowId: string) => {
          set((state) => ({
            workflows: state.workflows.filter((w) => w.id !== workflowId),
            activeWorkflowId:
              state.activeWorkflowId === workflowId ? null : state.activeWorkflowId,
            editingWorkflow:
              state.editingWorkflow?.id === workflowId ? null : state.editingWorkflow,
          }));
        },

        // Set active workflow
        setActiveWorkflow: (workflowId: string | null) => {
          set({ activeWorkflowId: workflowId });
        },

        // Set editing workflow
        setEditingWorkflow: (workflow: Workflow | null) => {
          set({ editingWorkflow: workflow });
        },

        // Add step to workflow
        addStep: (workflowId: string, step: WorkflowStep) => {
          set((state) => ({
            workflows: state.workflows.map((w) =>
              w.id === workflowId
                ? { ...w, steps: [...w.steps, step], updatedAt: new Date() }
                : w
            ),
            editingWorkflow:
              state.editingWorkflow?.id === workflowId
                ? {
                    ...state.editingWorkflow,
                    steps: [...state.editingWorkflow.steps, step],
                    updatedAt: new Date(),
                  }
                : state.editingWorkflow,
          }));
        },

        // Update step in workflow
        updateStep: (workflowId: string, stepId: string, updates: Partial<WorkflowStep>) => {
          set((state) => ({
            workflows: state.workflows.map((w) =>
              w.id === workflowId
                ? {
                    ...w,
                    steps: w.steps.map((s) =>
                      s.id === stepId ? { ...s, ...updates } : s
                    ),
                    updatedAt: new Date(),
                  }
                : w
            ),
            editingWorkflow:
              state.editingWorkflow?.id === workflowId
                ? {
                    ...state.editingWorkflow,
                    steps: state.editingWorkflow.steps.map((s) =>
                      s.id === stepId ? { ...s, ...updates } : s
                    ),
                    updatedAt: new Date(),
                  }
                : state.editingWorkflow,
          }));
        },

        // Delete step from workflow
        deleteStep: (workflowId: string, stepId: string) => {
          set((state) => ({
            workflows: state.workflows.map((w) =>
              w.id === workflowId
                ? {
                    ...w,
                    steps: w.steps.filter((s) => s.id !== stepId),
                    updatedAt: new Date(),
                  }
                : w
            ),
            editingWorkflow:
              state.editingWorkflow?.id === workflowId
                ? {
                    ...state.editingWorkflow,
                    steps: state.editingWorkflow.steps.filter((s) => s.id !== stepId),
                    updatedAt: new Date(),
                  }
                : state.editingWorkflow,
          }));
        },

        // Reorder steps in workflow
        reorderSteps: (workflowId: string, steps: WorkflowStep[]) => {
          set((state) => ({
            workflows: state.workflows.map((w) =>
              w.id === workflowId
                ? { ...w, steps, updatedAt: new Date() }
                : w
            ),
            editingWorkflow:
              state.editingWorkflow?.id === workflowId
                ? { ...state.editingWorkflow, steps, updatedAt: new Date() }
                : state.editingWorkflow,
          }));
        },

        // Clear error
        clearError: () => {
          set({ error: null });
        },
      }),
      {
        name: "workflow-storage",
        partialize: (state) => ({
          workflows: state.workflows,
          activeWorkflowId: state.activeWorkflowId,
        }),
      }
    )
  )
);