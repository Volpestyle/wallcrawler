// Export all stacks
export { CoreInfrastructureStack } from './stacks/CoreInfrastructureStack';
export { ApplicationServicesStack } from './stacks/ApplicationServicesStack';

// Export all constructs
export { SecurityConstruct } from './constructs/SecurityConstruct';

// Export commonly used AWS CDK constructs for convenience
export {
  aws_ec2 as EC2,
  aws_ecs as ECS,
  aws_s3 as S3,
  aws_cloudfront as CloudFront,
  aws_apigatewayv2 as ApiGatewayV2,
  aws_dynamodb as DynamoDB,
  aws_elasticache as ElastiCache,
  aws_lambda as Lambda,
  aws_iam as IAM,
  aws_cloudwatch as CloudWatch,
  aws_logs as Logs,
  aws_events as Events,
  aws_events_targets as EventTargets,
  aws_sns as SNS,
  aws_budgets as Budgets,
  aws_wafv2 as WAF,
  aws_kms as KMS,
  aws_secretsmanager as SecretsManager,
  aws_cloudtrail as CloudTrail,
  Stack,
  StackProps,
  Duration,
  CfnOutput,
  RemovalPolicy,
  Aws,
  Fn,
} from 'aws-cdk-lib';

export { Construct } from 'constructs';
