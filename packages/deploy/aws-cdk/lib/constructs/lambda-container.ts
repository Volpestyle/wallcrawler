import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Duration, Size, RemovalPolicy } from 'aws-cdk-lib';
import * as path from 'path';

export interface WallCrawlerLambdaContainerProps {
  artifactsBucket: s3.Bucket;
  interventionHandler: lambda.Function;
  cacheTable: dynamodb.Table;
  checkpointsTable: dynamodb.Table;
  sessionsTable: dynamodb.Table;
  metricsTable?: dynamodb.Table;
  llmProvider?: string;
  llmModel?: string;
}

export class WallCrawlerLambdaContainer extends Construct {
  public readonly function: lambda.Function;
  public readonly repository: ecr.Repository;

  constructor(scope: Construct, id: string, props: WallCrawlerLambdaContainerProps) {
    super(scope, id);

    // Create ECR repository for container images
    this.repository = new ecr.Repository(this, 'Repository', {
      repositoryName: 'wallcrawler-lambda',
      lifecycleRules: [
        {
          maxImageCount: 10,
          description: 'Keep only 10 most recent images',
        },
      ],
      removalPolicy: RemovalPolicy.DESTROY,
      emptyOnDelete: true,
    });

    // Create Lambda function with container image
    this.function = new lambda.Function(this, 'Function', {
      functionName: 'wallcrawler-browser-automation',
      runtime: lambda.Runtime.FROM_IMAGE,
      handler: lambda.Handler.FROM_IMAGE,
      code: lambda.Code.fromAssetImage(path.join(__dirname, '../../../wallcrawler-aws/docker'), {
        buildArgs: {
          PLAYWRIGHT_VERSION: '1.40.0',
        },
      }),
      memorySize: 10240, // 10GB - maximum for Lambda
      timeout: Duration.minutes(15), // Maximum Lambda timeout
      ephemeralStorageSize: Size.gibibytes(10), // 10GB ephemeral storage
      environment: {
        // AWS Resources
        ARTIFACTS_BUCKET: props.artifactsBucket.bucketName,
        INTERVENTION_FUNCTION: props.interventionHandler.functionName,
        CACHE_TABLE: props.cacheTable.tableName,
        CHECKPOINTS_TABLE: props.checkpointsTable.tableName,
        SESSIONS_TABLE: props.sessionsTable.tableName,
        METRICS_TABLE: props.metricsTable?.tableName || '',

        // LLM Configuration
        LLM_PROVIDER: props.llmProvider || 'bedrock',
        LLM_MODEL: props.llmModel || 'anthropic.claude-3-sonnet-20240229-v1:0',

        // Feature flags
        SAVE_DOM: 'false',
        NODE_ENV: 'production',
      },
      description: 'WallCrawler browser automation Lambda function with Playwright',
    });

    // Grant permissions to Lambda function
    props.artifactsBucket.grantReadWrite(this.function);
    props.cacheTable.grantReadWriteData(this.function);
    props.checkpointsTable.grantReadWriteData(this.function);
    props.sessionsTable.grantReadWriteData(this.function);
    props.interventionHandler.grantInvoke(this.function);

    if (props.metricsTable) {
      props.metricsTable.grantReadWriteData(this.function);
    }

    // Add Bedrock permissions if using Bedrock
    if (!props.llmProvider || props.llmProvider === 'bedrock') {
      this.function.addToRolePolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
          resources: ['arn:aws:bedrock:*:*:model/*'],
        })
      );
    }

    // Add CloudWatch Logs permissions
    this.function.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
        resources: ['arn:aws:logs:*:*:*'],
      })
    );

    // Add X-Ray permissions for tracing
    this.function.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['xray:PutTraceSegments', 'xray:PutTelemetryRecords'],
        resources: ['*'],
      })
    );
  }
}
