/**
 * WallCrawler Container - Entry point
 * Determines whether to use serverless or multi-session mode
 */

// If SESSION_ID is provided, run in serverless mode (single session per task)
// Otherwise, run in multi-session mode (multiple sessions per container)
import('./multi-session');
