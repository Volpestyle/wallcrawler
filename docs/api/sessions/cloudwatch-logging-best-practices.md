# CloudWatch Logging Best Practices for Wallcrawler Sessions

This document outlines logging strategies for session visibility now that terminated sessions are cleaned up after 15 minutes. For an infrastructure-wide map of log groups, metrics, and audit trails, see [../infra/OBSERVABILITY.md](../../infra/OBSERVABILITY.md).

## Overview

With session data stored in DynamoDB and automatically removed via TTL (`expiresAt`), CloudWatch Logs become the primary source for debugging, auditing, and monitoring session lifecycles beyond the session timeout window.

## Structured Logging Format

Use JSON structured logs for easy querying in CloudWatch Insights:

```go
type SessionLogEntry struct {
    Timestamp   string                 `json:"timestamp"`
    SessionID   string                 `json:"session_id"`
    ProjectID   string                 `json:"project_id,omitempty"`
    EventType   string                 `json:"event_type"`
    Status      string                 `json:"status"`
    Duration    int64                  `json:"duration_ms,omitempty"`
    Error       string                 `json:"error,omitempty"`
    Metadata    map[string]interface{} `json:"metadata,omitempty"`
}

var (
    // Structured logging is enabled by default; set STRUCTURED_LOGGING=false to fall back to plain text
    structuredLogging = os.Getenv("STRUCTURED_LOGGING") != "false"
)

// Example usage
func LogSessionEvent(event SessionLogEntry) {
    if event.Timestamp == "" {
        event.Timestamp = time.Now().UTC().Format(time.RFC3339)
    }

    if structuredLogging {
        jsonBytes, err := json.Marshal(event)
        if err != nil {
            log.Printf("Error marshaling log entry: %v", err)
            return
        }
        log.Println(string(jsonBytes))
    } else {
        if event.Error != "" {
            log.Printf("[%s] Session %s: %s (error: %s)", event.EventType, event.SessionID, event.Status, event.Error)
        } else {
            log.Printf("[%s] Session %s: %s", event.EventType, event.SessionID, event.Status)
        }
    }
}
```

## Key Events to Log

### 1. Session Lifecycle Events
```go
// Session Created
LogSessionEvent(SessionLogEntry{
    Timestamp: time.Now().Format(time.RFC3339),
    SessionID: sessionID,
    ProjectID: projectID,
    EventType: "SESSION_CREATED",
    Status:    "CREATING",
    Metadata: map[string]interface{}{
        "timeout":      timeout,
        "user_id":      userID,
        "api_key_id":   apiKeyID,
    },
})

// Session Ready
LogSessionEvent(SessionLogEntry{
    SessionID: sessionID,
    EventType: "SESSION_READY",
    Status:    "READY",
    Duration:  provisioningTime.Milliseconds(),
    Metadata: map[string]interface{}{
        "public_ip":   publicIP,
        "task_arn":    taskARN,
        "container_id": containerID,
    },
})

// Session Terminated
LogSessionEvent(SessionLogEntry{
    SessionID: sessionID,
    ProjectID: projectID,
    EventType: "SESSION_TERMINATED",
    Status:    "STOPPED",
    Duration:  sessionDuration.Milliseconds(),
    Metadata: map[string]interface{}{
        "reason":       "timeout|manual|error",
        "proxy_bytes":  proxyBytes,
        "cpu_usage":    avgCPUUsage,
        "memory_usage": memoryUsage,
    },
})
```

### 2. Operation Events
```go
// Browser Operations
LogSessionEvent(SessionLogEntry{
    SessionID: sessionID,
    ProjectID: projectID,
    EventType: "BROWSER_OPERATION",
    Metadata: map[string]interface{}{
        "operation": "navigate|extract|screenshot|act",
        "url":       targetURL,
        "selector":  selector,
        "success":   true,
    },
})

// Errors
LogSessionEvent(SessionLogEntry{
    SessionID: sessionID,
    ProjectID: projectID,
    EventType: "SESSION_ERROR",
    Error:     err.Error(),
    Metadata: map[string]interface{}{
        "operation":   operation,
        "retry_count": retryCount,
        "fatal":       isFatal,
    },
})
```

### 3. Resource Usage
```go
// Periodic resource metrics
LogSessionEvent(SessionLogEntry{
    SessionID: sessionID,
    ProjectID: projectID,
    EventType: "RESOURCE_METRICS",
    Metadata: map[string]interface{}{
        "cpu_percent":   cpuUsage,
        "memory_mb":     memoryMB,
        "network_bytes": networkBytes,
    },
})
```

## CloudWatch Insights Queries

### Find Failed Sessions
```sql
fields @timestamp, session_id, error, metadata.operation
| filter event_type = "SESSION_ERROR"
| filter project_id = "proj_123"
| sort @timestamp desc
| limit 100
```

### Session Duration Analysis
```sql
stats avg(duration_ms), max(duration_ms), min(duration_ms)
| filter event_type = "SESSION_TERMINATED"
| filter @timestamp > ago(1h)
```

### Resource Usage by Project
```sql
stats sum(metadata.proxy_bytes) as total_bytes,
      avg(metadata.cpu_usage) as avg_cpu,
      count(*) as session_count by project_id
| filter event_type = "SESSION_TERMINATED"
| filter @timestamp > ago(24h)
```

### Debug Specific Session
```sql
fields @timestamp, event_type, status, error, metadata
| filter session_id = "sess_abc123"
| sort @timestamp asc
```

## Log Retention Strategy

1. **CloudWatch Log Groups**:
   - `/aws/lambda/sessions-create` - 30 days (high-volume, synchronous entrypoint)
   - `/aws/lambda/sessions-list` & `/sessions-retrieve` - 14 days
   - `/aws/lambda/sessions-update` & `/sessions-debug` - 14 days
   - `/aws/lambda/sessions-stream-processor` - 14 days
   - `/aws/lambda/ecs-task-processor` - 14 days
   - `/aws/lambda/authorizer` - 14 days
   - `/aws/ecs/wallcrawler-controller` - 30 days

2. **Archive to S3**:
   - Export terminated session logs to S3 after 30 days
   - Use S3 lifecycle policies for long-term retention
   - Enable S3 Intelligent-Tiering for cost optimization

## Implementation Example

```go
func LogSessionCreated(sessionID, projectID string, metadata map[string]interface{}) {
    LogSessionEvent(SessionLogEntry{
        SessionID: sessionID,
        ProjectID: projectID,
        EventType: "SESSION_CREATED",
        Status:    "CREATING",
        Metadata:  metadata,
    })
}

func LogSessionError(sessionID, projectID string, err error, operation string, metadata map[string]interface{}) {
    LogSessionEvent(SessionLogEntry{
        SessionID: sessionID,
        ProjectID: projectID,
        EventType: "SESSION_ERROR",
        Error:     err.Error(),
        Metadata:  merge(metadata, map[string]interface{}{"operation": operation}),
    })
}

func merge(base, extra map[string]interface{}) map[string]interface{} {
    if base == nil {
        base = make(map[string]interface{})
    }
    for k, v := range extra {
        base[k] = v
    }
    return base
}
```

## Monitoring & Alerting

### CloudWatch Alarms
1. **High Error Rate**: 
   ```
   MetricName: SessionErrors
   Statistic: Sum
   Period: 300
   Threshold: 10
   ```

2. **Long Running Sessions**:
   ```
   MetricName: SessionDuration
   Statistic: Maximum
   Period: 300
   Threshold: 600000 (10 minutes)
   ```

### Custom Metrics
```go
// Publish custom metrics
func PublishSessionMetrics(sessionID string, duration time.Duration) {
    cwClient := cloudwatch.NewFromConfig(cfg)
    
    _, err := cwClient.PutMetricData(ctx, &cloudwatch.PutMetricDataInput{
        Namespace: aws.String("Wallcrawler/Sessions"),
        MetricData: []types.MetricDatum{
            {
                MetricName: aws.String("SessionDuration"),
                Value:      aws.Float64(duration.Seconds()),
                Unit:       types.StandardUnitSeconds,
                Dimensions: []types.Dimension{
                    {
                        Name:  aws.String("ProjectId"),
                        Value: aws.String(projectID),
                    },
                },
            },
        },
    })
}
```

## Benefits

1. **Permanent Audit Trail**: Session history preserved beyond the DynamoDB TTL window
2. **Advanced Analytics**: CloudWatch Insights for complex queries
3. **Cost Tracking**: Detailed usage metrics per project
4. **Debugging**: Full session lifecycle visibility
5. **Compliance**: Long-term retention for audit requirements

## Best Practices

1. **Log Early & Often**: Capture events as they happen
2. **Include Context**: Always include sessionID and projectID
3. **Use Structured Logs**: JSON format for easy parsing
4. **Batch Writes**: Use CloudWatch Logs PutLogEvents for efficiency
5. **Set Alarms**: Proactive monitoring for issues
6. **Regular Reviews**: Analyze logs for optimization opportunities
