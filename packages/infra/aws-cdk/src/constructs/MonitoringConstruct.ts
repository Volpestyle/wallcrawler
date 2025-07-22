import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import { Construct } from 'constructs';

export interface MonitoringConstructProps {
  environment: string;
  projectName: string;
  ecsCluster: ecs.ICluster;
  loadBalancer?: elbv2.ApplicationLoadBalancer;
  apiGateway: apigateway.RestApi;
  lambdaFunctions: lambda.Function[];
}

export class MonitoringConstruct extends Construct {
  public readonly dashboard: cloudwatch.Dashboard;

  constructor(scope: Construct, id: string, props: MonitoringConstructProps) {
    super(scope, id);

    // Create CloudWatch Dashboard
    this.dashboard = new cloudwatch.Dashboard(this, 'WallCrawlerDashboard', {
      dashboardName: `${props.projectName}-${props.environment}`,
      defaultInterval: cdk.Duration.minutes(5),
    });

    // ECS Cluster Metrics
    const ecsMetrics = this.createECSMetrics(props.ecsCluster, props.projectName, props.environment);

    // ALB Metrics (optional - only if loadBalancer is provided)
    const albMetrics = props.loadBalancer ? this.createALBMetrics(props.loadBalancer) : null;

    // Lambda Metrics
    const lambdaMetrics = this.createLambdaMetrics(props.lambdaFunctions);

    // API Gateway Metrics
    const apiMetrics = this.createAPIGatewayMetrics(props.apiGateway);

    // Add widgets to dashboard
    const topRowWidgets = [
      // Top row - Overview
      new cloudwatch.SingleValueWidget({
        title: 'Active Sessions',
        metrics: [ecsMetrics.activeTasks],
        width: 6,
        height: 3,
      }),
      new cloudwatch.SingleValueWidget({
        title: 'API Requests (1h)',
        metrics: [apiMetrics.requestCount],
        width: 6,
        height: 3,
      }),
    ];

    // Add ALB widgets only if loadBalancer is provided
    if (albMetrics) {
      topRowWidgets.push(
        new cloudwatch.SingleValueWidget({
          title: 'ALB Response Time',
          metrics: [albMetrics.responseTime],
          width: 6,
          height: 3,
        }),
        new cloudwatch.SingleValueWidget({
          title: 'Error Rate',
          metrics: [albMetrics.errorRate],
          width: 6,
          height: 3,
        })
      );
    }

    this.dashboard.addWidgets(...topRowWidgets);

    // Second row - ECS Metrics
    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'ECS Task Metrics',
        left: [ecsMetrics.activeTasks, ecsMetrics.pendingTasks],
        width: 12,
        height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'Container Resource Usage',
        left: [ecsMetrics.cpuUtilization, ecsMetrics.memoryUtilization],
        width: 12,
        height: 6,
      })
    );

    // Third row - ALB and API Gateway
    const thirdRowWidgets = [
      new cloudwatch.GraphWidget({
        title: 'API Gateway Metrics',
        left: [apiMetrics.requestCount, apiMetrics.latency],
        right: [apiMetrics.errorCount],
        width: 12,
        height: 6,
      })
    ];

    // Add ALB widget only if loadBalancer is provided
    if (albMetrics) {
      thirdRowWidgets.unshift(
        new cloudwatch.GraphWidget({
          title: 'ALB Request Volume',
          left: [albMetrics.requestCount, albMetrics.targetResponseTime],
          right: [albMetrics.httpCodeCount],
          width: 12,
          height: 6,
        })
      );
    }

    this.dashboard.addWidgets(...thirdRowWidgets);

    // Fourth row - Lambda Functions
    if (props.lambdaFunctions.length > 0) {
      this.dashboard.addWidgets(
        new cloudwatch.GraphWidget({
          title: 'Lambda Duration',
          left: lambdaMetrics.durations,
          width: 12,
          height: 6,
        }),
        new cloudwatch.GraphWidget({
          title: 'Lambda Errors & Throttles',
          left: lambdaMetrics.errors,
          right: lambdaMetrics.throttles,
          width: 12,
          height: 6,
        })
      );
    }

    // Create basic alarms
    this.createAlarms(props, ecsMetrics, albMetrics, lambdaMetrics);
  }

  private createECSMetrics(cluster: ecs.ICluster, projectName: string, environment: string) {
    const serviceName = `${projectName}-browser-service-${environment}`;

    return {
      activeTasks: new cloudwatch.Metric({
        namespace: 'AWS/ECS',
        metricName: 'RunningTaskCount',
        dimensionsMap: {
          ServiceName: serviceName,
          ClusterName: cluster.clusterName,
        },
        statistic: 'Average',
      }),
      pendingTasks: new cloudwatch.Metric({
        namespace: 'AWS/ECS',
        metricName: 'PendingTaskCount',
        dimensionsMap: {
          ServiceName: serviceName,
          ClusterName: cluster.clusterName,
        },
        statistic: 'Average',
      }),
      cpuUtilization: new cloudwatch.Metric({
        namespace: 'AWS/ECS',
        metricName: 'CPUUtilization',
        dimensionsMap: {
          ServiceName: serviceName,
          ClusterName: cluster.clusterName,
        },
        statistic: 'Average',
      }),
      memoryUtilization: new cloudwatch.Metric({
        namespace: 'AWS/ECS',
        metricName: 'MemoryUtilization',
        dimensionsMap: {
          ServiceName: serviceName,
          ClusterName: cluster.clusterName,
        },
        statistic: 'Average',
      }),
    };
  }

  private createALBMetrics(loadBalancer: elbv2.ApplicationLoadBalancer) {
    return {
      requestCount: new cloudwatch.Metric({
        namespace: 'AWS/ApplicationELB',
        metricName: 'RequestCount',
        dimensionsMap: {
          LoadBalancer: loadBalancer.loadBalancerFullName,
        },
        statistic: 'Sum',
      }),
      responseTime: new cloudwatch.Metric({
        namespace: 'AWS/ApplicationELB',
        metricName: 'TargetResponseTime',
        dimensionsMap: {
          LoadBalancer: loadBalancer.loadBalancerFullName,
        },
        statistic: 'Average',
      }),
      targetResponseTime: new cloudwatch.Metric({
        namespace: 'AWS/ApplicationELB',
        metricName: 'TargetResponseTime',
        dimensionsMap: {
          LoadBalancer: loadBalancer.loadBalancerFullName,
        },
        statistic: 'Average',
      }),
      errorRate: new cloudwatch.MathExpression({
        expression: '(m1 / m2) * 100',
        usingMetrics: {
          m1: new cloudwatch.Metric({
            namespace: 'AWS/ApplicationELB',
            metricName: 'HTTPCode_Target_5XX_Count',
            dimensionsMap: {
              LoadBalancer: loadBalancer.loadBalancerFullName,
            },
            statistic: 'Sum',
          }),
          m2: new cloudwatch.Metric({
            namespace: 'AWS/ApplicationELB',
            metricName: 'RequestCount',
            dimensionsMap: {
              LoadBalancer: loadBalancer.loadBalancerFullName,
            },
            statistic: 'Sum',
          }),
        },
        label: 'Error Rate %',
      }),
      httpCodeCount: new cloudwatch.Metric({
        namespace: 'AWS/ApplicationELB',
        metricName: 'HTTPCode_Target_5XX_Count',
        dimensionsMap: {
          LoadBalancer: loadBalancer.loadBalancerFullName,
        },
        statistic: 'Sum',
      }),
    };
  }

  private createAPIGatewayMetrics(api: apigateway.RestApi) {
    return {
      requestCount: new cloudwatch.Metric({
        namespace: 'AWS/ApiGateway',
        metricName: 'Count',
        dimensionsMap: {
          ApiName: api.restApiName,
        },
        statistic: 'Sum',
      }),
      latency: new cloudwatch.Metric({
        namespace: 'AWS/ApiGateway',
        metricName: 'Latency',
        dimensionsMap: {
          ApiName: api.restApiName,
        },
        statistic: 'Average',
      }),
      errorCount: new cloudwatch.Metric({
        namespace: 'AWS/ApiGateway',
        metricName: '5XXError',
        dimensionsMap: {
          ApiName: api.restApiName,
        },
        statistic: 'Sum',
      }),
    };
  }

  private createLambdaMetrics(lambdaFunctions: lambda.Function[]) {
    const durations = lambdaFunctions.map(
      (fn) =>
        new cloudwatch.Metric({
          namespace: 'AWS/Lambda',
          metricName: 'Duration',
          dimensionsMap: {
            FunctionName: fn.functionName,
          },
          statistic: 'Average',
          label: fn.functionName,
        })
    );

    const errors = lambdaFunctions.map(
      (fn) =>
        new cloudwatch.Metric({
          namespace: 'AWS/Lambda',
          metricName: 'Errors',
          dimensionsMap: {
            FunctionName: fn.functionName,
          },
          statistic: 'Sum',
          label: fn.functionName,
        })
    );

    const throttles = lambdaFunctions.map(
      (fn) =>
        new cloudwatch.Metric({
          namespace: 'AWS/Lambda',
          metricName: 'Throttles',
          dimensionsMap: {
            FunctionName: fn.functionName,
          },
          statistic: 'Sum',
          label: fn.functionName,
        })
    );

    return {
      durations,
      errors,
      throttles,
    };
  }

  private createAlarms(props: MonitoringConstructProps, ecsMetrics: any, albMetrics: any, lambdaMetrics: any) {
    // High CPU alarm
    new cloudwatch.Alarm(this, 'HighCPUAlarm', {
      metric: ecsMetrics.cpuUtilization,
      threshold: 80,
      evaluationPeriods: 3,
      alarmDescription: 'ECS service CPU utilization is high',
    });

    // High memory alarm
    new cloudwatch.Alarm(this, 'HighMemoryAlarm', {
      metric: ecsMetrics.memoryUtilization,
      threshold: 90,
      evaluationPeriods: 2,
      alarmDescription: 'ECS service memory utilization is high',
    });

    // ALB response time alarm (only if ALB is provided)
    if (albMetrics) {
      new cloudwatch.Alarm(this, 'HighResponseTimeAlarm', {
        metric: albMetrics.responseTime,
        threshold: 5, // 5 seconds
        evaluationPeriods: 3,
        alarmDescription: 'ALB response time is high',
      });
    }

    // Lambda error rate alarms
    props.lambdaFunctions.forEach((fn, index) => {
      new cloudwatch.Alarm(this, `LambdaErrorAlarm${index}`, {
        metric: lambdaMetrics.errors[index],
        threshold: 5,
        evaluationPeriods: 2,
        alarmDescription: `Lambda function ${fn.functionName} has high error rate`,
      });
    });
  }
}
