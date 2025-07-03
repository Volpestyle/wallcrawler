import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { Construct } from 'constructs';

export interface EcsClusterProps {
  /**
   * VPC for the ECS cluster
   */
  vpc: ec2.IVpc;

  /**
   * Security group for ECS tasks
   */
  ecsSecurityGroup: ec2.ISecurityGroup;

  /**
   * Security group for ALB
   */
  albSecurityGroup: ec2.ISecurityGroup;

  /**
   * Environment name (dev, staging, prod)
   */
  environment: string;

  /**
   * Project name for naming resources
   */
  projectName: string;

  /**
   * Enable container insights
   * @default true for prod, false for dev
   */
  containerInsights?: boolean;

  /**
   * Docker image URI for browser automation tasks
   * @default public.ecr.aws/ubuntu/ubuntu:22.04
   */
  browserImageUri?: string;

  /**
   * CPU units for browser automation tasks
   * @default 512 for dev, 1024 for prod
   */
  taskCpu?: number;

  /**
   * Memory (MB) for browser automation tasks
   * @default 1024 for dev, 2048 for prod
   */
  taskMemory?: number;

  /**
   * Redis connection string for session state
   */
  redisConnectionString?: string;
}

/**
 * ECS cluster construct optimized for browser automation workloads
 * Supports both Fargate and EC2 launch types
 */
export class EcsCluster extends Construct {
  public readonly cluster: ecs.Cluster;
  public readonly taskDefinition: ecs.FargateTaskDefinition;
  public readonly browserContainer: ecs.ContainerDefinition;
  public readonly loadBalancer: elbv2.ApplicationLoadBalancer;
  public readonly listener: elbv2.ApplicationListener;
  public readonly targetGroup: elbv2.ApplicationTargetGroup;
  public readonly taskRole: iam.Role;
  public readonly executionRole: iam.Role;

  constructor(scope: Construct, id: string, props: EcsClusterProps) {
    super(scope, id);

    const isProd = props.environment === 'prod' || props.environment === 'production';
    const taskCpu = props.taskCpu ?? (isProd ? 1024 : 512);
    const taskMemory = props.taskMemory ?? (isProd ? 2048 : 1024);

    // Create ECS cluster
    this.cluster = new ecs.Cluster(this, 'EcsCluster', {
      vpc: props.vpc,
      clusterName: `${props.projectName}-${props.environment}-cluster`,
      containerInsights: props.containerInsights ?? isProd,
      enableFargateCapacityProviders: true,
    });

    // CloudWatch log group for ECS tasks
    const logGroup = new logs.LogGroup(this, 'EcsLogGroup', {
      logGroupName: `/ecs/${props.projectName}-${props.environment}-browser-automation`,
      retention: isProd ? logs.RetentionDays.ONE_MONTH : logs.RetentionDays.ONE_WEEK,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    // Task execution role
    this.executionRole = new iam.Role(this, 'TaskExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: `Task execution role for ${props.projectName} ECS tasks`,
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
    });

    // Task role for application permissions
    this.taskRole = new iam.Role(this, 'TaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: `Task role for ${props.projectName} ECS tasks`,
    });

    // Add permissions for CloudWatch logging
    this.taskRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'logs:CreateLogStream',
        'logs:PutLogEvents',
        'logs:DescribeLogGroups',
        'logs:DescribeLogStreams',
      ],
      resources: [logGroup.logGroupArn],
    }));

    // Add permissions for ECS Exec (debugging)
    if (!isProd) {
      this.taskRole.addToPolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'ssmmessages:CreateControlChannel',
          'ssmmessages:CreateDataChannel',
          'ssmmessages:OpenControlChannel',
          'ssmmessages:OpenDataChannel',
        ],
        resources: ['*'],
      }));
    }

    // Fargate task definition for browser automation
    this.taskDefinition = new ecs.FargateTaskDefinition(this, 'BrowserTaskDefinition', {
      family: `${props.projectName}-${props.environment}-browser-automation`,
      cpu: taskCpu,
      memoryLimitMiB: taskMemory,
      taskRole: this.taskRole,
      executionRole: this.executionRole,
    });

    // Browser automation container
    this.browserContainer = this.taskDefinition.addContainer('BrowserContainer', {
      image: ecs.ContainerImage.fromRegistry(
        props.browserImageUri ?? 'public.ecr.aws/ubuntu/ubuntu:22.04'
      ),
      essential: true,
      cpu: taskCpu,
      memoryLimitMiB: taskMemory,
      
      // Environment variables
      environment: {
        NODE_ENV: props.environment,
        REDIS_URL: props.redisConnectionString ?? 'redis://localhost:6379',
        AWS_REGION: cdk.Stack.of(this).region,
        ECS_ENABLE_CONTAINER_METADATA: 'true',
      },

      // Logging configuration
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'browser-automation',
        logGroup,
      }),

      // Health check
      healthCheck: {
        command: ['CMD-SHELL', 'curl -f http://localhost:3000/health || exit 1'],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        retries: 3,
        startPeriod: cdk.Duration.seconds(60),
      },

      // Working directory
      workingDirectory: '/app',

      // Command to run browser automation service
      command: [
        'sh', '-c',
        'apt-get update && apt-get install -y curl chromium-browser && npm start'
      ],
    });

    // Add port mapping for browser automation service
    this.browserContainer.addPortMappings({
      containerPort: 3000,
      protocol: ecs.Protocol.TCP,
      name: 'browser-automation',
    });

    // Add VNC port for debugging (non-prod only)
    if (!isProd) {
      this.browserContainer.addPortMappings({
        containerPort: 5900,
        protocol: ecs.Protocol.TCP,
        name: 'vnc',
      });
    }

    // Application Load Balancer
    this.loadBalancer = new elbv2.ApplicationLoadBalancer(this, 'LoadBalancer', {
      vpc: props.vpc,
      internetFacing: false, // Internal ALB for security
      securityGroup: props.albSecurityGroup,
      loadBalancerName: `${props.projectName}-${props.environment}-alb`,
    });

    // Target group for ECS tasks
    this.targetGroup = new elbv2.ApplicationTargetGroup(this, 'TargetGroup', {
      vpc: props.vpc,
      port: 3000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      healthCheck: {
        path: '/health',
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
      },
      deregistrationDelay: cdk.Duration.seconds(30),
    });

    // ALB listener
    this.listener = this.loadBalancer.addListener('Listener', {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      defaultTargetGroups: [this.targetGroup],
    });

    // Tagging
    cdk.Tags.of(this.cluster).add('Environment', props.environment);
    cdk.Tags.of(this.cluster).add('Project', props.projectName);
    cdk.Tags.of(this.cluster).add('Component', 'compute');

    // Outputs
    new cdk.CfnOutput(this, 'ClusterName', {
      value: this.cluster.clusterName,
      description: 'ECS cluster name',
      exportName: `${props.projectName}-${props.environment}-cluster-name`,
    });

    new cdk.CfnOutput(this, 'ClusterArn', {
      value: this.cluster.clusterArn,
      description: 'ECS cluster ARN',
      exportName: `${props.projectName}-${props.environment}-cluster-arn`,
    });

    new cdk.CfnOutput(this, 'TaskDefinitionArn', {
      value: this.taskDefinition.taskDefinitionArn,
      description: 'Task definition ARN',
      exportName: `${props.projectName}-${props.environment}-task-definition-arn`,
    });

    new cdk.CfnOutput(this, 'LoadBalancerDns', {
      value: this.loadBalancer.loadBalancerDnsName,
      description: 'Load balancer DNS name',
      exportName: `${props.projectName}-${props.environment}-alb-dns`,
    });

    new cdk.CfnOutput(this, 'TaskRoleArn', {
      value: this.taskRole.roleArn,
      description: 'ECS task role ARN',
      exportName: `${props.projectName}-${props.environment}-task-role-arn`,
    });

    new cdk.CfnOutput(this, 'ExecutionRoleArn', {
      value: this.executionRole.roleArn,
      description: 'ECS execution role ARN',
      exportName: `${props.projectName}-${props.environment}-execution-role-arn`,
    });
  }

  /**
   * Add IAM permissions to the task role
   */
  public addTaskPermissions(statement: iam.PolicyStatement): void {
    this.taskRole.addToPolicy(statement);
  }

  /**
   * Add environment variable to the browser container
   */
  public addEnvironmentVariable(name: string, value: string): void {
    this.browserContainer.addEnvironment(name, value);
  }

  /**
   * Add secret environment variable to the browser container
   */
  public addSecret(name: string, secret: ecs.Secret): void {
    this.browserContainer.addSecret(name, secret);
  }
}