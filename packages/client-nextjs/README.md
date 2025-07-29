# Wallcrawler Dashboard

A sleek, minimal dashboard for testing Wallcrawler features via Stagehand instances. Built with Next.js 15, Tailwind CSS v4, and TypeScript.

## Features

- **Session Management** - Create and manage multiple browser automation sessions
- **Workflow Builder** - Drag-and-drop interface for building automation workflows
- **Dual Mode Support** - Run sessions locally or in AWS infrastructure via Wallcrawler
- **Dark Theme** - Modern dark mode UI with clean, minimal design
- **Real-time Updates** - Live session status and test output monitoring

## Prerequisites

- Node.js 18+
- pnpm 8+
- Wallcrawler API credentials (for cloud sessions)

## Installation

1. Clone the repository and navigate to the client-nextjs directory:
```bash
cd packages/client-nextjs
```

2. Install dependencies:
```bash
pnpm install
```

3. Create environment configuration:
```bash
cp .env.example .env.local
```

4. Configure environment variables in `.env.local`:

### For Wallcrawler Cloud Sessions (AWS Infrastructure)
```bash
NEXT_PUBLIC_WALLCRAWLER_API_KEY=your_wallcrawler_api_key_here
NEXT_PUBLIC_WALLCRAWLER_PROJECT_ID=your_wallcrawler_project_id_here
```

### For Local Sessions
No additional configuration needed - you'll specify the Stagehand URL when creating a session.

## Running the Dashboard

Start the development server:
```bash
pnpm dev
```

The dashboard will be available at `http://localhost:3000`

## Usage

### Creating Sessions

1. Click the **"+ New Session"** button in the Sessions panel
2. Choose your session type:
   - **Wallcrawler** - Runs in AWS infrastructure (requires API key)
   - **Local** - Connects to a local Stagehand server

### Wallcrawler Sessions
- Automatically uses your configured API key
- Sessions run in AWS infrastructure
- No local browser or Stagehand server needed
- Ideal for production and scalable automation

### Local Sessions
- Enter your Stagehand server URL (e.g., `http://localhost:3000`)
- Requires a running Stagehand instance
- Good for development and debugging

### Building Workflows

1. Navigate to the **Workflows** tab
2. Click **"+ New Workflow"** to create a workflow
3. Drag and drop steps to build your automation:
   - Navigate to URL
   - Click elements
   - Extract data
   - Take screenshots
   - Run custom scripts
4. Connect steps by dragging between them
5. Save your workflow for reuse

### Running Tests

1. Select a test category from the dashboard
2. Choose specific test actions
3. Click **"Run Test"** to execute
4. View real-time output in the test results panel

## Project Structure

```
client-nextjs/
├── app/                    # Next.js app directory
│   ├── layout.tsx         # Root layout with providers
│   ├── page.tsx           # Main dashboard page
│   └── globals.css        # Global styles and Tailwind config
├── components/            # React components
│   ├── ui/               # Reusable UI components
│   ├── layout/           # Layout components
│   ├── sessions/         # Session management components
│   └── workflows/        # Workflow builder components
├── lib/                   # Utilities and services
│   ├── api/              # API clients (Stagehand, Wallcrawler)
│   ├── stores/           # Zustand state management
│   ├── types/            # TypeScript type definitions
│   └── utils.ts          # Utility functions
└── public/               # Static assets
```

## Architecture

### State Management
- **Zustand** for global state management
- Persistent storage for sessions and workflows
- Real-time updates via store subscriptions

### API Integration
- **Stagehand Client** - Full TypeScript client for browser automation
- **Wallcrawler Client** - Integration with AWS infrastructure
- Proper error handling and loading states

### UI Components
- Built with Radix UI primitives
- Styled with Tailwind CSS v4
- Fully typed with TypeScript
- Accessible with ARIA support

## Development

### Adding New Components
Components follow a consistent pattern:
```tsx
import { cn } from '@/lib/utils';

interface ComponentProps {
  className?: string;
  // ... other props
}

export function Component({ className, ...props }: ComponentProps) {
  return (
    <div className={cn('base-styles', className)} {...props}>
      {/* Component content */}
    </div>
  );
}
```

### Adding New Test Features
1. Add test configuration to the appropriate section in `app/page.tsx`
2. Implement the test logic in the API client
3. Update types in `lib/types/stagehand.ts`

### Styling Guidelines
- Use Tailwind CSS classes
- Follow the established color system (CSS variables)
- Maintain consistent spacing and sizing
- Keep animations subtle and smooth

## Scripts

- `pnpm dev` - Start development server
- `pnpm build` - Build for production
- `pnpm start` - Start production server
- `pnpm lint` - Run ESLint

## Troubleshooting

### Wallcrawler Sessions Not Working
- Verify your API key and project ID are correct
- Check the browser console for error messages
- Ensure your API key has the necessary permissions

### Local Sessions Connection Failed
- Verify Stagehand is running on the specified URL
- Check for CORS issues if Stagehand is on a different port
- Ensure the URL includes the protocol (http:// or https://)

### UI Components Not Rendering
- Clear Next.js cache: `rm -rf .next`
- Reinstall dependencies: `pnpm install`
- Check for TypeScript errors: `pnpm tsc --noEmit`

## Contributing

1. Follow the existing code style and conventions
2. Add proper TypeScript types for new features
3. Test thoroughly with both session types
4. Update this README for significant changes

## License

[Your License Here]