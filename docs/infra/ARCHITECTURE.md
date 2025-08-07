# Wallcrawler Backend Architecture

## Overview

Wallcrawler is a distributed, serverless browser automation platform that provides remote browser access through Chrome DevTools Protocol (CDP). The system supports both SDK-based session management (compatible with Browserbase) and AI-powered automation (Stagehand AI).

## High-Level Architecture

```mermaid
graph TB
    subgraph "Client Layer"
        Client[Client Application]
        Stagehand[Stagehand Instance]
        SDK[SDK-Node]
    end
    
    subgraph "Edge Layer"
        CloudFront[CloudFront CDN<br/>DDoS Protection<br/>Response Caching]
    end
    
    subgraph "API Layer"
        APIGateway[API Gateway<br/>REST API]
        Authorizer[Lambda Authorizer<br/>Validates Wallcrawler API Key<br/>Injects AWS API Key]
    end
    
    subgraph "Compute Layer"
        subgraph "Lambda Functions"
            SDKHandlers[SDK Handlers<br/>sessions-create/list/retrieve/debug/update]
            APIHandlers[API Handlers<br/>sessions-start]
            EventHandlers[Event Processors<br/>ecs-task/stream-processor]
        end
        
        subgraph "ECS Fargate"
            Browser[Browser Container<br/>Chrome + CDP Proxy<br/>Port 9223]
        end
    end
    
    subgraph "Storage Layer"
        DynamoDB[(DynamoDB<br/>Session State)]
        Secrets[Secrets Manager<br/>JWT Keys]
    end
    
    subgraph "Messaging Layer"
        EventBridge[EventBridge<br/>Task Events]
        SNS[SNS<br/>Session Ready]
        DynamoStreams[DynamoDB Streams]
    end
    
    Client --> Stagehand
    Stagehand --> SDK
    SDK --> CloudFront
    CloudFront --> APIGateway
    APIGateway --> Authorizer
    Authorizer -.->|Validates & Returns Policy| APIGateway
    APIGateway --> SDKHandlers
    APIGateway --> APIHandlers
    
    SDKHandlers --> DynamoDB
    SDKHandlers --> Browser
    Browser --> DynamoDB
    
    EventBridge --> EventHandlers
    DynamoStreams --> EventHandlers
    EventHandlers --> SNS
    SNS --> SDKHandlers
    
    Browser -.-> Secrets
    SDKHandlers -.-> Secrets
    
    %% Direct CDP Connection after session creation
    SDKHandlers -.->|Returns connectUrl| SDK
    SDK -.->|connectUrl with JWT| Stagehand
    Stagehand ===>|WebSocket CDP<br/>Direct Connection<br/>Port 9223| Browser
```

## AWS Infrastructure Diagram

![Wallcrawler AWS Architecture](./wallcrawler-aws-architecture.png)

## Component Details

### API Architecture

```
CloudFront CDN (d1234abcd.cloudfront.net)
└── API Gateway (with Lambda Authorizer)
    ├── /v1/                    # SDK-Compatible Endpoints
    │   ├── /sessions
    │   │   ├── POST           # Create session
    │   │   ├── GET            # List sessions
    │   │   └── /{id}
    │   │       ├── GET        # Get session
    │   │       ├── POST       # Update session
    │   │       ├── /debug     # Debug URLs
    │   │       ├── /downloads # Downloads
    │   │       ├── /logs      # Logs
    │   │       └── /recording # Recording
    │   ├── /contexts          # Context management
    │   ├── /extensions        # Extension management
    │   └── /projects          # Project management
    └── /sessions/             # Stagehand AI Endpoints
        └── /start             # AI-powered session creation
```

**Authentication Flow:**
1. Client sends request with `x-wc-api-key` header
2. Lambda Authorizer validates Wallcrawler API key
3. Authorizer injects AWS API key into request context
4. API Gateway forwards request to backend Lambda with AWS key

### Lambda Functions

| Function | Handler | Purpose |
|----------|---------|---------|
| **Authentication** | | |
| AuthorizerLambda | `authorizer` | Validate Wallcrawler API keys, inject AWS key |
| **SDK Handlers** | | |
| SDKSessionsCreate | `sdk/sessions-create` | Synchronous session creation |
| SDKSessionsList | `sdk/sessions-list` | List sessions with filters |
| SDKSessionsRetrieve | `sdk/sessions-retrieve` | Get session details |
| SDKSessionsDebug | `sdk/sessions-debug` | Generate debug URLs |
| SDKSessionsUpdate | `sdk/sessions-update` | Terminate sessions |
| **API Handlers** | | |
| APISessionsStart | `api/sessions-start` | AI-powered sessions (stubbed) |
| **Event Processors** | | |
| ECSTaskProcessor | `ecs-task-processor` | Handle ECS state changes |
| StreamProcessor | `sessions-stream-processor` | Process DynamoDB streams |

### ECS Container Architecture

```mermaid
graph LR
    subgraph "ECS Fargate Task"
        subgraph "Go Controller Process"
            Main[Main Process]
            CDP[CDP Proxy<br/>:9223]
            Health[Health Monitor]
        end
        
        subgraph "Chrome Process"
            Chrome[Headless Chrome<br/>:9222 localhost]
        end
        
        Main --> Chrome
        CDP --> Chrome
        Health --> Chrome
    end
    
    Client[External Client] -->|JWT Auth| CDP
    Lambda[Lambda] -->|JWT Auth| CDP
```

## Sequence Diagrams

### Session Creation Flow

```mermaid
sequenceDiagram
    participant C as Client
    participant S as Stagehand
    participant SDK as SDK-Node
    participant API as API Gateway
    participant L as Lambda
    participant DB as DynamoDB
    participant ECS as ECS
    participant EB as EventBridge
    participant SNS as SNS
    
    C->>S: Create browser instance
    S->>SDK: Initialize session
    SDK->>API: POST /v1/sessions
    API->>L: Invoke sessions-create
    
    L->>DB: Create session (CREATING)
    L->>L: Generate JWT token
    L->>ECS: RunTask with session env
    L->>SNS: Subscribe to session topic
    
    ECS->>ECS: Start Chrome + CDP Proxy
    ECS->>EB: Task RUNNING event
    
    EB->>L: Trigger ecs-task-processor
    L->>DB: Update session (READY)
    
    DB->>L: Stream event
    L->>SNS: Publish session ready
    
    SNS->>L: Notify sessions-create
    L->>API: Return session + connectUrl
    API->>SDK: Session details
    SDK->>S: Browser ready
    S->>C: Ready to use
```

### CDP Authentication Flow

```mermaid
sequenceDiagram
    participant C as Client
    participant P as CDP Proxy (:9223)
    participant SM as Secrets Manager
    participant CH as Chrome (:9222)
    
    C->>P: WebSocket connect + JWT
    P->>P: Validate JWT claims
    P->>SM: Get signing key (cached)
    SM->>P: Return key
    P->>P: Verify signature
    
    alt Valid JWT
        P->>CH: Proxy connection
        CH->>P: CDP response
        P->>C: Forward response
    else Invalid JWT
        P->>C: 401 Unauthorized
    end
    
    loop Health Check
        P->>CH: Check connection
        alt No connections for timeout
            P->>P: Terminate container
        end
    end
```

### Event Processing Flow

```mermaid
sequenceDiagram
    participant ECS as ECS Task
    participant EB as EventBridge
    participant L1 as Task Processor
    participant DB as DynamoDB
    participant DS as DynamoDB Streams
    participant L2 as Stream Processor
    participant SNS as SNS
    participant L3 as Waiting Lambda
    
    ECS->>EB: Task state change
    EB->>L1: Process event
    
    alt Task RUNNING
        L1->>DB: Update session READY
    else Task STOPPED
        L1->>DB: Update session TERMINATED
    end
    
    DB->>DS: Stream record
    DS->>L2: Process stream
    
    alt Session READY
        L2->>SNS: Publish ready event
        SNS->>L3: Notify subscribers
    end
```

## Security Architecture

### Authentication Layers

1. **API Layer**: Wallcrawler API key (`x-wc-api-key` header)
2. **CDP Layer**: JWT tokens with session-specific claims
3. **AWS Layer**: IAM roles and policies

### Network Security

```mermaid
graph TB
    subgraph "External Access"
        Internet[Internet]
    end
    
    subgraph "Security Groups"
        SGECS[ECS Security Group<br/>Ingress: 9223 from Any<br/>Egress: All]
        SGLambda[Lambda Security Group<br/>Egress: All]
    end
    
    subgraph "Port Access"
        Port9222[Port 9222<br/>Chrome CDP<br/>localhost only]
        Port9223[Port 9223<br/>CDP Proxy<br/>JWT Required]
    end
    
    Internet -->|Public IP| SGECS
    SGECS --> Port9223
    SGLambda --> SGECS
    Port9223 -->|Internal| Port9222
```

## Data Storage

### DynamoDB Schema

**Table: wallcrawler-sessions**

| Attribute | Type | Description |
|-----------|------|-------------|
| sessionId (PK) | String | Unique session identifier |
| status | String | CREATING, READY, TERMINATED |
| projectId | String | Project identifier |
| createdAt | Number | Unix timestamp |
| expiresAt | Number | TTL for automatic cleanup |
| taskArn | String | ECS task identifier |
| connectUrl | String | WebSocket CDP URL |
| publicIp | String | Container public IP |

**Global Secondary Indexes:**
- `projectId-createdAt-index`: Query sessions by project
- `status-expiresAt-index`: Find active/expired sessions

## Deployment Modes

### Development Mode
- No NAT Gateway (saves $45/month)
- Lambdas run outside VPC
- DynamoDB on-demand billing
- Single public subnet

### Production Mode
- NAT Gateway for private subnet egress
- Lambdas in private subnet
- WAF protection enabled
- Multi-AZ deployment

## Architectural Benefits

### CloudFront + Lambda Authorizer Design
1. **43% Cost Reduction**: Eliminated proxy Lambda and public API Gateway
2. **Free DDoS Protection**: AWS Shield Standard included with CloudFront
3. **Better Performance**: Edge caching for 401/403 responses
4. **Simpler Architecture**: Single API Gateway with authorizer pattern
5. **Result Caching**: 5-minute authorizer cache reduces Lambda invocations

### Cost Optimization
1. **Self-terminating containers**: ECS tasks monitor CDP connections and terminate when idle
2. **Serverless architecture**: Pay-per-use Lambda and DynamoDB
3. **Development mode**: Reduced infrastructure for non-production
4. **TTL cleanup**: Automatic session expiration in DynamoDB
5. **Edge caching**: CloudFront reduces backend load

## Monitoring & Observability

- **CloudWatch Logs**: All Lambda and ECS container logs
- **Container Insights**: ECS cluster metrics
- **EventBridge**: Audit trail for all session events
- **DynamoDB Streams**: Real-time session state changes

## Future Enhancements

1. **AI Mode Implementation**: Complete Stagehand AI endpoints (act, extract, observe)
2. **Multi-region Support**: Global browser deployment
3. **Session Recording**: Video capture of browser sessions
4. **Advanced Analytics**: Usage metrics and performance monitoring
5. **WebRTC Support**: Real-time browser streaming