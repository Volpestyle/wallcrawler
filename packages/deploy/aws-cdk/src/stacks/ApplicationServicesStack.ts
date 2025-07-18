import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { CoreInfrastructureStack } from './CoreInfrastructureStack';
import * as path from 'path';
import { MonitoringConstruct } from '../constructs/MonitoringConstruct';
import { ConfigurationConstruct } from '../constructs/ConfigurationConstruct';

export interface ApplicationServicesStackProps extends cdk.StackProps {
  projectName: string;
  environment: string;
  infrastructureStack: CoreInfrastructureStack;
  maxSessionsPerContainer?: number;
  proxyMinContainers?: number;
  proxyMaxContainers?: number;
  customDomain?: string;
  certificateArn?: string;
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
    const proxyMinContainers = props.proxyMinContainers || 2;
    const proxyMaxContainers = props.proxyMaxContainers || 100;

    // Import infrastructure resources
    const {
      vpc,
      albSecurityGroup: _albSecurityGroup,
      containerSecurityGroup,
      lambdaSecurityGroup,
      redisEndpoint,
      s3Bucket,
      sharedLoadBalancer,
      namespace,
      securityConstruct: _securityConstruct,
      jweSecret,
      apiKeysSecret,
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

    const proxyLogGroup = new cdk.aws_logs.LogGroup(this, 'ProxyLogGroup', {
      logGroupName: `/ecs/${props.projectName}/proxy-${props.environment}`,
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
    const _browserContainer = browserTaskDefinition.addContainer('BrowserContainer', {
      image: cdk.aws_ecs.ContainerImage.fromEcrRepository(ecrRepository, 'latest'),
      logging: cdk.aws_ecs.LogDrivers.awsLogs({
        streamPrefix: 'browser',
        logGroup: browserLogGroup,
      }),
      environment: {
        NODE_ENV: isDev ? 'development' : 'production',
        PORT: '8080',
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
      ],
    });

    // Grant permissions to browser containers
    s3Bucket.grantReadWrite(browserTaskDefinition.taskRole);
    jweSecret.grantRead(browserTaskDefinition.taskRole);

    // Proxy Service Task Definition
    const proxyTaskDefinition = new cdk.aws_ecs.FargateTaskDefinition(this, 'ProxyTaskDefinition', {
      family: `${props.projectName}-proxy-${props.environment}`,
      cpu: ConfigurationConstruct.getParameterAsNumber(configConstruct.containerCpu),
      memoryLimitMiB: ConfigurationConstruct.getParameterAsNumber(configConstruct.containerMemory),
    });

    // ECR Repository for proxy service
    const proxyEcrRepository = new cdk.aws_ecr.Repository(this, 'ProxyRepository', {
      repositoryName: `${props.projectName}/proxy-${props.environment}`,
      imageScanOnPush: true,
      lifecycleRules: [
        {
          maxImageCount: 10,
          description: 'Keep only 10 most recent images',
        },
      ],
      removalPolicy: isDev ? cdk.RemovalPolicy.DESTROY : cdk.RemovalPolicy.RETAIN,
    });

    // Add container to proxy task
    const _proxyContainer = proxyTaskDefinition.addContainer('ProxyContainer', {
      image: cdk.aws_ecs.ContainerImage.fromEcrRepository(proxyEcrRepository, 'latest'),
      logging: cdk.aws_ecs.LogDrivers.awsLogs({
        streamPrefix: 'proxy',
        logGroup: proxyLogGroup,
      }),
      environment: {
        NODE_ENV: isDev ? 'development' : 'production',
        PORT: '8080',
        REDIS_ENDPOINT: redisEndpoint,
        REDIS_TLS_ENABLED: (!isDev).toString(),
        ENVIRONMENT: props.environment,
        BROWSER_TASK_DEFINITION_ARN: browserTaskDefinition.taskDefinitionArn,
        ECS_CLUSTER_NAME: ecsCluster.clusterName,
        CONTAINER_SECURITY_GROUP_ID: containerSecurityGroup.securityGroupId,
        CONTAINER_SUBNETS: vpc.privateSubnets.map((s) => s.subnetId).join(','),
        MIN_CONTAINERS: proxyMinContainers.toString(),
        MAX_CONTAINERS: proxyMaxContainers.toString(),
      },
      secrets: {
        JWE_SECRET: cdk.aws_ecs.Secret.fromSecretsManager(jweSecret, 'JWE_SECRET'),
      },
      healthCheck: {
        command: ['CMD-SHELL', 'curl -f http://localhost:8080/health || exit 1'],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        retries: 3,
        startPeriod: cdk.Duration.seconds(30),
      },
      portMappings: [
        {
          containerPort: 8080,
          protocol: cdk.aws_ecs.Protocol.TCP,
        },
      ],
    });

    // Grant permissions to proxy service
    proxyTaskDefinition.taskRole.addToPrincipalPolicy(
      new cdk.aws_iam.PolicyStatement({
        actions: ['ecs:RunTask', 'ecs:StopTask', 'ecs:DescribeTasks', 'ecs:ListTasks'],
        resources: ['*'],
      })
    );

    proxyTaskDefinition.taskRole.addToPrincipalPolicy(
      new cdk.aws_iam.PolicyStatement({
        actions: ['iam:PassRole'],
        resources: [browserTaskDefinition.taskRole.roleArn, browserTaskDefinition.executionRole!.roleArn],
      })
    );

    jweSecret.grantRead(proxyTaskDefinition.taskRole);

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

    // Proxy Service
    const proxyService = new cdk.aws_ecs.FargateService(this, 'ProxyService', {
      cluster: ecsCluster,
      taskDefinition: proxyTaskDefinition,
      serviceName: `${props.projectName}-proxy-${props.environment}`,
      desiredCount: proxyMinContainers,
      securityGroups: [containerSecurityGroup],
      vpcSubnets: {
        subnets: vpc.privateSubnets,
      },
      enableECSManagedTags: true,
    });

    // Register proxy service with service discovery
    proxyService.enableCloudMap({
      cloudMapNamespace: namespace,
      name: 'proxy',
    });

    // Auto-scaling for proxy service
    const proxyScaling = proxyService.autoScaleTaskCount({
      minCapacity: proxyMinContainers,
      maxCapacity: 10,
    });

    proxyScaling.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: 70,
    });

    proxyScaling.scaleOnMemoryUtilization('MemoryScaling', {
      targetUtilizationPercent: 80,
    });

    // Target Group for proxy WebSocket connections
    const _proxyTargetGroup = new cdk.aws_elasticloadbalancingv2.ApplicationTargetGroup(this, 'ProxyTargetGroup', {
      vpc,
      targetGroupName: `${props.projectName}-proxy-${props.environment}`,
      port: 8080,
      protocol: cdk.aws_elasticloadbalancingv2.ApplicationProtocol.HTTP,
      targets: [proxyService],
      healthCheck: {
        path: '/health',
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(10),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
      },
      stickinessCookieDuration: cdk.Duration.hours(1),
      targetType: cdk.aws_elasticloadbalancingv2.TargetType.IP,
    });

    // HTTPS Listener
    const httpsListener = props.certificateArn
      ? sharedLoadBalancer.addListener('HttpsListener', {
        port: 443,
        protocol: cdk.aws_elasticloadbalancingv2.ApplicationProtocol.HTTPS,
        certificates: [cdk.aws_elasticloadbalancingv2.ListenerCertificate.fromArn(props.certificateArn)],
      })
      : null;

    // HTTP Listener (always created)
    const httpListener = sharedLoadBalancer.addListener('HttpListener', {
      port: 80,
      protocol: cdk.aws_elasticloadbalancingv2.ApplicationProtocol.HTTP,
    });

    // Listener rules for WebSocket proxy
    const listener = httpsListener || httpListener;
    listener.addTargets('ProxyWebSocketTarget', {
      targetGroupName: `${props.projectName}-proxy-ws-${props.environment}`,
      priority: 100,
      conditions: [cdk.aws_elasticloadbalancingv2.ListenerCondition.pathPatterns(['/sessions/*/ws'])],
      targets: [proxyService],
      healthCheck: {
        path: '/health',
      },
    });

    // Lambda functions for session management
    const lambdaEnvironment = {
      REDIS_ENDPOINT: redisEndpoint,
      REDIS_TLS_ENABLED: (!isDev).toString(),
      ALB_DNS_NAME: props.customDomain || sharedLoadBalancer.loadBalancerDnsName,
      ENVIRONMENT: props.environment,
      ECS_CLUSTER_NAME: ecsCluster.clusterName,
      BROWSER_TASK_DEFINITION_ARN: browserTaskDefinition.taskDefinitionArn,
      S3_BUCKET: s3Bucket.bucketName,
      JWE_SECRET_ARN: jweSecret.secretArn,
      API_KEYS_SECRET_ARN: apiKeysSecret.secretArn,
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

    // Delete Session Lambda
    const deleteSessionLambda = new cdk.aws_lambda.Function(this, 'DeleteSessionFunction', {
      runtime: cdk.aws_lambda.Runtime.NODEJS_20_X,
      handler: 'delete-session.handler',
      code: cdk.aws_lambda.Code.fromAsset(path.join(__dirname, '..', 'lambda', 'functions')),
      vpc,
      vpcSubnets: {
        subnets: vpc.privateSubnets,
      },
      securityGroups: [lambdaSecurityGroup],
      environment: lambdaEnvironment,
      timeout: cdk.Duration.seconds(30),
      memorySize: 128,
    });
    lambdaFunctions.push(deleteSessionLambda);

    // List Sessions Lambda
    const listSessionsLambda = new cdk.aws_lambda.Function(this, 'ListSessionsFunction', {
      runtime: cdk.aws_lambda.Runtime.NODEJS_20_X,
      handler: 'list-sessions.handler',
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
    lambdaFunctions.push(listSessionsLambda);

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

    // Grant permissions to Lambda functions
    [createSessionLambda, getSessionLambda, deleteSessionLambda, listSessionsLambda, cleanupSessionsLambda].forEach(
      (fn) => {
        jweSecret.grantRead(fn);
        apiKeysSecret.grantRead(fn);
      }
    );

    // Grant ECS permissions to cleanup Lambda
    cleanupSessionsLambda.addToRolePolicy(
      new cdk.aws_iam.PolicyStatement({
        actions: ['ecs:DescribeTasks', 'ecs:ListTasks', 'ecs:StopTask'],
        resources: ['*'],
      })
    );

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

    // API Gateway resources
    const sessionsResource = api.root.addResource('sessions');
    const sessionResource = sessionsResource.addResource('{sessionId}');

    // Wire up Lambda functions to API Gateway
    sessionsResource.addMethod('POST', new cdk.aws_apigateway.LambdaIntegration(createSessionLambda));
    sessionsResource.addMethod('GET', new cdk.aws_apigateway.LambdaIntegration(listSessionsLambda));
    sessionResource.addMethod('GET', new cdk.aws_apigateway.LambdaIntegration(getSessionLambda));
    sessionResource.addMethod('DELETE', new cdk.aws_apigateway.LambdaIntegration(deleteSessionLambda));

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
      loadBalancer: sharedLoadBalancer,
      apiGateway: api,
      lambdaFunctions,
    });

    // Outputs
    this.apiUrl = api.url;
    this.webSocketUrl = `${props.certificateArn ? 'wss' : 'ws'}://${props.customDomain || sharedLoadBalancer.loadBalancerDnsName}`;

    new cdk.CfnOutput(this, 'APIUrl', {
      value: this.apiUrl,
      description: 'API Gateway URL for session management',
    });

    new cdk.CfnOutput(this, 'WebSocketUrl', {
      value: this.webSocketUrl,
      description: 'WebSocket URL for browser connections',
    });

    new cdk.CfnOutput(this, 'ECRRepositoryUri', {
      value: ecrRepository.repositoryUri,
      description: 'ECR repository URI for browser container',
    });

    new cdk.CfnOutput(this, 'ProxyECRRepositoryUri', {
      value: proxyEcrRepository.repositoryUri,
      description: 'ECR repository URI for proxy container',
    });
  }
}
