# Wallcrawler Architecture

## AWS Infrastructure

```mermaid
graph TD
    subgraph Clients
        SDK[SDK Clients]
        Stagehand[Stagehand Agents]
        Admin[Internal Tools]
    end

    subgraph Edge
        CF[Amazon CloudFront]
        WAF[AWS WAF]
    end

    subgraph API
        APIGW[Amazon API Gateway]
        Authorizer[Lambda Authorizer]
    end

    subgraph Compute
        SessionsLambdas["Sessions Lambdas<br/>create/list/read/update/debug"]
        ProjectsLambdas["Projects Lambdas<br/>list/retrieve/usage"]
        ContextsLambdas["Contexts Lambdas<br/>create/retrieve/update"]
        StreamLambdas["Event Lambdas<br/>stream to SNS, ECS task"]
        ECS[Amazon ECS Fargate]
    end

    subgraph Data
        SessionsTable["DynamoDB<br/>wallcrawler-sessions"]
        ProjectsTable["DynamoDB<br/>wallcrawler-projects"]
        ApiKeysTable["DynamoDB<br/>wallcrawler-api-keys"]
        ContextsTable["DynamoDB<br/>wallcrawler-contexts"]
        ContextBucket["S3<br/>wallcrawler-contexts-*"]
        ReadyTopic["SNS<br/>wallcrawler-session-ready"]
    end

    Clients --> CF --> WAF --> APIGW
    APIGW --> Authorizer
    Authorizer --> APIGW

    APIGW --> SessionsLambdas
    APIGW --> ProjectsLambdas
    APIGW --> ContextsLambdas

    SessionsLambdas --> SessionsTable
    SessionsLambdas --> ContextsTable
    SessionsLambdas --> ContextBucket
    SessionsLambdas --> ECS

    ProjectsLambdas --> ProjectsTable
    ProjectsLambdas --> SessionsTable

    ContextsLambdas --> ContextsTable
    ContextsLambdas --> ContextBucket

    StreamLambdas --> SessionsTable
    StreamLambdas --> ReadyTopic
    ReadyTopic --> SessionsLambdas
    StreamLambdas --> ContextBucket

    ECS --> ContextBucket
    ECS --> SessionsTable
```

## Sequence Diagrams

### Session Creation (with context reuse)

```mermaid
sequenceDiagram
    participant Client
    participant API as API Gateway
    participant Auth as Lambda Authorizer
    participant Create as sessions-create
    participant Contexts as DynamoDB (contexts)
    participant Sessions as DynamoDB (sessions)
    participant ECS as ECS Fargate
    participant SNS as SNS (session-ready)
    participant Stream as sessions-stream-processor

    Client->>API: POST /v1/sessions { browserSettings.context.id }
    API->>Auth: Authorize request
    Auth->>DynamoDB: Lookup API key -> allowed projects
    Auth->>API: Return allow policy and projectId
    API->>Create: Invoke Lambda
    Create->>Contexts: Validate context belongs to project
    Create->>Sessions: Put session (CREATING)
    Create->>Sessions: Update session (PROVISIONING, JWT)
    Create->>ECS: RunTask (env includes context + project)
    Create-->>Client: Wait on SNS notification

    ECS-->>Sessions: Controller updates session to READY (connect URL, IP)
    Sessions-->>Stream: DynamoDB stream event
    Stream->>SNS: Publish READY notification
    SNS->>Create: Notify waiting lambda
    Create->>Client: 200 { connectUrl, signingKey, ... }
```

### Context Lifecycle

```mermaid
sequenceDiagram
    participant Client
    participant API as API Gateway
    participant Auth as Lambda Authorizer
    participant CCreate as contexts-create
    participant CRetrieve as contexts-retrieve
    participant CUpdate as contexts-update
    participant Contexts as DynamoDB (contexts)
    participant Bucket as S3 (contexts bucket)

    Client->>API: POST /v1/contexts
    API->>Auth: Authorize
    API->>CCreate: Invoke
    CCreate->>Contexts: Put context metadata
    CCreate->>Client: Upload URL (pre-signed S3 PUT)
    Client->>Bucket: Upload profile archive

    Client->>API: GET /v1/contexts/{id}
    API->>Auth: Authorize
    API->>CRetrieve: Invoke
    CRetrieve->>Contexts: Get context
    CRetrieve->>Client: Metadata

    Client->>API: PUT /v1/contexts/{id}
    API->>Auth: Authorize
    API->>CUpdate: Invoke
    CUpdate->>Contexts: Update timestamp
    CUpdate->>Client: New upload URL
```

### Session Ready Notification

```mermaid
sequenceDiagram
    participant Controller as ECS Controller
    participant Sessions as DynamoDB (sessions)
    participant Stream as DynamoDB Stream
    participant Processor as sessions-stream-processor
    participant SNS as SNS Topic
    participant Create as sessions-create

    Controller->>Sessions: Update session (READY, connectUrl)
    Sessions-->>Stream: Emit stream record
    Stream->>Processor: Invoke Lambda
    Processor->>SNS: Publish READY notification
    SNS->>Create: Deliver message
    Create->>Client: Return session response
```

### Multi-Project Authorization

```mermaid
sequenceDiagram
    participant Client
    participant API as API Gateway
    participant Auth as Lambda Authorizer
    participant Keys as DynamoDB (api-keys)
    participant Projects as DynamoDB (projects)
    participant Handler as SDK Lambda

    Client->>API: Request with x-wc-api-key (+ optional x-wc-project-id)
    API->>Auth: Authorize
    Auth->>Keys: Fetch API key metadata (projectIds)
    Auth->>Projects: Load selected project
    Auth->>API: Allow policy + context { projectId, projectIds[*] }
    API->>Handler: Invoke Lambda
    Handler->>Handler: utils.GetAuthorizedProjectID / IDs
    Handler->>Service: Perform project-scoped action
    Handler->>Client: Response
```

## Notes

- Contexts, sessions, projects, and API keys are isolated per project. Multi-project keys are allowed; the authorizer enforces project membership on every request.
- Context archives are stored in S3 and hydrated by the ECS controller. When `persist` is true, the controller re-uploads the profile on shutdown.
- End-user isolation (per `ownerId`) should be implemented in the consumer application by tagging contexts and filtering before calling the Wallcrawler API.
```
