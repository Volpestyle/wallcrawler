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
            image: ecs.ContainerImage.fromAsset('../../backend-go', {
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
                AWS_REGION: this.region,
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
                                'execute-api:ManageConnections',
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
            AWS_REGION: this.region,
            CONNECT_URL_BASE: domainName ? `https://${domainName}` : 'https://api.wallcrawler.dev',
            WALLCRAWLER_JWT_SIGNING_SECRET_ARN: jwtSigningSecret.secretArn,
            CDP_PROXY_PORT: '9223',
        };

        // Factory function for consistent Lambda configuration
        const createLambdaFunction = (name: string, handler: string, description: string) => {
            return new lambda.Function(this, name, {
                runtime: lambda.Runtime.PROVIDED_AL2,
                handler: 'bootstrap',
                code: lambda.Code.fromAsset(`../../backend-go/build/${handler.toLowerCase()}`),
                timeout: cdk.Duration.minutes(15),
                memorySize: 1024,
                vpc,
                environment: commonLambdaEnvironment,
                description,
            });
        };

        // Lambda functions for each endpoint
        const startSessionLambda = createLambdaFunction(
            'StartSessionLambda',
            'start-session',
            'Create new browser session and launch ECS task'
        );

        const stagehandStartLambda = createLambdaFunction(
            'StagehandStartLambda',
            'sessions-start',
            'Stagehand-compatible session start endpoint'
        );

        const actLambda = createLambdaFunction(
            'ActLambda',
            'act',
            'Execute actions using LLM guidance'
        );

        const extractLambda = createLambdaFunction(
            'ExtractLambda',
            'extract',
            'Extract structured data from pages'
        );

        const observeLambda = createLambdaFunction(
            'ObserveLambda',
            'observe',
            'Observe and describe page elements'
        );

        const navigateLambda = createLambdaFunction(
            'NavigateLambda',
            'navigate',
            'Navigate to URLs with options'
        );

        const agentExecuteLambda = createLambdaFunction(
            'AgentExecuteLambda',
            'agent-execute',
            'Execute multi-step agent workflows'
        );

        const retrieveSessionLambda = createLambdaFunction(
            'RetrieveSessionLambda',
            'retrieve',
            'Retrieve session status and metadata'
        );

        const debugSessionLambda = createLambdaFunction(
            'DebugSessionLambda',
            'debug',
            'Get session debug/CDP URL'
        );

        const cdpUrlLambda = createLambdaFunction(
            'CDPUrlLambda',
            'cdp-url',
            'Generate signed CDP URLs for authenticated access'
        );

        const endSessionLambda = createLambdaFunction(
            'EndSessionLambda',
            'end',
            'Terminate browser session and cleanup'
        );

        // Create Screencast Lambda for WebSocket handling
        const screencastLambda = createLambdaFunction(
            'ScreencastLambda',
            'screencast',
            'Handles WebSocket connections for browser screencast streaming'
        );

        // EventBridge for session events
        const sessionEventRule = new events.Rule(this, 'SessionEventRule', {
            description: 'Route session events to appropriate handlers',
            eventPattern: {
                source: ['wallcrawler.backend'],
                detailType: ['SessionTerminated'],
            },
        });

        sessionEventRule.addTarget(new targets.LambdaFunction(endSessionLambda));

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

        // Root endpoints
        const startSessionResource = api.root.addResource('start-session');
        startSessionResource.addMethod('POST',
            new apigateway.LambdaIntegration(startSessionLambda, { proxy: true }),
            {
                apiKeyRequired: true,
                requestValidator,
            }
        );

        // Sessions resource
        const sessionsResource = api.root.addResource('sessions');

        // Stagehand-compatible start endpoint
        const startResource = sessionsResource.addResource('start');
        startResource.addMethod('POST',
            new apigateway.LambdaIntegration(stagehandStartLambda, { proxy: true }),
            {
                apiKeyRequired: true,
                requestValidator,
            }
        );

        // Session-specific resources
        const sessionResource = sessionsResource.addResource('{sessionId}');

        sessionResource.addResource('retrieve').addMethod('GET',
            new apigateway.LambdaIntegration(retrieveSessionLambda, { proxy: true }),
            { apiKeyRequired: true }
        );

        sessionResource.addResource('debug').addMethod('GET',
            new apigateway.LambdaIntegration(debugSessionLambda, { proxy: true }),
            { apiKeyRequired: true }
        );

        sessionResource.addResource('cdp-url').addMethod('POST',
            new apigateway.LambdaIntegration(cdpUrlLambda, { proxy: true }),
            {
                apiKeyRequired: true,
                requestValidator,
            }
        );

        sessionResource.addResource('end').addMethod('POST',
            new apigateway.LambdaIntegration(endSessionLambda, { proxy: true }),
            { apiKeyRequired: true }
        );

        // Streaming endpoints
        sessionResource.addResource('act').addMethod('POST',
            createStreamingIntegration(actLambda),
            {
                apiKeyRequired: true,
                requestValidator,
                methodResponses: [
                    {
                        statusCode: '200',
                        responseParameters: {
                            'method.response.header.Content-Type': true,
                            'method.response.header.Cache-Control': true,
                            'method.response.header.Connection': true,
                        },
                    },
                ],
            }
        );

        sessionResource.addResource('extract').addMethod('POST',
            createStreamingIntegration(extractLambda),
            { apiKeyRequired: true, requestValidator }
        );

        sessionResource.addResource('observe').addMethod('POST',
            createStreamingIntegration(observeLambda),
            { apiKeyRequired: true, requestValidator }
        );

        sessionResource.addResource('navigate').addMethod('POST',
            createStreamingIntegration(navigateLambda),
            { apiKeyRequired: true, requestValidator }
        );

        sessionResource.addResource('agentExecute').addMethod('POST',
            createStreamingIntegration(agentExecuteLambda),
            { apiKeyRequired: true, requestValidator }
        );

        // WebSocket API for screencast using lower-level constructs for CDK 2.100.0 compatibility
        const webSocketApi = new apigatewayv2.CfnApi(this, 'ScreencastWebSocketAPI', {
            name: 'Wallcrawler WebSocket API',
            description: 'WebSocket API for browser screencast streaming',
            protocolType: 'WEBSOCKET',
            routeSelectionExpression: '$request.body.action',
        });

        const webSocketIntegration = new apigatewayv2.CfnIntegration(this, 'ScreencastIntegration', {
            apiId: webSocketApi.ref,
            integrationType: 'AWS_PROXY',
            integrationUri: `arn:aws:apigateway:${this.region}:lambda:path/2015-03-31/functions/${screencastLambda.functionArn}/invocations`,
        });

        // WebSocket routes
        new apigatewayv2.CfnRoute(this, 'ConnectRoute', {
            apiId: webSocketApi.ref,
            routeKey: '$connect',
            target: `integrations/${webSocketIntegration.ref}`,
        });

        new apigatewayv2.CfnRoute(this, 'DisconnectRoute', {
            apiId: webSocketApi.ref,
            routeKey: '$disconnect',
            target: `integrations/${webSocketIntegration.ref}`,
        });

        new apigatewayv2.CfnRoute(this, 'ScreencastRoute', {
            apiId: webSocketApi.ref,
            routeKey: 'screencast',
            target: `integrations/${webSocketIntegration.ref}`,
        });

        const webSocketStage = new apigatewayv2.CfnStage(this, 'ScreencastStage', {
            apiId: webSocketApi.ref,
            stageName: 'prod',
            autoDeploy: true,
        });

        // Grant WebSocket API invoke permissions to Screencast Lambda
        screencastLambda.addPermission('WebSocketInvokePermission', {
            principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
            sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:${webSocketApi.ref}/*/*`,
        });

        // Grant Screencast Lambda permissions to manage API Gateway connections
        screencastLambda.addToRolePolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'execute-api:ManageConnections',
            ],
            resources: [
                `arn:aws:execute-api:${this.region}:${this.account}:${webSocketApi.ref}/*/*`,
            ],
        }));

        // Add WebSocket endpoint to common Lambda environment
        const webSocketEndpoint = `https://${webSocketApi.ref}.execute-api.${this.region}.amazonaws.com/prod`;
        const updatedLambdaEnvironment = {
            ...commonLambdaEnvironment,
            WEBSOCKET_API_ENDPOINT: webSocketEndpoint,
        };

        // Update all Lambda functions to include WebSocket endpoint
        [startSessionLambda, stagehandStartLambda, actLambda, extractLambda, observeLambda,
            navigateLambda, agentExecuteLambda, retrieveSessionLambda, debugSessionLambda,
            cdpUrlLambda, endSessionLambda, screencastLambda].forEach(lambdaFn => {
                lambdaFn.addEnvironment('WEBSOCKET_API_ENDPOINT', webSocketEndpoint);
            });

        // Also add WebSocket endpoint to ECS task definition environment
        controllerContainer.addEnvironment('WEBSOCKET_API_ENDPOINT', webSocketEndpoint);

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

        new cdk.CfnOutput(this, 'WebSocketAPIURL', {
            description: 'WebSocket API endpoint URL',
            value: `wss://${webSocketApi.ref}.execute-api.${this.region}.amazonaws.com/${webSocketStage.stageName}`,
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