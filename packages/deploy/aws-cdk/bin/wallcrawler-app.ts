#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { WallCrawlerInfraStack } from '../src/stacks/WallCrawlerInfraStack';

const app = new cdk.App();

// Get configuration from context or environment
const config = {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
  },
  environment: app.node.tryGetContext('environment') || 'dev',
  projectName: app.node.tryGetContext('projectName') || 'wallcrawler',
};

// Main infrastructure stack
new WallCrawlerInfraStack(app, `${config.projectName}-infra-${config.environment}`, {
  env: config.env,
  environment: config.environment,
  projectName: config.projectName,
  description: `WallCrawler infrastructure stack for ${config.environment} environment`,
  tags: {
    Project: config.projectName,
    Environment: config.environment,
    ManagedBy: 'CDK',
  },
});