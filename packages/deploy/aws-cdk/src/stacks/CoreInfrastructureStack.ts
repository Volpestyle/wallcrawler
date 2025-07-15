import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { SecurityConstruct } from '../constructs/SecurityConstruct';
import { ConfigurationConstruct } from '../constructs/ConfigurationConstruct';

export interface CoreInfrastructureStackProps extends cdk.StackProps {
  projectName: string;
  environment: string;
  allowedApiKeys?: string[];
}

/**
 * Core Infrastructure Stack
 * Contains all shared infrastructure resources that change infrequently
 */
export class CoreInfrastructureStack extends cdk.Stack {
  public readonly vpc: cdk.aws_ec2.Vpc;
  public readonly albSecurityGroup: cdk.aws_ec2.SecurityGroup;
  public readonly containerSecurityGroup: cdk.aws_ec2.SecurityGroup;
  public readonly lambdaSecurityGroup: cdk.aws_ec2.SecurityGroup;
  public readonly redisSecurityGroup: cdk.aws_ec2.SecurityGroup;
  public readonly redisEndpoint: string;
  public readonly s3Bucket: cdk.aws_s3.Bucket;
  public readonly sharedLoadBalancer: cdk.aws_elasticloadbalancingv2.ApplicationLoadBalancer;
  public readonly namespace: cdk.aws_servicediscovery.PrivateDnsNamespace;
  public readonly securityConstruct: SecurityConstruct;
  public readonly configConstruct: ConfigurationConstruct;
  public readonly jweSecret: cdk.aws_secretsmanager.Secret;
  public readonly apiKeysSecret: cdk.aws_secretsmanager.Secret;

  constructor(scope: Construct, id: string, props: CoreInfrastructureStackProps) {
    super(scope, id, props);

    const isDev = props.environment === 'development' || props.environment === 'dev';

    // Configuration construct (SSM parameters)
    this.configConstruct = new ConfigurationConstruct(this, 'Configuration', {
      environment: props.environment,
      projectName: props.projectName,
    });

    // Security construct (KMS keys, WAF)
    this.securityConstruct = new SecurityConstruct(this, 'Security', {
      environment: props.environment,
      projectName: props.projectName,
    });

    // VPC with cost optimization
    this.vpc = new cdk.aws_ec2.Vpc(this, 'VPC', {
      vpcName: `${props.projectName}-vpc-${props.environment}`,
      maxAzs: 2,
      natGateways: isDev ? 0 : 1, // No NAT Gateway in dev (cost optimization)
      subnetConfiguration: [
        {
          name: 'Public',
          subnetType: cdk.aws_ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: 'Private',
          subnetType: cdk.aws_ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
        {
          name: 'Isolated',
          subnetType: cdk.aws_ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
    });

    // VPC Endpoints for AWS services (cost optimization)
    if (!isDev) {
      this.vpc.addGatewayEndpoint('S3Endpoint', {
        service: cdk.aws_ec2.GatewayVpcEndpointAwsService.S3,
      });

      this.vpc.addInterfaceEndpoint('SecretsManagerEndpoint', {
        service: cdk.aws_ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
      });

      this.vpc.addInterfaceEndpoint('ECSEndpoint', {
        service: cdk.aws_ec2.InterfaceVpcEndpointAwsService.ECS,
      });

      this.vpc.addInterfaceEndpoint('ECREndpoint', {
        service: cdk.aws_ec2.InterfaceVpcEndpointAwsService.ECR,
      });
    }

    // Security Groups
    this.albSecurityGroup = new cdk.aws_ec2.SecurityGroup(this, 'ALBSecurityGroup', {
      vpc: this.vpc,
      description: 'Security group for Application Load Balancer',
      securityGroupName: `${props.projectName}-alb-sg-${props.environment}`,
    });

    this.containerSecurityGroup = new cdk.aws_ec2.SecurityGroup(this, 'ContainerSecurityGroup', {
      vpc: this.vpc,
      description: 'Security group for ECS containers',
      securityGroupName: `${props.projectName}-container-sg-${props.environment}`,
    });

    this.lambdaSecurityGroup = new cdk.aws_ec2.SecurityGroup(this, 'LambdaSecurityGroup', {
      vpc: this.vpc,
      description: 'Security group for Lambda functions',
      securityGroupName: `${props.projectName}-lambda-sg-${props.environment}`,
    });

    this.redisSecurityGroup = new cdk.aws_ec2.SecurityGroup(this, 'RedisSecurityGroup', {
      vpc: this.vpc,
      description: 'Security group for ElastiCache Redis',
      securityGroupName: `${props.projectName}-redis-sg-${props.environment}`,
    });

    // Security Group Rules
    this.albSecurityGroup.addIngressRule(
      cdk.aws_ec2.Peer.anyIpv4(),
      cdk.aws_ec2.Port.tcp(443),
      'Allow HTTPS from anywhere'
    );

    this.albSecurityGroup.addIngressRule(
      cdk.aws_ec2.Peer.anyIpv4(),
      cdk.aws_ec2.Port.tcp(80),
      'Allow HTTP from anywhere'
    );

    this.containerSecurityGroup.addIngressRule(
      this.albSecurityGroup,
      cdk.aws_ec2.Port.tcp(8080),
      'Allow traffic from ALB'
    );

    this.containerSecurityGroup.addIngressRule(
      this.containerSecurityGroup,
      cdk.aws_ec2.Port.allTraffic(),
      'Allow inter-container communication'
    );

    this.redisSecurityGroup.addIngressRule(
      this.containerSecurityGroup,
      cdk.aws_ec2.Port.tcp(6379),
      'Allow Redis access from containers'
    );

    this.redisSecurityGroup.addIngressRule(
      this.lambdaSecurityGroup,
      cdk.aws_ec2.Port.tcp(6379),
      'Allow Redis access from Lambda'
    );

    // S3 Bucket for browser artifacts
    this.s3Bucket = new cdk.aws_s3.Bucket(this, 'ArtifactsBucket', {
      bucketName: `${props.projectName}-artifacts-${props.environment}-${this.account}`,
      encryption: cdk.aws_s3.BucketEncryption.KMS,
      encryptionKey: this.securityConstruct.kmsKey,
      versioned: false,
      lifecycleRules: [
        {
          id: 'delete-old-screenshots',
          expiration: cdk.Duration.days(7),
          prefix: 'screenshots/',
        },
        {
          id: 'delete-old-downloads',
          expiration: cdk.Duration.days(1),
          prefix: 'downloads/',
        },
      ],
      blockPublicAccess: cdk.aws_s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: isDev ? cdk.RemovalPolicy.DESTROY : cdk.RemovalPolicy.RETAIN,
      autoDeleteObjects: isDev,
    });

    // ElastiCache Redis
    const redisSubnets = this.vpc.selectSubnets({
      subnetType: cdk.aws_ec2.SubnetType.PRIVATE_ISOLATED,
    }).subnets;

    const redisSubnetGroup = new cdk.aws_elasticache.CfnSubnetGroup(this, 'RedisSubnetGroup', {
      description: 'Subnet group for WallCrawler ElastiCache Redis',
      subnetIds: redisSubnets.map((subnet) => subnet.subnetId),
      cacheSubnetGroupName: `${props.projectName}-redis-${props.environment}`,
    });

    const redisCluster = new cdk.aws_elasticache.CfnCacheCluster(this, 'RedisCluster', {
      cacheNodeType: isDev ? 'cache.t3.micro' : 'cache.t3.small',
      engine: 'redis',
      engineVersion: '7.0',
      numCacheNodes: 1,
      cacheSubnetGroupName: redisSubnetGroup.ref,
      vpcSecurityGroupIds: [this.redisSecurityGroup.securityGroupId],
      clusterName: `${props.projectName}-redis-${props.environment}`,
      port: 6379,
      azMode: 'single-az',
      preferredAvailabilityZone: redisSubnets[0].availabilityZone,
      snapshotRetentionLimit: isDev ? 0 : 5,
      snapshotWindow: isDev ? undefined : '03:00-05:00',
      preferredMaintenanceWindow: isDev ? undefined : 'sun:05:00-sun:06:00',
      transitEncryptionEnabled: !isDev, // Enable TLS in production
    });

    this.redisEndpoint = redisCluster.attrRedisEndpointAddress;

    // Service Discovery Namespace
    this.namespace = new cdk.aws_servicediscovery.PrivateDnsNamespace(this, 'ServiceNamespace', {
      name: `${props.projectName}.local`,
      vpc: this.vpc,
      description: 'Private namespace for WallCrawler services',
    });

    // Application Load Balancer
    this.sharedLoadBalancer = new cdk.aws_elasticloadbalancingv2.ApplicationLoadBalancer(this, 'SharedLoadBalancer', {
      vpc: this.vpc,
      internetFacing: true,
      loadBalancerName: `${props.projectName}-alb-${props.environment}`,
      securityGroup: this.albSecurityGroup,
    });

    // Associate WAF with ALB
    if (this.securityConstruct.wafWebAcl) {
      new cdk.aws_wafv2.CfnWebACLAssociation(this, 'SharedALBWAFAssociation', {
        resourceArn: this.sharedLoadBalancer.loadBalancerArn,
        webAclArn: this.securityConstruct.wafWebAcl.attrArn,
      });
    }

    // Secrets
    this.jweSecret = new cdk.aws_secretsmanager.Secret(this, 'JWESecret', {
      secretName: `${props.projectName}-jwe-secret-${props.environment}`,
      description: 'JWE encryption secret for session authentication',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({}),
        generateStringKey: 'JWE_SECRET',
        passwordLength: 64,
        excludeCharacters: ' %+~`#$&*()|[]{}:;<>?!\'/@"\\',
      },
    });

    this.apiKeysSecret = new cdk.aws_secretsmanager.Secret(this, 'ApiKeysSecret', {
      secretName: `${props.projectName}-api-keys-${props.environment}`,
      description: 'API keys for authentication',
      secretObjectValue: {
        API_KEYS: cdk.SecretValue.unsafePlainText(
          JSON.stringify(props.allowedApiKeys || ['dev-key-123', 'dev-key-456'])
        ),
      },
      encryptionKey: this.securityConstruct.kmsKey,
    });

    // Outputs
    new cdk.CfnOutput(this, 'VPCId', {
      value: this.vpc.vpcId,
      exportName: `${props.projectName}-vpc-id-${props.environment}`,
    });

    new cdk.CfnOutput(this, 'ALBDnsName', {
      value: this.sharedLoadBalancer.loadBalancerDnsName,
      exportName: `${props.projectName}-alb-dns-${props.environment}`,
    });

    new cdk.CfnOutput(this, 'RedisEndpoint', {
      value: this.redisEndpoint,
      exportName: `${props.projectName}-redis-endpoint-${props.environment}`,
    });

    new cdk.CfnOutput(this, 'BucketName', {
      value: this.s3Bucket.bucketName,
      exportName: `${props.projectName}-bucket-name-${props.environment}`,
    });
  }
}
