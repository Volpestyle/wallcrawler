#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { WallCrawlerStack } from '../lib/wallcrawler-stack';

const app = new cdk.App();
new WallCrawlerStack(app, 'WallCrawlerStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
  },
  description: 'WallCrawler AWS infrastructure for browser automation with human intervention',
});