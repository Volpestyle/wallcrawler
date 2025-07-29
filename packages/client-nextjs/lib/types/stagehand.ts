import { z } from "zod";

// Session types
export const SessionStatusSchema = z.enum(["idle", "running", "completed", "error"]);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

export const SessionSchema = z.object({
  id: z.string(),
  url: z.string().url(),
  name: z.string(),
  status: SessionStatusSchema,
  createdAt: z.date(),
  lastActiveAt: z.date(),
  error: z.string().optional(),
});

export type Session = z.infer<typeof SessionSchema>;

// Navigation types
export const NavigationRequestSchema = z.object({
  url: z.string().url(),
  waitUntil: z.enum(["load", "domcontentloaded", "networkidle0", "networkidle2"]).optional(),
  timeout: z.number().optional(),
});

export type NavigationRequest = z.infer<typeof NavigationRequestSchema>;

// Element interaction types
export const ElementActionSchema = z.enum(["click", "type", "select", "hover", "clear"]);
export type ElementAction = z.infer<typeof ElementActionSchema>;

export const ElementInteractionSchema = z.object({
  selector: z.string(),
  action: ElementActionSchema,
  value: z.string().optional(),
  timeout: z.number().optional(),
});

export type ElementInteraction = z.infer<typeof ElementInteractionSchema>;

// Data extraction types
export const ExtractionTypeSchema = z.enum(["text", "links", "images", "table", "json"]);
export type ExtractionType = z.infer<typeof ExtractionTypeSchema>;

export const DataExtractionRequestSchema = z.object({
  type: ExtractionTypeSchema,
  selector: z.string().optional(),
  jsonPath: z.string().optional(),
});

export type DataExtractionRequest = z.infer<typeof DataExtractionRequestSchema>;

// Screenshot types
export const ScreenshotOptionsSchema = z.object({
  fullPage: z.boolean().optional(),
  selector: z.string().optional(),
  quality: z.number().min(0).max(100).optional(),
  type: z.enum(["png", "jpeg"]).optional(),
});

export type ScreenshotOptions = z.infer<typeof ScreenshotOptionsSchema>;

// Workflow types
export const WorkflowStepTypeSchema = z.enum([
  "navigate",
  "interact",
  "extract",
  "screenshot",
  "wait",
  "conditional",
]);

export type WorkflowStepType = z.infer<typeof WorkflowStepTypeSchema>;

export const WorkflowStepSchema = z.object({
  id: z.string(),
  type: WorkflowStepTypeSchema,
  name: z.string(),
  description: z.string().optional(),
  config: z.record(z.any()),
  nextStepId: z.string().optional(),
  conditionalNextStepId: z.string().optional(),
});

export type WorkflowStep = z.infer<typeof WorkflowStepSchema>;

export const WorkflowSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  steps: z.array(WorkflowStepSchema),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type Workflow = z.infer<typeof WorkflowSchema>;

// API Response types
export const ApiResponseSchema = z.object({
  success: z.boolean(),
  data: z.any().optional(),
  error: z.string().optional(),
  timestamp: z.date(),
});

export type ApiResponse<T = any> = {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: Date;
};