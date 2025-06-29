# CLAUDE.md

THE CODE COMMANDMENTS:

1. Always properly type, never use any, and try not to typecast unless absolutely necessary.
2. Never code fallback data. Always use the real deal, all or nothin. And don't try to maintain backwarrds compatibility with changes unless asked to.
3. Leave all the testing (pnpm dev) to I, The Human.

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

WallCrawler is an AI-powered browser automation framework built as a monorepo. It extends Playwright with natural language commands via LLM integration, replacing fragile CSS selectors with AI-powered web interactions. The project is forked from Stagehand and includes custom infrastructure providers for different deployment environments.

## Monorepo Structure

- `packages/stagehand/` - Core AI browser automation library (fork of Stagehand)
- `packages/demos/nextjs-local/` - Next.js demo application
- `packages/infra/local/` - Local development infrastructure provider
- `packages/infra/aws/` - AWS cloud infrastructure provider
- `packages/deploy/aws-cdk/` - AWS CDK infrastructure templates

## Development Commands

```bash
# Root level commands (run from project root)
pnpm install              # Install all dependencies
pnpm build               # Build all packages
pnpm dev                 # Start all packages in development mode
pnpm test                # Run tests across all packages
pnpm lint                # Run ESLint across all packages
pnpm lint:fix            # Auto-fix ESLint issues
pnpm typecheck           # TypeScript checking across packages
pnpm format              # Format code with Prettier
pnpm clean               # Clean all dist and node_modules

# Demo-specific commands (run from packages/demos/nextjs-local/)
pnpm dev                 # Start Next.js development server
pnpm build               # Build Next.js application
pnpm start               # Start production server
pnpm lint                # Run Next.js ESLint
pnpm typecheck           # TypeScript checking

# Core package commands (run from packages/stagehand/)
pnpm build               # Build core library
pnpm lint                # Run linting
pnpm build-dom-scripts   # Build DOM utility scripts
```

## Prerequisites

- Node.js 18+
- pnpm 10.11.0+ (specified in packageManager)
- Playwright: `npx playwright install` (for browser dependencies)
- At least one LLM provider configured (OpenAI, Anthropic, or Ollama)

## Core AI Browser Automation API

WallCrawler extends Playwright's Page class with three main AI methods:

### act() - Perform Actions

```typescript
await page.act('Click the sign in button');
await page.act("Type 'hello world' in the search box");
```

### extract() - Extract Structured Data

```typescript
const data = await page.extract({
  instruction: 'Extract product information',
  schema: z.object({
    title: z.string(),
    price: z.string(),
    availability: z.boolean(),
  }),
});
```

### observe() - Analyze Elements

```typescript
const [action] = await page.observe('Click the sign in button');
await page.act(action); // Use cached result for reliability
```

### agent() - Autonomous Multi-Step Tasks

```typescript
const agent = stagehand.agent({
  provider: 'openai',
  model: 'gpt-4o',
});
await agent.execute('Navigate to the checkout and complete the purchase');
```

## Environment Configuration

Create `.env.local` files with LLM provider credentials:

```bash
# OpenAI
OPENAI_API_KEY=sk-your-key
OPENAI_MODEL=gpt-4o

# Anthropic
ANTHROPIC_API_KEY=sk-ant-your-key
ANTHROPIC_MODEL=claude-3-5-sonnet-20241022

# Ollama (local)
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3
```

## Architecture Patterns

### Provider Pattern

- Pluggable infrastructure via `IBrowserProvider` interface
- Local provider for development (`@wallcrawler/infra/local`)
- AWS provider for cloud deployment (`@wallcrawler/infra/aws`)

### Workspace Dependencies

- Uses `workspace:*` for internal package dependencies
- Requires `pnpm build` after core package changes
- Hot reload available for demo development

### Caching Best Practices

Always cache `observe()` results before using with `act()`:

```typescript
const cachedAction = await getCache(instruction);
if (cachedAction) {
  await page.act(cachedAction);
} else {
  const results = await page.observe(instruction);
  await setCache(instruction, results);
  await page.act(results[0]);
}
```

## Testing Strategy

- Run `pnpm test` from root for all packages
- Individual package tests available in each package directory
- Core automation tests in `packages/stagehand/`
- Demo integration tests in `packages/demos/nextjs-local/`

## Key File Locations

- Stagehand configuration: `packages/demos/nextjs-local/stagehand.config.ts`
- Demo scenarios: `packages/demos/nextjs-local/src/lib/demo-scenarios.ts`
- Core library entry: `packages/stagehand/lib/index.ts`
- Local provider: `packages/infra/local/src/LocalProvider.ts`
- AWS provider: `packages/infra/aws/src/AwsProvider.ts`

## Development Workflow

1. Make changes to core packages (`packages/stagehand/`, `packages/infra/`)
2. Run `pnpm build` from root to rebuild packages
3. Test changes in demo: `cd packages/demos/nextjs-local && pnpm dev`
4. Run linting/typechecking before commits: `pnpm lint && pnpm typecheck`
5. Use `pnpm changeset` for versioning when publishing

## Schema Validation

All structured data extraction uses Zod schemas:

- Use `z.string().url()` for URL fields
- Wrap arrays in objects: `z.object({ items: z.array(z.string()) })`
- Enable strict validation for production data extraction
