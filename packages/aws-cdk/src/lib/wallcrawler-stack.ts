import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';

export class WallcrawlerStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        // Environment variables from context
        const environment = this.node.tryGetContext('environment') || 'development';
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

        // Allow overriding with context for development/testing
        const manualJwtKey = this.node.tryGetContext('jwtSigningKey');
        const jwtSigningKey = manualJwtKey || jwtSigningSecret.secretValue.unsafeUnwrap();

        // VPC for ECS and Redis
        const vpc = new ec2.Vpc(this, 'WallcrawlerVPC', {
            maxAzs: 2,
            natGateways: 1,
            enableDnsHostnames: true,
            enableDnsSupport: true,
            subnetConfiguration: [
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

        const redisSecurityGroup = new ec2.SecurityGroup(this, 'RedisSecurityGroup', {
            vpc,
            description: 'Security group for Redis cluster',
            allowAllOutbound: false,
        });

        // Allow Lambda to access Redis
        redisSecurityGroup.addIngressRule(
            lambdaSecurityGroup,
            ec2.Port.tcp(6379),
            'Lambda access to Redis'
        );

        // Allow ECS to access Redis
        redisSecurityGroup.addIngressRule(
            ecsSecurityGroup,
            ec2.Port.tcp(6379),
            'ECS access to Redis'
        );

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

        // ElastiCache Redis cluster for session state
        const redisSubnetGroup = new elasticache.CfnSubnetGroup(this, 'RedisSubnetGroup', {
            description: 'Subnet group for Wallcrawler Redis cluster',
            subnetIds: vpc.privateSubnets.map(subnet => subnet.subnetId),
        });

        const redisCluster = new elasticache.CfnCacheCluster(this, 'RedisCluster', {
            cacheNodeType: 'cache.t3.micro',
            engine: 'redis',
            numCacheNodes: 1,
            cacheSubnetGroupName: redisSubnetGroup.ref,
            vpcSecurityGroupIds: [redisSecurityGroup.securityGroupId],
            port: 6379,
        });

        // ECS Cluster for browser containers
        const ecsCluster = new ecs.Cluster(this, 'BrowserCluster', {
            vpc,
            clusterName: 'wallcrawler-browsers',
            containerInsights: true,
        });

        // Task Definition for browser containers with our Go controller
        const browserTaskDefinition = new ecs.FargateTaskDefinition(this, 'BrowserTaskDefinition', {
            cpu: 1024,
            memoryLimitMiB: 2048,
            runtimePlatform: {
                operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
                cpuArchitecture: ecs.CpuArchitecture.X86_64,
            },
        });

        // Add permissions for ECS task to manage WebSocket connections
        browserTaskDefinition.addToTaskRolePolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'execute-api:ManageConnections',
            ],
            resources: ['*'], // Will be scoped after WebSocket API is created
        }));

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
                REDIS_ADDR: `${redisCluster.attrRedisEndpointAddress}:6379`,
                ECS_CLUSTER: ecsCluster.clusterName,
                ECS_TASK_DEFINITION: browserTaskDefinition.taskDefinitionArn,
                CONNECT_URL_BASE: domainName ? `https://${domainName}` : 'https://api.wallcrawler.dev',
                WALLCRAWLER_JWT_SIGNING_SECRET_ARN: jwtSigningSecret.secretArn,
                CDP_PROXY_PORT: '9223',
                // WebSocket endpoint will be added after WebSocket API is created
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

        // Lambda execution role with necessary permissions
        const lambdaExecutionRole = new iam.Role(this, 'LambdaExecutionRole', {
            assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole'),
            ],
            inlinePolicies: {
                WallcrawlerPolicy: new iam.PolicyDocument({
                    statements: [
                        new iam.PolicyStatement({
                            effect: iam.Effect.ALLOW,
                            actions: [
                                'ecs:RunTask',
                                'ecs:DescribeTasks',
                                'ecs:StopTask',
                                'ecs:ListTasks',
                            ],
                            resources: [
                                browserTaskDefinition.taskDefinitionArn,
                                `${ecsCluster.clusterArn}/*`,
                            ],
                        }),
                        new iam.PolicyStatement({
                            effect: iam.Effect.ALLOW,
                            actions: [
                                'iam:PassRole',
                            ],
                            resources: [
                                browserTaskDefinition.taskRole.roleArn,
                                browserTaskDefinition.executionRole!.roleArn,
                            ],
                        }),
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
            REDIS_ADDR: `${redisCluster.attrRedisEndpointAddress}:6379`,
            ECS_CLUSTER: ecsCluster.clusterName,
            ECS_TASK_DEFINITION: browserTaskDefinition.taskDefinitionArn,
            CONNECT_URL_BASE: domainName ? `https://${domainName}` : 'https://api.wallcrawler.dev',
            WALLCRAWLER_JWT_SIGNING_SECRET_ARN: jwtSigningSecret.secretArn,
            CDP_PROXY_PORT: '9223',
        };

        // Factory function for consistent Lambda configuration
        const createLambdaFunction = (name: string, handler: string, description: string) => {
            return new lambda.Function(this, name, {
                runtime: lambda.Runtime.PROVIDED_AL2,
                handler: 'bootstrap',
                code: lambda.Code.fromAsset(`../backend-go/build/${handler.toLowerCase()}`),
                timeout: cdk.Duration.minutes(15),
                memorySize: 1024,
                vpc,
                environment: commonLambdaEnvironment,
                description,
            });
        };

        // ================================================================= 
        // LAMBDA FUNCTIONS - Organized by category
        // =================================================================

        // --- SDK Handlers (Browserbase-compatible) ---
        const sdkSessionsCreateLambda = createLambdaFunction(
            'SDKSessionsCreateLambda',
            'sdk/sessions-create',
            'SDK: Create basic browser sessions'
        );

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

        const sdkSessionsUpdateLambda = createLambdaFunction(
            'SDKSessionsUpdateLambda',
            'sdk/sessions-update',
            'SDK: Update session (REQUEST_RELEASE)'
        );

        // --- API Mode Handlers (Stagehand AI) ---
        const apiSessionsStartLambda = createLambdaFunction(
            'APISessionsStartLambda',
            'api/sessions-start',
            'API: Create AI-powered sessions (stubbed)'
        );

        // --- Wallcrawler-Specific Handlers ---
        const sessionCdpUrlLambda = createLambdaFunction(
            'SessionCdpUrlLambda',
            'cdp-url',
            'Generate signed CDP URLs'
        );

        // EventBridge for session events
        const sessionEventRule = new events.Rule(this, 'SessionEventRule', {
            description: 'Route session events to appropriate handlers',
            eventPattern: {
                source: ['wallcrawler.backend'],
                detailType: ['SessionTerminated'],
            },
        });

        // Session provisioner handles all session lifecycle events
        const sessionProvisionerLambda = createLambdaFunction(
            'SessionProvisionerLambda',
            'session-provisioner',
            'Handle session lifecycle events via EventBridge'
        );

        sessionEventRule.addTarget(new targets.LambdaFunction(sessionProvisionerLambda));

        // API Gateway for REST endpoints
        const api = new apigateway.RestApi(this, 'WallcrawlerAPI', {
            restApiName: 'Wallcrawler API',
            description: 'Remote browser automation API compatible with Stagehand',
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

        // API Key for authentication
        const apiKey = api.addApiKey('WallcrawlerApiKey', {
            apiKeyName: 'wallcrawler-api-key',
            description: 'API key for Wallcrawler access',
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

        // =================================================================
        // GROUP 1: SDK-COMPATIBLE ENDPOINTS (Browserbase-style API)
        // All endpoints under /v1/ that match the SDK expectations
        // =================================================================

        const v1Resource = api.root.addResource('v1');

        // --- Sessions Resource (/v1/sessions) ---
        const v1SessionsResource = v1Resource.addResource('sessions');

        // POST /v1/sessions - Create session
        v1SessionsResource.addMethod('POST',
            new apigateway.LambdaIntegration(sdkSessionsCreateLambda, { proxy: true }),
            {
                apiKeyRequired: true,
                requestValidator,
            }
        );

        // GET /v1/sessions - List sessions
        v1SessionsResource.addMethod('GET',
            new apigateway.LambdaIntegration(sdkSessionsListLambda, { proxy: true }),
            { apiKeyRequired: true }
        );

        // Session-specific SDK endpoints (/v1/sessions/{id})
        const v1SessionResource = v1SessionsResource.addResource('{id}');

        // GET /v1/sessions/{id} - Retrieve session
        v1SessionResource.addMethod('GET',
            new apigateway.LambdaIntegration(sdkSessionsRetrieveLambda, { proxy: true }),
            { apiKeyRequired: true }
        );

        // POST /v1/sessions/{id} - Update session  
        v1SessionResource.addMethod('POST',
            new apigateway.LambdaIntegration(sdkSessionsUpdateLambda, { proxy: true }),
            { apiKeyRequired: true }
        );

        // GET /v1/sessions/{id}/debug - Debug/live URLs
        v1SessionResource.addResource('debug').addMethod('GET',
            new apigateway.LambdaIntegration(sdkSessionsRetrieveLambda, { proxy: true }),
            { apiKeyRequired: true }
        );

        // GET /v1/sessions/{id}/downloads - Downloads
        v1SessionResource.addResource('downloads').addMethod('GET',
            new apigateway.LambdaIntegration(sdkSessionsRetrieveLambda, { proxy: true }),
            { apiKeyRequired: true }
        );

        // GET /v1/sessions/{id}/logs - Logs
        v1SessionResource.addResource('logs').addMethod('GET',
            new apigateway.LambdaIntegration(sdkSessionsRetrieveLambda, { proxy: true }),
            { apiKeyRequired: true }
        );

        // GET /v1/sessions/{id}/recording - Recording
        v1SessionResource.addResource('recording').addMethod('GET',
            new apigateway.LambdaIntegration(sdkSessionsRetrieveLambda, { proxy: true }),
            { apiKeyRequired: true }
        );

        // POST /v1/sessions/{id}/uploads - Uploads
        v1SessionResource.addResource('uploads').addMethod('POST',
            new apigateway.LambdaIntegration(sdkSessionsRetrieveLambda, { proxy: true }),
            {
                apiKeyRequired: true,
                requestValidator,
            }
        );

        // --- Contexts Resource (/v1/contexts) ---
        const v1ContextsResource = v1Resource.addResource('contexts');

        // POST /v1/contexts - Create context
        v1ContextsResource.addMethod('POST',
            new apigateway.LambdaIntegration(sdkSessionsRetrieveLambda, { proxy: true }),
            {
                apiKeyRequired: true,
                requestValidator,
            }
        );

        // Context-specific endpoints (/v1/contexts/{id})
        const v1ContextResource = v1ContextsResource.addResource('{id}');

        // GET /v1/contexts/{id} - Retrieve context
        v1ContextResource.addMethod('GET',
            new apigateway.LambdaIntegration(sdkSessionsRetrieveLambda, { proxy: true }),
            { apiKeyRequired: true }
        );

        // PUT /v1/contexts/{id} - Update context
        v1ContextResource.addMethod('PUT',
            new apigateway.LambdaIntegration(sdkSessionsRetrieveLambda, { proxy: true }),
            {
                apiKeyRequired: true,
                requestValidator,
            }
        );

        // --- Extensions Resource (/v1/extensions) ---
        const v1ExtensionsResource = v1Resource.addResource('extensions');

        // POST /v1/extensions - Create extension
        v1ExtensionsResource.addMethod('POST',
            new apigateway.LambdaIntegration(sdkSessionsRetrieveLambda, { proxy: true }),
            {
                apiKeyRequired: true,
                requestValidator,
            }
        );

        // Extension-specific endpoints (/v1/extensions/{id})
        const v1ExtensionResource = v1ExtensionsResource.addResource('{id}');

        // GET /v1/extensions/{id} - Retrieve extension
        v1ExtensionResource.addMethod('GET',
            new apigateway.LambdaIntegration(sdkSessionsRetrieveLambda, { proxy: true }),
            { apiKeyRequired: true }
        );

        // DELETE /v1/extensions/{id} - Delete extension
        v1ExtensionResource.addMethod('DELETE',
            new apigateway.LambdaIntegration(sdkSessionsUpdateLambda, { proxy: true }),
            { apiKeyRequired: true }
        );

        // --- Projects Resource (/v1/projects) ---
        const v1ProjectsResource = v1Resource.addResource('projects');

        // GET /v1/projects - List projects
        v1ProjectsResource.addMethod('GET',
            new apigateway.LambdaIntegration(sdkSessionsRetrieveLambda, { proxy: true }),
            { apiKeyRequired: true }
        );

        // Project-specific endpoints (/v1/projects/{id})
        const v1ProjectResource = v1ProjectsResource.addResource('{id}');

        // GET /v1/projects/{id} - Retrieve project
        v1ProjectResource.addMethod('GET',
            new apigateway.LambdaIntegration(sdkSessionsRetrieveLambda, { proxy: true }),
            { apiKeyRequired: true }
        );

        // GET /v1/projects/{id}/usage - Project usage
        v1ProjectResource.addResource('usage').addMethod('GET',
            new apigateway.LambdaIntegration(sdkSessionsRetrieveLambda, { proxy: true }),
            { apiKeyRequired: true }
        );

        // =================================================================
        // GROUP 2: STAGEHAND API ENDPOINTS (AI-powered automation)
        // All endpoints under /sessions/ for Stagehand's API mode
        // =================================================================

        const sessionsResource = api.root.addResource('sessions');

        // POST /sessions/start - Stagehand-compatible AI session creation
        const startResource = sessionsResource.addResource('start');
        startResource.addMethod('POST',
            new apigateway.LambdaIntegration(apiSessionsStartLambda, { proxy: true }),
            {
                apiKeyRequired: true,
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
        // =================================================================

        // POST /sessions/{sessionId}/cdp-url - Generate signed CDP URLs for Direct Mode
        sessionResource.addResource('cdp-url').addMethod('POST',
            new apigateway.LambdaIntegration(sessionCdpUrlLambda, { proxy: true }),
            {
                apiKeyRequired: true,
                requestValidator,
            }
        );

        // EventBridge for async communication
        const eventBus = new events.EventBus(this, 'WallcrawlerEventBus', {
            eventBusName: 'wallcrawler-events',
        });

        // WAF for API protection
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

        // CloudFormation outputs
        new cdk.CfnOutput(this, 'APIGatewayURL', {
            description: 'API Gateway endpoint URL',
            value: api.url,
        });

        new cdk.CfnOutput(this, 'ApiKeyId', {
            description: 'API Key ID for authentication',
            value: apiKey.keyId,
        });

        new cdk.CfnOutput(this, 'RedisEndpoint', {
            description: 'Redis cluster endpoint',
            value: redisCluster.attrRedisEndpointAddress,
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
    }
} 