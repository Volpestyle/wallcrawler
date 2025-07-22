# Wallcrawler Next.js Local Demo

A modern, sleek Next.js application for experimenting with Wallcrawler browser automation using the local provider. This demo provides a comprehensive UI dashboard for managing sessions, creating workflows, and testing Stagehand methods.

## Features

- **Session Management**: Create, view, and manage browser automation sessions
- **Stagehand Playground**: Interactive testing environment for act, extract, observe, and agent methods
- **Workflow Builder**: Create and manage reusable automation workflows
- **Real-time Metrics**: Monitor token usage, inference times, and performance
- **Modern UI**: Dark theme with Shadcn UI components and Tailwind CSS

## Tech Stack

- **Framework**: Next.js 14 with App Router
- **UI Components**: Shadcn UI with Radix primitives
- **Styling**: Tailwind CSS with dark theme
- **Fonts**: Inter (body) and JetBrains Mono (code)
- **State Management**: React hooks with SWR for data fetching
- **Validation**: Zod schemas
- **Backend**: @wallcrawler/stagehand with @wallcrawler/infra-local provider

## Getting Started

### Prerequisites

- Node.js 18.0.0 or higher
- pnpm package manager
- Access to the Wallcrawler monorepo

### Installation

From the monorepo root:

```bash
# Install dependencies
pnpm install

# Navigate to the demo package
cd packages/demos/nextjs-local

# Start the development server
pnpm dev
```

The application will be available at [http://localhost:3000](http://localhost:3000).

### Development

```bash
# Development mode
pnpm dev

# Build for production
pnpm build

# Start production server
pnpm start

# Type checking
pnpm typecheck

# Linting
pnpm lint
```

## Application Structure

```
src/
├── app/                    # Next.js App Router pages
│   ├── globals.css        # Global styles and theme
│   ├── layout.tsx         # Root layout with sidebar
│   ├── page.tsx           # Dashboard page
│   ├── sessions/          # Session management pages
│   ├── playground/        # Stagehand testing interface
│   └── api/               # API routes for Stagehand operations
├── components/            # React components
│   ├── ui/                # Shadcn UI components
│   └── Sidebar.tsx        # Navigation sidebar
├── lib/                   # Utilities and services
│   ├── utils.ts           # Shadcn utility functions
│   └── stagehand-service.ts # Stagehand integration service
└── types/                 # TypeScript type definitions
    └── stagehand.ts       # Stagehand-related types
```

## Pages

### Dashboard (`/`)

- Overview of active sessions and workflows
- Quick action buttons for common tasks
- Real-time metrics display
- Recent activity feed

### Sessions (`/sessions`)

- List all browser automation sessions
- Create new sessions with custom options
- View session details and debug URLs
- Close active sessions

### Playground (`/playground`)

- Interactive interface for testing Stagehand methods
- Tabbed interface for act, extract, observe, and agent
- Real-time results display
- Schema validation for extract operations

### Workflows (`/workflows`) _(Planned)_

- Create and manage automation workflows
- Drag-and-drop workflow builder
- Run workflows and view results
- Workflow templates and sharing

## API Routes

### Session Management

- `GET /api/sessions` - List all sessions
- `POST /api/sessions` - Create new session
- `GET /api/sessions/[id]` - Get session details
- `DELETE /api/sessions/[id]` - Close session

### Stagehand Operations

- `POST /api/stagehand/act` - Execute action
- `POST /api/stagehand/extract` - Extract data
- `POST /api/stagehand/observe` - Observe elements
- `POST /api/stagehand/agent` - Run agent
- `POST /api/stagehand/navigate` - Navigate to URL

## Configuration

The application uses the local provider by default with the following settings:

```typescript
{
  provider: new LocalProvider(),
  verbose: 1,
  enableCaching: true,
  modelName: 'default', // Configurable per session
}
```

## Development Notes

- **Local Only**: This application is designed for local development and experimentation
- **No Authentication**: No user authentication required for localhost usage
- **Singleton Service**: Uses a singleton Stagehand service to manage multiple sessions
- **Error Handling**: Comprehensive error handling with user-friendly messages
- **Type Safety**: Full TypeScript integration with proper typing

## Customization

### Theme

Modify colors in `src/app/globals.css` and `tailwind.config.js`:

```css
:root {
  --primary: 217.2 91.2% 59.8%; /* Blue accent */
  --background: 222.2 84% 4.9%; /* Dark background */
  /* ... other CSS variables */
}
```

### Components

Add new Shadcn components:

```bash
npx shadcn-ui@latest add [component-name]
```

### API Integration

Extend the Stagehand service in `src/lib/stagehand-service.ts` for additional functionality.

## Troubleshooting

### Common Issues

1. **Dependencies not found**: Run `pnpm install` from the monorepo root
2. **Port conflicts**: Change the port in `package.json` dev script
3. **Type errors**: Ensure all workspace dependencies are built (`pnpm build`)

### Browser Issues

- Ensure Playwright browsers are installed
- Check browser permissions for the local provider
- Verify no other automation tools are running

## Contributing

This is a demo application within the Wallcrawler monorepo. Follow the main repository's contribution guidelines.

## License

MIT - See the main repository's LICENSE file.
