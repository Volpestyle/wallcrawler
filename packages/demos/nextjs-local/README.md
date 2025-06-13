# WallCrawler Next.js Demo with Local Provider

This demo showcases WallCrawler's AI-powered browser automation capabilities using the local infrastructure provider in a Next.js application.

## Features

- 🤖 Natural language browser automation
- 📁 Local filesystem storage for artifacts
- 🔍 Multiple demo scenarios (scraping, forms, navigation, extraction)
- 📊 Structured data extraction with Zod validation
- 🖼️ Screenshot capture and display
- 📝 Real-time status updates
- 🎨 Modern UI with Tailwind CSS

## Prerequisites

- Node.js 18+
- pnpm (recommended) or npm
- At least one LLM API key:
  - OpenAI API key (`OPENAI_API_KEY`)
  - Anthropic API key (`ANTHROPIC_API_KEY`)
  - Or Ollama running locally

## Installation

1. From the monorepo root, install dependencies:
```bash
pnpm install
```

2. Build the core packages:
```bash
pnpm build
```

3. Navigate to this demo:
```bash
cd packages/demos/nextjs-local
```

4. Create a `.env.local` file:
```env
# Choose one or more LLM providers
OPENAI_API_KEY=your-openai-api-key
ANTHROPIC_API_KEY=your-anthropic-api-key

# Optional configurations
WALLCRAWLER_DEBUG=true
WALLCRAWLER_CACHE_DIR=.wallcrawler/cache
```

## Running the Demo

Start the development server:
```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Demo Scenarios

### 1. Web Scraping
Extract information from web pages using natural language commands.
- Example: "Navigate to the first book and extract its title, price, and availability"

### 2. Form Automation
Automatically fill and submit forms with structured data.
- Example: "Login with username 'standard_user' and password 'secret_sauce'"

### 3. Multi-Step Navigation
Navigate through multiple pages and perform complex workflows.
- Example: "Search for 'Artificial Intelligence' and extract the first paragraph"

### 4. Structured Data Extraction
Extract data matching a Zod schema for type-safe results.
- Example: Extract product data with specific fields validated by Zod

## Architecture

```
src/
├── app/                    # Next.js App Router
│   ├── api/               # API routes
│   │   └── wallcrawler/   # WallCrawler endpoints
│   ├── layout.tsx         # Root layout
│   └── page.tsx           # Home page
├── components/            # React components
│   ├── ui/               # Reusable UI components
│   ├── WallcrawlerDemo.tsx
│   ├── ActionForm.tsx
│   ├── ResultsDisplay.tsx
│   └── StatusIndicator.tsx
└── lib/                   # Utilities
    ├── wallcrawler-client.ts
    ├── demo-scenarios.ts
    └── utils.ts
```

## API Endpoints

### POST /api/wallcrawler
Start a new automation task.

Request:
```json
{
  "url": "https://example.com",
  "command": "Extract the page title",
  "model": "openai",
  "schema": "z.object({ title: z.string() })"
}
```

Response:
```json
{
  "sessionId": "uuid-v4"
}
```

### GET /api/wallcrawler/status
Check the status of an automation task.

Query params:
- `sessionId`: The session ID from the POST request

Response:
```json
{
  "status": "running",
  "message": "Executing automation...",
  "progress": 70
}
```

### GET /api/wallcrawler/artifacts
Retrieve the results and artifacts from a completed task.

Query params:
- `sessionId`: The session ID
- `type`: (optional) Artifact type (e.g., "screenshot")
- `id`: (optional) Artifact ID

## Local Storage

The demo uses the local filesystem provider which stores data in:

```
.wallcrawler/
├── demo/
│   ├── screenshots/     # Captured screenshots
│   ├── cache/          # Cached browser data
│   └── logs/           # Execution logs
```

## Customization

### Adding New Scenarios

1. Edit `src/lib/demo-scenarios.ts` to add new scenarios
2. Update the UI in `src/app/page.tsx` to include the new tab
3. Customize the default values and example commands

### Modifying the UI

The demo uses Tailwind CSS and Radix UI components. You can:
- Edit component styles in `src/app/globals.css`
- Modify UI components in `src/components/ui/`
- Update the layout in `src/app/layout.tsx`

## Troubleshooting

### Browser Launch Issues
- Ensure Playwright dependencies are installed: `npx playwright install`
- Check that no other processes are using the required ports

### API Key Errors
- Verify your API keys are correctly set in `.env.local`
- Ensure the keys have sufficient credits/permissions

### Storage Issues
- Check write permissions for the `.wallcrawler` directory
- Clear the cache if experiencing stale data: `rm -rf .wallcrawler/cache`

## Production Deployment

For production use:
1. Use a proper session store (Redis, database) instead of in-memory storage
2. Implement authentication and rate limiting
3. Use cloud storage for artifacts instead of local filesystem
4. Configure appropriate CORS and security headers
5. Use the AWS provider (`@wallcrawler/aws`) for serverless deployment

## Contributing

See the main [WallCrawler README](../../../README.md) for contribution guidelines.

## License

MIT - See the [LICENSE](../../../LICENSE) file for details.