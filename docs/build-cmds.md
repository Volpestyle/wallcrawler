# Wallcrawler Build Commands

## Overview

Simple guide for building all packages in the Wallcrawler monorepo.

## Prerequisites

- Node.js 18+
- Go 1.21+
- pnpm (not npm!)
- Docker (for containerized builds)

## Quick Start - Build Everything

```bash
# Install all dependencies
pnpm install

# Build all packages
pnpm build
```

## Individual Package Builds

### Backend Go Services

```bash
cd packages/backend-go

# Build all functions for AWS deployment
make build

# Build for local development (current OS)
make dev-build

# Build only Lambda functions (excludes ECS controller)
make lambda-only

# Build ECS controller Docker image
make docker-build

# Clean build artifacts
make clean

# Download dependencies
make deps

# Format Go code
make fmt

# Run linter
make lint

# Run tests
make test

# Show all available targets
make help
```

### Node.js SDK

```bash
cd packages/sdk-node

# Build the SDK
pnpm build

# Run tests
pnpm test
```

### AWS CDK Infrastructure

```bash
cd packages/aws-cdk

# Build CDK
pnpm build

# Deploy infrastructure
pnpm deploy
```

### Stagehand

```bash
cd packages/stagehand

# Build Stagehand
pnpm build

# Run evaluations
pnpm evals
```

### Components (React)

```bash
cd packages/components

# Build components
pnpm build
```

### Next.js Client

```bash
cd packages/client-nextjs

# Build Next.js app
pnpm build

# Start development server
pnpm dev
```

## ⚠️ Important: Avoid Manual Go Builds

**DON'T** run `go build` directly in backend-go directories. This creates binaries that get committed to git.

**DO** use the Makefile commands:

- `make build` - for production builds
- `make dev-build` - for local development
- `make clean` - to clean up

## Build Outputs

### Go Builds

- Production builds: `packages/backend-go/build/`
- Development builds: `packages/backend-go/build-dev/`
- Docker images: Built and tagged locally

### Node.js Builds

- Built files go to `dist/` or `build/` directories
- All build outputs are gitignored

## Troubleshooting

### Large Repository Size

If git operations are slow, check for accidentally committed binaries:

```bash
# Check repository size
git count-objects -vH

# Find large files
git rev-list --objects --all | git cat-file --batch-check='%(objecttype) %(objectname) %(objectsize) %(rest)' | awk '/^blob/ {print substr($0,6)}' | sort -k2nr | head -10
```

### Clean Everything

```bash
# Clean all build artifacts
pnpm clean

# Clean Go builds specifically
cd packages/backend-go && make clean

# Clean node_modules and reinstall
rm -rf node_modules packages/*/node_modules
pnpm install
```
