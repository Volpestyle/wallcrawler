import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { CoreInfrastructureStack } from './CoreInfrastructureStack';
import * as path from 'path';
import { MonitoringConstruct } from '../constructs/MonitoringConstruct';
import { ConfigurationConstruct } from '../constructs/ConfigurationConstruct';
import * as apigatewayv2_integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';

export interface ApplicationServicesStackProps extends cdk.StackProps {
  projectName: string;
  environment: string;
  infrastructureStack: CoreInfrastructureStack;
  maxSessionsPerContainer?: number;
}

/**
 * Application Services Stack
 * Contains all application-specific services that change frequently
 */
export class ApplicationServicesStack extends cdk.Stack {
  public readonly apiUrl: string;
  public readonly webSocketUrl: string;
  public readonly monitoringConstruct: MonitoringConstruct;

  constructor(scope: Construct, id: string, props: ApplicationServicesStackProps) {
    super(scope, id, props);

    const isDev = props.environment === 'development' || props.environment === 'dev';
    const maxSessionsPerContainer = props.maxSessionsPerContainer || 20;

    // Import infrastructure resources
    const {
      vpc,
      containerSecurityGroup,
      lambdaSecurityGroup,
      redisEndpoint,
      s3Bucket,
      jweSecret,
    } = props.infrastructureStack;

    // ECS Cluster
    const ecsCluster = new cdk.aws_ecs.Cluster(this, 'ECSCluster', {
      vpc,
      clusterName: `${props.projectName}-cluster-${props.environment}`,
      containerInsights: !isDev,
      enableFargateCapacityProviders: true,
    });

    // CloudWatch Log Groups
    const browserLogGroup = new cdk.aws_logs.LogGroup(this, 'BrowserLogGroup', {
      logGroupName: `/ecs/${props.projectName}/browser-${props.environment}`,
      retention: cdk.aws_logs.RetentionDays.THREE_DAYS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });



    // ECR Repository for browser containers
    const ecrRepository = new cdk.aws_ecr.Repository(this, 'BrowserRepository', {
      repositoryName: `${props.projectName}/browser-${props.environment}`,
      imageScanOnPush: true,
      lifecycleRules: [
        {
          maxImageCount: 10,
          description: 'Keep only 10 most recent images',
        },
      ],
      removalPolicy: isDev ? cdk.RemovalPolicy.DESTROY : cdk.RemovalPolicy.RETAIN,
    });

    // Browser Container Task Definition
    const configConstruct = props.infrastructureStack.configConstruct;
    const browserTaskDefinition = new cdk.aws_ecs.FargateTaskDefinition(this, 'BrowserTaskDefinition', {
      family: `${props.projectName}-browser-${props.environment}`,
      cpu: ConfigurationConstruct.getParameterAsNumber(configConstruct.containerCpu),
      memoryLimitMiB: ConfigurationConstruct.getParameterAsNumber(configConstruct.containerMemory),
    });

    // Add container to browser task
    browserTaskDefinition.addContainer('BrowserContainer', {
      image: cdk.aws_ecs.ContainerImage.fromEcrRepository(ecrRepository, 'latest'),
      logging: cdk.aws_ecs.LogDrivers.awsLogs({
        streamPrefix: 'browser',
        logGroup: browserLogGroup,
      }),
      environment: {
        NODE_ENV: isDev ? 'development' : 'production',
        PORT: '8080',
        CDP_PORT: '9222',
        MAX_SESSIONS: maxSessionsPerContainer.toString(),
        REDIS_ENDPOINT: redisEndpoint,
        REDIS_TLS_ENABLED: (!isDev).toString(),
        S3_BUCKET: s3Bucket.bucketName,
        ENVIRONMENT: props.environment,
      },
      secrets: {
        JWE_SECRET: cdk.aws_ecs.Secret.fromSecretsManager(jweSecret, 'JWE_SECRET'),
      },
      healthCheck: {
        command: ['CMD-SHELL', 'curl -f http://localhost:8080/health || exit 1'],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        retries: 3,
        startPeriod: cdk.Duration.seconds(60),
      },
      portMappings: [
        {
          containerPort: 8080,
          protocol: cdk.aws_ecs.Protocol.TCP,
        },
        {
          containerPort: 9222,
          protocol: cdk.aws_ecs.Protocol.TCP,
        },
      ],
    });

    // Grant permissions to browser containers
    s3Bucket.grantReadWrite(browserTaskDefinition.taskRole);
    jweSecret.grantRead(browserTaskDefinition.taskRole);



    // Store ECS-specific configuration in SSM for programmatic access
    configConstruct.createInfrastructureParameter(
      'EcsClusterNameParam',
      `/${props.projectName}/${props.environment}/ecs-cluster-name`,
      ecsCluster.clusterName,
      'ECS Cluster name for browser automation tasks'
    );

    configConstruct.createInfrastructureParameter(
      'BrowserTaskDefinitionParam',
      `/${props.projectName}/${props.environment}/ecs-browser-task-definition`,
      browserTaskDefinition.taskDefinitionArn,
      'ECS Task Definition ARN for browser containers'
    );

    // ECS Service for multi-session containers (for direct WebSocket streaming)
    const browserService = new cdk.aws_ecs.FargateService(this, 'BrowserService', {
      cluster: ecsCluster,
      taskDefinition: browserTaskDefinition,
      serviceName: `${props.projectName}-browser-service-${props.environment}`,
      desiredCount: isDev ? 1 : 2, // Start with minimal instances, will auto-scale
      assignPublicIp: false, // Use private subnets
      vpcSubnets: {
        subnets: vpc.privateSubnets,
      },
      securityGroups: [containerSecurityGroup],
      platformVersion: cdk.aws_ecs.FargatePlatformVersion.LATEST,
    });

    // Network Load Balancer for internal container WebSocket access
    const containerNLB = new elbv2.NetworkLoadBalancer(this, 'ContainerNLB', {
      vpc,
      internetFacing: false, // Internal only
      loadBalancerName: `${props.projectName}-container-nlb-${props.environment}`,
      vpcSubnets: {
        subnets: vpc.privateSubnets,
      },
    });

    // Target Group for container WebSocket endpoints
    const containerTargetGroup = new elbv2.NetworkTargetGroup(this, 'ContainerTargetGroup', {
      vpc,
      port: 8080, // Container WebSocket port
      protocol: elbv2.Protocol.TCP,
      targetType: elbv2.TargetType.IP,
      targetGroupName: `${props.projectName}-container-tg-${props.environment}`,
      healthCheck: {
        enabled: true,
        protocol: elbv2.Protocol.HTTP,
        path: '/health',
        port: '8080',
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
        timeout: cdk.Duration.seconds(10),
        interval: cdk.Duration.seconds(30),
      },
    });

    // Target Group for CDP debugging endpoints (NEW)
    const cdpTargetGroup = new elbv2.NetworkTargetGroup(this, 'CdpTargetGroup', {
      vpc,
      port: 9222, // CDP debugging port
      protocol: elbv2.Protocol.TCP,
      targetType: elbv2.TargetType.IP,
      targetGroupName: `${props.projectName}-cdp-tg-${props.environment}`,
      healthCheck: {
        enabled: true,
        protocol: elbv2.Protocol.TCP,
        port: '9222',
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
        timeout: cdk.Duration.seconds(10),
        interval: cdk.Duration.seconds(30),
      },
    });

    // NLB Listener for WebSocket communication
    const _containerListener = containerNLB.addListener('ContainerListener', {
      port: 8080,
      protocol: elbv2.Protocol.TCP,
      defaultTargetGroups: [containerTargetGroup],
    });

    // NLB Listener for CDP debugging (NEW)
    const _cdpListener = containerNLB.addListener('CdpListener', {
      port: 9222,
      protocol: elbv2.Protocol.TCP,
      defaultTargetGroups: [cdpTargetGroup],
    });

    // Attach ECS service to both target groups
    browserService.attachToNetworkTargetGroup(containerTargetGroup);
    browserService.attachToNetworkTargetGroup(cdpTargetGroup);

    // VPC Link for API Gateway to access internal NLB
    const _containerVpcLink = new cdk.aws_apigatewayv2.VpcLink(this, 'ContainerVpcLink', {
      vpc,
      subnets: { subnets: vpc.privateSubnets },
      securityGroups: [containerSecurityGroup],
      vpcLinkName: `${props.projectName}-container-vpclink-${props.environment}`,
    });

    configConstruct.createInfrastructureParameter(
      'WebSocketApiEndpointParam',
      `/${props.projectName}/${props.environment}/websocket-api-endpoint`,
      this.webSocketUrl,
      'API Gateway WebSocket endpoint URL for real-time browser automation'
    );

    configConstruct.createInfrastructureParameter(
      'ContainerNLBDnsParam',
      `/${props.projectName}/${props.environment}/container-nlb-dns`,
      containerNLB.loadBalancerDnsName,
      'Internal NLB DNS name for direct container access'
    );

    // NEW: CDP endpoint configuration
    configConstruct.createInfrastructureParameter(
      'CdpEndpointParam',
      `/${props.projectName}/${props.environment}/cdp-endpoint`,
      `${containerNLB.loadBalancerDnsName}:9222`,
      'Internal NLB endpoint for direct CDP connections'
    );

    configConstruct.createInfrastructureParameter(
      'RestApiEndpointParam',
      `/${props.projectName}/${props.environment}/rest-api-endpoint`,
      this.apiUrl,
      'API Gateway REST endpoint URL for session management'
    );



    // WebSocket API Gateway (create before Lambda functions to get the ID)
    const webSocketApi = new cdk.aws_apigatewayv2.WebSocketApi(this, 'WebSocketApi', {
      apiName: `${props.projectName}-websocket-${props.environment}`,
      description: 'WebSocket API for real-time browser automation',
    });

    // Lambda functions for session management
    const lambdaEnvironment = {
      REDIS_ENDPOINT: redisEndpoint,
      REDIS_TLS_ENABLED: (!isDev).toString(),
      ENVIRONMENT: props.environment,
      ECS_CLUSTER_NAME: ecsCluster.clusterName,
      BROWSER_TASK_DEFINITION_ARN: browserTaskDefinition.taskDefinitionArn,
      S3_BUCKET: s3Bucket.bucketName,
      JWE_SECRET_ARN: jweSecret.secretArn,
      WEBSOCKET_API_ID: webSocketApi.apiId,
      CONTAINER_NLB_DNS: containerNLB.loadBalancerDnsName,
      CDP_ENDPOINT: `${containerNLB.loadBalancerDnsName}:9222`, // NEW: CDP endpoint for direct connections
    };

    const lambdaFunctions = [];

    // Create Session Lambda
    const createSessionLambda = new cdk.aws_lambda.Function(this, 'CreateSessionFunction', {
      runtime: cdk.aws_lambda.Runtime.NODEJS_20_X,
      handler: 'create-session.handler',
      code: cdk.aws_lambda.Code.fromAsset(path.join(__dirname, '..', 'lambda', 'functions')),
      vpc,
      vpcSubnets: {
        subnets: vpc.privateSubnets,
      },
      securityGroups: [lambdaSecurityGroup],
      environment: lambdaEnvironment,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
    });
    lambdaFunctions.push(createSessionLambda);

    // Get Session Lambda
    const getSessionLambda = new cdk.aws_lambda.Function(this, 'GetSessionFunction', {
      runtime: cdk.aws_lambda.Runtime.NODEJS_20_X,
      handler: 'get-session.handler',
      code: cdk.aws_lambda.Code.fromAsset(path.join(__dirname, '..', 'lambda', 'functions')),
      vpc,
      vpcSubnets: {
        subnets: vpc.privateSubnets,
      },
      securityGroups: [lambdaSecurityGroup],
      environment: lambdaEnvironment,
      timeout: cdk.Duration.seconds(10),
      memorySize: 128,
    });
    lambdaFunctions.push(getSessionLambda);

    // Sessions Start Lambda (for Stagehand compatibility)
    const sessionsStartLambda = new cdk.aws_lambda.Function(this, 'SessionsStartFunction', {
      runtime: cdk.aws_lambda.Runtime.NODEJS_20_X,
      handler: 'sessions-start.handler',
      code: cdk.aws_lambda.Code.fromAsset(path.join(__dirname, '..', 'lambda', 'functions')),
      vpc,
      vpcSubnets: {
        subnets: vpc.privateSubnets,
      },
      securityGroups: [lambdaSecurityGroup],
      environment: lambdaEnvironment,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
    });
    lambdaFunctions.push(sessionsStartLambda);

    // Session Act Lambda
    const sessionActLambda = new cdk.aws_lambda.Function(this, 'SessionActFunction', {
      runtime: cdk.aws_lambda.Runtime.NODEJS_20_X,
      handler: 'session-act.handler',
      code: cdk.aws_lambda.Code.fromAsset(path.join(__dirname, '..', 'lambda', 'functions')),
      vpc,
      vpcSubnets: {
        subnets: vpc.privateSubnets,
      },
      securityGroups: [lambdaSecurityGroup],
      environment: lambdaEnvironment,
      timeout: cdk.Duration.minutes(2),
      memorySize: 512,
    });
    lambdaFunctions.push(sessionActLambda);

    // Session Extract Lambda
    const sessionExtractLambda = new cdk.aws_lambda.Function(this, 'SessionExtractFunction', {
      runtime: cdk.aws_lambda.Runtime.NODEJS_20_X,
      handler: 'session-extract.handler',
      code: cdk.aws_lambda.Code.fromAsset(path.join(__dirname, '..', 'lambda', 'functions')),
      vpc,
      vpcSubnets: {
        subnets: vpc.privateSubnets,
      },
      securityGroups: [lambdaSecurityGroup],
      environment: lambdaEnvironment,
      timeout: cdk.Duration.minutes(2),
      memorySize: 512,
    });
    lambdaFunctions.push(sessionExtractLambda);

    // Session Observe Lambda
    const sessionObserveLambda = new cdk.aws_lambda.Function(this, 'SessionObserveFunction', {
      runtime: cdk.aws_lambda.Runtime.NODEJS_20_X,
      handler: 'session-observe.handler',
      code: cdk.aws_lambda.Code.fromAsset(path.join(__dirname, '..', 'lambda', 'functions')),
      vpc,
      vpcSubnets: {
        subnets: vpc.privateSubnets,
      },
      securityGroups: [lambdaSecurityGroup],
      environment: lambdaEnvironment,
      timeout: cdk.Duration.minutes(2),
      memorySize: 512,
    });
    lambdaFunctions.push(sessionObserveLambda);

    // Session End Lambda
    const sessionEndLambda = new cdk.aws_lambda.Function(this, 'SessionEndFunction', {
      runtime: cdk.aws_lambda.Runtime.NODEJS_20_X,
      handler: 'session-end.handler',
      code: cdk.aws_lambda.Code.fromAsset(path.join(__dirname, '..', 'lambda', 'functions')),
      vpc,
      vpcSubnets: {
        subnets: vpc.privateSubnets,
      },
      securityGroups: [lambdaSecurityGroup],
      environment: lambdaEnvironment,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
    });
    lambdaFunctions.push(sessionEndLambda);

    // Cleanup Sessions Lambda
    const cleanupSessionsLambda = new cdk.aws_lambda.Function(this, 'CleanupSessionsFunction', {
      runtime: cdk.aws_lambda.Runtime.NODEJS_20_X,
      handler: 'cleanup-sessions.handler',
      code: cdk.aws_lambda.Code.fromAsset(path.join(__dirname, '..', 'lambda', 'functions')),
      vpc,
      vpcSubnets: {
        subnets: vpc.privateSubnets,
      },
      securityGroups: [lambdaSecurityGroup],
      environment: lambdaEnvironment,
      timeout: cdk.Duration.minutes(5),
      memorySize: 256,
    });
    lambdaFunctions.push(cleanupSessionsLambda);

    // WebSocket Lambda Functions
    const websocketConnectLambda = new cdk.aws_lambda.Function(this, 'WebSocketConnectFunction', {
      runtime: cdk.aws_lambda.Runtime.NODEJS_20_X,
      handler: 'websocket-connect.handler',
      code: cdk.aws_lambda.Code.fromAsset(path.join(__dirname, '..', 'lambda', 'functions')),
      vpc,
      vpcSubnets: {
        subnets: vpc.privateSubnets,
      },
      securityGroups: [lambdaSecurityGroup],
      environment: lambdaEnvironment,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
    });
    lambdaFunctions.push(websocketConnectLambda);

    const websocketDisconnectLambda = new cdk.aws_lambda.Function(this, 'WebSocketDisconnectFunction', {
      runtime: cdk.aws_lambda.Runtime.NODEJS_20_X,
      handler: 'websocket-disconnect.handler',
      code: cdk.aws_lambda.Code.fromAsset(path.join(__dirname, '..', 'lambda', 'functions')),
      vpc,
      vpcSubnets: {
        subnets: vpc.privateSubnets,
      },
      securityGroups: [lambdaSecurityGroup],
      environment: {
        ...lambdaEnvironment,
        CONTAINER_SUBNETS: vpc.privateSubnets.map((s) => s.subnetId).join(','),
        CONTAINER_SECURITY_GROUP_ID: containerSecurityGroup.securityGroupId,
      },
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
    });
    lambdaFunctions.push(websocketDisconnectLambda);

    const websocketMessageLambda = new cdk.aws_lambda.Function(this, 'WebSocketMessageFunction', {
      runtime: cdk.aws_lambda.Runtime.NODEJS_20_X,
      handler: 'websocket-message.handler',
      code: cdk.aws_lambda.Code.fromAsset(path.join(__dirname, '..', 'lambda', 'functions')),
      vpc,
      vpcSubnets: {
        subnets: vpc.privateSubnets,
      },
      securityGroups: [lambdaSecurityGroup],
      environment: {
        ...lambdaEnvironment,
        CONTAINER_SUBNETS: vpc.privateSubnets.map((s) => s.subnetId).join(','),
        CONTAINER_SECURITY_GROUP_ID: containerSecurityGroup.securityGroupId,
      },
      timeout: cdk.Duration.minutes(1),
      memorySize: 512,
    });
    lambdaFunctions.push(websocketMessageLambda);

    // Grant permissions to Lambda functions
    lambdaFunctions.forEach(
      (fn) => {
        jweSecret.grantRead(fn);
      }
    );

    // Grant ECS permissions to cleanup Lambda and WebSocket disconnect Lambda
    [cleanupSessionsLambda, websocketDisconnectLambda].forEach(fn => {
      fn.addToRolePolicy(
        new cdk.aws_iam.PolicyStatement({
          actions: ['ecs:DescribeTasks', 'ecs:ListTasks', 'ecs:StopTask'],
          resources: ['*'],
        })
      );
    });

    // Grant ECS RunTask permissions to WebSocket message Lambda
    websocketMessageLambda.addToRolePolicy(
      new cdk.aws_iam.PolicyStatement({
        actions: ['ecs:RunTask', 'ecs:DescribeTasks'],
        resources: ['*'],
      })
    );

    websocketMessageLambda.addToRolePolicy(
      new cdk.aws_iam.PolicyStatement({
        actions: ['iam:PassRole'],
        resources: [browserTaskDefinition.taskRole.roleArn, browserTaskDefinition.executionRole!.roleArn],
      })
    );

    // Add routes to the WebSocket API
    webSocketApi.addRoute('$connect', {
      integration: new apigatewayv2_integrations.WebSocketLambdaIntegration('ConnectIntegration', websocketConnectLambda),
    });

    webSocketApi.addRoute('$disconnect', {
      integration: new apigatewayv2_integrations.WebSocketLambdaIntegration('DisconnectIntegration', websocketDisconnectLambda),
    });

    webSocketApi.addRoute('$default', {
      integration: new apigatewayv2_integrations.WebSocketLambdaIntegration('DefaultIntegration', websocketMessageLambda),
    });

    // WebSocket API Stage
    const webSocketStage = new cdk.aws_apigatewayv2.WebSocketStage(this, 'WebSocketStage', {
      webSocketApi,
      stageName: props.environment,
      autoDeploy: true,
    });

    // Grant WebSocket API permissions to Lambda functions
    [websocketConnectLambda, websocketDisconnectLambda, websocketMessageLambda].forEach(fn => {
      fn.addToRolePolicy(
        new cdk.aws_iam.PolicyStatement({
          actions: ['execute-api:ManageConnections'],
          resources: [
            `arn:aws:execute-api:${this.region}:${this.account}:${webSocketApi.apiId}/${props.environment}/*`,
          ],
        })
      );
    });

    // API Gateway
    const api = new cdk.aws_apigateway.RestApi(this, 'SessionAPI', {
      restApiName: `${props.projectName}-api-${props.environment}`,
      description: 'API for browser session management',
      defaultCorsPreflightOptions: {
        allowOrigins: cdk.aws_apigateway.Cors.ALL_ORIGINS,
        allowMethods: cdk.aws_apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'X-Api-Key', 'Authorization'],
      },
      deployOptions: {
        stageName: props.environment,
        throttlingBurstLimit: 100,
        throttlingRateLimit: 50,
      },
    });

    // Create API Keys for native API Gateway validation
    const primaryApiKey = new cdk.aws_apigateway.ApiKey(this, 'PrimaryApiKey', {
      apiKeyName: `${props.projectName}-primary-key-${props.environment}`,
      description: 'Primary API key for WallCrawler session management',
      enabled: true,
    });

    // Additional API key for backup/rotation
    const secondaryApiKey = new cdk.aws_apigateway.ApiKey(this, 'SecondaryApiKey', {
      apiKeyName: `${props.projectName}-secondary-key-${props.environment}`,
      description: 'Secondary API key for WallCrawler session management',
      enabled: true,
    });

    // Usage Plan with rate limiting and quotas
    const usagePlan = new cdk.aws_apigateway.UsagePlan(this, 'ApiUsagePlan', {
      name: `${props.projectName}-usage-plan-${props.environment}`,
      description: 'Usage plan for WallCrawler API with rate limiting',
      throttle: {
        rateLimit: isDev ? 100 : 1000, // requests per second
        burstLimit: isDev ? 200 : 2000, // burst capacity
      },
      quota: {
        limit: isDev ? 10000 : 100000, // requests per period
        period: cdk.aws_apigateway.Period.DAY,
      },
    });

    // Associate API keys with usage plan
    usagePlan.addApiKey(primaryApiKey);
    usagePlan.addApiKey(secondaryApiKey);

    // Associate usage plan with API stage
    usagePlan.addApiStage({
      stage: api.deploymentStage,
    });

    // API Gateway resources
    const sessionsResource = api.root.addResource('sessions');
    const sessionResource = sessionsResource.addResource('{sessionId}');

    // Configure methods to require API key
    const methodOptions: cdk.aws_apigateway.MethodOptions = {
      apiKeyRequired: true,
    };

    // Wire up Lambda functions to API Gateway with API key requirement
    sessionsResource.addMethod('POST', new cdk.aws_apigateway.LambdaIntegration(createSessionLambda), methodOptions);
    sessionResource.addMethod('GET', new cdk.aws_apigateway.LambdaIntegration(getSessionLambda), methodOptions);

    // Add Stagehand-compatible endpoints
    const sessionsStartResource = sessionsResource.addResource('start');
    sessionsStartResource.addMethod('POST', new cdk.aws_apigateway.LambdaIntegration(sessionsStartLambda), methodOptions);

    // Session action endpoints
    const sessionActResource = sessionResource.addResource('act');
    sessionActResource.addMethod('POST', new cdk.aws_apigateway.LambdaIntegration(sessionActLambda), methodOptions);

    const sessionExtractResource = sessionResource.addResource('extract');
    sessionExtractResource.addMethod('POST', new cdk.aws_apigateway.LambdaIntegration(sessionExtractLambda), methodOptions);

    const sessionObserveResource = sessionResource.addResource('observe');
    sessionObserveResource.addMethod('POST', new cdk.aws_apigateway.LambdaIntegration(sessionObserveLambda), methodOptions);

    const sessionNavigateResource = sessionResource.addResource('navigate');
    sessionNavigateResource.addMethod('POST', new cdk.aws_apigateway.LambdaIntegration(sessionActLambda), methodOptions); // Reuse act handler for navigate

    const sessionAgentExecuteResource = sessionResource.addResource('agentExecute');
    sessionAgentExecuteResource.addMethod('POST', new cdk.aws_apigateway.LambdaIntegration(sessionActLambda), methodOptions); // Reuse act handler for agentExecute

    const sessionEndResource = sessionResource.addResource('end');
    sessionEndResource.addMethod('POST', new cdk.aws_apigateway.LambdaIntegration(sessionEndLambda), methodOptions);

    // Grant permissions to new Lambda functions
    [sessionsStartLambda, sessionActLambda, sessionExtractLambda, sessionObserveLambda, sessionEndLambda].forEach(
      (fn) => {
        jweSecret.grantRead(fn);
        fn.addToRolePolicy(
          new cdk.aws_iam.PolicyStatement({
            actions: ['ecs:RunTask', 'ecs:DescribeTasks'],
            resources: ['*'],
          })
        );
        fn.addToRolePolicy(
          new cdk.aws_iam.PolicyStatement({
            actions: ['iam:PassRole'],
            resources: [browserTaskDefinition.taskRole.roleArn, browserTaskDefinition.executionRole!.roleArn],
          })
        );
      }
    );

    // EventBridge rule for periodic cleanup
    new cdk.aws_events.Rule(this, 'CleanupSchedule', {
      schedule: cdk.aws_events.Schedule.rate(cdk.Duration.minutes(5)),
      targets: [new cdk.aws_events_targets.LambdaFunction(cleanupSessionsLambda)],
      description: 'Trigger session cleanup every 5 minutes',
    });

    // Monitoring construct
    this.monitoringConstruct = new MonitoringConstruct(this, 'Monitoring', {
      environment: props.environment,
      projectName: props.projectName,
      ecsCluster,
      apiGateway: api,
      lambdaFunctions,
    });

    // Outputs
    this.apiUrl = api.url;
    this.webSocketUrl = `${webSocketStage.url.replace('https://', 'wss://').replace('http://', 'ws://')}`;

    new cdk.CfnOutput(this, 'APIUrl', {
      value: this.apiUrl,
      description: 'API Gateway REST URL for session management',
    });

    new cdk.CfnOutput(this, 'WebSocketUrl', {
      value: this.webSocketUrl,
      description: 'API Gateway WebSocket URL for real-time browser automation',
    });

    new cdk.CfnOutput(this, 'WebSocketApiId', {
      value: webSocketApi.apiId,
      description: 'WebSocket API Gateway ID',
    });

    new cdk.CfnOutput(this, 'ECRRepositoryUri', {
      value: ecrRepository.repositoryUri,
      description: 'ECR repository URI for browser container',
    });

    new cdk.CfnOutput(this, 'ContainerNLBDns', {
      value: containerNLB.loadBalancerDnsName,
      description: 'Internal NLB DNS name for direct container access',
    });

    // API Key outputs for client usage
    new cdk.CfnOutput(this, 'PrimaryApiKey', {
      value: primaryApiKey.keyId,
      description: 'Primary API key for WallCrawler session management',
    });

    new cdk.CfnOutput(this, 'SecondaryApiKey', {
      value: secondaryApiKey.keyId,
      description: 'Secondary API key for WallCrawler session management',
    });

    new cdk.CfnOutput(this, 'UsagePlanId', {
      value: usagePlan.usagePlanId,
      description: 'Usage plan ID for API rate limiting and quotas',
    });
  }
}