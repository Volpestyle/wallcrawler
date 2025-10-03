# Wallcrawler CDK Deployment Guide

## Quick Start

```bash
# Development
npm run deploy:dev

# Staging
npm run deploy:staging

# Production
npm run deploy:prod
```

## What Happens During Deployment

1. **Pre-deployment Checks**
   - ✅ AWS credentials validation
   - ✅ Docker daemon running
   - ✅ Go functions built automatically
   - ✅ CDK bootstrap verification
   - ⚠️ Production requires explicit confirmation

2. **Deployment**
   - Builds TypeScript CDK code
   - Deploys infrastructure to AWS
   - Creates/updates all resources

3. **Post-deployment** (Automatic)
   - Generates `wallcrawler-config.txt` with all configuration values
   - Seeds the default project/API key (see `wallcrawler-api-key.txt` for the raw key)

## Environment Configurations

| Environment | API Endpoint | Key Differences | Idle Cost |
|------------|--------------|-----------------|-----------|
| **dev** | CloudFront distribution (auto, stage `dev`) | - Lambdas run outside the VPC<br>- NAT gateway and WAF disabled<br>- Pay-per-use services only | <$2/month |
| **staging** | CloudFront distribution (auto, stage `staging`) | - Lambdas run inside private subnets<br>- NAT gateway + WAF enabled<br>- Identical runtime config to prod | ~$50/month |
| **prod** | CloudFront distribution or custom domain | - Lambdas in private subnets<br>- NAT gateway + WAF enabled<br>- Optional Secrets Manager rotation | ~$50/month (+ custom domain fees) |

## Cost Breakdown (Idle Infrastructure)

### Resources with Ongoing Costs

| Resource | dev | staging/prod | Notes |
|----------|-----|--------------|-------|
| **NAT Gateway** | $0 | ~$45/month | Created when `environment` is not `dev` |
| **AWS WAF (regional)** | $0 | ~$7/month | Base fee + managed rule set |
| **Secrets Manager** | ~$0.40/month | ~$0.40/month | Stores the JWT signing key |
| **CloudWatch Logs** | ~$0.50/month | ~$0.50/month | Assuming 7-day retention per log group |
| **Total Idle Cost** | **< $2/month** | **≈ $52/month** | Before usage-based services |

### Zero-Cost When Idle (Pay-Per-Use)

| Resource | Billing Model | Notes |
|----------|---------------|--------|
| **API Gateway + CloudFront** | Per request / data transfer | CloudFront fronts API Gateway in every environment |
| **Lambda Functions** (16x) | Per invocation | All handlers are serverless |
| **DynamoDB Tables** | On-demand | Sessions, projects, API keys, contexts |
| **SNS & EventBridge** | Per request/event | Drive the synchronous session workflow |
| **ECS Fargate** | Per task hour | Billed only while browser containers run |

The architecture is designed to minimize idle costs by using serverless and pay-per-use services wherever possible.

## Generated Configuration File

### `wallcrawler-config.txt`
```bash
# API Access
WALLCRAWLER_API_URL=<CLOUDFRONT_DOMAIN_FROM_APIGATEWAYURL_OUTPUT>
WALLCRAWLER_AWS_API_KEY=7j9km0WaXj...
WALLCRAWLER_PROJECT_ID=default

# JWT Authentication (for Direct Mode)
WALLCRAWLER_JWT_SIGNING_KEY=base64-encoded-key

# AWS Resources (internal use)
WALLCRAWLER_DYNAMODB_TABLE=wallcrawler-sessions
# ... other AWS resources
```

If the generated file leaves `WALLCRAWLER_API_URL` (or `WALLCRAWLER_PUBLIC_API_URL`) blank, copy the `APIGatewayURL` stack output—the CloudFront domain—and fill it in manually. Copy the variables you need to your application's `.env` file.

## Post-deployment Initialization

The deploy script now seeds a default project (`project_default`) and issues a fresh Wallcrawler API key automatically. The raw key is written to `packages/aws-cdk/wallcrawler-api-key.txt`—store it somewhere secure (password manager, Secrets Manager, etc.) and delete the local copy when you are finished. We intentionally do **not** publish this file or `wallcrawler-config.txt` as CI artifacts; GitHub artifacts are decrypted for any collaborator with repository access, so we pull the values locally instead.

Recommended workflow:

1. Let the GitHub Actions deployment finish (it already runs the bootstrap script).
2. On your workstation, run `pnpm --filter @wallcrawler/aws-cdk run post-deploy` if you need to reseed the tables or rotate the default key. Re-running is idempotent: the script skips the project insert when it already exists and only creates a new API key when the table is empty.
3. Run `pnpm --filter @wallcrawler/aws-cdk generate-env` to pull the latest CloudFormation outputs and API key value into a fresh `wallcrawler-config.txt`.
4. Copy the required values into your application’s `.env` file, then securely store or remove the generated files.

### AWS API Gateway Key

- CDK provisions a separate AWS API Gateway key (`wallcrawler-internal-api-key`) for the internal API endpoint. A custom resource copies the live key value into the Lambda authorizer’s environment and the stack exposes the key ID (and a convenience CLI command) as outputs.
- `generate-env-local.sh` runs `aws apigateway get-api-key --include-value` so the generated `wallcrawler-config.txt` contains the decrypted value under `WALLCRAWLER_AWS_API_KEY`. Handle it like any other secret—store it in your vault if you plan to call the internal API directly and keep it out of source control.
- Rotation: delete the key in API Gateway or trigger the bootstrap script to recreate it. The custom resource will propagate the new value to the authorizer on the next deploy; update your secret store accordingly.

## Observability

- For a full map of CloudWatch log groups, ECS Container Insights, and CloudTrail pointers, see [docs/infra/OBSERVABILITY.md](../infra/OBSERVABILITY.md).
- Session-specific logging queries remain in [CloudWatch logging best practices](../api/sessions/cloudwatch-logging-best-practices.md).
- GitHub Actions deployment logs mirror local `pnpm cdk:<env>` output; combine them with the CloudWatch groups above when diagnosing issues.

If you want to add additional tenants or keys manually, the AWS CLI snippets below remain valid:

```bash
# Add another project
aws dynamodb put-item \
  --table-name wallcrawler-projects \
  --item '{"projectId":{"S":"project_beta"},"name":{"S":"Beta Project"},"defaultTimeout":{"N":"3600"},"concurrency":{"N":"5"},"status":{"S":"ACTIVE"},"createdAt":{"S":"$(date -u +%Y-%m-%dT%H:%M:%SZ)"},"updatedAt":{"S":"$(date -u +%Y-%m-%dT%H:%M:%SZ)"}}'

# Add an API key (replace RAW_KEY with your secret)
RAW_KEY="wc_example_key"
KEY_HASH=$(python - <<'EOF'
import hashlib, os
print(hashlib.sha256(os.environ['RAW_KEY'].encode()).hexdigest())
EOF
)
aws dynamodb put-item \
  --table-name wallcrawler-api-keys \
  --item '{"apiKeyHash":{"S":"'"${KEY_HASH}"'"},"projectId":{"S":"project_default"},"projectIds":{"L":[{"S":"project_default"}]},"status":{"S":"ACTIVE"},"createdAt":{"S":"$(date -u +%Y-%m-%dT%H:%M:%SZ)"}}'
```

Contexts are stored in the automatically created S3 bucket (`CONTEXTS_BUCKET_NAME` in the generated config).

## Managing Contexts

Contexts capture reusable Chrome profiles (cookies, local storage, etc.) and are scoped per project.

### Create a Context

```bash
curl -X POST "$WALLCRAWLER_API_URL/v1/contexts" \
  -H "x-wc-api-key: $WALLCRAWLER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"projectId":"project_default"}'
```

The response includes a pre-signed S3 `uploadUrl`. Upload a tar.gz archive of the Chrome profile directory within 15 minutes. The archive is stored at `s3://$CONTEXTS_BUCKET_NAME/<projectId>/<contextId>/profile.tar.gz`.

### Retrieve Context Metadata

```bash
curl "$WALLCRAWLER_API_URL/v1/contexts/$CONTEXT_ID" \
  -H "x-wc-api-key: $WALLCRAWLER_API_KEY"
```

### Refresh Upload URL (persist changes)

```bash
curl -X PUT "$WALLCRAWLER_API_URL/v1/contexts/$CONTEXT_ID" \
  -H "x-wc-api-key: $WALLCRAWLER_API_KEY"
```

### Session Creation with Context

When creating a session, supply the `context.id` and set `persist` to decide whether the controller should re-upload the profile after the session ends:

```jsonc
{
  "projectId": "project_default",
  "browserSettings": {
    "context": {
      "id": "$CONTEXT_ID",
      "persist": true
    }
  }
}
```

> **Security note:** Wallcrawler enforces isolation at the project level. If you need per-user boundaries, record the user ID alongside each context in your application and filter before calling the Wallcrawler API.

## Prerequisites

- AWS CLI configured (`aws configure`)
- Docker Desktop running
- Node.js 18+ and npm
- Go 1.20+ (for Lambda functions)
- CDK bootstrapped: `cdk bootstrap aws://ACCOUNT-ID/REGION`

## First Time Setup

```bash
# Install dependencies
npm install

# Bootstrap CDK (one time per account/region)
npm run bootstrap

# Deploy to dev
npm run deploy:dev
```

## Destroy Stack

```bash
# Development/Staging
npm run destroy:dev
npm run destroy:staging

# Production (requires manual confirmation)
cdk destroy --all --context environment=prod
```

## Custom Domain (Optional)

For production with custom domain:
```bash
export CDK_CONTEXT_DOMAIN_NAME=api.wallcrawler.com
npm run deploy:prod
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Docker daemon not running" | Start Docker Desktop |
| "CDK not bootstrapped" | Run `npm run bootstrap` |
| "Go build failed" | Check Go installation: `go version` |
| "JWT secret not found" | Will be created automatically on first deploy |

## Cost Breakdown

- **dev**: <$2/month (Secrets Manager + CloudWatch logs)
- **staging/prod**: ≈$52/month base before traffic
  - NAT Gateway: ~$45/month
  - AWS WAF managed rule set: ~$7/month
  - Lambda, API Gateway, CloudFront, DynamoDB, SNS, EventBridge, ECS: pay per use
