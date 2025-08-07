### Wallcrawler Monorepo

Self‑hosted, AWS‑backed remote browser platform with Stagehand LLM browsing, compatible with Browserbase APIs. This monorepo contains the infrastructure, backend services, SDK, and UI components to run Wallcrawler in your own AWS account.

### Quick links

- **Architecture**: [docs/infra/ARCHITECTURE.md](docs/infra/ARCHITECTURE.md)
- **Event Systems**: [docs/infra/EVENT_SYSTEMS_ARCHITECTURE.md](docs/infra/EVENT_SYSTEMS_ARCHITECTURE.md)
- **DynamoDB Schema**: [docs/infra/DYNAMODB_SCHEMA.md](docs/infra/DYNAMODB_SCHEMA.md)
- **Multi‑Arch Docker**: [docs/infra/MULTI_ARCH_DOCKER_SOLUTION.md](docs/infra/MULTI_ARCH_DOCKER_SOLUTION.md)
- **Deployment Guide**: [docs/deploy/DEPLOYMENT_GUIDE.md](docs/deploy/DEPLOYMENT_GUIDE.md)
- **API Endpoints Reference**: [docs/api/api-endpoints-reference.md](docs/api/api-endpoints-reference.md)
- **SDK Integration Guide**: [docs/api/sdk-integration-guide.md](docs/api/sdk-integration-guide.md)
- **Sessions**:
  - JWT Signing Key Flow: [docs/api/sessions/jwt-signing-key-flow.md](docs/api/sessions/jwt-signing-key-flow.md)
  - Container Lifecycle: [docs/api/sessions/wallcrawler-container-lifecycle.md](docs/api/sessions/wallcrawler-container-lifecycle.md)
  - CloudWatch Logging Best Practices: [docs/api/sessions/cloudwatch-logging-best-practices.md](docs/api/sessions/cloudwatch-logging-best-practices.md)

### Packages

- `@wallcrawler/aws-cdk` — AWS CDK app defining all infrastructure (API Gateway, Lambda, ECS/Fargate, EventBridge, DynamoDB, Redis, etc.)
  - Source: [packages/aws-cdk/](packages/aws-cdk/)
  - See: [docs/infra/ARCHITECTURE.md](docs/infra/ARCHITECTURE.md) and [docs/deploy/DEPLOYMENT_GUIDE.md](docs/deploy/DEPLOYMENT_GUIDE.md)

- `@wallcrawler/backend-go` — Go Lambda handlers and services for SDK‑compatible endpoints and orchestration
  - Source: [packages/backend-go/](packages/backend-go/)
  - README: [packages/backend-go/README.md](packages/backend-go/README.md)

- `@wallcrawler/sdk-node` — TypeScript/Node client for Wallcrawler’s REST API (Browserbase‑compatible)
  - Source: [packages/sdk-node/](packages/sdk-node/)
  - README: [packages/sdk-node/README.md](packages/sdk-node/README.md)
  - API: [packages/sdk-node/api.md](packages/sdk-node/api.md)

- `@wallcrawler/stagehand` — Stagehand fork used by Wallcrawler for LLM‑powered browsing
  - Source: [packages/stagehand/](packages/stagehand/)
  - README: [packages/stagehand/README.md](packages/stagehand/README.md)

- `@wallcrawler/components` — UI components (e.g., `BrowserViewport`) for embedding live sessions
  - Source: [packages/components/](packages/components/)

### Prerequisites

- Node.js >= 18 and pnpm >= 8
- Go >= 1.21 (for backend)
- AWS CLI configured for your target account
- Docker (for local builds and multi‑arch images)

### Getting started

```bash
# 1) Initialize submodules (if any)
pnpm install:submodules

# 2) Install dependencies
pnpm install

# 3) Build everything
pnpm build

# 4) Generate local env (CDK helpers)
pnpm generate-env

# 5) Deploy (see Deployment Guide for environments/config)
pnpm deploy
```

Additional scripts:

- Lint: `pnpm lint`
- Tests: `pnpm test`
- Dev (package‑scoped): `pnpm -r dev`
- CDK Toolkit: `pnpm cdk`

### API compatibility

Wallcrawler provides Browserbase‑compatible APIs and Stagehand endpoints. For exact routes, request/response shapes, and streaming behavior, see:

- docs/api/api-endpoints-reference.md
- docs/api/sdk-integration-guide.md

### Architecture overview

High‑level design, event flows, and data models are covered in the docs referenced above. For a visual, see [docs/infra/wallcrawler-aws-architecture.png](docs/infra/wallcrawler-aws-architecture.png).
