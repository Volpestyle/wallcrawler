import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

export interface NetworkingStackProps {
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
  cidr?: string;

  /**
   * Maximum number of Availability Zones
   * @default 2 for dev, 3 for prod
   */
  maxAzs?: number;

  /**
   * Enable NAT gateways
   * @default 1 for dev, 2 for prod
   */
  natGateways?: number;

  /**
   * Enable VPC Flow Logs
   * @default true
   */
  enableFlowLogs?: boolean;

  /**
   * Enable DNS hostnames
   * @default true
   */
  enableDnsHostnames?: boolean;

  /**
   * Enable DNS support
   * @default true
   */
  enableDnsSupport?: boolean;
}

/**
 * Networking construct that creates a VPC with public and private subnets
 * Optimized for WallCrawler infrastructure with ECS and ElastiCache
 */
export class NetworkingStack extends Construct {
  public readonly vpc: ec2.Vpc;
  public readonly publicSubnets: ec2.ISubnet[];
  public readonly privateSubnets: ec2.ISubnet[];
  public readonly isolatedSubnets: ec2.ISubnet[];
  public readonly ecsSecurityGroup: ec2.SecurityGroup;
  public readonly albSecurityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: NetworkingStackProps) {
    super(scope, id);

    const isProd = props.environment === 'prod' || props.environment === 'production';
    const maxAzs = props.maxAzs ?? (isProd ? 3 : 2);
    const natGateways = props.natGateways ?? (isProd ? 2 : 1);

    // Create VPC with public, private, and isolated subnets
    this.vpc = new ec2.Vpc(this, 'VPC', {
      ipAddresses: ec2.IpAddresses.cidr(props.cidr ?? '10.0.0.0/16'),
      maxAzs,
      enableDnsHostnames: props.enableDnsHostnames ?? true,
      enableDnsSupport: props.enableDnsSupport ?? true,
      natGateways,
      
      // Subnet configuration for different workloads
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
        {
          cidrMask: 24,
          name: 'Isolated',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      ],

      // Gateway endpoints for cost optimization
      gatewayEndpoints: {
        S3: {
          service: ec2.GatewayVpcEndpointAwsService.S3,
        },
        DynamoDB: {
          service: ec2.GatewayVpcEndpointAwsService.DYNAMODB,
        },
      },
    });

    // Store subnet references
    this.publicSubnets = this.vpc.publicSubnets;
    this.privateSubnets = this.vpc.privateSubnets;
    this.isolatedSubnets = this.vpc.isolatedSubnets;

    // VPC Endpoints for AWS services (reduces NAT gateway costs)
    if (isProd) {
      // ECR endpoints for container image pulls
      this.vpc.addInterfaceEndpoint('EcrDockerEndpoint', {
        service: ec2.InterfaceVpcEndpointAwsService.ECR_DOCKER,
        subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      });

      this.vpc.addInterfaceEndpoint('EcrEndpoint', {
        service: ec2.InterfaceVpcEndpointAwsService.ECR,
        subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      });

      // CloudWatch endpoints for logging
      this.vpc.addInterfaceEndpoint('CloudWatchLogsEndpoint', {
        service: ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS,
        subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      });

      // ECS endpoints for service management
      this.vpc.addInterfaceEndpoint('EcsEndpoint', {
        service: ec2.InterfaceVpcEndpointAwsService.ECS,
        subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      });

      this.vpc.addInterfaceEndpoint('EcsAgentEndpoint', {
        service: ec2.InterfaceVpcEndpointAwsService.ECS_AGENT,
        subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      });

      this.vpc.addInterfaceEndpoint('EcsTelemetryEndpoint', {
        service: ec2.InterfaceVpcEndpointAwsService.ECS_TELEMETRY,
        subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      });
    }

    // Security group for ECS tasks
    this.ecsSecurityGroup = new ec2.SecurityGroup(this, 'EcsSecurityGroup', {
      vpc: this.vpc,
      description: `Security group for ${props.projectName} ECS tasks`,
      allowAllOutbound: true,
    });

    // Security group for Application Load Balancer
    this.albSecurityGroup = new ec2.SecurityGroup(this, 'AlbSecurityGroup', {
      vpc: this.vpc,
      description: `Security group for ${props.projectName} Application Load Balancer`,
      allowAllOutbound: true,
    });

    // ALB security group rules
    this.albSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      'Allow HTTP traffic'
    );

    this.albSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      'Allow HTTPS traffic'
    );

    // ECS security group rules
    this.ecsSecurityGroup.addIngressRule(
      ec2.Peer.securityGroupId(this.albSecurityGroup.securityGroupId),
      ec2.Port.allTraffic(),
      'Allow traffic from ALB'
    );

    // Allow ECS tasks to communicate with each other
    this.ecsSecurityGroup.addIngressRule(
      ec2.Peer.securityGroupId(this.ecsSecurityGroup.securityGroupId),
      ec2.Port.allTraffic(),
      'Allow ECS tasks to communicate with each other'
    );

    // VPC Flow Logs
    if (props.enableFlowLogs ?? true) {
      this.vpc.addFlowLog('VpcFlowLogs', {
        destination: ec2.FlowLogDestination.toCloudWatchLogs(),
        trafficType: ec2.FlowLogTrafficType.ALL,
      });
    }

    // Tagging
    cdk.Tags.of(this.vpc).add('Name', `${props.projectName}-${props.environment}-vpc`);
    cdk.Tags.of(this.vpc).add('Environment', props.environment);
    cdk.Tags.of(this.vpc).add('Project', props.projectName);
    cdk.Tags.of(this.vpc).add('Component', 'networking');

    // Outputs
    new cdk.CfnOutput(this, 'VpcId', {
      value: this.vpc.vpcId,
      description: 'VPC ID',
      exportName: `${props.projectName}-${props.environment}-vpc-id`,
    });

    new cdk.CfnOutput(this, 'VpcCidr', {
      value: this.vpc.vpcCidrBlock,
      description: 'VPC CIDR block',
      exportName: `${props.projectName}-${props.environment}-vpc-cidr`,
    });

    new cdk.CfnOutput(this, 'PublicSubnetIds', {
      value: this.publicSubnets.map(subnet => subnet.subnetId).join(','),
      description: 'Public subnet IDs',
      exportName: `${props.projectName}-${props.environment}-public-subnet-ids`,
    });

    new cdk.CfnOutput(this, 'PrivateSubnetIds', {
      value: this.privateSubnets.map(subnet => subnet.subnetId).join(','),
      description: 'Private subnet IDs',
      exportName: `${props.projectName}-${props.environment}-private-subnet-ids`,
    });

    new cdk.CfnOutput(this, 'IsolatedSubnetIds', {
      value: this.isolatedSubnets.map(subnet => subnet.subnetId).join(','),
      description: 'Isolated subnet IDs',
      exportName: `${props.projectName}-${props.environment}-isolated-subnet-ids`,
    });

    new cdk.CfnOutput(this, 'EcsSecurityGroupId', {
      value: this.ecsSecurityGroup.securityGroupId,
      description: 'ECS security group ID',
      exportName: `${props.projectName}-${props.environment}-ecs-security-group-id`,
    });

    new cdk.CfnOutput(this, 'AlbSecurityGroupId', {
      value: this.albSecurityGroup.securityGroupId,
      description: 'ALB security group ID',
      exportName: `${props.projectName}-${props.environment}-alb-security-group-id`,
    });
  }

  /**
   * Get subnets by type
   */
  public getSubnetsByType(subnetType: ec2.SubnetType): ec2.ISubnet[] {
    switch (subnetType) {
      case ec2.SubnetType.PUBLIC:
        return this.publicSubnets;
      case ec2.SubnetType.PRIVATE_WITH_EGRESS:
        return this.privateSubnets;
      case ec2.SubnetType.PRIVATE_ISOLATED:
        return this.isolatedSubnets;
      default:
        throw new Error(`Unsupported subnet type: ${subnetType}`);
    }
  }
}