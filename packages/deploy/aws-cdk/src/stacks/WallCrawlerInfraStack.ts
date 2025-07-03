import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';
import { NetworkingStack } from '../constructs/NetworkingStack';
import { RedisCluster } from '../constructs/RedisCluster';
import { EcsCluster } from '../constructs/EcsCluster';

export interface WallCrawlerInfraStackProps extends cdk.StackProps {
  /**
   * Environment name (dev, staging, prod)
   */
  environment: string;

  /**
   * Project name for naming resources
   */
  projectName: string;

  /**
   * VPC CIDR block
   * @default 10.0.0.0/16
   */
  vpcCidr?: string;

  /**
   * Maximum number of Availability Zones
   * @default 2 for dev, 3 for prod
   */
  maxAzs?: number;

  /**
   * Redis node type
   * @default cache.t3.micro for dev, cache.r7g.large for prod
   */
  redisNodeType?: string;

  /**
   * Number of Redis replica nodes
   * @default 0 for dev, 2 for prod
   */
  redisReplicas?: number;

  /**
   * ECS task CPU units
   * @default 512 for dev, 1024 for prod
   */
  ecsTaskCpu?: number;

  /**
   * ECS task memory (MB)
   * @default 1024 for dev, 2048 for prod
   */
  ecsTaskMemory?: number;

  /**
   * Docker image URI for browser automation
   * @default public.ecr.aws/ubuntu/ubuntu:22.04
   */
  browserImageUri?: string;
}

/**
 * Main infrastructure stack for WallCrawler
 * Creates VPC, Redis cluster, and ECS cluster for browser automation
 */
export class WallCrawlerInfraStack extends cdk.Stack {
  public readonly networking: NetworkingStack;
  public readonly redisCluster: RedisCluster;
  public readonly ecsCluster: EcsCluster;

  constructor(scope: Construct, id: string, props: WallCrawlerInfraStackProps) {
    super(scope, id, props);

    const isProd = props.environment === 'prod' || props.environment === 'production';

    // Create networking infrastructure
    this.networking = new NetworkingStack(this, 'Networking', {
      environment: props.environment,
      projectName: props.projectName,
      cidr: props.vpcCidr,
      maxAzs: props.maxAzs,
      natGateways: isProd ? 2 : 1,
      enableFlowLogs: true,
    });

    // Create Redis cluster for session state management
    this.redisCluster = new RedisCluster(this, 'RedisCluster', {
      vpc: this.networking.vpc,
      subnets: this.networking.isolatedSubnets, // Use isolated subnets for security
      environment: props.environment,
      projectName: props.projectName,
      nodeType: props.redisNodeType,
      numCacheNodes: props.redisReplicas,
      multiAzEnabled: isProd,
      automaticFailoverEnabled: isProd,
      atRestEncryptionEnabled: true,
      transitEncryptionEnabled: true,
      snapshotRetentionLimit: isProd ? 7 : 1,
    });

    // Create ECS cluster for browser automation
    this.ecsCluster = new EcsCluster(this, 'EcsCluster', {
      vpc: this.networking.vpc,
      ecsSecurityGroup: this.networking.ecsSecurityGroup,
      albSecurityGroup: this.networking.albSecurityGroup,
      environment: props.environment,
      projectName: props.projectName,
      containerInsights: isProd,
      taskCpu: props.ecsTaskCpu,
      taskMemory: props.ecsTaskMemory,
      browserImageUri: props.browserImageUri,
      redisConnectionString: this.redisCluster.connectionString,
    });

    // Allow ECS tasks to access Redis
    this.redisCluster.allowAccessFrom(
      this.networking.ecsSecurityGroup,
      'Allow ECS tasks to access Redis'
    );

    // Add Redis connection details to ECS task environment
    this.ecsCluster.addEnvironmentVariable('REDIS_ENDPOINT', this.redisCluster.redisEndpoint);
    this.ecsCluster.addEnvironmentVariable('REDIS_CONNECTION_STRING', this.redisCluster.connectionString);

    if (this.redisCluster.readerEndpoint) {
      this.ecsCluster.addEnvironmentVariable('REDIS_READER_ENDPOINT', this.redisCluster.readerEndpoint);
    }

    // Stack-level outputs
    new cdk.CfnOutput(this, 'StackName', {
      value: this.stackName,
      description: 'CloudFormation stack name',
    });

    new cdk.CfnOutput(this, 'Environment', {
      value: props.environment,
      description: 'Deployment environment',
    });

    new cdk.CfnOutput(this, 'ProjectName', {
      value: props.projectName,
      description: 'Project name',
    });

    new cdk.CfnOutput(this, 'DeploymentSummary', {
      value: JSON.stringify({
        vpc: this.networking.vpc.vpcId,
        redisEndpoint: this.redisCluster.redisEndpoint,
        ecsCluster: this.ecsCluster.cluster.clusterName,
        loadBalancer: this.ecsCluster.loadBalancer.loadBalancerDnsName,
        environment: props.environment,
      }),
      description: 'Deployment summary with key resource identifiers',
    });

    // Add tags to the entire stack
    cdk.Tags.of(this).add('Environment', props.environment);
    cdk.Tags.of(this).add('Project', props.projectName);
    cdk.Tags.of(this).add('ManagedBy', 'CDK');
    cdk.Tags.of(this).add('StackName', this.stackName);
  }

  /**
   * Get connection details for the infrastructure
   */
  public getConnectionDetails(): {
    vpcId: string;
    redisEndpoint: string;
    redisConnectionString: string;
    ecsClusterName: string;
    ecsClusterArn: string;
    loadBalancerDns: string;
    taskDefinitionArn: string;
  } {
    return {
      vpcId: this.networking.vpc.vpcId,
      redisEndpoint: this.redisCluster.redisEndpoint,
      redisConnectionString: this.redisCluster.connectionString,
      ecsClusterName: this.ecsCluster.cluster.clusterName,
      ecsClusterArn: this.ecsCluster.cluster.clusterArn,
      loadBalancerDns: this.ecsCluster.loadBalancer.loadBalancerDnsName,
      taskDefinitionArn: this.ecsCluster.taskDefinition.taskDefinitionArn,
    };
  }
}