import * as cdk from 'aws-cdk-lib';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import * as path from 'path';

export interface GoContainerConstructProps {
    projectName: string;
    environment: string;
    vpc: ec2.IVpc;
    containerSecurityGroup: ec2.ISecurityGroup;
    redisEndpoint: string;
    s3Bucket: s3.IBucket;
    jweSecret: secretsmanager.ISecret;
    maxSessionsPerContainer?: number;
    cpu?: number;
    memoryLimitMiB?: number;
}

/**
 * Construct for deploying the Go browser container to ECS
 */
export class GoContainerConstruct extends Construct {
    public readonly cluster: ecs.Cluster;
    public readonly service: ecs.FargateService;
    public readonly taskDefinition: ecs.FargateTaskDefinition;
    public readonly repository: ecr.Repository;
    public readonly logGroup: logs.LogGroup;
    public readonly nlb: elbv2.NetworkLoadBalancer;
    public readonly containerTargetGroup: elbv2.NetworkTargetGroup;
    public readonly cdpTargetGroup: elbv2.NetworkTargetGroup;

    constructor(scope: Construct, id: string, private props: GoContainerConstructProps) {
        super(scope, id);

        const isDev = this.props.environment === 'development' || this.props.environment === 'dev';
        const maxSessionsPerContainer = this.props.maxSessionsPerContainer || 20;

        // Create ECS Cluster
        this.cluster = new ecs.Cluster(this, 'GoECSCluster', {
            vpc: this.props.vpc,
            clusterName: `${this.props.projectName}-go-cluster-${this.props.environment}`,
            containerInsights: !isDev,
            enableFargateCapacityProviders: true,
        });

        // ECR Repository for Go container
        this.repository = new ecr.Repository(this, 'GoBrowserRepository', {
            repositoryName: `${this.props.projectName}/go-browser-${this.props.environment}`,
            imageScanOnPush: true,
            lifecycleRules: [
                {
                    maxImageCount: 10,
                    description: 'Keep only 10 most recent images',
                },
            ],
            removalPolicy: isDev ? cdk.RemovalPolicy.DESTROY : cdk.RemovalPolicy.RETAIN,
        });

        // CloudWatch Log Group for Go container
        this.logGroup = new logs.LogGroup(this, 'GoBrowserLogGroup', {
            logGroupName: `/ecs/${this.props.projectName}/go-browser-${this.props.environment}`,
            retention: logs.RetentionDays.THREE_DAYS,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });

        // Go Container Task Definition
        this.taskDefinition = new ecs.FargateTaskDefinition(this, 'GoBrowserTaskDefinition', {
            family: `${this.props.projectName}-go-browser-${this.props.environment}`,
            cpu: this.props.cpu || 1024,
            memoryLimitMiB: this.props.memoryLimitMiB || 2048,
        });

        // Add Go container to task
        const containerDefinition = this.taskDefinition.addContainer('GoBrowserContainer', {
            image: ecs.ContainerImage.fromEcrRepository(this.repository, 'latest'),
            logging: ecs.LogDrivers.awsLogs({
                streamPrefix: 'go-browser',
                logGroup: this.logGroup,
            }),
            environment: {
                PORT: '8080',
                CDP_PORT: '9222',
                MAX_SESSIONS: maxSessionsPerContainer.toString(),
                REDIS_ENDPOINT: this.props.redisEndpoint,
                S3_BUCKET: this.props.s3Bucket.bucketName,
                ENVIRONMENT: this.props.environment,
                CONTAINER_ID: '', // Will be set at runtime
            },
            secrets: {
                JWE_SECRET: ecs.Secret.fromSecretsManager(this.props.jweSecret, 'JWE_SECRET'),
            },
            healthCheck: {
                command: ['CMD-SHELL', 'curl -f http://localhost:8080/health || exit 1'],
                interval: cdk.Duration.seconds(30),
                timeout: cdk.Duration.seconds(10),
                retries: 3,
                startPeriod: cdk.Duration.seconds(60),
            },
        });

        // Add port mappings
        containerDefinition.addPortMappings(
            {
                containerPort: 8080,
                protocol: ecs.Protocol.TCP,
                name: 'http',
            },
            {
                containerPort: 9222,
                protocol: ecs.Protocol.TCP,
                name: 'cdp',
            }
        );

        // Grant S3 permissions to the task role
        this.props.s3Bucket.grantReadWrite(this.taskDefinition.taskRole);

        // Create ECS Service
        this.service = new ecs.FargateService(this, 'GoBrowserService', {
            cluster: this.cluster,
            taskDefinition: this.taskDefinition,
            serviceName: `${this.props.projectName}-go-browser-${this.props.environment}`,
            desiredCount: isDev ? 1 : 2,
            assignPublicIp: false,
            securityGroups: [this.props.containerSecurityGroup],
            vpcSubnets: {
                subnets: this.props.vpc.privateSubnets,
            },
            healthCheckGracePeriod: cdk.Duration.seconds(300),
            capacityProviderStrategies: [
                {
                    capacityProvider: 'FARGATE',
                    weight: 1,
                },
                {
                    capacityProvider: 'FARGATE_SPOT',
                    weight: isDev ? 0 : 1, // Use Spot instances for cost savings in non-dev environments
                },
            ],
        });

        // Auto Scaling for the ECS Service
        const scalableTarget = this.service.autoScaleTaskCount({
            minCapacity: isDev ? 1 : 2,
            maxCapacity: isDev ? 3 : 10,
        });

        // Scale based on CPU utilization
        scalableTarget.scaleOnCpuUtilization('CpuScaling', {
            targetUtilizationPercent: 70,
            scaleInCooldown: cdk.Duration.minutes(5),
            scaleOutCooldown: cdk.Duration.minutes(2),
        });

        // Scale based on memory utilization
        scalableTarget.scaleOnMemoryUtilization('MemoryScaling', {
            targetUtilizationPercent: 80,
            scaleInCooldown: cdk.Duration.minutes(5),
            scaleOutCooldown: cdk.Duration.minutes(2),
        });

        // Create Network Load Balancer for internal communication
        this.nlb = new elbv2.NetworkLoadBalancer(this, 'GoContainerNLB', {
            vpc: this.props.vpc,
            internetFacing: false,
            loadBalancerName: `${this.props.projectName}-go-nlb-${this.props.environment}`,
            vpcSubnets: {
                subnets: this.props.vpc.privateSubnets,
            },
        });

        // Target Group for HTTP traffic (WebSocket/API)
        this.containerTargetGroup = new elbv2.NetworkTargetGroup(this, 'GoContainerTargetGroup', {
            port: 8080,
            protocol: elbv2.Protocol.TCP,
            vpc: this.props.vpc,
            targetGroupName: `${this.props.projectName}-go-http-${this.props.environment}`,
            healthCheck: {
                enabled: true,
                protocol: elbv2.Protocol.HTTP,
                path: '/health',
                port: '8080',
                healthyHttpCodes: '200',
                interval: cdk.Duration.seconds(30),
                timeout: cdk.Duration.seconds(10),
                healthyThresholdCount: 2,
                unhealthyThresholdCount: 3,
            },
        });

        // Target Group for CDP traffic
        this.cdpTargetGroup = new elbv2.NetworkTargetGroup(this, 'GoCdpTargetGroup', {
            port: 9222,
            protocol: elbv2.Protocol.TCP,
            vpc: this.props.vpc,
            targetGroupName: `${this.props.projectName}-go-cdp-${this.props.environment}`,
            healthCheck: {
                enabled: true,
                protocol: elbv2.Protocol.TCP,
                port: '9222',
                interval: cdk.Duration.seconds(30),
                timeout: cdk.Duration.seconds(10),
                healthyThresholdCount: 2,
                unhealthyThresholdCount: 3,
            },
        });

        // Add listeners to NLB
        this.nlb.addListener('GoContainerListener', {
            port: 8080,
            protocol: elbv2.Protocol.TCP,
            defaultTargetGroups: [this.containerTargetGroup],
        });

        this.nlb.addListener('GoCdpListener', {
            port: 9222,
            protocol: elbv2.Protocol.TCP,
            defaultTargetGroups: [this.cdpTargetGroup],
        });

        // Attach service to target groups
        this.service.attachToNetworkTargetGroup(this.containerTargetGroup);
        this.service.attachToNetworkTargetGroup(this.cdpTargetGroup);

        // Output important values
        new cdk.CfnOutput(this, 'GoClusterName', {
            value: this.cluster.clusterName,
            description: 'Go ECS Cluster Name',
            exportName: `${this.props.projectName}-go-cluster-name-${this.props.environment}`,
        });

        new cdk.CfnOutput(this, 'GoTaskDefinitionArn', {
            value: this.taskDefinition.taskDefinitionArn,
            description: 'Go Browser Task Definition ARN',
            exportName: `${this.props.projectName}-go-task-def-arn-${this.props.environment}`,
        });

        new cdk.CfnOutput(this, 'GoServiceName', {
            value: this.service.serviceName,
            description: 'Go Browser ECS Service Name',
            exportName: `${this.props.projectName}-go-service-name-${this.props.environment}`,
        });

        new cdk.CfnOutput(this, 'GoNlbDnsName', {
            value: this.nlb.loadBalancerDnsName,
            description: 'Go Container NLB DNS Name',
            exportName: `${this.props.projectName}-go-nlb-dns-${this.props.environment}`,
        });

        new cdk.CfnOutput(this, 'GoEcrRepositoryUri', {
            value: this.repository.repositoryUri,
            description: 'Go Browser ECR Repository URI',
            exportName: `${this.props.projectName}-go-ecr-uri-${this.props.environment}`,
        });
    }

    /**
     * Create build and push script for the Go container
     */
    public createBuildScript(): string {
        const buildScript = `#!/bin/bash
set -e

# Configuration
REPOSITORY_URI="${this.repository.repositoryUri}"
REGION="${cdk.Stack.of(this).region}"
DOCKERFILE_PATH="packages/infra/go-container/Dockerfile"
BUILD_CONTEXT="packages/infra/go-container"

echo "Building and pushing Go container to ECR..."
echo "Repository URI: $REPOSITORY_URI"

# Login to ECR
echo "Logging in to ECR..."
aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin $REPOSITORY_URI

# Build the Docker image
echo "Building Docker image..."
docker build -t wallcrawler-go-browser -f $DOCKERFILE_PATH $BUILD_CONTEXT

# Tag the image
echo "Tagging image..."
docker tag wallcrawler-go-browser:latest $REPOSITORY_URI:latest
docker tag wallcrawler-go-browser:latest $REPOSITORY_URI:$(date +%Y%m%d-%H%M%S)

# Push the image
echo "Pushing image to ECR..."
docker push $REPOSITORY_URI:latest
docker push $REPOSITORY_URI:$(date +%Y%m%d-%H%M%S)

echo "Successfully pushed Go container to ECR!"

# Update ECS service to use new image
echo "Updating ECS service..."
aws ecs update-service \\
  --cluster "${this.cluster.clusterName}" \\
  --service "${this.service.serviceName}" \\
  --force-new-deployment \\
  --region $REGION

echo "ECS service update initiated!"
`;

        return buildScript;
    }
} 