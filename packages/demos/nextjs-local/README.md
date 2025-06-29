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
- At least one LLM provider:
  - **OpenAI**: API key and model name
  - **Anthropic**: API key and model name
  - **Ollama**: Local installation with a model downloaded

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

4. Set up your environment variables:

```bash
# Copy the example file
cp .env.example .env

# Edit .env.local with your preferred text editor
```

Example `.env.local` configuration:

```env.local
# For OpenAI (cloud)
OPENAI_API_KEY=sk-your-openai-api-key-here
OPENAI_MODEL=gpt-4o

# For Anthropic (cloud)
ANTHROPIC_API_KEY=sk-ant-your-anthropic-api-key-here
ANTHROPIC_MODEL=claude-3-5-sonnet-20241022

# For Ollama (local) - requires Ollama to be running
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3
```

### Setting up Ollama (for local models)

1. Install Ollama from [ollama.ai](https://ollama.ai)
2. Download a model:

```bash
ollama pull llama3
# or try other models like: qwen, mistral, codellama
```

3. Verify Ollama is running:

```bash
curl http://localhost:11434/api/tags
```

## Running the Demo

Start the development server:

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Demo Scenarios

The demo showcases all core WallCrawler/Stagehand methods:

### 1. AI Agent (Multi-Step Automation)

Uses Stagehand's agent system for complex, multi-step tasks.

- **Method**: `stagehand.agent().execute()`
- **Example**: "Navigate the e-commerce site and add the most expensive item to cart"
- **Note**: Currently supports OpenAI and Anthropic models only

### 2. Act Method (Page Actions)

Perform specific actions on web pages like clicking, typing, scrolling.

- **Method**: `stagehand.page.act()`
- **Example**: "Click on the first product to view its details"
- **Use case**: Automating user interactions

### 3. Observe Method (Element Discovery)

Observe and describe elements on the page without taking actions.

- **Method**: `stagehand.page.observe()`
- **Example**: "Describe all the books visible on the page and their properties"
- **Use case**: Understanding page structure and content

### 4. Extract Method (Structured Data)

Extract structured data that matches a specific Zod schema.

- **Method**: `stagehand.page.extract()`
- **Example**: Extract book data with title, price, rating, and availability
- **Use case**: Scraping data in a type-safe, validated format

### 5. Act + Extract Combo

Demonstrates combining actions with data extraction for complex workflows.

- **Methods**: `stagehand.page.act()` followed by `stagehand.page.extract()`
- **Example**: "Search for 'Artificial Intelligence', click the first result, and extract the summary"
- **Use case**: Navigation followed by data collection

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

### Ollama Issues

- **"OLLAMA_BASE_URL environment variable not found"**: Make sure you've set `OLLAMA_BASE_URL=http://localhost:11434` in your `.env.local` file
- **Connection refused**: Ensure Ollama is running (`ollama serve` or restart the Ollama app)
- **Model not found**: Download the model first (`ollama pull llama3`)
- **Slow responses**: Local models may be slower than cloud APIs, especially on CPU-only machines

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
