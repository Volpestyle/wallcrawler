import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

export interface SecurityConstructProps {
  environment: string;
  projectName: string;
}

export class SecurityConstruct extends Construct {
  public readonly wafWebAcl: cdk.aws_wafv2.CfnWebACL | undefined;
  public readonly kmsKey: cdk.aws_kms.Key;

  constructor(scope: Construct, id: string, props: SecurityConstructProps) {
    super(scope, id);

    // Create KMS key for encryption
    this.kmsKey = new cdk.aws_kms.Key(this, 'WallCrawlerKey', {
      alias: `${props.projectName}-${props.environment}`,
      description: `KMS key for ${props.projectName} ${props.environment} environment`,
      enableKeyRotation: true,
    });

    // Create WAF Web ACL for production environments only
    // Development environments skip WAF to reduce costs (~$2-5/month savings)
    const isProduction = props.environment === 'prod' || props.environment === 'production';

    if (isProduction) {
      console.log(`[SecurityConstruct] Creating WAF for ${props.environment} environment`);
      this.wafWebAcl = new cdk.aws_wafv2.CfnWebACL(this, 'WallCrawlerWAF', {
        name: `${props.projectName}-waf-${props.environment}`,
        scope: 'REGIONAL',
        defaultAction: { allow: {} },
        description: `Basic WAF for ${props.projectName} ${props.environment}`,
        rules: [
          {
            name: 'RateLimitRule',
            priority: 1,
            statement: {
              rateBasedStatement: {
                limit: 2000,
                aggregateKeyType: 'IP',
              },
            },
            action: { block: {} },
            visibilityConfig: {
              sampledRequestsEnabled: false,
              cloudWatchMetricsEnabled: false,
              metricName: 'RateLimitRule',
            },
          },
          {
            name: 'AWSManagedRulesCommonRuleSet',
            priority: 2,
            overrideAction: { none: {} },
            statement: {
              managedRuleGroupStatement: {
                vendorName: 'AWS',
                name: 'AWSManagedRulesCommonRuleSet',
              },
            },
            visibilityConfig: {
              sampledRequestsEnabled: false,
              cloudWatchMetricsEnabled: false,
              metricName: 'CommonRuleSetMetric',
            },
          },
        ],
        visibilityConfig: {
          sampledRequestsEnabled: false,
          cloudWatchMetricsEnabled: false,
          metricName: `${props.projectName}WAF${props.environment}`,
        },
      });
    } else {
      console.log(`[SecurityConstruct] Skipping WAF for ${props.environment} environment (cost optimization)`);
      this.wafWebAcl = undefined;
    }
  }
}
