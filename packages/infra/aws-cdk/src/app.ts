#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import { CoreInfrastructureStack } from './stacks/CoreInfrastructureStack';
import { ApplicationServicesStack } from './stacks/ApplicationServicesStack';

const app = new cdk.App();

// Get configuration from context or environment - no fallbacks
const account = process.env.CDK_DEFAULT_ACCOUNT;
const region = process.env.CDK_DEFAULT_REGION;
const environment = app.node.tryGetContext('environment');
const projectName = app.node.tryGetContext('projectName');

// Validate required configuration
if (!account) {
  throw new Error('CDK_DEFAULT_ACCOUNT environment variable is required');
}
if (!region) {
  throw new Error('CDK_DEFAULT_REGION environment variable is required');
}
if (!environment) {
  throw new Error('environment context is required. Use: cdk deploy --context environment=dev');
}
if (!projectName) {
  throw new Error('projectName context is required. Use: cdk deploy --context projectName=wallcrawler');
}

const config = {
  env: {
    account,
    region,
  },
  environment,
  projectName,
};

// Optional configuration from context
const allowedApiKeys = app.node.tryGetContext('allowedApiKeys');
const maxSessionsPerContainer = app.node.tryGetContext('maxSessionsPerContainer');

// Stack 1: Core Infrastructure (VPC, ALB, Redis, S3, Secrets)
const infrastructureStack = new CoreInfrastructureStack(app, `${config.projectName}-core-${config.environment}`, {
  env: config.env,
  environment: config.environment,
  projectName: config.projectName,
  allowedApiKeys: allowedApiKeys ? allowedApiKeys.split(',') : undefined,
  description: `WallCrawler core infrastructure for ${config.environment} environment`,
  tags: {
    Project: config.projectName,
    Environment: config.environment,
    ManagedBy: 'CDK',
    Stack: 'Infrastructure',
  },
});

// Stack 2: Application Services (ECS, Lambda, API Gateway)
new ApplicationServicesStack(app, `${config.projectName}-app-${config.environment}`, {
  env: config.env,
  environment: config.environment,
  projectName: config.projectName,
  infrastructureStack,
  maxSessionsPerContainer: maxSessionsPerContainer ? parseInt(maxSessionsPerContainer) : undefined,
  description: `WallCrawler application services for ${config.environment} environment`,
  tags: {
    Project: config.projectName,
    Environment: config.environment,
    ManagedBy: 'CDK',
    Stack: 'Application',
  },
});

// Apply CDK Nag security checks
// Only apply in production or when explicitly enabled
const enableCdkNag = process.env.ENABLE_CDK_NAG === 'true' || config.environment === 'prod';
if (enableCdkNag) {
  cdk.Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));
  console.log('CDK Nag security checks enabled');
}
