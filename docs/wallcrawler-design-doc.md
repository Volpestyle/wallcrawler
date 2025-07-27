# Wallcrawler Design Document

## Table of Contents

1. [Overview](#overview)
2. [Architecture Overview](#architecture-overview)
3. [Core Components](#core-components)
4. [Data Flow](#data-flow)
5. [API Design](#api-design)
6. [Session Management](#session-management)
7. [Infrastructure](#infrastructure)
8. [Security](#security)
9. [Performance & Scaling](#performance--scaling)
10. [Deployment](#deployment)

## Overview

Wallcrawler is a serverless browser automation platform that provides Stagehand-compatible remote browser sessions running on AWS infrastructure. It enables LLM-driven browser automation through a modern, event-driven architecture powered by AWS EventBridge.

### Key Features

- **Event-Driven Architecture**: AWS EventBridge orchestrates all session lifecycle events for reliability and scalability
- **Remote Browser Sessions**: ECS Fargate containers running Chrome with remote debugging
- **Stagehand Integration**: Compatible API for seamless Stagehand integration
- **Dual Mode Support**:
  - **API Mode**: Full proxy through Wallcrawler APIs with streaming responses
  - **Direct Mode**: Direct Chrome DevTools Protocol (CDP) access for privacy
- **WebSocket Streaming**: Real-time browser viewport streaming with EventBridge coordination
- **Serverless Architecture**: AWS Lambda functions with EventBridge-driven workflows
- **Hybrid State Management**: EventBridge for lifecycle orchestration, Redis for real-time operations
- **Enterprise Reliability**: Automatic retry, dead letter queues, and comprehensive observability

### System Boundaries

```mermaid
graph TB
    subgraph "External"
        Client[Client Application]
        Stagehand[Stagehand Library]
        LLM[LLM Provider<br/>OpenAI/Anthropic]
    end

    subgraph "Wallcrawler Platform"
        API[API Gateway]
        Lambda[Lambda Functions]
        ECS[ECS Browser Tasks]
        Redis[Redis State Store]
        WS[WebSocket API]
    end

    subgraph "AWS Infrastructure"
        VPC[VPC Network]
        ALB[Application Load Balancer]
        EventBridge[EventBridge]
    end

    Client --> API
    Stagehand --> API
    Stagehand -.-> ECS
    Client --> WS
    API --> Lambda
    Lambda --> ECS
    Lambda --> Redis
    Lambda --> EventBridge
    ECS --> Redis
    ECS --> WS

    style API fill:#e1f5fe
    style Lambda fill:#e1f5fe
    style ECS fill:#e1f5fe
    style Redis fill:#e1f5fe
    style WS fill:#e1f5fe
    style Client fill:#f3e5f5
    style Stagehand fill:#f3e5f5
    style LLM fill:#f3e5f5
    style VPC fill:#e8f5e8
    style ALB fill:#e8f5e8
    style EventBridge fill:#e8f5e8
```

## Architecture Overview

Wallcrawler follows a serverless, event-driven architecture designed for scalability and cost-effectiveness.

### High-Level Architecture

```mermaid
graph TB
    subgraph "Client Layer"
        StagehandApp[Stagehand Application]
        WebApp[Web Application]
        SDK[Wallcrawler SDK]
    end

    subgraph "API Layer"
        RestAPI[REST API Gateway]
        WebSocketAPI[WebSocket API Gateway]
        WAF[Web Application Firewall]
    end

    subgraph "Compute Layer"
        StartLambda[Session Start Lambda]
        ActLambda[Act Lambda]
        ExtractLambda[Extract Lambda]
        ObserveLambda[Observe Lambda]
        NavigateLambda[Navigate Lambda]
        AgentLambda[Agent Execute Lambda]
        DebugLambda[Debug Lambda]
        EndLambda[End Session Lambda]
        ScreencastLambda[Screencast Lambda]
    end

    subgraph "Browser Layer"
        ECSCluster[ECS Fargate Cluster]
        BrowserTask1[Browser Task 1<br/>Chrome + Controller]
        BrowserTask2[Browser Task 2<br/>Chrome + Controller]
        BrowserTaskN[Browser Task N<br/>Chrome + Controller]
    end

    subgraph "Storage Layer"
        RedisCluster[Redis ElastiCache<br/>Session State]
    end

    subgraph "Event Layer"
        EventBridge[EventBridge<br/>Session Events]
    end

    subgraph "Monitoring Layer"
        CloudWatch[CloudWatch Logs & Metrics]
        XRay[X-Ray Tracing]
    end

    StagehandApp --> RestAPI
    WebApp --> RestAPI
    WebApp --> WebSocketAPI
    SDK --> RestAPI

    RestAPI --> WAF
    WebSocketAPI --> WAF
    WAF --> StartLambda
    WAF --> ActLambda
    WAF --> ExtractLambda
    WAF --> ObserveLambda
    WAF --> NavigateLambda
    WAF --> AgentLambda
    WAF --> DebugLambda
    WAF --> EndLambda
    WebSocketAPI --> ScreencastLambda

    StartLambda --> ECSCluster
    ActLambda --> BrowserTask1
    ExtractLambda --> BrowserTask2
    EndLambda --> BrowserTaskN

    StartLambda --> RedisCluster
    ActLambda --> RedisCluster
    BrowserTask1 --> RedisCluster
    BrowserTask2 --> RedisCluster

    StartLambda --> EventBridge
    EndLambda --> EventBridge
    BrowserTask1 --> EventBridge

    ECSCluster --> BrowserTask1
    ECSCluster --> BrowserTask2
    ECSCluster --> BrowserTaskN

    ScreencastLambda --> CloudWatch
    BrowserTask1 --> CloudWatch
    StartLambda --> CloudWatch

    style StagehandApp fill:#e3f2fd
    style WebApp fill:#e3f2fd
    style SDK fill:#e3f2fd
    style RestAPI fill:#f3e5f5
    style WebSocketAPI fill:#f3e5f5
    style WAF fill:#f3e5f5
    style StartLambda fill:#e8f5e8
    style ActLambda fill:#e8f5e8
    style ExtractLambda fill:#e8f5e8
    style ECSCluster fill:#fff3e0
    style BrowserTask1 fill:#fff3e0
    style BrowserTask2 fill:#fff3e0
    style RedisCluster fill:#fce4ec
    style EventBridge fill:#f1f8e9
    style CloudWatch fill:#e0f2f1
```

## Core Components

### 1. API Gateway & Lambda Functions

The API layer handles all incoming requests and routes them to appropriate Lambda functions.

### 2. ECS Browser Tasks

Each browser session runs in a dedicated ECS Fargate task containing:

- Chrome browser with remote debugging enabled
- Go controller for session management
- WebSocket communication for real-time updates

### 3. Redis State Store

Centralized session state management with automatic expiration and cleanup.

### 4. WebSocket API

Real-time streaming for browser screencast and bidirectional communication.

## Data Flow

### EventBridge-Driven Session Creation Flow

Wallcrawler uses EventBridge as the central coordination layer for all session lifecycle events, providing reliable, scalable, and observable session management.

```mermaid
sequenceDiagram
    participant Client as Stagehand Client
    participant API as Session Start API
    participant EventBridge as EventBridge
    participant Provisioner as Session Provisioner Lambda
    participant ECS as ECS Service
    participant Browser as Browser Task
    participant Redis as Redis State Store
    participant Webhook as Webhook Lambda

    Client->>API: POST /sessions/start
    API->>API: Generate session ID
    API->>Redis: Store session (status: CREATING)
    API->>EventBridge: Publish SessionCreateRequested
    API-->>Client: {"sessionId": "sess_123", "status": "creating"}

    EventBridge->>Provisioner: Route creation event
    Provisioner->>Redis: Update status: PROVISIONING
    Provisioner->>ECS: Create Fargate task

    ECS->>Browser: Launch container
    Browser->>Browser: Start Chrome with CDP
    Browser->>Redis: Update status: STARTING

    Browser->>EventBridge: Publish SessionChromeReady
    EventBridge->>Provisioner: Handle ready event

    loop IP Assignment Wait
        Provisioner->>ECS: Check task public IP
        ECS-->>Provisioner: Task details + IP
    end

    Provisioner->>Redis: Update status: READY + connectURL
    Provisioner->>EventBridge: Publish SessionReady

    EventBridge->>Webhook: Notify ready (optional)

    Note over Client: Client polls /sessions/{id}/status
    Client->>API: GET /sessions/{id}/status
    API->>Redis: Get session state
    API-->>Client: {"status": "ready", "connectUrl": "ws://ip:9222"}

    Note over Client, Browser: Session ready for CDP connection
```

### Session Interaction Flow (EventBridge Coordination)

All session interactions are coordinated through EventBridge for reliability and observability:

```mermaid
sequenceDiagram
    participant Client as Stagehand Client
    participant API as API Gateway
    participant ActLambda as Act Lambda
    participant EventBridge as EventBridge
    participant Browser as Browser Controller
    participant Redis as Redis State Store
    participant LLM as LLM Provider

    Client->>API: POST /sessions/{id}/act
    API->>ActLambda: Stream request
    ActLambda->>Redis: Get session state
    ActLambda->>EventBridge: Publish ActionStarted

    EventBridge->>Browser: Route action event (via Redis Pub/Sub)
    Browser->>Redis: Update session: ACTIVE
    Browser->>Browser: Get page DOM
    Browser->>LLM: Send DOM + instruction
    LLM-->>Browser: Return action plan
    Browser->>Browser: Execute CDP commands

    loop Streaming Response
        Browser->>EventBridge: Publish ActionProgress
        EventBridge->>ActLambda: Route progress event
        ActLambda-->>API: Forward stream
        API-->>Client: Stream chunk
    end

    Browser->>Redis: Update session: READY
    Browser->>EventBridge: Publish ActionCompleted
    EventBridge->>ActLambda: Route completion event
    ActLambda-->>API: Complete response
    API-->>Client: End stream
```

### Enhanced Session Termination Flow

EventBridge orchestrates comprehensive session cleanup with automatic retry and error handling:

```mermaid
sequenceDiagram
    participant Client as Stagehand Client
    participant API as API Gateway
    participant EndLambda as End Session Lambda
    participant EventBridge as EventBridge
    participant CleanupLambda as Cleanup Lambda
    participant Browser as Browser Task
    participant ECS as ECS Service
    participant Redis as Redis State Store
    participant Monitor as Monitoring Lambda

    Client->>API: POST /sessions/{id}/end
    API->>EndLambda: Terminate session
    EndLambda->>Redis: Get session state
    EndLambda->>EventBridge: Publish SessionTerminationRequested
    EndLambda-->>API: {"status": "terminating"}
    API-->>Client: Termination acknowledged

    EventBridge->>CleanupLambda: Route termination event
    CleanupLambda->>Redis: Update status: TERMINATING
    CleanupLambda->>Browser: Signal graceful shutdown
    CleanupLambda->>ECS: Stop Fargate task

    Browser->>Browser: Stop Chrome gracefully
    Browser->>EventBridge: Publish SessionResourcesReleased

    EventBridge->>CleanupLambda: Handle resource release
    CleanupLambda->>Redis: Update status: STOPPED
    CleanupLambda->>EventBridge: Publish SessionTerminated

    EventBridge->>Monitor: Update metrics & billing
    EventBridge->>CleanupLambda: Final cleanup (delayed)

    Note over CleanupLambda: Wait 60s for task shutdown
    CleanupLambda->>Redis: Delete session data
    CleanupLambda->>EventBridge: Publish SessionCleanupCompleted

    Note over EventBridge: Session lifecycle complete
```

### Direct Mode Connection Flow

```mermaid
sequenceDiagram
    participant Client as Stagehand Client
    participant API as API Gateway
    participant DebugLambda as Debug Lambda
    participant Redis as Redis Cluster
    participant Browser as Browser Task

    Client->>API: GET /sessions/{id}/debug
    API->>DebugLambda: Get debug URL
    DebugLambda->>Redis: Get session state
    Redis-->>DebugLambda: Session with public IP
    DebugLambda-->>API: Return CDP URL
    API-->>Client: ws://[public-ip]:9222

    Client->>Browser: Direct CDP connection
    Browser-->>Client: Chrome DevTools Protocol

    Note over Client, Browser: Direct communication bypasses Wallcrawler APIs
```

### Enhanced WebSocket Flow with EventBridge Coordination

WebSocket operations are coordinated through EventBridge for better reliability and monitoring:

```mermaid
sequenceDiagram
    participant Client as Web Client
    participant WSGateway as WebSocket Gateway
    participant ScreencastLambda as Screencast Lambda
    participant EventBridge as EventBridge
    participant Redis as Redis State Store
    participant Browser as Browser Controller

    Client->>WSGateway: WebSocket connect
    WSGateway->>ScreencastLambda: $connect event
    ScreencastLambda->>Redis: Store connection ID
    ScreencastLambda->>EventBridge: Publish WebSocketConnected

    Client->>WSGateway: {"action": "start_screencast", "sessionId": "sess_123"}
    WSGateway->>ScreencastLambda: Route message
    ScreencastLambda->>Redis: Validate session
    ScreencastLambda->>EventBridge: Publish ScreencastStartRequested

    EventBridge->>Browser: Route capture event (via Redis Pub/Sub)
    Browser->>Browser: Start Chrome screencast
    Browser->>EventBridge: Publish ScreencastStarted

    loop Frame Streaming
        Browser->>Browser: Capture frame
        Browser->>ScreencastLambda: Send frame via WebSocket
        ScreencastLambda->>WSGateway: Broadcast frame
        WSGateway->>Client: Frame data
    end

    Client->>WSGateway: {"action": "stop_screencast"}
    WSGateway->>ScreencastLambda: Route message
    ScreencastLambda->>EventBridge: Publish ScreencastStopRequested
    EventBridge->>Browser: Route stop event (via Redis Pub/Sub)
    Browser->>Browser: Stop screencast
    Browser->>EventBridge: Publish ScreencastStopped
```

## Architecture Decision: EventBridge vs Redis

Understanding the distinct roles of EventBridge and Redis is crucial to Wallcrawler's architecture design.

### EventBridge: Session Lifecycle Orchestration

**Primary Role**: Event-driven coordination of session lifecycle and cross-service communication

```mermaid
graph TB
    subgraph "EventBridge Responsibilities"
        SessionLifecycle[Session Lifecycle Events<br/>Create → Ready → Active → Terminated]
        CrossService[Cross-Service Communication<br/>Lambda ↔ ECS ↔ Monitoring]
        AsyncWorkflows[Async Workflow Coordination<br/>Retry Logic, Error Handling]
        Observability[Event Auditing & Tracing<br/>Complete Session History]
        Scaling[Auto-scaling Triggers<br/>Resource Management]
    end

    subgraph "Event Types"
        Creation[SessionCreateRequested<br/>SessionReady<br/>SessionCreateFailed]
        Operations[ActionStarted<br/>ActionCompleted<br/>ScreencastStarted]
        Cleanup[SessionTerminationRequested<br/>SessionResourcesReleased<br/>SessionCleanupCompleted]
        Monitoring[SessionMetrics<br/>BillingEvents<br/>ResourceUsage]
    end

    SessionLifecycle --> Creation
    CrossService --> Operations
    AsyncWorkflows --> Cleanup
    Observability --> Monitoring
```

**Why EventBridge for Session Management:**

1. **🔄 Reliable Event Delivery**: Built-in retry mechanisms and dead letter queues
2. **📊 Complete Audit Trail**: Every session lifecycle event is tracked and traceable
3. **🎯 Decoupled Architecture**: Services don't need direct communication
4. **⚡ Auto-scaling**: Resource creation/cleanup based on demand patterns
5. **🛡️ Error Resilience**: Automatic retry and failure handling workflows
6. **🔍 Observability**: CloudWatch integration for metrics and monitoring

### Redis: Real-time State and Communication

**Primary Role**: High-performance state storage and real-time inter-service communication

```mermaid
graph TB
    subgraph "Redis Responsibilities"
        SessionState[Session State Storage<br/>Current Status, Metadata, Config]
        RealTime[Real-time Communication<br/>Pub/Sub for Immediate Actions]
        Caching[High-speed Data Cache<br/>Session Lookups, Connection Data]
        Temporary[Temporary Data Storage<br/>Action Results, Frame Buffers]
        Coordination[ECS Task Coordination<br/>Direct Browser ↔ Lambda Communication]
    end

    subgraph "Data Patterns"
        StateData[session:{id} → Session State<br/>session:{id}:viewers → WebSocket Connections]
        PubSubChannels[session:{id}:events → Real-time Commands<br/>screencast:{id} → Frame Data]
        Cache[task_ips:{taskId} → Public IPs<br/>connection_sessions → WebSocket Mapping]
    end

    SessionState --> StateData
    RealTime --> PubSubChannels
    Caching --> Cache
```

**Why Redis for Real-time Operations:**

1. **⚡ Sub-millisecond Performance**: Critical for real-time browser operations
2. **🔄 Pub/Sub Messaging**: Direct communication between ECS tasks and Lambda functions
3. **📱 WebSocket State**: Managing active WebSocket connections and viewers
4. **🎯 Session Lookups**: Fast session state retrieval for API requests
5. **🔄 Atomic Operations**: Session status updates and viewer count management
6. **⏰ TTL Support**: Automatic cleanup of expired session data

### Hybrid Communication Architecture

```mermaid
graph TB
    subgraph "EventBridge Flow (Lifecycle Events)"
        EB1[Session Creation] --> EB2[Resource Provisioning]
        EB2 --> EB3[Session Ready]
        EB3 --> EB4[Session Termination]
        EB4 --> EB5[Cleanup Complete]
    end

    subgraph "Redis Flow (Real-time Operations)"
        R1[Action Commands] --> R2[Browser Execution]
        R2 --> R3[Status Updates]
        R3 --> R4[Response Streaming]
        R4 --> R5[WebSocket Broadcasting]
    end

    subgraph "Integration Points"
        EventBridge --> Redis
        Redis --> EventBridge
    end

    Note1[EventBridge: Reliable, Auditable, Async]
    Note2[Redis: Fast, Real-time, Direct]

    style EventBridge fill:#e3f2fd
    style Redis fill:#fce4ec
```

### Event Types and Patterns

| Category                | Event Type                    | Source                | Target                  | Purpose                        |
| ----------------------- | ----------------------------- | --------------------- | ----------------------- | ------------------------------ |
| **Session Lifecycle**   | `SessionCreateRequested`      | `sessions-start`      | `session-provisioner`   | Trigger async session creation |
|                         | `SessionReady`                | `session-provisioner` | `webhook-notifications` | Notify session availability    |
|                         | `SessionTerminationRequested` | `end-session`         | `cleanup-handler`       | Initiate graceful shutdown     |
|                         | `SessionCleanupCompleted`     | `cleanup-handler`     | `monitoring`            | Session fully terminated       |
| **Browser Operations**  | `ActionStarted`               | `act-lambda`          | `monitoring`            | Track action execution         |
|                         | `ActionCompleted`             | `browser-controller`  | `act-lambda`            | Signal action completion       |
|                         | `ScreencastStarted`           | `browser-controller`  | `monitoring`            | WebSocket streaming active     |
| **Resource Management** | `ECSTaskStarted`              | `session-provisioner` | `monitoring`            | Track resource usage           |
|                         | `ECSTaskFailed`               | `ecs-monitor`         | `error-handler`         | Handle task failures           |
|                         | `ResourceQuotaExceeded`       | `resource-monitor`    | `scaling-handler`       | Trigger scaling decisions      |
| **Error Handling**      | `SessionCreateFailed`         | `session-provisioner` | `retry-handler`         | Retry failed sessions          |
|                         | `SessionTimeout`              | `timeout-monitor`     | `cleanup-handler`       | Clean up stale sessions        |

### Performance Characteristics

| Aspect         | EventBridge               | Redis                      |
| -------------- | ------------------------- | -------------------------- |
| **Latency**    | 10-100ms (async)          | <1ms (real-time)           |
| **Durability** | Persistent, replicated    | In-memory with persistence |
| **Ordering**   | Event ordering guarantees | Pub/Sub immediate delivery |
| **Scaling**    | Auto-scaling, unlimited   | Single-node or cluster     |
| **Use Case**   | Workflow coordination     | Real-time operations       |
| **Cost**       | Pay per event             | Fixed infrastructure cost  |

## API Design

### REST API Endpoints

Wallcrawler provides a Stagehand-compatible API with additional native endpoints.

```mermaid
graph TB
    subgraph "Session Management"
        StartSession[POST /sessions/start<br/>Stagehand Compatible]
        StartNative[POST /start-session<br/>Wallcrawler Native]
        RetrieveSession[GET /sessions/{id}/retrieve]
        DebugSession[GET /sessions/{id}/debug]
        CDPURLSession[POST /sessions/{id}/cdp-url<br/>Signed CDP URLs]
        EndSession[POST /sessions/{id}/end]
    end

    subgraph "Browser Operations (Streaming)"
        Act[POST /sessions/{id}/act]
        Extract[POST /sessions/{id}/extract]
        Observe[POST /sessions/{id}/observe]
        Navigate[POST /sessions/{id}/navigate]
        AgentExecute[POST /sessions/{id}/agentExecute]
    end

    subgraph "Real-time Communication"
        WSConnect[WebSocket /screencast]
        WSEvents[Event Broadcasting]
    end

    StartSession --> Lambda1[sessions-start Lambda]
    StartNative --> Lambda2[start-session Lambda]
    RetrieveSession --> Lambda3[retrieve Lambda]
    DebugSession --> Lambda4[debug Lambda]
    CDPURLSession --> Lambda7[cdp-url Lambda]
    EndSession --> Lambda5[end Lambda]

    Act --> Lambda6[act Lambda]
    Extract --> Lambda7[extract Lambda]
    Observe --> Lambda8[observe Lambda]
    Navigate --> Lambda9[navigate Lambda]
    AgentExecute --> Lambda10[agent-execute Lambda]

    WSConnect --> Lambda11[screencast Lambda]
    WSEvents --> Lambda11


```

### Authentication & Headers

All API requests require authentication and specific headers:

```yaml
Headers:
  x-wc-api-key: 'your-api-key' # API authentication
  x-wc-project-id: 'project-id' # Project identification
  x-wc-session-id: 'session-id' # Session context (optional)
  x-model-api-key: 'llm-api-key' # LLM provider API key
  x-stream-response: 'true' # Enable streaming responses
  Content-Type: 'application/json'
```

### Response Format

All responses follow a consistent format:

```typescript
// Success Response
{
  "success": true,
  "data": {
    // Response data
  }
}

// Error Response
{
  "success": false,
  "message": "Error description"
}

// Streaming Response (Server-Sent Events)
data: {"type": "log", "data": {"level": "info", "message": "Starting action..."}}
data: {"type": "result", "data": {"success": true, "action": "click"}}
data: {"type": "system", "data": {"status": "complete"}}
```

## Session Management

### Enhanced Session Lifecycle with EventBridge

```mermaid
stateDiagram-v2
    [*] --> CREATING: POST /sessions/start<br/>SessionCreateRequested
    CREATING --> PROVISIONING: EventBridge routes to provisioner
    PROVISIONING --> STARTING: ECS task launched<br/>SessionChromeReady
    CREATING --> FAILED: Task creation failed<br/>SessionCreateFailed
    PROVISIONING --> FAILED: ECS provisioning failed

    STARTING --> READY: Chrome CDP available<br/>SessionReady
    STARTING --> FAILED: Chrome startup failed

    READY --> ACTIVE: Action execution<br/>ActionStarted
    ACTIVE --> READY: Action completed<br/>ActionCompleted
    ACTIVE --> FAILED: Action failed<br/>ActionFailed

    READY --> TERMINATING: POST /sessions/{id}/end<br/>SessionTerminationRequested
    ACTIVE --> TERMINATING: Force terminate
    FAILED --> TERMINATING: Auto-cleanup trigger

    TERMINATING --> STOPPED: Resources released<br/>SessionResourcesReleased
    STOPPED --> [*]: Cleanup completed<br/>SessionCleanupCompleted

    note right of CREATING
        - Session ID generated
        - Initial state in Redis
        - EventBridge orchestration starts
    end note

    note right of PROVISIONING
        - ECS Fargate task creation
        - Public IP assignment
        - Container startup
    end note

    note right of READY
        - Chrome CDP available (port 9222)
        - Public IP accessible
        - Ready for Stagehand connections
    end note

    note right of ACTIVE
        - Processing browser actions
        - Streaming API responses
        - LLM interactions active
    end note

    note right of TERMINATING
        - Graceful Chrome shutdown
        - ECS task stopping
        - Resource cleanup in progress
    end note
```

### Session State Schema with EventBridge Integration

```typescript
interface EnhancedSessionState {
  id: string; // Unique session identifier
  status: SessionStatus; // Current lifecycle status
  projectId: string; // Project identification
  connectUrl?: string; // Chrome CDP WebSocket URL
  ecsTaskArn?: string; // AWS ECS task ARN
  publicIP?: string; // ECS task public IP
  userMetadata?: object; // User-defined metadata
  modelConfig?: ModelConfig; // LLM configuration

  // EventBridge Integration
  eventHistory: SessionEvent[]; // Complete event audit trail
  lastEventTimestamp: Date; // Last EventBridge event
  retryCount?: number; // Failed creation retry attempts

  // Performance Tracking
  createdAt: Date; // Session creation time
  provisioningStartedAt?: Date; // ECS task creation started
  readyAt?: Date; // Chrome CDP available
  lastActiveAt?: Date; // Last action execution
  terminatedAt?: Date; // Session termination time

  // Resource Management
  resourceLimits?: ResourceLimits; // CPU, memory, timeout limits
  billingInfo?: BillingInfo; // Usage tracking
}

interface SessionEvent {
  eventType: string; // EventBridge event type
  timestamp: Date; // Event occurrence time
  source: string; // Event source service
  detail: object; // Event-specific data
  correlationId?: string; // Request correlation
}

interface ResourceLimits {
  maxCPU: number; // Maximum CPU allocation
  maxMemory: number; // Maximum memory (MB)
  maxDuration: number; // Maximum session duration (seconds)
  maxActions: number; // Maximum actions per session
}

enum SessionStatus {
  CREATING = 'CREATING', // Initial state, EventBridge triggered
  PROVISIONING = 'PROVISIONING', // ECS task being created
  STARTING = 'STARTING', // Chrome initializing
  READY = 'READY', // Available for actions
  ACTIVE = 'ACTIVE', // Processing actions
  TERMINATING = 'TERMINATING', // Shutdown in progress
  STOPPED = 'STOPPED', // Fully terminated
  FAILED = 'FAILED', // Error state
}
```

### EventBridge-Driven Architecture Benefits

Leveraging EventBridge as the central coordination layer provides significant advantages over traditional synchronous architectures:

#### **1. Operational Resilience**

- **Automatic Retry**: Failed session creation automatically retries with exponential backoff
- **Dead Letter Queues**: Permanently failed requests are captured for analysis
- **Circuit Breaker**: System automatically stops creating sessions when ECS is at capacity
- **Graceful Degradation**: API remains responsive even during high load or ECS issues

#### **2. Cost Optimization**

- **Reduced Lambda Duration**: Session start API returns immediately instead of waiting 60+ seconds
- **Pay-per-Event**: Only pay for actual EventBridge events, not Lambda wait time
- **Resource Efficiency**: Separate provisioner Lambda only runs during active work
- **Auto-scaling**: Resources scale based on actual demand patterns

#### **3. Enhanced Observability**

- **Complete Audit Trail**: Every session event is tracked from creation to termination
- **Performance Metrics**: Detailed timing data for each lifecycle stage
- **Error Analysis**: Failed session patterns and retry statistics
- **Billing Accuracy**: Precise resource usage tracking for cost allocation

#### **4. Scalability & Performance**

- **Decoupled Services**: Session creation doesn't block API availability
- **Independent Scaling**: API and provisioning layers scale independently
- **Burst Handling**: EventBridge can queue thousands of session requests
- **Multi-Region**: Easy extension to multiple AWS regions

#### **5. Developer Experience**

- **Event-Driven Debugging**: Easy to trace session issues through event history
- **A/B Testing**: Different provisioning strategies through event routing
- **Feature Flags**: Conditional session creation based on user attributes
- **Webhook Integration**: Real-time notifications to external systems

```mermaid
graph TB
    subgraph "Traditional Sync Architecture"
        SyncAPI[API Request] --> SyncWait[60s Wait] --> SyncResponse[Response]
        SyncWait --> SyncTimeout[Timeout Risk]
        SyncWait --> SyncCost[High Lambda Cost]
    end

    subgraph "EventBridge Architecture"
        AsyncAPI[API Request] --> AsyncEvent[EventBridge] --> AsyncWork[Background Work]
        AsyncAPI --> AsyncResponse[Immediate Response]
        AsyncEvent --> AsyncRetry[Auto Retry]
        AsyncEvent --> AsyncScale[Auto Scale]
        AsyncEvent --> AsyncMonitor[Full Observability]
    end

    SyncTimeout --> AsyncRetry
    SyncCost --> AsyncScale

    style "Traditional Sync Architecture" fill:#ffebee
    style "EventBridge Architecture" fill:#e8f5e8
```

This EventBridge-driven approach transforms Wallcrawler from a traditional request-response system into a modern, event-driven platform capable of handling enterprise-scale browser automation workloads with reliability and cost efficiency.

## Infrastructure

### AWS Architecture Components

```mermaid
graph TB
    subgraph "Network Layer"
        VPC[VPC<br/>10.0.0.0/16]
        PublicSubnet1[Public Subnet 1<br/>10.0.1.0/24]
        PublicSubnet2[Public Subnet 2<br/>10.0.2.0/24]
        PrivateSubnet1[Private Subnet 1<br/>10.0.3.0/24]
        PrivateSubnet2[Private Subnet 2<br/>10.0.4.0/24]
        IGW[Internet Gateway]
        NAT[NAT Gateway]
    end

    subgraph "Security Groups"
        LambdaSG[Lambda Security Group<br/>Outbound: All]
                    ECSSG[ECS Security Group<br/>Inbound: 9223 from 0.0.0.0/0<br/>Outbound: All]
        RedisSG[Redis Security Group<br/>Inbound: 6379 from Lambda/ECS]
    end

    subgraph "Compute"
        Lambda[Lambda Functions<br/>VPC: Private Subnets]
        ECSCluster[ECS Fargate Cluster<br/>VPC: Public Subnets]
        ECSService[ECS Service<br/>Desired Count: 0]
    end

    subgraph "Storage"
        Redis[ElastiCache Redis<br/>VPC: Private Subnets<br/>Node Type: cache.t3.micro]
    end

    subgraph "API Layer"
        APIGW[API Gateway<br/>Regional]
        WSGW[WebSocket Gateway<br/>Regional]
        WAF[Web Application Firewall<br/>Rate Limiting + Security Rules]
    end

    subgraph "Monitoring"
        CloudWatch[CloudWatch<br/>Logs + Metrics]
        EventBridge[EventBridge<br/>Session Events]
    end

    VPC --> PublicSubnet1
    VPC --> PublicSubnet2
    VPC --> PrivateSubnet1
    VPC --> PrivateSubnet2

    PublicSubnet1 --> IGW
    PublicSubnet2 --> IGW
    PrivateSubnet1 --> NAT
    PrivateSubnet2 --> NAT

    Lambda --> PrivateSubnet1
    Lambda --> PrivateSubnet2
    ECSCluster --> PublicSubnet1
    ECSCluster --> PublicSubnet2
    Redis --> PrivateSubnet1
    Redis --> PrivateSubnet2

    APIGW --> Lambda
    WSGW --> Lambda
    WAF --> APIGW
    WAF --> WSGW

    Lambda --> Redis
    ECSCluster --> Redis
    Lambda --> ECSCluster
    Lambda --> EventBridge
    ECSCluster --> EventBridge

    Lambda --> CloudWatch
    ECSCluster --> CloudWatch


```

### ECS Task Architecture

```mermaid
graph TB
    subgraph "ECS Fargate Task"
        subgraph "Container: wallcrawler-controller"
            Chrome[Google Chrome<br/>--remote-debugging-port=9222<br/>--remote-debugging-address=0.0.0.0]
            Controller[Go Controller<br/>Session Management<br/>WebSocket Communication<br/>CDP Proxy]
            Stagehand[Stagehand Library<br/>LLM Integration<br/>Action Processing]
        end

        subgraph "Task Configuration"
            CPU[CPU: 1024<br/>Memory: 2048 MB]
            Network[Network Mode: awsvpc<br/>Public IP: Enabled]
            Platform[Platform: Linux/x86_64]
        end

        subgraph "Environment Variables"
            SessionID[SESSION_ID]
            RedisAddr[REDIS_ADDR]
            ECSCluster[ECS_CLUSTER]
            WSEndpoint[WEBSOCKET_API_ENDPOINT]
            Region[AWS_REGION]
        end

        subgraph "Port Mappings"
            Port9222[Container Port: 9222<br/>Protocol: TCP<br/>Chrome CDP (localhost)]
            Port9223[Container Port: 9223<br/>Protocol: TCP<br/>CDP Proxy (public)]
        end
    end

    subgraph "External Access"
        SignedCDP[Signed CDP Access<br/>ws://[public-ip]:9223/cdp?signingKey=JWT]
        StagehandClient[Stagehand Client<br/>API Mode]
        WebSocketClient[WebSocket Client<br/>Screencast via CDP Proxy]
    end

    Chrome --> Port9222
    Controller --> Chrome
    Controller --> Port9223
    Controller --> Stagehand
    Controller --> SessionID
    Controller --> RedisAddr
    Controller --> WSEndpoint

    SignedCDP --> Port9223
    Port9223 --> Port9222
    StagehandClient --> Controller
    WebSocketClient --> Port9223


```

### Resource Specifications

| Component        | Specification                                    | Scaling      |
| ---------------- | ------------------------------------------------ | ------------ |
| Lambda Functions | Runtime: Go 1.21, Memory: 1024MB, Timeout: 15min | Auto-scaling |
| ECS Tasks        | CPU: 1 vCPU, Memory: 2GB, Platform: Fargate      | On-demand    |
| Redis            | Node Type: cache.t3.micro, Engine: Redis 7.0     | Single node  |
| VPC              | CIDR: 10.0.0.0/16, AZs: 2, NAT: 1                | Static       |

## Security

### Authentication & Authorization

```mermaid
graph TB
    subgraph "Client Request"
        Client[Client Application]
        APIKey[API Key<br/>x-wc-api-key]
        ProjectID[Project ID<br/>x-wc-project-id]
    end

    subgraph "API Gateway"
        WAF[Web Application Firewall]
        RateLimit[Rate Limiting<br/>1000 req/min]
        APIAuth[API Key Validation]
        UsagePlan[Usage Plan]
    end

    subgraph "Lambda Authorization"
        HeaderValidation[Header Validation]
        ProjectValidation[Project Access Check]
        SessionOwnership[Session Ownership Check]
    end

    subgraph "ECS Security"
        TaskRole[ECS Task Role<br/>Minimal Permissions]
        SecurityGroup[Security Group<br/>Port 9222 Only]
        VPCEndpoints[VPC Endpoints<br/>AWS Services]
    end

    Client --> APIKey
    Client --> ProjectID
    APIKey --> WAF
    ProjectID --> WAF

    WAF --> RateLimit
    RateLimit --> APIAuth
    APIAuth --> UsagePlan
    UsagePlan --> HeaderValidation

    HeaderValidation --> ProjectValidation
    ProjectValidation --> SessionOwnership

    SessionOwnership --> TaskRole
    TaskRole --> SecurityGroup
    SecurityGroup --> VPCEndpoints


```

### Security Features

1. **API Key Authentication**: All REST API requests require valid API keys (`x-wc-api-key`)
2. **JWT Signed CDP URLs**: Time-limited, scope-based authentication for CDP access
3. **CDP Proxy Security**: Enterprise-grade proxy with rate limiting and circuit breaker
4. **Network Isolation**: Chrome listens only on localhost (127.0.0.1:9222), proxy on 9223
5. **Project Isolation**: Sessions are isolated by project ID
6. **Enterprise Monitoring**: Rate limiting, error tracking, and comprehensive metrics
7. **Network Security**: VPC with security groups and NACLs
8. **WAF Protection**: DDoS protection and common attack mitigation
9. **Encryption**: Data in transit and at rest encryption
10. **IAM Roles**: Least privilege access for all components

## Performance & Scaling

### Auto-Scaling Configuration

```mermaid
graph TB
    subgraph "API Layer Scaling"
        APIGateway[API Gateway<br/>Auto-scaling<br/>No Limits]
        Lambda[Lambda Functions<br/>Concurrent Execution: 1000<br/>Reserved Concurrency: 100]
    end

    subgraph "Browser Layer Scaling"
        ECSService[ECS Service<br/>Desired Count: 0<br/>Max Count: 100]
        AutoScaling[Auto Scaling<br/>CPU/Memory Based<br/>Scale Out: 2min<br/>Scale In: 5min]
    end

    subgraph "Storage Layer Scaling"
        Redis[Redis ElastiCache<br/>Single Node<br/>Backup: Enabled<br/>Memory: 1GB]
        Persistence[Data Persistence<br/>RDB Snapshots<br/>TTL: 24 hours]
    end

    subgraph "Performance Monitoring"
        CloudWatch[CloudWatch Metrics<br/>API Latency<br/>Error Rates<br/>Resource Utilization]
        Alarms[CloudWatch Alarms<br/>High Latency: >5s<br/>Error Rate: >5%<br/>Memory: >80%]
    end

    APIGateway --> Lambda
    Lambda --> ECSService
    ECSService --> AutoScaling
    AutoScaling --> Redis

    Lambda --> CloudWatch
    ECSService --> CloudWatch
    Redis --> CloudWatch
    CloudWatch --> Alarms


```

### Performance Targets

| Metric                        | Target          | EventBridge Benefit                              | Monitoring         |
| ----------------------------- | --------------- | ------------------------------------------------ | ------------------ |
| Session Start API Response    | < 500ms         | ✅ Immediate response, no 60s wait               | CloudWatch         |
| Session Ready Time            | < 30 seconds    | ✅ Async provisioning with progress tracking     | EventBridge Events |
| WebSocket Latency             | < 100ms         | ✅ EventBridge coordination for connection state | Custom Metrics     |
| Browser Task Startup          | < 20 seconds    | ✅ Parallel provisioning and health checks       | ECS + EventBridge  |
| Concurrent Sessions           | 500+ per region | ✅ EventBridge queuing and burst handling        | Auto-scaling       |
| Session Creation Success Rate | > 99%           | ✅ Automatic retry and dead letter queues        | EventBridge DLQ    |
| Error Recovery Time           | < 60 seconds    | ✅ Circuit breaker and automated cleanup         | EventBridge Rules  |

## Deployment

### CI/CD Pipeline

```mermaid
graph TB
    subgraph "Source Control"
        GitHub[GitHub Repository<br/>wallcrawler]
        PRs[Pull Requests<br/>Feature Branches]
        Main[Main Branch<br/>Production Ready]
    end

    subgraph "Build Process"
        GoBuilds[Go Lambda Builds<br/>backend-go/build.sh]
        TypeScriptBuilds[TypeScript Builds<br/>pnpm build]
        DockerBuild[Docker Image Build<br/>ECS Container]
        Tests[Unit Tests<br/>Integration Tests]
    end

    subgraph "AWS Deployment"
        CDKSynth[CDK Synthesize<br/>CloudFormation Template]
        CDKDeploy[CDK Deploy<br/>Infrastructure Update]
        LambdaDeploy[Lambda Deployment<br/>Function Updates]
        ECSUpdate[ECS Service Update<br/>Rolling Deployment]
    end

    subgraph "Environments"
        Dev[Development<br/>development context]
        Staging[Staging<br/>staging context]
        Prod[Production<br/>production context]
    end

    GitHub --> PRs
    PRs --> GoBuilds
    PRs --> TypeScriptBuilds
    PRs --> Tests

    Main --> DockerBuild
    DockerBuild --> CDKSynth
    CDKSynth --> CDKDeploy

    CDKDeploy --> LambdaDeploy
    CDKDeploy --> ECSUpdate

    LambdaDeploy --> Dev
    ECSUpdate --> Dev

    Dev --> Staging
    Staging --> Prod


```

### Deployment Commands

```bash
# Development deployment
pnpm install
pnpm build
cd packages/aws-cdk
cdk deploy --context environment=development

# Production deployment
pnpm install
pnpm build
cd packages/backend-go && ./build.sh
cd ../aws-cdk
cdk deploy --context environment=production --context domainName=api.wallcrawler.com
```

### Environment Configuration

Each environment uses CDK context for configuration:

```json
{
  "development": {
    "environment": "development",
    "ecsDesiredCount": 0,
    "redisNodeType": "cache.t3.micro",
    "lambdaMemory": 1024
  },
  "production": {
    "environment": "production",
    "domainName": "api.wallcrawler.com",
    "ecsDesiredCount": 0,
    "redisNodeType": "cache.r6g.large",
    "lambdaMemory": 2048
  }
}
```

---

This design document provides a comprehensive overview of the Wallcrawler architecture. For implementation details, refer to the individual package documentation in `/packages/*/README.md`.
