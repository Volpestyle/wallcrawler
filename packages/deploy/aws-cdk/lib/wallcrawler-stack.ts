import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigatewayv2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as cloudfrontOrigins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as sns from 'aws-cdk-lib/aws-sns';
import { Construct } from 'constructs';
import { WallCrawlerLambdaContainer } from './constructs/lambda-container';

export class WallCrawlerStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Secrets
    const jwtSecret = new secretsmanager.Secret(this, 'JWTSecret', {
      secretName: 'wallcrawler/jwt-secret',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({}),
        generateStringKey: 'secret',
        passwordLength: 32,
      },
    });

    // TODO: Enable when push notifications are implemented
    // const pushNotificationSecrets = new secretsmanager.Secret(this, 'PushNotificationSecrets', {
    //   secretName: 'wallcrawler/push-notifications',
    //   description: 'APNS and FCM credentials for push notifications',
    // });

    // DynamoDB Tables
    const sessionsTable = new dynamodb.Table(this, 'SessionsTable', {
      tableName: 'wallcrawler-sessions',
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      pointInTimeRecovery: true,
    });

    const interventionsTable = new dynamodb.Table(this, 'InterventionsTable', {
      tableName: 'wallcrawler-interventions',
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
    });

    // TODO: Enable when device tokens are needed
    // const deviceTokensTable = new dynamodb.Table(this, 'DeviceTokensTable', {
    //   tableName: 'wallcrawler-device-tokens',
    //   partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
    //   sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
    //   billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    //   timeToLiveAttribute: 'ttl',
    // });

    const wsConnectionsTable = new dynamodb.Table(this, 'WebSocketConnectionsTable', {
      tableName: 'wallcrawler-ws-connections',
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
    });

    // Additional tables for browser automation
    const cacheTable = new dynamodb.Table(this, 'CacheTable', {
      tableName: 'wallcrawler-cache',
      partitionKey: { name: 'cacheKey', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const checkpointsTable = new dynamodb.Table(this, 'CheckpointsTable', {
      tableName: 'wallcrawler-checkpoints',
      partitionKey: { name: 'sessionId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.NUMBER },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const metricsTable = new dynamodb.Table(this, 'MetricsTable', {
      tableName: 'wallcrawler-metrics',
      partitionKey: { name: 'metricName', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.NUMBER },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // S3 Buckets
    const artifactsBucket = new s3.Bucket(this, 'ArtifactsBucket', {
      bucketName: `wallcrawler-artifacts-${this.account}`,
      versioned: true,
      lifecycleRules: [{
        id: 'cleanup',
        expiration: cdk.Duration.days(30),
      }],
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    const portalBucket = new s3.Bucket(this, 'PortalBucket', {
      bucketName: `wallcrawler-portal-${this.account}`,
      websiteIndexDocument: 'index.html',
      websiteErrorDocument: 'error.html',
      publicReadAccess: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    // SNS Topic for notifications
    const notificationTopic = new sns.Topic(this, 'NotificationTopic', {
      topicName: 'wallcrawler-notifications',
      displayName: 'WallCrawler Notifications',
    });

    // Lambda Layer for shared code
    const sharedLayer = new lambda.LayerVersion(this, 'SharedLayer', {
      code: lambda.Code.fromAsset('../dist'),
      compatibleRuntimes: [lambda.Runtime.NODEJS_18_X],
      description: 'WallCrawler AWS shared libraries',
    });

    // Lambda Functions
    const interventionHandlerFn = new lambda.Function(this, 'InterventionHandler', {
      functionName: 'wallcrawler-intervention-handler',
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'intervention-handler.handler',
      code: lambda.Code.fromAsset('../dist/lambda'),
      layers: [sharedLayer],
      timeout: cdk.Duration.minutes(1),
      memorySize: 1024,
      environment: {
        INTERVENTIONS_TABLE: interventionsTable.tableName,
        NOTIFICATION_TOPIC_ARN: notificationTopic.topicArn,
        JWT_SECRET_ARN: jwtSecret.secretArn,
        PORTAL_DOMAIN: `https://${portalBucket.bucketWebsiteDomainName}`,
      },
    });

    // Grant permissions
    interventionsTable.grantReadWriteData(interventionHandlerFn);
    notificationTopic.grantPublish(interventionHandlerFn);
    jwtSecret.grantRead(interventionHandlerFn);

    // WebSocket API
    const webSocketApi = new apigatewayv2.WebSocketApi(this, 'InterventionWebSocketApi', {
      apiName: 'wallcrawler-intervention-ws',
      description: 'WebSocket API for intervention portal',
    });

    const wsConnectFn = new lambda.Function(this, 'WSConnectHandler', {
      functionName: 'wallcrawler-ws-connect',
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'websocket-handler.handleConnect',
      code: lambda.Code.fromAsset('../dist/lambda'),
      layers: [sharedLayer],
      environment: {
        CONNECTIONS_TABLE: wsConnectionsTable.tableName,
        JWT_SECRET_ARN: jwtSecret.secretArn,
      },
    });

    const wsDisconnectFn = new lambda.Function(this, 'WSDisconnectHandler', {
      functionName: 'wallcrawler-ws-disconnect',
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'websocket-handler.handleDisconnect',
      code: lambda.Code.fromAsset('../dist/lambda'),
      layers: [sharedLayer],
      environment: {
        CONNECTIONS_TABLE: wsConnectionsTable.tableName,
      },
    });

    const wsMessageFn = new lambda.Function(this, 'WSMessageHandler', {
      functionName: 'wallcrawler-ws-message',
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'websocket-handler.handleMessage',
      code: lambda.Code.fromAsset('../dist/lambda'),
      layers: [sharedLayer],
      timeout: cdk.Duration.seconds(30),
      environment: {
        CONNECTIONS_TABLE: wsConnectionsTable.tableName,
        SESSIONS_TABLE: sessionsTable.tableName,
      },
    });

    // Grant permissions
    wsConnectionsTable.grantReadWriteData(wsConnectFn);
    wsConnectionsTable.grantReadWriteData(wsDisconnectFn);
    wsConnectionsTable.grantReadWriteData(wsMessageFn);
    sessionsTable.grantReadWriteData(wsMessageFn);
    jwtSecret.grantRead(wsConnectFn);

    // WebSocket routes
    webSocketApi.addRoute('$connect', {
      integration: new apigatewayv2Integrations.WebSocketLambdaIntegration(
        'ConnectIntegration',
        wsConnectFn
      ),
    });

    webSocketApi.addRoute('$disconnect', {
      integration: new apigatewayv2Integrations.WebSocketLambdaIntegration(
        'DisconnectIntegration',
        wsDisconnectFn
      ),
    });

    webSocketApi.addRoute('$default', {
      integration: new apigatewayv2Integrations.WebSocketLambdaIntegration(
        'MessageIntegration',
        wsMessageFn
      ),
    });

    // WebSocket Stage
    const wsStage = new apigatewayv2.WebSocketStage(this, 'WebSocketStage', {
      webSocketApi,
      stageName: 'prod',
      autoDeploy: true,
    });

    // Grant execute-api permissions to Lambda functions
    wsMessageFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['execute-api:ManageConnections'],
      resources: [`arn:aws:execute-api:${this.region}:${this.account}:${webSocketApi.apiId}/*`],
    }));

    // CloudFront distribution for portal
    const portalDistribution = new cloudfront.Distribution(this, 'PortalDistribution', {
      defaultBehavior: {
        origin: new cloudfrontOrigins.S3Origin(portalBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      additionalBehaviors: {
        '/api/*': {
          origin: new cloudfrontOrigins.HttpOrigin(
            `${wsStage.url.replace('wss://', '').replace('/prod', '')}`
          ),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
        },
      },
      defaultRootObject: 'index.html',
      errorResponses: [{
        httpStatus: 404,
        responseHttpStatus: 200,
        responsePagePath: '/index.html',
      }],
    });

    // Browser automation Lambda container
    const browserAutomationLambda = new WallCrawlerLambdaContainer(this, 'BrowserAutomation', {
      artifactsBucket,
      interventionHandler: interventionHandlerFn,
      cacheTable,
      checkpointsTable,
      sessionsTable,
      metricsTable,
    });

    // Grant WebSocket API permissions to browser automation Lambda
    browserAutomationLambda.function.addToRolePolicy(new iam.PolicyStatement({
      actions: ['execute-api:ManageConnections'],
      resources: [`arn:aws:execute-api:${this.region}:${this.account}:${webSocketApi.apiId}/*`],
    }));

    // Outputs
    new cdk.CfnOutput(this, 'InterventionHandlerArn', {
      value: interventionHandlerFn.functionArn,
      description: 'ARN of the intervention handler Lambda function',
    });

    new cdk.CfnOutput(this, 'BrowserAutomationFunctionArn', {
      value: browserAutomationLambda.function.functionArn,
      description: 'ARN of the browser automation Lambda function',
    });

    new cdk.CfnOutput(this, 'WebSocketApiUrl', {
      value: wsStage.url,
      description: 'WebSocket API URL for intervention portal',
    });

    new cdk.CfnOutput(this, 'PortalUrl', {
      value: `https://${portalDistribution.distributionDomainName}`,
      description: 'CloudFront URL for intervention portal',
    });

    new cdk.CfnOutput(this, 'ArtifactsBucketName', {
      value: artifactsBucket.bucketName,
      description: 'S3 bucket for automation artifacts',
    });

    new cdk.CfnOutput(this, 'CacheTableName', {
      value: cacheTable.tableName,
      description: 'DynamoDB table for caching LLM responses',
    });

    new cdk.CfnOutput(this, 'CheckpointsTableName', {
      value: checkpointsTable.tableName,
      description: 'DynamoDB table for session checkpoints',
    });
  }
}