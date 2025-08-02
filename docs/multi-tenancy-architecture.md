# Wallcrawler Multi-Tenancy Architecture

## Overview

Wallcrawler implements a multi-tenant architecture using a hybrid approach:
- **DynamoDB**: Primary data store for session state, providing durability and scalability
- **Redis**: Real-time pub/sub for event notifications during session lifecycle

This design provides project-level isolation, automatic resource cleanup, and cost-optimized operations through container self-termination and DynamoDB TTL.

## Multi-Tenancy Model

### Project-Based Isolation

Sessions are organized by `projectId`, which represents the client application:
- Each API key is associated with a specific project
- Sessions are tagged with their originating project
- Projects cannot access sessions from other projects

Example projects:
- `jobseek` - Job search automation platform
- `research` - Web research assistant
- `testing` - QA automation tools

### User-Level Filtering

While Wallcrawler stores user information in session metadata, user-level access control is implemented at the client application level:

1. **Session Creation**: Client apps add `userId` to session metadata
2. **Session Listing**: Client apps filter sessions by `userId` server-side
3. **Security**: Users can only see their own sessions through the client app

## Security Boundaries

```
API Key (Authentication)
    ↓
Project (Isolation)
    ↓
User (Client-side filtering)
    ↓
Session (Resource)
```

### Key Security Features

1. **API Key Authentication**: All requests require valid API keys
2. **Project Isolation**: Sessions are strictly isolated by project
3. **JWT-Secured CDP**: Direct browser connections use signed JWTs
4. **No Cross-Project Access**: Projects cannot list or access other projects' sessions

## Session Lifecycle

### 1. Session Creation (0s)
- Client requests new session with project ID and user metadata
- Session record created in DynamoDB with status `CREATING`
- ECS task launched with session ID environment variable
- TTL set to 1 hour from creation

### 2. Container Provisioning (0-30s)
- ECS task starts and Chrome browser initializes
- CDP proxy starts on port 9223 with JWT authentication
- Container registers as ready in DynamoDB
- Client receives WebSocket URL for direct CDP connection

### 3. Active Session (30s - 2min+)
- Client connects via CDP WebSocket to port 9223
- CDP proxy tracks connection state
- All browser operations happen through authenticated CDP
- Health monitor checks connection every 10 seconds

### 4. Automatic Termination (Disconnect + 2min)
- When CDP connection drops, 2-minute timer starts
- Timer resets if client reconnects within window
- After 2 minutes: Container updates DynamoDB status to `STOPPED`
- Container performs graceful shutdown and exits
- ECS removes the task automatically

### 5. Cleanup (1 hour)
- DynamoDB TTL automatically deletes session records after 1 hour
- No manual cleanup required
- No orphaned resources possible

## Data Flow

```
Client Application (e.g., Jobseek)
    ↓ HTTPS + API Key
Wallcrawler API Gateway
    ↓ 
Lambda Functions
    ├─→ DynamoDB (Session State)
    └─→ Redis (Pub/Sub Events)
         ↓ 
    ECS Task Ready Notification
         ↓
ECS Fargate Container
    ├─→ DynamoDB (Status Updates)
    └─→ Redis (Ready Events)
         ↓ CDP WebSocket
Client Browser Automation
```

### Hybrid Storage Strategy

**DynamoDB** stores:
- Session metadata and state
- User and project information  
- Resource limits and billing
- Long-term audit trails

**Redis** handles:
- Real-time session ready notifications
- Event pub/sub during session lifecycle
- Synchronous communication between Lambda and ECS

## DynamoDB Design

### Table: wallcrawler-sessions

**Primary Key**
- Partition Key: `sessionId` (String)

**Attributes**
- `sessionId`: Unique session identifier
- `projectId`: Project identifier for multi-tenancy
- `status`: Session state (CREATING, READY, ACTIVE, STOPPED, etc.)
- `connectUrl`: Authenticated CDP WebSocket URL
- `publicIP`: ECS task public IP address
- `signingKey`: JWT signing key for CDP authentication
- `userMetadata`: Map containing userId and other client data
- `ecsTaskArn`: ECS task identifier
- `expiresAt`: TTL timestamp (1 hour from creation)
- `createdAt`: Creation timestamp
- `updatedAt`: Last modification timestamp

**Global Secondary Indexes**

1. **GSI1: projectId-createdAt-index**
   - Partition Key: `projectId`
   - Sort Key: `createdAt`
   - Use Case: List all sessions for a project, ordered by creation time

2. **GSI2: status-expiresAt-index**
   - Partition Key: `status`
   - Sort Key: `expiresAt`
   - Use Case: Find active sessions nearing expiration (safety net queries)

## CDP Health Monitoring

### Connection Tracking

The CDP proxy in each container monitors WebSocket connections:

```go
type CDPProxy struct {
    hasConnection   bool
    connectionMutex sync.RWMutex
    onDisconnect    func()
}
```

### Health Monitor Logic

```
Every 10 seconds:
  if (connected):
    reset disconnect timer
  else:
    if (disconnectTimer == null):
      start 2-minute timer
    else if (elapsed > 2 minutes):
      update DynamoDB status = STOPPED
      initiate graceful shutdown
      exit(0)
```

### Automatic Cleanup Benefits

1. **Cost Optimization**: Containers stop within 2 minutes of disconnect
2. **Resource Efficiency**: No long-running idle containers
3. **Reliability**: No dependency on external cleanup processes
4. **Simplicity**: Self-managing containers reduce operational complexity

## Client Integration

### Session Creation with User Metadata

```typescript
// Jobseek example
const stagehand = new Stagehand({
  env: 'WALLCRAWLER',
  apiKey: process.env.WALLCRAWLER_API_KEY,
  projectId: 'jobseek',
  browserbaseSessionCreateParams: {
    userMetadata: {
      userId: session.user.id,
      email: session.user.email,
      createdAt: new Date().toISOString()
    }
  }
});
```

### Server-Side User Filtering

```typescript
// List sessions for current user only
async listUserSessions(userId: string): Promise<SessionInfo[]> {
  const wallcrawler = new Wallcrawler({
    apiKey: process.env.WALLCRAWLER_API_KEY,
  });

  // Get all project sessions
  const allSessions = await wallcrawler.sessions.list({
    projectId: 'jobseek'
  });

  // Filter for user's sessions only (server-side)
  return allSessions
    .filter(s => s.userMetadata?.userId === userId)
    .map(s => ({
      id: s.id,
      status: s.status,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt
    }));
}
```

## Cost Optimization

### Reduced Container Runtime
- **Before**: 1-hour timeout = $0.0135/session
- **After**: 2-minute timeout = $0.00045/session
- **Savings**: 96.7% reduction in compute costs

### Eliminated Services
- **Redis ElastiCache**: $13-50/month saved
- **Session Cleanup Lambda**: Minimal, but removed complexity

### DynamoDB Costs
- **On-Demand Pricing**: Pay only for actual usage
- **Typical Session**: ~5 read/write operations = $0.000006
- **TTL Cleanup**: Free (no read/write costs)

### Total Cost Reduction
- **Compute**: -96.7%
- **Storage**: -100% (Redis eliminated)
- **Overall**: ~90% reduction in operational costs

## Monitoring and Observability

### Key Metrics

1. **Session Metrics**
   - Sessions created per project
   - Average session duration
   - Disconnect/reconnect patterns
   - TTL cleanup rate

2. **Container Metrics**
   - CDP connection duration
   - Auto-termination triggers
   - Graceful vs forced shutdowns

3. **DynamoDB Metrics**
   - Read/write capacity usage
   - TTL deletion rate
   - GSI query performance

### CloudWatch Dashboards

Monitor system health with:
- Active sessions by project
- Container lifecycle events
- Connection drop patterns
- Cost tracking by project

## Failure Scenarios

### 1. Container Crash
- **Impact**: Session marked as FAILED
- **Recovery**: Client can create new session
- **Cleanup**: DynamoDB TTL removes record

### 2. Network Interruption
- **Impact**: CDP connection drops
- **Recovery**: 2-minute window to reconnect
- **Cleanup**: Auto-termination after timeout

### 3. DynamoDB Unavailable
- **Impact**: Cannot create/update sessions
- **Recovery**: DynamoDB HA handles automatically
- **Cleanup**: Not needed (stateless containers)

## Migration Path

### Phase 1: Infrastructure Update
1. Deploy DynamoDB table with GSIs
2. Update CDK stack to remove Redis
3. Deploy updated Lambda functions

### Phase 2: Container Updates
1. Add CDP health monitoring to containers
2. Implement auto-termination logic
3. Update to use DynamoDB for status updates

### Phase 3: Client Integration
1. Update Jobseek to include user metadata
2. Implement server-side session filtering
3. Remove any Redis-dependent code

### Phase 4: Cleanup
1. Remove session-cleanup Lambda
2. Terminate Redis cluster
3. Update monitoring dashboards

## Best Practices

### For Wallcrawler Operators

1. **Monitor TTL Effectiveness**: Ensure sessions are cleaned up within 1-2 hours
2. **Track Reconnection Patterns**: Adjust timeout if users frequently reconnect
3. **Project Sizing**: Monitor per-project usage for capacity planning

### For Client Applications

1. **Always Include User Metadata**: Essential for multi-user apps
2. **Handle Disconnections Gracefully**: Implement reconnection logic
3. **Cache Session Lists**: Reduce API calls with short-lived caches
4. **Clean Session Closure**: Always call `stagehand.close()` when done

## Security Considerations

### Data Protection
- **Encryption at Rest**: DynamoDB encrypts all data
- **Encryption in Transit**: TLS for all API calls
- **No Shared State**: Complete isolation between projects

### Access Control
- **API Keys**: Rotated regularly, stored securely
- **IAM Roles**: Least privilege for all components
- **Network**: Containers in public subnets with security groups

### Audit Trail
- **CloudTrail**: All API operations logged
- **DynamoDB Streams**: Optional change data capture
- **Container Logs**: CloudWatch Logs for debugging

## Future Enhancements

### Planned Improvements
1. **Session Replay**: Store and replay browser sessions
2. **Usage Analytics**: Detailed metrics per project/user
3. **Resource Limits**: Per-project quotas and rate limiting
4. **Multi-Region**: Global deployment for lower latency

### Scaling Considerations
- **DynamoDB Auto-Scaling**: Handles growth automatically
- **ECS Capacity**: Add container instances as needed
- **API Gateway**: Built-in request throttling

## Conclusion

This architecture provides a robust, cost-effective multi-tenant solution that:
- Automatically cleans up resources
- Provides strong isolation between projects
- Scales efficiently with demand
- Reduces operational costs by ~90%
- Maintains full backward compatibility

The combination of DynamoDB for state management and container self-termination creates a self-healing system that requires minimal operational overhead while providing excellent reliability and performance.