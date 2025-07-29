import { Stagehand } from "@wallcrawler/stagehand";
import { Session } from "@/lib/types/stagehand";

// In-memory session storage
// Note: This will be cleared when the server restarts
// Consider using Redis or a database for production
export const sessionStorage = new Map<string, { session: Session; stagehand: Stagehand }>();