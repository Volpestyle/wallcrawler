# Wallcrawler Integration Guide

This dashboard now supports creating browser automation sessions using Wallcrawler's AWS infrastructure through the Stagehand fork.

## Setup

### 1. Environment Variables

Create a `.env.local` file in the `client-nextjs` directory with your Wallcrawler credentials:

```bash
NEXT_PUBLIC_WALLCRAWLER_API_KEY=your_wallcrawler_api_key_here
NEXT_PUBLIC_WALLCRAWLER_PROJECT_ID=your_wallcrawler_project_id_here
```

### 2. Install Dependencies

Run `pnpm install` to install all dependencies including the Stagehand fork.

## Usage

### Creating Sessions

When creating a new session, you'll see two options:

1. **Wallcrawler (Cloud)** - Creates sessions in AWS infrastructure
   - Automatic scaling and management
   - No local browser required
   - Sessions persist across restarts

2. **Local** - Connects to a local Stagehand instance
   - Requires a running Stagehand server
   - Specify the URL (default: http://localhost:3000)

### Session Management

- Wallcrawler sessions are marked with a cloud icon
- Local sessions are marked with a server icon
- Sessions show their status (running, completed, error)
- You can close sessions directly from the dashboard

## Architecture

The integration uses:
- `@wallcrawler/stagehand` - Fork of Stagehand with Wallcrawler support
- `@wallcrawler/sdk` - Official Wallcrawler SDK
- `WallcrawlerClient` - Custom client that wraps Stagehand for session management

## API Reference

### WallcrawlerClient

```typescript
const client = new WallcrawlerClient();

// Create a session
const response = await client.createSession("My Session Name");

// Navigate to URL
await client.navigateTo(sessionId, "https://example.com");

// Take screenshot
const screenshot = await client.takeScreenshot(sessionId);

// Close session
await client.closeSession(sessionId);
```

### Session Store

The Zustand store manages both Wallcrawler and local sessions:

```typescript
const { 
  addSession,
  removeSession,
  setUseWallcrawler,
  initializeWallcrawler 
} = useSessionStore();
```

## Troubleshooting

1. **"Wallcrawler configuration not found"**
   - Ensure environment variables are set correctly
   - Restart the Next.js development server after adding env vars

2. **Session creation fails**
   - Check your API key and project ID are valid
   - Ensure you have internet connectivity
   - Check the browser console for detailed error messages

3. **Sessions not persisting**
   - Wallcrawler sessions persist on the server
   - Local sessions are only stored in browser state