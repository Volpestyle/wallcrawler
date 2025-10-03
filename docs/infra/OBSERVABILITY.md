# Wallcrawler Observability Guide

This guide summarizes where to find logs, metrics, and audit trails for the deployed infrastructure. Use it alongside the service-specific runbooks (for example, the session logging guide) when debugging incidents.

## Monitoring Surfaces

| Layer | Primary Tooling | Notes |
|-------|-----------------|-------|
| AWS CloudTrail | CloudTrail console / Athena | Tracks CDK stack updates, IAM changes, and API calls (deployments, key rotation, etc.). |
| API Gateway & CloudFront | CloudWatch Logs, Access Logs | Invoke logs live under `/aws/apigateway/<rest-api-id>`, CloudFront access logs can be shipped to S3 if enabled. |
| Lambda Functions | CloudWatch Logs | Every function writes to `/aws/lambda/<function-name>`. Use Logs Insights for structured queries. |
| ECS / Fargate Tasks | CloudWatch Logs | Task stdout/stderr available in `/aws/ecs/wallcrawler-controller`. Container metrics appear in CloudWatch Container Insights. |
| DynamoDB | CloudWatch Metrics & Streams | Streams feed the `sessions-stream-processor` Lambda; metrics (throttle, latency) viewable in CloudWatch. |
| Secrets / Parameter Access | CloudTrail | Access to Secrets Manager and SSM parameters is logged for auditing. |
| CI/CD (GitHub Actions) | GitHub Actions UI | Build logs live with each workflow run; infra deploy output mirrors local CDK commands. |

## CloudWatch Log Groups

The following log groups are created by the CDK stack (default retention shown in parentheses):

- `/aws/lambda/sessions-create` (30d)
- `/aws/lambda/sessions-list`
- `/aws/lambda/sessions-retrieve`
- `/aws/lambda/sessions-update`
- `/aws/lambda/sessions-debug`
- `/aws/lambda/sessions-downloads`
- `/aws/lambda/sessions-logs`
- `/aws/lambda/sessions-recording`
- `/aws/lambda/sessions-uploads`
- `/aws/lambda/projects-list`
- `/aws/lambda/projects-retrieve`
- `/aws/lambda/projects-usage`
- `/aws/lambda/contexts-create`
- `/aws/lambda/contexts-retrieve`
- `/aws/lambda/contexts-update`
- `/aws/lambda/sessions-stream-processor`
- `/aws/lambda/ecs-task-processor`
- `/aws/lambda/authorizer`
- `/aws/lambda/sdk-not-implemented` (legacy catch-all)
- `/aws/ecs/wallcrawler-controller`

Use the **CloudWatch Logs** console or `aws logs tail` to stream any of these groups. For ECS task-level detail, open CloudWatch → Container Insights → ECS Clusters → `wallcrawler-browsers`.

## Common Workflows

### Find a Recent Deployment

1. Open AWS CloudTrail → Event history.
2. Filter by `Event name: UpdateStack` and `Resource name: WallcrawlerStack<Env>`.
3. Expand the entry to view the IAM principal (should be the GitHub OIDC deploy role) and parameters.

### Debug API Failures

1. CloudWatch Logs → Log groups → `/aws/lambda/authorizer`. Check for authorization errors (`event_type=AUTH_FAILURE`).
2. Look at `/aws/lambda/sessions-create` or the relevant handler for application errors.
3. For throttles/5xx, run `aws cloudwatch get-metric-statistics` on API Gateway metrics (`5XXError`, `Latency`).

### Inspect Session Lifecycle

The detailed workflow remains in `docs/api/sessions/cloudwatch-logging-best-practices.md`. Start there for structured log queries focused on sessions.

### Tail Logs Locally

```bash
aws logs tail /aws/lambda/sessions-create \
  --follow \
  --since 30m \
  --profile <your-profile> \
  --region us-east-1
```

### Use CloudWatch Logs Insights

```sql
fields @timestamp, @logStream, level, message
| filter @logGroup like '/aws/lambda/sessions-create'
| filter level = 'ERROR'
| sort @timestamp desc
| limit 100
```

### ECS Task Debugging

```bash
# List recent tasks
aws ecs list-tasks --cluster wallcrawler-browsers --region us-east-1

# Describe a task for status and log stream name
aws ecs describe-tasks \
  --cluster wallcrawler-browsers \
  --tasks <task-arn> \
  --region us-east-1 \
  --query 'tasks[0].containers[0].logStreamName'

# Tail the controller logs
aws logs tail /aws/ecs/wallcrawler-controller --follow --since 1h
```

## Alarms and Metrics

- Enable CloudWatch Alarms on critical Lambda error rates (`Errors`, `Throttles`) and ECS task failures if you need proactive alerting. The CDK stack does not create alarms by default—use the `docs/infra/DYNAMODB_SCHEMA.md` thresholds and Lambda SLOs as starting points.
- Container Insights provides CPU/memory usage graphs for the `wallcrawler-browsers` cluster.

## Security & Audit

- CloudTrail logs IAM, Secrets Manager, and DynamoDB table modifications. For long-term retention, configure a CloudTrail trail to deliver to S3 with lifecycle policies.
- GuardDuty (if enabled in the account) will alert on suspicious API activity. Pair it with AWS Config rules if you need resource drift detection.

## Additional References

- [Session-specific logging guide](../api/sessions/cloudwatch-logging-best-practices.md)
- [Deployment guide](../deploy/DEPLOYMENT_GUIDE.md)
- AWS Docs: CloudWatch Logs, CloudWatch Logs Insights, CloudTrail, ECS Container Insights

