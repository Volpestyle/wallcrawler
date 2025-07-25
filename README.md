# Wallcrawler

> **Serverless Browser Automation Platform using AWS and Stagehand**

Wallcrawler is a serverless browser automation platform that integrates Stagehand for LLM-driven automation. Similar to Browserbase or Browserless.io, but designed as an in-house solution leveraging AWS infrastructure for scalable browser sessions.

## 📖 Overview

Wallcrawler provides:

- **Remote Browser Sessions**: AWS ECS-based browser instances with WebSocket streaming
- **LLM Integration**: Powered by Stagehand for intelligent browser automation
- **Serverless Architecture**: Lambda functions with API Gateway and EventBridge coordination
- **WebSocket Streaming**: Real-time browser viewport streaming and interaction
- **SDK & Components**: Client libraries and React components for easy integration

## 🏗️ Architecture

For detailed architecture documentation, see [docs/wallcrawler-design-doc.md](./docs/wallcrawler-design-doc.md).

Key components:

- **API Gateway** → Lambda handlers for session management
- **ECS Tasks** → Browser instances with Stagehand integration
- **Redis** → Session state and metadata storage
- **EventBridge** → Session lifecycle coordination
- **WebSocket API** → Real-time browser streaming

## 📦 Packages

This monorepo contains the following packages:

| Package           | Description                              | Language         |
| ----------------- | ---------------------------------------- | ---------------- |
| `util-ts`         | Shared TypeScript types and utilities    | TypeScript       |
| `util-go`         | Shared Go utilities and modules          | Go               |
| `wallcrawler-sdk` | Client-side SDK (like Browserbase SDK)   | TypeScript       |
| `components`      | React components for browser viewing     | TypeScript/React |
| `aws-cdk`         | AWS Infrastructure as Code               | TypeScript       |
| `backend-go`      | Lambda handlers and ECS controller       | Go               |
| `client-nextjs`   | Demo Next.js client application          | TypeScript/React |
| `stagehand`       | Forked Stagehand library (git submodule) | TypeScript       |

## 🚀 Quick Start

### Prerequisites

- Node.js >= 18.0.0
- pnpm >= 8.0.0
- Go >= 1.21
- AWS CLI configured
- Docker (for local development)

### Installation

1. **Clone the repository**:

   ```bash
   git clone <repository-url>
   cd wallcrawler
   ```

2. **Initialize submodules**:

   ```bash
   git submodule update --init --recursive
   # or
   pnpm run install:submodules
   ```

3. **Install dependencies**:

   ```bash
   pnpm install
   ```

4. **Build all packages**:
   ```bash
   pnpm run build
   ```

### Development

- **Start development servers**: `pnpm run dev`
- **Run tests**: `pnpm run test`
- **Lint code**: `pnpm run lint`
- **Clean build artifacts**: `pnpm run clean`

## 📋 Project Structure

```
wallcrawler/
├── packages/
│   ├── util-ts/          # Shared TypeScript utilities
│   ├── util-go/          # Shared Go utilities
│   ├── wallcrawler-sdk/  # Client SDK
│   ├── components/       # React components
│   ├── aws-cdk/          # Infrastructure code
│   ├── backend-go/       # Go Lambda handlers
│   ├── client-nextjs/    # Demo client app
│   └── stagehand/        # Stagehand library (submodule)
├── docs/                 # Documentation
└── [config files]       # Workspace configuration
```

## 🔧 Configuration

### Workspace Configuration

The monorepo is configured with:

- **pnpm workspaces** for package management
- **Prettier** for code formatting
- **ESLint** for linting (relaxed rules with warnings)
- **TypeScript** for type checking

### Environment Setup

Each package may require specific environment variables. See individual package README files for details.

## 📚 Documentation

- **[Design Document](./docs/wallcrawler-design-doc.md)** - Complete system architecture and specifications
- **[Architecture Diagrams](./docs/)** - Visual representations of system flows
- **[Development Prompts](./docs/prompts.md)** - Step-by-step development guidance

## 🤝 Contributing

1. Follow the naming conventions in the design document
2. Use pnpm for package management
3. Favor proper TypeScript typing over `any` or `unknown`
4. Store reusable logic in `util-ts` and `util-go` packages
5. Build packages to verify soundness before committing

## 📄 License

MIT License - see individual packages for specific licensing information.

---

**Note**: This project uses pnpm workspaces and git submodules. Make sure to run `pnpm run install:submodules` after cloning.
