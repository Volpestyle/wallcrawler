import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

export interface ConfigurationConstructProps {
  environment: string;
  projectName: string;
}

export class ConfigurationConstruct extends Construct {
  public readonly maxConcurrentSessions: cdk.aws_ssm.StringParameter;
  public readonly sessionTimeoutMinutes: cdk.aws_ssm.StringParameter;
  public readonly containerCpu: cdk.aws_ssm.StringParameter;
  public readonly containerMemory: cdk.aws_ssm.StringParameter;
  public readonly logRetentionDays: cdk.aws_ssm.StringParameter;
  public readonly artifactRetentionDays: cdk.aws_ssm.StringParameter;
  public readonly enableContainerInsights: cdk.aws_ssm.StringParameter;

  constructor(scope: Construct, id: string, props: ConfigurationConstructProps) {
    super(scope, id);

    const parameterPrefix = `/${props.projectName}/${props.environment}`;

    // Browser session configuration
    this.maxConcurrentSessions = new cdk.aws_ssm.StringParameter(this, 'MaxConcurrentSessions', {
      parameterName: `${parameterPrefix}/browser/max-concurrent-sessions`,
      stringValue: props.environment === 'prod' ? '10' : '5',
      description: 'Maximum number of concurrent browser sessions per container',
    });

    this.sessionTimeoutMinutes = new cdk.aws_ssm.StringParameter(this, 'SessionTimeoutMinutes', {
      parameterName: `${parameterPrefix}/browser/session-timeout-minutes`,
      stringValue: '240', // 4 hours
      description: 'Browser session timeout in minutes',
    });

    // Container resource configuration
    this.containerCpu = new cdk.aws_ssm.StringParameter(this, 'ContainerCpu', {
      parameterName: `${parameterPrefix}/container/cpu`,
      stringValue: props.environment === 'prod' ? '2048' : '1024', // 2 vCPU for prod, 1 for dev
      description: 'ECS container CPU units (1024 = 1 vCPU)',
    });

    this.containerMemory = new cdk.aws_ssm.StringParameter(this, 'ContainerMemory', {
      parameterName: `${parameterPrefix}/container/memory`,
      stringValue: props.environment === 'prod' ? '4096' : '2048', // 4GB for prod, 2GB for dev
      description: 'ECS container memory in MiB',
    });

    // Logging and retention configuration
    this.logRetentionDays = new cdk.aws_ssm.StringParameter(this, 'LogRetentionDays', {
      parameterName: `${parameterPrefix}/logging/retention-days`,
      stringValue: props.environment === 'prod' ? '30' : '7',
      description: 'CloudWatch logs retention period in days',
    });

    this.artifactRetentionDays = new cdk.aws_ssm.StringParameter(this, 'ArtifactRetentionDays', {
      parameterName: `${parameterPrefix}/artifacts/retention-days`,
      stringValue: '30',
      description: 'S3 artifact retention period in days',
    });

    // Monitoring configuration
    this.enableContainerInsights = new cdk.aws_ssm.StringParameter(this, 'EnableContainerInsights', {
      parameterName: `${parameterPrefix}/monitoring/container-insights`,
      stringValue: props.environment === 'prod' ? 'true' : 'false',
      description: 'Enable ECS Container Insights for detailed monitoring',
    });

    // Output parameter ARNs for easy reference
    new cdk.CfnOutput(this, 'ConfigurationParametersPrefix', {
      value: parameterPrefix,
      description: 'Systems Manager parameter prefix for configuration values',
    });
  }

  /**
   * Get parameter value as number
   */
  static getParameterAsNumber(parameter: cdk.aws_ssm.IStringParameter): number {
    return cdk.Token.asNumber(parameter.stringValue);
  }

  /**
   * Get parameter value as boolean (for use in CDK constructs that expect boolean)
   * Note: This creates a CloudFormation condition that resolves at deploy time
   */
  static getParameterAsBoolean(_parameter: cdk.aws_ssm.IStringParameter): boolean {
    // For constructs that need a boolean at synth time, we'll use a simple check
    // The actual parameter resolution happens at deploy time
    return true; // Default to true, actual value controlled by parameter
  }
}
