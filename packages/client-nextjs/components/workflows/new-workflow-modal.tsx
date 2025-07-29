"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useWorkflowStore } from "@/lib/stores/workflow-store";
import { useUIStore } from "@/lib/stores/ui-store";

const formSchema = z.object({
  name: z.string().min(1, "Workflow name is required"),
  description: z.string().optional(),
});

type FormData = z.infer<typeof formSchema>;

export function NewWorkflowModal() {
  const { createWorkflow } = useWorkflowStore();
  const { workflowModalOpen, setWorkflowModalOpen } = useUIStore();

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<FormData>({
    resolver: zodResolver(formSchema),
  });

  const onSubmit = (data: FormData) => {
    createWorkflow(data.name, data.description);
    reset();
    setWorkflowModalOpen(false);
  };

  return (
    <Dialog open={workflowModalOpen} onOpenChange={setWorkflowModalOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create New Workflow</DialogTitle>
          <DialogDescription>
            Design automation workflows with drag-and-drop steps
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)}>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Workflow Name</Label>
              <Input
                id="name"
                placeholder="My Automation Workflow"
                {...register("name")}
              />
              {errors.name && (
                <p className="text-xs text-error">{errors.name.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description (Optional)</Label>
              <Input
                id="description"
                placeholder="Describe what this workflow does..."
                {...register("description")}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setWorkflowModalOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit">Create Workflow</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}