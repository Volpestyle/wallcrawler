import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

export interface RedisClusterProps {
  /**
   * VPC to deploy the Redis cluster in
   */
  vpc: ec2.IVpc;

  /**
   * Subnets for the Redis cluster (private subnets recommended)
   */
  subnets?: ec2.ISubnet[];

  /**
   * Environment name (dev, staging, prod)
   */
  environment: string;

  /**
   * Project name for naming resources
   */
  projectName: string;

  /**
   * Redis node type
   * @default cache.t3.micro for dev, cache.r7g.large for prod
   */
  nodeType?: string;

  /**
   * Number of replica nodes
   * @default 0 for dev, 2 for prod
   */
  numCacheNodes?: number;

  /**
   * Redis version
   * @default 7.1
   */
  engineVersion?: string;

  /**
   * Enable Multi-AZ deployment
   * @default false for dev, true for prod
   */
  multiAzEnabled?: boolean;

  /**
   * Enable encryption at rest
   * @default true
   */
  atRestEncryptionEnabled?: boolean;

  /**
   * Enable encryption in transit
   * @default true
   */
  transitEncryptionEnabled?: boolean;

  /**
   * Backup retention period in days
   * @default 1 for dev, 7 for prod
   */
  snapshotRetentionLimit?: number;

  /**
   * Automatic failover enabled
   * @default false for dev, true for prod
   */
  automaticFailoverEnabled?: boolean;

  /**
   * Log delivery configurations
   * @default CloudWatch logging enabled for slow-log
   */
  logDeliveryConfigurations?: elasticache.CfnReplicationGroup.LogDeliveryConfigurationRequestProperty[];
}

/**
 * Redis ElastiCache cluster construct optimized for WallCrawler infrastructure
 * Implements AWS best practices for security, performance, and monitoring
 */
export class RedisCluster extends Construct {
  public readonly cluster: elasticache.CfnReplicationGroup;
  public readonly subnetGroup: elasticache.CfnSubnetGroup;
  public readonly securityGroup: ec2.SecurityGroup;
  public readonly connectionString: string;
  public readonly redisEndpoint: string;
  public readonly readerEndpoint?: string;

  constructor(scope: Construct, id: string, props: RedisClusterProps) {
    super(scope, id);

    // Environment-specific defaults
    const isProd = props.environment === 'prod' || props.environment === 'production';
    const isStaging = props.environment === 'staging';
    
    const nodeType = props.nodeType ?? (isProd ? 'cache.r7g.large' : isStaging ? 'cache.t3.small' : 'cache.t3.micro');
    const numCacheNodes = props.numCacheNodes ?? (isProd ? 2 : 0);
    const multiAzEnabled = props.multiAzEnabled ?? isProd;
    const snapshotRetentionLimit = props.snapshotRetentionLimit ?? (isProd ? 7 : 1);
    const automaticFailoverEnabled = props.automaticFailoverEnabled ?? isProd;

    // Create CloudWatch log group for Redis logs
    const logGroup = new logs.LogGroup(this, 'RedisLogGroup', {
      logGroupName: `/aws/elasticache/${props.projectName}-${props.environment}-redis`,
      retention: isProd ? logs.RetentionDays.ONE_MONTH : logs.RetentionDays.ONE_WEEK,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    // Security group for Redis cluster
    this.securityGroup = new ec2.SecurityGroup(this, 'RedisSecurityGroup', {
      vpc: props.vpc,
      description: `Security group for ${props.projectName} Redis cluster`,
      allowAllOutbound: false,
    });

    // Allow Redis access from within VPC (port 6379)
    this.securityGroup.addIngressRule(
      ec2.Peer.ipv4(props.vpc.vpcCidrBlock),
      ec2.Port.tcp(6379),
      'Allow Redis access from VPC'
    );

    // Create subnet group for Redis cluster
    const subnetIds = props.subnets?.map(subnet => subnet.subnetId) ?? 
      props.vpc.privateSubnets.map(subnet => subnet.subnetId);

    this.subnetGroup = new elasticache.CfnSubnetGroup(this, 'RedisSubnetGroup', {
      description: `Subnet group for ${props.projectName} Redis cluster`,
      subnetIds,
      cacheSubnetGroupName: `${props.projectName}-${props.environment}-redis-subnet-group`.toLowerCase(),
    });

    // Parameter group for Redis with optimized settings
    const parameterGroup = new elasticache.CfnParameterGroup(this, 'RedisParameterGroup', {
      cacheParameterGroupFamily: 'redis7.x',
      description: `Parameter group for ${props.projectName} Redis cluster`,
      properties: {
        // Optimize for session storage use case
        'maxmemory-policy': 'allkeys-lru',
        'timeout': '300', // 5 minutes client timeout
        'tcp-keepalive': '60',
        // Enable notifications for key events (useful for session expiration)
        'notify-keyspace-events': 'Ex',
      },
    });

    // Log delivery configurations
    const defaultLogConfigs: elasticache.CfnReplicationGroup.LogDeliveryConfigurationRequestProperty[] = [
      {
        destinationType: 'cloudwatch-logs',
        destinationDetails: {
          cloudWatchLogsDetails: {
            logGroup: logGroup.logGroupName,
          },
        },
        logFormat: 'text',
        logType: 'slow-log',
      },
    ];

    // Create Redis replication group
    this.cluster = new elasticache.CfnReplicationGroup(this, 'RedisCluster', {
      replicationGroupDescription: `${props.projectName} Redis cluster for ${props.environment}`,
      replicationGroupId: `${props.projectName}-${props.environment}-redis`.toLowerCase(),
      
      // Engine configuration
      engine: 'redis',
      engineVersion: props.engineVersion ?? '7.1',
      cacheNodeType: nodeType,
      numCacheClusters: numCacheNodes > 0 ? numCacheNodes + 1 : 1, // Primary + replicas
      
      // Network configuration
      cacheSubnetGroupName: this.subnetGroup.ref,
      securityGroupIds: [this.securityGroup.securityGroupId],
      
      // High availability configuration
      multiAzEnabled,
      automaticFailoverEnabled,
      
      // Security configuration
      atRestEncryptionEnabled: props.atRestEncryptionEnabled ?? true,
      transitEncryptionEnabled: props.transitEncryptionEnabled ?? true,
      
      // Backup configuration
      snapshotRetentionLimit,
      snapshotWindow: '03:00-05:00', // Backup during low traffic hours
      preferredMaintenanceWindow: 'sun:05:00-sun:06:00',
      
      // Parameter group
      cacheParameterGroupName: parameterGroup.ref,
      
      // Logging configuration
      logDeliveryConfigurations: props.logDeliveryConfigurations ?? defaultLogConfigs,
      
      // Tagging
      tags: [
        { key: 'Name', value: `${props.projectName}-${props.environment}-redis` },
        { key: 'Environment', value: props.environment },
        { key: 'Project', value: props.projectName },
        { key: 'Component', value: 'cache' },
        { key: 'ManagedBy', value: 'CDK' },
      ],
    });

    // Dependencies
    this.cluster.addDependency(this.subnetGroup);
    this.cluster.addDependency(parameterGroup);

    // Connection details
    this.redisEndpoint = `${this.cluster.attrPrimaryEndPointAddress}:${this.cluster.attrPrimaryEndPointPort}`;
    this.readerEndpoint = numCacheNodes > 0 ? 
      `${this.cluster.attrReaderEndPointAddress}:${this.cluster.attrReaderEndPointPort}` : 
      undefined;
    
    this.connectionString = props.transitEncryptionEnabled ? 
      `rediss://${this.redisEndpoint}` : 
      `redis://${this.redisEndpoint}`;

    // Outputs
    new cdk.CfnOutput(this, 'RedisEndpoint', {
      value: this.redisEndpoint,
      description: 'Redis primary endpoint',
      exportName: `${props.projectName}-${props.environment}-redis-endpoint`,
    });

    new cdk.CfnOutput(this, 'RedisConnectionString', {
      value: this.connectionString,
      description: 'Redis connection string',
      exportName: `${props.projectName}-${props.environment}-redis-connection-string`,
    });

    if (this.readerEndpoint) {
      new cdk.CfnOutput(this, 'RedisReaderEndpoint', {
        value: this.readerEndpoint,
        description: 'Redis reader endpoint',
        exportName: `${props.projectName}-${props.environment}-redis-reader-endpoint`,
      });
    }

    new cdk.CfnOutput(this, 'RedisSecurityGroupId', {
      value: this.securityGroup.securityGroupId,
      description: 'Redis security group ID',
      exportName: `${props.projectName}-${props.environment}-redis-security-group-id`,
    });
  }

  /**
   * Allow access to the Redis cluster from a security group
   */
  public allowAccessFrom(securityGroup: ec2.ISecurityGroup, description?: string): void {
    this.securityGroup.addIngressRule(
      ec2.Peer.securityGroupId(securityGroup.securityGroupId),
      ec2.Port.tcp(6379),
      description ?? 'Allow Redis access'
    );
  }

  /**
   * Allow access to the Redis cluster from a CIDR block
   */
  public allowAccessFromCidr(cidrBlock: string, description?: string): void {
    this.securityGroup.addIngressRule(
      ec2.Peer.ipv4(cidrBlock),
      ec2.Port.tcp(6379),
      description ?? 'Allow Redis access from CIDR'
    );
  }
}