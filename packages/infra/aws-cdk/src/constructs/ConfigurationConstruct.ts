import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

export interface ConfigurationConstructProps {
  environment: string;
  projectName: string;
}

export class ConfigurationConstruct extends Construct {
  // Keep only container resource parameters that are actually used
  public readonly containerCpu: cdk.aws_ssm.StringParameter;
  public readonly containerMemory: cdk.aws_ssm.StringParameter;

  constructor(scope: Construct, id: string, props: ConfigurationConstructProps) {
    super(scope, id);

    const parameterPrefix = `/${props.projectName}/${props.environment}`;

    // Container resource configuration (used by CDK for task definition)
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

    // Output parameter prefix for reference
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
   * Create an SSM parameter for infrastructure configuration
   * Used to store essential infrastructure endpoints and resource identifiers
   */
  createInfrastructureParameter(
    id: string,
    parameterName: string,
    value: string,
    description: string,
    type: cdk.aws_ssm.ParameterType = cdk.aws_ssm.ParameterType.STRING
  ): cdk.aws_ssm.StringParameter {
    return new cdk.aws_ssm.StringParameter(this, id, {
      parameterName,
      stringValue: value,
      description,
      type,
    });
  }
}
