# Wallcrawler DynamoDB Schema

## Table: wallcrawler-sessions

### Overview

The `wallcrawler-sessions` table is the single source of truth for all browser session data in the Wallcrawler platform.

### Table Configuration

```
Table Name: wallcrawler-sessions
Billing Mode: PAY_PER_REQUEST (On-Demand)
Time to Live: Enabled on 'expiresAt' attribute
Point-in-Time Recovery: Enabled
```

### Primary Key

- **Partition Key**: `sessionId` (String)
  - Format: `sess_[8-character-uuid]`
  - Example: `sess_a1b2c3d4`

### Attributes

| Attribute               | Type   | Required | Description                                                                                  |
| ----------------------- | ------ | -------- | -------------------------------------------------------------------------------------------- |
| `sessionId`             | String | Yes      | Unique session identifier                                                                    |
| `status`                | String | Yes      | Session state: CREATING, PROVISIONING, STARTING, READY, ACTIVE, TERMINATING, STOPPED, FAILED |
| `projectId`             | String | Yes      | Project identifier for multi-tenancy (e.g., "jobseek", "research")                           |
| `connectUrl`            | String | No       | Authenticated WebSocket URL for CDP connection                                               |
| `publicIP`              | String | No       | ECS task public IP address                                                                   |
| `signingKey`            | String | No       | JWT signing key for CDP authentication                                                       |
| `ecsTaskArn`            | String | No       | ECS task ARN for container management                                                        |
| `userMetadata`          | Map    | No       | Client-defined metadata including userId                                                     |
| `modelConfig`           | Map    | No       | LLM configuration if using API mode                                                          |
| `createdAt`             | Number | Yes      | Unix timestamp of session creation                                                           |
| `updatedAt`             | Number | Yes      | Unix timestamp of last update                                                                |
| `expiresAt`             | Number | Yes      | TTL timestamp (1 hour from creation)                                                         |
| `provisioningStartedAt` | Number | No       | Unix timestamp when provisioning started                                                     |
| `readyAt`               | Number | No       | Unix timestamp when session became ready                                                     |
| `lastActiveAt`          | Number | No       | Unix timestamp of last activity                                                              |
| `terminatedAt`          | Number | No       | Unix timestamp when session was terminated                                                   |
| `eventHistory`          | List   | No       | Array of session events for audit trail                                                      |
| `resourceLimits`        | Map    | No       | Resource constraints for the session                                                         |
| `billingInfo`           | Map    | No       | Usage tracking for cost allocation                                                           |

### Global Secondary Indexes

#### GSI1: projectId-createdAt-index

- **Purpose**: Efficiently query all sessions for a specific project
- **Partition Key**: `projectId` (String)
- **Sort Key**: `createdAt` (Number)
- **Projection**: ALL_ATTRIBUTES
- **Use Cases**:
  - List all sessions for a project
  - Filter sessions by date range
  - Multi-tenant session isolation

#### GSI2: status-expiresAt-index

- **Purpose**: Find active sessions nearing expiration
- **Partition Key**: `status` (String)
- **Sort Key**: `expiresAt` (Number)
- **Projection**: KEYS_ONLY
- **Use Cases**:
  - Safety net queries for orphaned sessions
  - Monitoring active session counts
  - Debugging stuck sessions

### Data Types

#### userMetadata (Map)

```json
{
  "userId": "user123",
  "email": "user@example.com",
  "organizationId": "org456",
  "customField": "value"
}
```

#### modelConfig (Map)

```json
{
  "modelName": "gpt-4",
  "modelAPIKey": "encrypted-key",
  "domSettleTimeoutMs": 30000,
  "verbose": 2,
  "debugDom": true
}
```

#### eventHistory (List of Maps)

```json
[
  {
    "eventType": "StatusChanged",
    "timestamp": 1704067200,
    "source": "wallcrawler.utils",
    "detail": {
      "previousStatus": "CREATING",
      "newStatus": "READY",
      "sessionId": "sess_a1b2c3d4"
    }
  }
]
```

#### resourceLimits (Map)

```json
{
  "maxCPU": 1024,
  "maxMemory": 2048,
  "maxDuration": 3600,
  "maxActions": 1000
}
```

#### billingInfo (Map)

```json
{
  "costCenter": "engineering",
  "cpuSeconds": 120.5,
  "memoryMBHours": 2.1,
  "actionsCount": 45,
  "lastBillingAt": 1704067200
}
```

### Access Patterns

#### 1. Get Session by ID

```
Operation: GetItem
Key: { sessionId: "sess_a1b2c3d4" }
```

#### 2. List Sessions by Project

```
Operation: Query
Index: projectId-createdAt-index
KeyCondition: projectId = "jobseek"
ScanIndexForward: false (newest first)
```

#### 3. Find Active Sessions

```
Operation: Query
Index: status-expiresAt-index
KeyCondition: status = "ACTIVE"
```

#### 4. Update Session Status

```
Operation: UpdateItem
Key: { sessionId: "sess_a1b2c3d4" }
UpdateExpression: "SET #status = :status, updatedAt = :now"
```

#### 5. Delete Session

```
Operation: DeleteItem
Key: { sessionId: "sess_a1b2c3d4" }
```

### TTL Configuration

- **TTL Attribute**: `expiresAt`
- **Default TTL**: 1 hour from creation
- **Behavior**: DynamoDB automatically deletes items after TTL expires
- **Grace Period**: Items may persist up to 48 hours after TTL (eventually consistent)

### Cost Optimization

#### On-Demand Pricing (as of 2024)

- **Write Request Units**: $1.25 per million writes
- **Read Request Units**: $0.25 per million reads
- **Storage**: $0.25 per GB-month

#### Typical Session Costs

- **Create**: 1 WRU = $0.00000125
- **Read**: 1 RRU = $0.00000025
- **List (GSI Query)**: ~10 RRUs = $0.0000025
- **Update**: 1 WRU = $0.00000125
- **Total per session**: ~$0.000005 (0.0005 cents)

### Best Practices

#### 1. Efficient Queries

- Always use GSIs for list operations
- Limit query results with `Limit` parameter
- Use projection expressions to reduce data transfer

#### 2. Batch Operations

- Use BatchGetItem for multiple session reads
- Implement exponential backoff for throttling

#### 3. Monitoring

- Track ConsumedCapacity for cost monitoring
- Set up CloudWatch alarms for throttling
- Monitor TTL deletion metrics

#### 4. Security

- Encrypt sensitive data before storing
- Use IAM policies for least-privilege access
- Enable point-in-time recovery for compliance

### Migration from Redis

#### Key Differences

1. **No expiration callbacks**: Use TTL for automatic cleanup
2. **No pub/sub**: Use EventBridge for event-driven workflows
3. **Query flexibility**: Use GSIs instead of SCAN operations
4. **Consistency**: Eventually consistent by default

#### Migration Steps

1. Deploy DynamoDB table with CDK
2. Update Lambda functions to use DynamoDB client
3. Update ECS containers to write to DynamoDB
4. Monitor both systems during transition
5. Decommission Redis cluster

### Troubleshooting

#### Common Issues

1. **Session Not Found**
   - Check if TTL has expired
   - Verify correct sessionId format
   - Ensure proper IAM permissions

2. **Query Performance**
   - Use GSIs instead of Scan
   - Implement pagination for large results
   - Consider caching for frequently accessed data

3. **Throttling**
   - Switch to provisioned capacity if consistent
   - Implement exponential backoff
   - Review access patterns

4. **Cost Spikes**
   - Monitor hot partition keys
   - Review TTL configuration
   - Optimize query patterns

### CloudWatch Metrics

Key metrics to monitor:

- `UserErrors`: Client-side errors (4xx)
- `SystemErrors`: Server-side errors (5xx)
- `ConsumedReadCapacityUnits`: Read usage
- `ConsumedWriteCapacityUnits`: Write usage
- `TimeToLiveDeletedItemCount`: TTL cleanup rate

### Future Enhancements

1. **DynamoDB Streams**: Real-time session event processing
2. **Global Tables**: Multi-region replication
3. **Auto-scaling**: Switch to provisioned capacity with scaling
4. **Contributor Insights**: Identify access pattern anomalies
