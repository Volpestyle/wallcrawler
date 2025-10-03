import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as snsSubscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3 from 'aws-cdk-lib/aws-s3';

export class WallcrawlerStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        // Environment variables from context
        const environment = this.node.tryGetContext('environment') || 'dev';
        const domainName = this.node.tryGetContext('domainName');

        // JWT signing key for CDP authentication
        // Automatically generated and stored in AWS Secrets Manager
        const jwtSigningSecret = new secretsmanager.Secret(this, 'JWTSigningKey', {
            description: 'JWT signing key for Wallcrawler CDP authentication',
            generateSecretString: {
                secretStringTemplate: JSON.stringify({ algorithm: 'HS256' }),
                generateStringKey: 'signingKey',
                excludeCharacters: '"@/\\\'',
                includeSpace: false,
                requireEachIncludedType: true,
                passwordLength: 64,
            },
        });

        // Optional automatic rotation (enabled by context parameter)
        const enableRotation = this.node.tryGetContext('enableJwtRotation') === 'true';
        if (enableRotation) {
            new secretsmanager.RotationSchedule(this, 'JWTKeyRotation', {
                secret: jwtSigningSecret,
                rotationLambda: new lambda.Function(this, 'JWTRotationFunction', {
                    runtime: lambda.Runtime.NODEJS_18_X,
                    handler: 'index.handler',
                    code: lambda.Code.fromInline(`
                        const AWS = require('aws-sdk');
                        const crypto = require('crypto');
                        
                        exports.handler = async (event) => {
                            const secretsManager = new AWS.SecretsManager();
                            
                            // Generate new 64-character base64 key
                            const newKey = crypto.randomBytes(48).toString('base64');
                            
                            const secretValue = {
                                algorithm: 'HS256',
                                signingKey: newKey
                            };
                            
                            await secretsManager.updateSecret({
                                SecretId: event.Step === 'createSecret' ? event.SecretId : event.SecretArn,
                                SecretString: JSON.stringify(secretValue)
                            }).promise();
                            
                            return { success: true };
                        };
                    `),
                    timeout: cdk.Duration.minutes(1),
                }),
                automaticallyAfter: cdk.Duration.days(30), // Rotate every 30 days
            });
        }

        const isDevelopment = environment === 'dev';

        // Allow overriding with context for development/testing
        const manualJwtKey = this.node.tryGetContext('jwtSigningKey');
        const jwtSigningKey = manualJwtKey || jwtSigningSecret.secretValue.unsafeUnwrap();

        // VPC for ECS
        // In development, we use only public subnets to avoid NAT Gateway costs
        const vpc = new ec2.Vpc(this, 'WallcrawlerVPC', {
            maxAzs: 2,
            natGateways: isDevelopment ? 0 : 1, // No NAT Gateway in dev
            enableDnsHostnames: true,
            enableDnsSupport: true,
            subnetConfiguration: isDevelopment ? [
                // Development: Only public subnets (no NAT costs)
                {
                    cidrMask: 24,
                    name: 'Public',
                    subnetType: ec2.SubnetType.PUBLIC,
                },
            ] : [
                // Production: Public and private subnets with NAT
                {
                    cidrMask: 24,
                    name: 'Public',
                    subnetType: ec2.SubnetType.PUBLIC,
                },
                {
                    cidrMask: 24,
                    name: 'Private',
                    subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
                },
            ],
        });

        // Security Groups
        const lambdaSecurityGroup = new ec2.SecurityGroup(this, 'LambdaSecurityGroup', {
            vpc,
            description: 'Security group for Wallcrawler Lambda functions',
            allowAllOutbound: true,
        });

        const ecsSecurityGroup = new ec2.SecurityGroup(this, 'ECSSecurityGroup', {
            vpc,
            description: 'Security group for ECS browser containers',
            allowAllOutbound: true,
        });

        // DynamoDB table for session management
        const sessionsTable = new dynamodb.Table(this, 'SessionsTable', {
            partitionKey: { name: 'sessionId', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            timeToLiveAttribute: 'expiresAt', // TTL field for automatic cleanup
            pointInTimeRecovery: true,
            stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES, // Enable streams for session state changes
            removalPolicy: cdk.RemovalPolicy.DESTROY, // For dev/test environments
        });

        cdk.Tags.of(sessionsTable).add('Service', 'Wallcrawler');
        cdk.Tags.of(sessionsTable).add('Resource', 'Sessions');

        // Global Secondary Index for project queries
        sessionsTable.addGlobalSecondaryIndex({
            indexName: 'projectId-createdAt-index',
            partitionKey: { name: 'projectId', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
            projectionType: dynamodb.ProjectionType.ALL
        });

        // GSI for efficient active session queries
        sessionsTable.addGlobalSecondaryIndex({
            indexName: 'status-expiresAt-index',
            partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'expiresAt', type: dynamodb.AttributeType.NUMBER },
            projectionType: dynamodb.ProjectionType.KEYS_ONLY
        });

        // Projects metadata table (tenancy & configuration)
        const projectsTable = new dynamodb.Table(this, 'ProjectsTable', {
            tableName: 'wallcrawler-projects',
            partitionKey: { name: 'projectId', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            pointInTimeRecovery: true,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });

        // API keys table keyed by hashed API key value
        const apiKeysTable = new dynamodb.Table(this, 'ApiKeysTable', {
            tableName: 'wallcrawler-api-keys',
            partitionKey: { name: 'apiKeyHash', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            pointInTimeRecovery: true,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });

        apiKeysTable.addGlobalSecondaryIndex({
            indexName: 'projectId-index',
            partitionKey: { name: 'projectId', type: dynamodb.AttributeType.STRING },
            projectionType: dynamodb.ProjectionType.ALL,
        });

        const contextsTable = new dynamodb.Table(this, 'ContextsTable', {
            tableName: 'wallcrawler-contexts',
            partitionKey: { name: 'contextId', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            pointInTimeRecovery: true,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });

        const contextsBucket = new s3.Bucket(this, 'ContextsBucket', {
            encryption: s3.BucketEncryption.S3_MANAGED,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            enforceSSL: true,
            versioned: false,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
        });

        const sessionArtifactsBucket = new s3.Bucket(this, 'SessionArtifactsBucket', {
            encryption: s3.BucketEncryption.S3_MANAGED,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            enforceSSL: true,
            versioned: false,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
        });

        // SNS Topic for session ready notifications
        const sessionReadyTopic = new sns.Topic(this, 'SessionReadyTopic', {
            topicName: 'wallcrawler-session-ready',
            displayName: 'Wallcrawler Session Ready Notifications',
        });

        // Allow Lambda to access ECS tasks (CDP proxy)
        ecsSecurityGroup.addIngressRule(
            lambdaSecurityGroup,
            ec2.Port.tcp(9223),
            'Lambda access to CDP Proxy'
        );

        // Allow external access to CDP Proxy port for authenticated Direct Mode
        ecsSecurityGroup.addIngressRule(
            ec2.Peer.anyIpv4(),
            ec2.Port.tcp(9223),
            'External access to authenticated CDP Proxy for Direct Mode'
        );

        // Chrome CDP (port 9222) is only accessible from localhost for security
        // External access goes through the authenticated CDP proxy on port 9223

        // ECS Cluster for browser containers
        const ecsCluster = new ecs.Cluster(this, 'BrowserCluster', {
            vpc,
            clusterName: 'wallcrawler-browsers',
            containerInsights: true,
        });

        // Task Definition for browser containers with our Go controller
        const browserTaskDefinition = new ecs.FargateTaskDefinition(this, 'BrowserTaskDefinition', {
            family: 'wallcrawler-browser', // Explicit family name for EventBridge filtering
            cpu: 1024,
            memoryLimitMiB: 2048,
            runtimePlatform: {
                operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
                cpuArchitecture: ecs.CpuArchitecture.X86_64,
            },
        });


        // Add permissions for ECS task to read JWT signing key from Secrets Manager
        browserTaskDefinition.addToTaskRolePolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'secretsmanager:GetSecretValue',
                'secretsmanager:DescribeSecret',
            ],
            resources: [jwtSigningSecret.secretArn],
        }));

        // Our Go controller container (includes Chrome with remote debugging)
        const controllerContainer = browserTaskDefinition.addContainer('controller', {
            image: ecs.ContainerImage.fromAsset('../backend-go', {
                file: 'Dockerfile',
            }),
            essential: true,
            memoryLimitMiB: 2048,
            portMappings: [
                {
                    containerPort: 9222,
                    protocol: ecs.Protocol.TCP,
                    name: 'chrome-cdp',
                },
                {
                    containerPort: 9223,
                    protocol: ecs.Protocol.TCP,
                    name: 'cdp-proxy',
                },
            ],
            environment: {
                SESSIONS_TABLE_NAME: sessionsTable.tableName,
                ECS_CLUSTER: ecsCluster.clusterName,
                // Use task definition family name instead of ARN to avoid circular reference
                ECS_TASK_DEFINITION_FAMILY: 'wallcrawler-browser',
                CONNECT_URL_BASE: domainName ? `https://${domainName}` : 'https://api.wallcrawler.dev',
                WALLCRAWLER_JWT_SIGNING_SECRET_ARN: jwtSigningSecret.secretArn,
                CDP_PROXY_PORT: '9223',
                CDP_DISCONNECT_TIMEOUT: '120', // 2 minutes in seconds
                CDP_HEALTH_CHECK_INTERVAL: '10', // Check every 10 seconds
            },
            logging: ecs.LogDrivers.awsLogs({
                streamPrefix: 'wallcrawler-controller',
                logRetention: logs.RetentionDays.ONE_WEEK,
            }),
        });

        // ECS Service for running browser tasks with public IP (for Direct Mode)
        const browserService = new ecs.FargateService(this, 'BrowserService', {
            cluster: ecsCluster,
            taskDefinition: browserTaskDefinition,
            desiredCount: 0, // We'll scale this via Lambda
            assignPublicIp: true, // Public IP for direct access
            vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
            securityGroups: [ecsSecurityGroup],
            serviceName: 'wallcrawler-browsers',
        });

        // Lambda execution role - create without inline policies first
        const lambdaExecutionRole = new iam.Role(this, 'LambdaExecutionRole', {
            assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole'),
            ],
            // Add basic permissions directly to avoid circular dependencies
            inlinePolicies: {
                LambdaBasicPolicy: new iam.PolicyDocument({
                    statements: [
                        new iam.PolicyStatement({
                            effect: iam.Effect.ALLOW,
                            actions: [
                                'ec2:DescribeNetworkInterfaces',
                                'ec2:DescribeInstances',
                                'ec2:DescribeTasks',
                            ],
                            resources: ['*'],
                        }),
                        new iam.PolicyStatement({
                            effect: iam.Effect.ALLOW,
                            actions: [
                                'events:PutEvents',
                            ],
                            resources: ['*'],
                        }),
                        new iam.PolicyStatement({
                            effect: iam.Effect.ALLOW,
                            actions: [
                                'secretsmanager:GetSecretValue',
                                'secretsmanager:DescribeSecret',
                            ],
                            resources: [jwtSigningSecret.secretArn],
                        }),
                    ],
                }),
            },
        });

        // Common Lambda environment variables
        const commonLambdaEnvironment = {
            SESSIONS_TABLE_NAME: sessionsTable.tableName,
            PROJECTS_TABLE_NAME: projectsTable.tableName,
            API_KEYS_TABLE_NAME: apiKeysTable.tableName,
            CONTEXTS_TABLE_NAME: contextsTable.tableName,
            CONTEXTS_BUCKET_NAME: contextsBucket.bucketName,
            SESSION_ARTIFACTS_BUCKET_NAME: sessionArtifactsBucket.bucketName,
            ECS_CLUSTER: ecsCluster.clusterName,
            // Use task definition family name instead of ARN to avoid circular reference
            ECS_TASK_DEFINITION_FAMILY: 'wallcrawler-browser',
            CONNECT_URL_BASE: domainName ? `https://${domainName}` : 'https://api.wallcrawler.dev',
            WALLCRAWLER_JWT_SIGNING_SECRET_ARN: jwtSigningSecret.secretArn,
            CDP_PROXY_PORT: '9223',
            SESSION_TIMEOUT_HOURS: '1', // Configurable timeout
        };

        // Factory function for consistent Lambda configuration
        const createLambdaFunction = (name: string, handler: string, description: string, timeoutMinutes: number = 15) => {
            return new lambda.Function(this, name, {
                runtime: lambda.Runtime.PROVIDED_AL2,
                handler: 'bootstrap',
                code: lambda.Code.fromAsset(`../backend-go/build/${handler.toLowerCase()}`),
                timeout: cdk.Duration.minutes(timeoutMinutes),
                memorySize: 1024,
                // In development, Lambdas run outside VPC for cost savings
                vpc: isDevelopment ? undefined : vpc,
                vpcSubnets: isDevelopment ? undefined : { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
                securityGroups: isDevelopment ? undefined : [lambdaSecurityGroup],
                environment: commonLambdaEnvironment,
                description,
                role: lambdaExecutionRole,
            });
        };

        // ================================================================= 
        // LAMBDA FUNCTIONS - Organized by category
        // =================================================================

        // --- SDK Handlers (Browserbase-compatible) ---
        const sdkSessionsCreateLambda = createLambdaFunction(
            'SDKSessionsCreateLambda',
            'sdk/sessions-create',
            'SDK: Create sessions synchronously',
            1 // 1 minute timeout - waits for container to be ready
        );

        // Subscribe to SNS topic for session ready notifications
        sessionReadyTopic.addSubscription(new snsSubscriptions.LambdaSubscription(sdkSessionsCreateLambda));

        const sdkSessionsListLambda = createLambdaFunction(
            'SDKSessionsListLambda',
            'sdk/sessions-list',
            'SDK: List sessions'
        );

        const sdkSessionsRetrieveLambda = createLambdaFunction(
            'SDKSessionsRetrieveLambda',
            'sdk/sessions-retrieve',
            'SDK: Retrieve session details'
        );

        const sdkSessionsDebugLambda = createLambdaFunction(
            'SDKSessionsDebugLambda',
            'sdk/sessions-debug',
            'SDK: Get session debug/live URLs'
        );

        const sdkSessionsUpdateLambda = createLambdaFunction(
            'SDKSessionsUpdateLambda',
            'sdk/sessions-update',
            'SDK: Update session (REQUEST_RELEASE)'
        );

        const sdkSessionsDownloadsLambda = createLambdaFunction(
            'SDKSessionsDownloadsLambda',
            'sdk/sessions-downloads',
            'SDK: List session file downloads'
        );

        const sdkSessionsLogsLambda = createLambdaFunction(
            'SDKSessionsLogsLambda',
            'sdk/sessions-logs',
            'SDK: Retrieve session event logs'
        );

        const sdkSessionsRecordingLambda = createLambdaFunction(
            'SDKSessionsRecordingLambda',
            'sdk/sessions-recording',
            'SDK: Retrieve session recording metadata'
        );

        const sdkSessionsUploadsLambda = createLambdaFunction(
            'SDKSessionsUploadsLambda',
            'sdk/sessions-uploads',
            'SDK: Generate pre-signed upload URLs for session assets'
        );

        const sdkProjectsListLambda = createLambdaFunction(
            'SDKProjectsListLambda',
            'sdk/projects-list',
            'SDK: List projects'
        );

        const sdkProjectsRetrieveLambda = createLambdaFunction(
            'SDKProjectsRetrieveLambda',
            'sdk/projects-retrieve',
            'SDK: Retrieve project'
        );

        const sdkProjectsUsageLambda = createLambdaFunction(
            'SDKProjectsUsageLambda',
            'sdk/projects-usage',
            'SDK: Project usage metrics'
        );

        const sdkContextsCreateLambda = createLambdaFunction(
            'SDKContextsCreateLambda',
            'sdk/contexts-create',
            'SDK: Create context'
        );

        const sdkContextsRetrieveLambda = createLambdaFunction(
            'SDKContextsRetrieveLambda',
            'sdk/contexts-retrieve',
            'SDK: Retrieve context'
        );

        const sdkContextsUpdateLambda = createLambdaFunction(
            'SDKContextsUpdateLambda',
            'sdk/contexts-update',
            'SDK: Update context'
        );

        const sdkNotImplementedLambda = createLambdaFunction(
            'SDKNotImplementedLambda',
            'common/not-implemented',
            'SDK: Not implemented stub'
        );

        // --- API Mode Handlers (Stagehand AI) ---
        const apiSessionsStartLambda = createLambdaFunction(
            'APISessionsStartLambda',
            'api/sessions-start',
            'API: Create AI-powered sessions (stubbed)'
        );

        // --- Wallcrawler-Specific Handlers ---
        // EventBridge for session events
        const sessionEventRule = new events.Rule(this, 'SessionEventRule', {
            description: 'Route session events to appropriate handlers',
            eventPattern: {
                source: ['wallcrawler.backend'],
                detailType: [
                    'SessionTerminated',
                    'SessionTimedOut'
                ],
            },
        });

        // EventBridge rule for ECS task state changes (AWS native events)
        const ecsTaskStateRule = new events.Rule(this, 'ECSTaskStateRule', {
            description: 'Monitor ECS task state changes for Wallcrawler browser containers',
            eventPattern: {
                source: ['aws.ecs'],
                detailType: ['ECS Task State Change'],
                detail: {
                    clusterArn: [ecsCluster.clusterArn],
                    // Match tasks by family name in the group field instead of taskDefinitionArn
                    group: [`family:wallcrawler-browser`]
                }
            },
        });

        // Session provisioner handles all session lifecycle events AND ECS task state changes
        const ecsTaskProcessorLambda = createLambdaFunction(
            'ECSTaskProcessorLambda',
            'ecs-task-processor',
            'Handle ECS task state changes'
        );

        sessionEventRule.addTarget(new targets.LambdaFunction(ecsTaskProcessorLambda));
        ecsTaskStateRule.addTarget(new targets.LambdaFunction(ecsTaskProcessorLambda));

        // DynamoDB Stream processor for session ready notifications
        const sessionsStreamProcessorLambda = createLambdaFunction(
            'SessionsStreamProcessorLambda',
            'sessions-stream-processor',
            'Process DynamoDB stream events for session state changes'
        );

        // Grant SNS publish permissions
        lambdaExecutionRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['sns:Publish'],
            resources: [sessionReadyTopic.topicArn],
        }));

        // Set the topic ARN as environment variable
        sessionsStreamProcessorLambda.addEnvironment('SESSION_READY_TOPIC_ARN', sessionReadyTopic.topicArn);

        // Add DynamoDB Stream event source
        sessionsStreamProcessorLambda.addEventSourceMapping('SessionsStreamEventSource', {
            eventSourceArn: sessionsTable.tableStreamArn!,
            startingPosition: lambda.StartingPosition.LATEST,
            batchSize: 10,
            maxBatchingWindow: cdk.Duration.seconds(1),
        });

        // Create Lambda Authorizer
        const authorizerLambda = createLambdaFunction(
            'AuthorizerLambda',
            'authorizer',
            'Validate Wallcrawler API keys and inject AWS API key',
            1 // 1 minute timeout
        );

        // Pass the AWS API key to the authorizer (will be set later)
        authorizerLambda.addEnvironment('AWS_API_KEY', 'PLACEHOLDER');

        // API Gateway for REST endpoints
        const api = new apigateway.RestApi(this, 'WallcrawlerAPI', {
            restApiName: 'Wallcrawler API',
            description: 'Remote browser automation API compatible with Stagehand',
            deployOptions: {
                stageName: environment,
                description: `${environment} stage`,
            },
            defaultCorsPreflightOptions: {
                allowOrigins: apigateway.Cors.ALL_ORIGINS,
                allowMethods: apigateway.Cors.ALL_METHODS,
                allowHeaders: [
                    'Content-Type',
                    'X-Amz-Date',
                    'Authorization',
                    'X-Api-Key',
                    'x-wc-api-key',
                    'x-wc-project-id',
                    'x-wc-session-id',
                    'x-model-api-key',
                    'x-stream-response',
                    'x-sent-at',
                    'x-language',
                    'x-sdk-version',
                ],
            },
        });

        // Create the Lambda Authorizer
        const authorizer = new apigateway.RequestAuthorizer(this, 'WallcrawlerAuthorizer', {
            handler: authorizerLambda,
            identitySources: [
                apigateway.IdentitySource.header('x-wc-api-key')
                // x-wc-project-id is optional - it can be read from headers in the Lambda but not required by API Gateway
            ],
            resultsCacheTtl: cdk.Duration.minutes(5), // Cache auth results for 5 minutes
            authorizerName: 'WallcrawlerApiKeyAuthorizer',
        });

        // Configure API Gateway to pass the AWS API key from authorizer to backend
        // This is done at the integration level for each method

        // API Key for internal authentication (passed to Lambda Authorizer)
        const apiKey = api.addApiKey('WallcrawlerInternalApiKey', {
            apiKeyName: 'wallcrawler-internal-api-key',
            description: 'Internal API key for AWS API Gateway access',
        });

        const usagePlan = api.addUsagePlan('WallcrawlerUsagePlan', {
            name: 'Wallcrawler Usage Plan',
            throttle: {
                rateLimit: 1000,
                burstLimit: 2000,
            },
            quota: {
                limit: 100000,
                period: apigateway.Period.MONTH,
            },
        });

        usagePlan.addApiKey(apiKey);
        usagePlan.addApiStage({
            stage: api.deploymentStage
        });

        // Update the authorizer Lambda with the API key
        const apiKeyRetriever = new cr.AwsCustomResource(this, 'AuthorizerApiKeyRetriever', {
            onCreate: {
                service: 'APIGateway',
                action: 'getApiKey',
                parameters: {
                    apiKey: apiKey.keyId,
                    includeValue: true,
                },
                physicalResourceId: cr.PhysicalResourceId.of(apiKey.keyId),
            },
            policy: cr.AwsCustomResourcePolicy.fromStatements([
                new iam.PolicyStatement({
                    actions: ['apigateway:GET'],
                    resources: ['*'],
                }),
            ]),
        });

        const authorizerApiKeyUpdater = new cr.AwsCustomResource(this, 'AuthorizerApiKeyUpdater', {
            onCreate: {
                service: 'Lambda',
                action: 'updateFunctionConfiguration',
                parameters: {
                    FunctionName: authorizerLambda.functionName,
                    Environment: {
                        Variables: {
                            AWS_API_KEY: apiKeyRetriever.getResponseField('value'),
                        },
                    },
                },
                physicalResourceId: cr.PhysicalResourceId.of(`${authorizerLambda.functionName}-api-key-update`),
            },
            onUpdate: {
                service: 'Lambda',
                action: 'updateFunctionConfiguration',
                parameters: {
                    FunctionName: authorizerLambda.functionName,
                    Environment: {
                        Variables: {
                            AWS_API_KEY: apiKeyRetriever.getResponseField('value'),
                        },
                    },
                },
            },
            policy: cr.AwsCustomResourcePolicy.fromStatements([
                new iam.PolicyStatement({
                    actions: ['lambda:UpdateFunctionConfiguration'],
                    resources: [authorizerLambda.functionArn],
                }),
            ]),
        });

        authorizerApiKeyUpdater.node.addDependency(apiKey);
        authorizerApiKeyUpdater.node.addDependency(apiKeyRetriever);

        // Request validator for API
        const requestValidator = new apigateway.RequestValidator(this, 'RequestValidator', {
            restApi: api,
            requestValidatorName: 'wallcrawler-validator',
            validateRequestBody: true,
            validateRequestParameters: true,
        });

        // Lambda integrations with streaming support
        const createStreamingIntegration = (lambdaFunction: lambda.Function) => {
            return new apigateway.LambdaIntegration(lambdaFunction, {
                proxy: true,
                integrationResponses: [
                    {
                        statusCode: '200',
                        responseParameters: {
                            'method.response.header.Content-Type': "'text/plain'",
                            'method.response.header.Cache-Control': "'no-cache'",
                            'method.response.header.Connection': "'keep-alive'",
                        },
                    },
                ],
            });
        };

        // Helper function to create Lambda integration with AWS API key injection
        const createAuthenticatedIntegration = (lambdaFunction: lambda.Function) => {
            return new apigateway.LambdaIntegration(lambdaFunction, {
                proxy: true,
                requestParameters: {
                    'integration.request.header.X-Api-Key': 'context.authorizer.awsApiKey'
                }
            });
        };

        // =================================================================
        // GROUP 1: SDK-COMPATIBLE ENDPOINTS (Browserbase-style API)
        // All endpoints under /v1/ that match the SDK expectations
        // =================================================================

        const v1Resource = api.root.addResource('v1');

        // --- Sessions Resource (/v1/sessions) ---
        const v1SessionsResource = v1Resource.addResource('sessions');

        // Step Functions role removed - using direct Lambda integration

        // POST /v1/sessions - Create session (direct Lambda integration)
        v1SessionsResource.addMethod('POST',
            createAuthenticatedIntegration(sdkSessionsCreateLambda),
            {
                authorizer,
                requestValidator,
                methodResponses: [
                    { statusCode: '200' },
                    { statusCode: '400' },
                    { statusCode: '500' },
                ],
            }
        );

        // GET /v1/sessions - List sessions
        v1SessionsResource.addMethod('GET',
            createAuthenticatedIntegration(sdkSessionsListLambda),
            { authorizer }
        );

        // Session-specific SDK endpoints (/v1/sessions/{id})
        const v1SessionResource = v1SessionsResource.addResource('{id}');

        // GET /v1/sessions/{id} - Retrieve session
        v1SessionResource.addMethod('GET',
            createAuthenticatedIntegration(sdkSessionsRetrieveLambda),
            { authorizer }
        );

        // POST /v1/sessions/{id} - Update session  
        v1SessionResource.addMethod('POST',
            createAuthenticatedIntegration(sdkSessionsUpdateLambda),
            { authorizer }
        );

        // GET /v1/sessions/{id}/debug - Debug/live URLs
        v1SessionResource.addResource('debug').addMethod('GET',
            createAuthenticatedIntegration(sdkSessionsDebugLambda),
            { authorizer }
        );

        // GET /v1/sessions/{id}/downloads - Downloads
        v1SessionResource.addResource('downloads').addMethod('GET',
            createAuthenticatedIntegration(sdkSessionsDownloadsLambda),
            { authorizer }
        );

        // GET /v1/sessions/{id}/logs - Logs
        v1SessionResource.addResource('logs').addMethod('GET',
            createAuthenticatedIntegration(sdkSessionsLogsLambda),
            { authorizer }
        );

        // GET /v1/sessions/{id}/recording - Recording
        v1SessionResource.addResource('recording').addMethod('GET',
            createAuthenticatedIntegration(sdkSessionsRecordingLambda),
            { authorizer }
        );

        // POST /v1/sessions/{id}/uploads - Uploads
        v1SessionResource.addResource('uploads').addMethod('POST',
            createAuthenticatedIntegration(sdkSessionsUploadsLambda),
            {
                authorizer,
                requestValidator,
            }
        );

        // --- Contexts Resource (/v1/contexts) ---
        const v1ContextsResource = v1Resource.addResource('contexts');

        // POST /v1/contexts - Create context
        v1ContextsResource.addMethod('POST',
            createAuthenticatedIntegration(sdkContextsCreateLambda),
            {
                authorizer,
                requestValidator,
            }
        );

        // Context-specific endpoints (/v1/contexts/{id})
        const v1ContextResource = v1ContextsResource.addResource('{id}');

        // GET /v1/contexts/{id} - Retrieve context
        v1ContextResource.addMethod('GET',
            createAuthenticatedIntegration(sdkContextsRetrieveLambda),
            { authorizer }
        );

        // PUT /v1/contexts/{id} - Update context
        v1ContextResource.addMethod('PUT',
            createAuthenticatedIntegration(sdkContextsUpdateLambda),
            {
                authorizer,
                requestValidator,
            }
        );

        // --- Extensions Resource (/v1/extensions) ---
        const v1ExtensionsResource = v1Resource.addResource('extensions');

        // POST /v1/extensions - Create extension
        v1ExtensionsResource.addMethod('POST',
            createAuthenticatedIntegration(sdkNotImplementedLambda),
            {
                authorizer,
                requestValidator,
            }
        );

        // Extension-specific endpoints (/v1/extensions/{id})
        const v1ExtensionResource = v1ExtensionsResource.addResource('{id}');

        // GET /v1/extensions/{id} - Retrieve extension
        v1ExtensionResource.addMethod('GET',
            createAuthenticatedIntegration(sdkNotImplementedLambda),
            { authorizer }
        );

        // DELETE /v1/extensions/{id} - Delete extension
        v1ExtensionResource.addMethod('DELETE',
            createAuthenticatedIntegration(sdkNotImplementedLambda),
            { authorizer }
        );

        // --- Projects Resource (/v1/projects) ---
        const v1ProjectsResource = v1Resource.addResource('projects');

        // GET /v1/projects - List projects
        v1ProjectsResource.addMethod('GET',
            createAuthenticatedIntegration(sdkProjectsListLambda),
            { authorizer }
        );

        // Project-specific endpoints (/v1/projects/{id})
        const v1ProjectResource = v1ProjectsResource.addResource('{id}');

        // GET /v1/projects/{id} - Retrieve project
        v1ProjectResource.addMethod('GET',
            createAuthenticatedIntegration(sdkProjectsRetrieveLambda),
            { authorizer }
        );

        // GET /v1/projects/{id}/usage - Project usage
        v1ProjectResource.addResource('usage').addMethod('GET',
            createAuthenticatedIntegration(sdkProjectsUsageLambda),
            { authorizer }
        );

        // =================================================================
        // GROUP 2: STAGEHAND API ENDPOINTS (AI-powered automation)
        // All endpoints under /sessions/ for Stagehand's API mode
        // =================================================================

        const sessionsResource = api.root.addResource('sessions');

        // POST /sessions/start - Stagehand-compatible AI session creation
        const startResource = sessionsResource.addResource('start');
        startResource.addMethod('POST',
            createAuthenticatedIntegration(apiSessionsStartLambda),
            {
                authorizer,
                requestValidator,
            }
        );

        // AI-powered session operations (/sessions/{sessionId})
        const sessionResource = sessionsResource.addResource('{sessionId}');

        // Note: AI operation endpoints (act, extract, observe, etc.) are stubbed for now
        // They can be added later when we implement API mode

        // =================================================================
        // GROUP 3: WALLCRAWLER-SPECIFIC ENDPOINTS  
        // Custom endpoints for Wallcrawler-specific functionality
        // Note: CDP URLs are now provided via SDK-compatible endpoints:
        // - POST /v1/sessions (returns connectUrl)
        // - GET /v1/sessions/{id} (returns connectUrl for reconnection)
        // - GET /v1/sessions/{id}/debug (returns debugger URLs)
        // =================================================================

        // EventBridge for async communication
        const eventBus = new events.EventBus(this, 'WallcrawlerEventBus', {
            eventBusName: 'wallcrawler-events',
        });

        // WAF for API protection (only in production)
        if (!isDevelopment) {
            const webAcl = new wafv2.CfnWebACL(this, 'WallcrawlerWebACL', {
                scope: 'REGIONAL',
                defaultAction: { allow: {} },
                rules: [
                    {
                        name: 'AWSManagedRulesCommonRuleSet',
                        priority: 1,
                        statement: {
                            managedRuleGroupStatement: {
                                vendorName: 'AWS',
                                name: 'AWSManagedRulesCommonRuleSet',
                            },
                        },
                        overrideAction: { none: {} },
                        visibilityConfig: {
                            sampledRequestsEnabled: true,
                            cloudWatchMetricsEnabled: true,
                            metricName: 'CommonRuleSet',
                        },
                    },
                    {
                        name: 'RateLimitRule',
                        priority: 2,
                        statement: {
                            rateBasedStatement: {
                                limit: 1000,
                                aggregateKeyType: 'IP',
                            },
                        },
                        action: { block: {} },
                        visibilityConfig: {
                            sampledRequestsEnabled: true,
                            cloudWatchMetricsEnabled: true,
                            metricName: 'RateLimit',
                        },
                    },
                ],
                visibilityConfig: {
                    sampledRequestsEnabled: true,
                    cloudWatchMetricsEnabled: true,
                    metricName: 'WallcrawlerWebACL',
                },
            });

            // Associate WAF with API Gateway
            new wafv2.CfnWebACLAssociation(this, 'WebACLAssociation', {
                webAclArn: webAcl.attrArn,
                resourceArn: `arn:aws:apigateway:${this.region}::/restapis/${api.restApiId}/stages/${api.deploymentStage.stageName}`,
            });
        }

        // Add ECS permissions to Lambda role after all resources are created
        // Use addToRolePolicy to avoid circular dependencies
        lambdaExecutionRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'ecs:RunTask',
                'ecs:DescribeTasks',
                'ecs:StopTask',
                'ecs:ListTasks',
            ],
            resources: [
                // Use wildcard for task definition to avoid circular reference
                `arn:aws:ecs:${this.region}:${this.account}:task-definition/wallcrawler-browser:*`,
                `${ecsCluster.clusterArn}/*`,
            ],
        }));

        lambdaExecutionRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'iam:PassRole',
            ],
            resources: [
                browserTaskDefinition.taskRole.roleArn,
                browserTaskDefinition.executionRole!.roleArn,
            ],
        }));

        // Add DynamoDB permissions to Lambda execution role
        lambdaExecutionRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'dynamodb:PutItem',
                'dynamodb:GetItem',
                'dynamodb:UpdateItem',
                'dynamodb:DeleteItem',
                'dynamodb:Query',
                'dynamodb:Scan',
            ],
            resources: [
                sessionsTable.tableArn,
                `${sessionsTable.tableArn}/index/*`,
                projectsTable.tableArn,
                apiKeysTable.tableArn,
                `${apiKeysTable.tableArn}/index/*`,
                contextsTable.tableArn,
            ],
        }));

        // Add DynamoDB Streams permissions for the stream processor Lambda
        lambdaExecutionRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'dynamodb:GetRecords',
                'dynamodb:GetShardIterator',
                'dynamodb:DescribeStream',
                'dynamodb:ListStreams',
            ],
            resources: [
                `${sessionsTable.tableArn}/stream/*`,
            ],
        }));

        lambdaExecutionRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                's3:GetObject',
                's3:PutObject',
                's3:DeleteObject',
                's3:ListBucket',
            ],
            resources: [
                contextsBucket.bucketArn,
                `${contextsBucket.bucketArn}/*`,
                sessionArtifactsBucket.bucketArn,
                `${sessionArtifactsBucket.bucketArn}/*`,
            ],
        }));

        // Add DynamoDB permissions to ECS task role for status updates
        browserTaskDefinition.addToTaskRolePolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'dynamodb:UpdateItem',
            ],
            resources: [sessionsTable.tableArn],
        }));

        browserTaskDefinition.addToTaskRolePolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                's3:GetObject',
                's3:PutObject',
            ],
            resources: [`${contextsBucket.bucketArn}/*`],
        }));

        // =================================================================
        // CLOUDFRONT DISTRIBUTION - DDoS Protection & Caching
        // Public-facing CDN that routes to API Gateway with Lambda Authorizer
        // =================================================================

        // Create CloudFront distribution
        const distribution = new cloudfront.Distribution(this, 'WallcrawlerDistribution', {
            comment: 'Wallcrawler API CloudFront Distribution',
            defaultBehavior: {
                origin: new origins.RestApiOrigin(api, {
                    customHeaders: {
                        // CloudFront will pass these headers to API Gateway
                    },
                }),
                allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
                cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD,
                // Custom cache policy with minimal caching (1 second) to forward Authorization header
                // This is required because CloudFront doesn't allow header configuration with TTL=0
                cachePolicy: new cloudfront.CachePolicy(this, 'WallcrawlerCachePolicy', {
                    cachePolicyName: `WallcrawlerAPICache-${environment}`,
                    comment: 'Minimal cache policy for Wallcrawler API with Authorization header',
                    defaultTtl: cdk.Duration.seconds(1), // Minimum TTL to allow header configuration
                    minTtl: cdk.Duration.seconds(1),
                    maxTtl: cdk.Duration.seconds(1),
                    headerBehavior: cloudfront.CacheHeaderBehavior.allowList(
                        'Authorization',
                        'x-wc-api-key',
                        'x-wc-project-id',
                        'x-wc-session-id',
                        'Content-Type'
                    ),
                    queryStringBehavior: cloudfront.CacheQueryStringBehavior.all(),
                    cookieBehavior: cloudfront.CacheCookieBehavior.none(),
                    enableAcceptEncodingGzip: true,
                    enableAcceptEncodingBrotli: true,
                }),
                viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            },
            // Cache 403 responses to prevent DDoS (401 is not supported by CloudFront)
            errorResponses: [
                {
                    httpStatus: 403,
                    ttl: cdk.Duration.minutes(5), // Cache forbidden for 5 minutes
                },
            ],
            // Enable AWS Shield Standard (free)
            enableIpv6: true,
            priceClass: cloudfront.PriceClass.PRICE_CLASS_100, // Use only North America and Europe edge locations for cost savings
        });

        // CloudFormation outputs
        new cdk.CfnOutput(this, 'CloudFrontURL', {
            description: 'CloudFront distribution URL for Wallcrawler API',
            value: `https://${distribution.distributionDomainName}`,
            exportName: 'WallcrawlerCloudFrontURL',
        });

        new cdk.CfnOutput(this, 'InternalAPIGatewayURL', {
            description: 'Internal API Gateway URL (for debugging only)',
            value: api.url,
        });

        // Keep the original output name but point to CloudFront
        new cdk.CfnOutput(this, 'APIGatewayURL', {
            description: 'API endpoint URL (via CloudFront)',
            value: `https://${distribution.distributionDomainName}`,
        });

        new cdk.CfnOutput(this, 'ApiKeyId', {
            description: 'API Key ID for authentication',
            value: apiKey.keyId,
        });

        new cdk.CfnOutput(this, 'GetApiKeyCommand', {
            description: 'Command to retrieve the actual API key value',
            value: `aws apigateway get-api-key --api-key ${apiKey.keyId} --include-value --query value --output text --region ${this.region}`,
        });

        new cdk.CfnOutput(this, 'DynamoDBTableName', {
            description: 'DynamoDB table name for sessions',
            value: sessionsTable.tableName,
        });

        new cdk.CfnOutput(this, 'ECSClusterName', {
            description: 'ECS cluster name for browser containers',
            value: ecsCluster.clusterName,
        });

        new cdk.CfnOutput(this, 'VPCId', {
            description: 'VPC ID for the Wallcrawler infrastructure',
            value: vpc.vpcId,
        });

        new cdk.CfnOutput(this, 'DirectModeSupported', {
            description: 'Direct Mode with enterprise security (JWT authenticated CDP proxy)',
            value: 'Enterprise (Authenticated CDP Proxy on port 9223)',
        });

        new cdk.CfnOutput(this, 'SecurityModel', {
            description: 'Security configuration for CDP access',
            value: 'Chrome localhost-only (9222) + Authenticated Proxy (9223)',
        });

        new cdk.CfnOutput(this, 'TaskDefinitionArn', {
            description: 'ECS Task Definition ARN for browser containers',
            value: browserTaskDefinition.taskDefinitionArn,
        });

        new cdk.CfnOutput(this, 'JWTSigningSecretArn', {
            description: 'AWS Secrets Manager ARN for JWT signing key',
            value: jwtSigningSecret.secretArn,
        });

        new cdk.CfnOutput(this, 'SessionArtifactsBucketName', {
            description: 'S3 bucket for session uploads and artifacts',
            value: sessionArtifactsBucket.bucketName,
        });

        // Development mode cost savings output
        if (isDevelopment) {
            new cdk.CfnOutput(this, 'DevelopmentMode', {
                description: 'Development mode is enabled with cost optimizations',
                value: 'ENABLED - No NAT Gateway ($45/mo saved), DynamoDB on-demand pricing, Lambdas outside VPC',
            });
        }

        // Hybrid storage architecture output
        new cdk.CfnOutput(this, 'StorageArchitecture', {
            description: 'Hybrid storage approach for optimal performance and cost',
            value: 'DynamoDB for session state + SNS/EventBridge for pub/sub events',
        });
    }
} 
