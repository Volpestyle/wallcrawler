import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import type * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';
import * as path from 'path';

export interface GoLambdaFunctionProps {
    functionName: string;
    description: string;
    sourceDir: string; // Path to the Go function directory
    handler?: string; // Optional custom handler name
    timeout?: cdk.Duration;
    memorySize?: number;
    environment?: { [key: string]: string };
    vpc?: ec2.IVpc;
    vpcSubnets?: ec2.SubnetSelection;
    securityGroups?: ec2.ISecurityGroup[];
    initialPolicy?: iam.PolicyStatement[];
}

export interface GoLambdaConstructProps {
    projectName: string;
    environment: string;
    vpc?: ec2.IVpc;
    lambdaSecurityGroup?: ec2.ISecurityGroup;
    commonEnvironment?: { [key: string]: string };
}

/**
 * Construct for deploying Go Lambda functions
 * Handles building Go binaries and packaging them for Lambda deployment
 */
export class GoLambdaConstruct extends Construct {
    public readonly functions: Map<string, lambda.Function> = new Map();
    private readonly props: GoLambdaConstructProps;

    constructor(scope: Construct, id: string, props: GoLambdaConstructProps) {
        super(scope, id);
        this.props = props;
    }

    /**
     * Create a Go Lambda function
     */
    public createFunction(functionProps: GoLambdaFunctionProps): lambda.Function {
        const { functionName, sourceDir, handler = 'bootstrap', timeout, memorySize, environment = {}, vpc, vpcSubnets, securityGroups, initialPolicy = [] } = functionProps;

        // Merge common environment with function-specific environment
        const mergedEnvironment = {
            ...this.props.commonEnvironment,
            ...environment,
        };

        // Create the Lambda function
        const lambdaFunction = new lambda.Function(this, `${functionName}Function`, {
            runtime: lambda.Runtime.PROVIDED_AL2023, // Custom runtime for Go
            handler, // Go functions use 'bootstrap' as the handler
            code: lambda.Code.fromAsset(sourceDir, {
                bundling: {
                    image: lambda.Runtime.PROVIDED_AL2023.bundlingImage,
                    user: 'root',
                    command: [
                        'bash', '-c',
                        [
                            'cd /asset-input',
                            'export GOOS=linux',
                            'export GOARCH=amd64',
                            'export CGO_ENABLED=0',
                            'go build -ldflags="-s -w" -o bootstrap main.go',
                            'cp bootstrap /asset-output/',
                        ].join(' && '),
                    ],
                },
            }),
            functionName: `${this.props.projectName}-${functionName}-${this.props.environment}`,
            description: functionProps.description,
            timeout: timeout || cdk.Duration.seconds(30),
            memorySize: memorySize || 256,
            environment: mergedEnvironment,
            vpc: vpc || this.props.vpc,
            vpcSubnets: vpcSubnets || (this.props.vpc ? { subnets: this.props.vpc.privateSubnets } : undefined),
            securityGroups: securityGroups || (this.props.lambdaSecurityGroup ? [this.props.lambdaSecurityGroup] : undefined),
            architecture: lambda.Architecture.X86_64,
            tracing: lambda.Tracing.ACTIVE, // Enable X-Ray tracing
        });

        // Add initial policies
        initialPolicy.forEach(policy => {
            lambdaFunction.addToRolePolicy(policy);
        });

        // Store the function
        this.functions.set(functionName, lambdaFunction);

        return lambdaFunction;
    }

    /**
     * Create the create-session Go Lambda function
     */
    public createCreateSessionFunction(): lambda.Function {
        const sourceDir = path.join(__dirname, '../../lambda/cmd/create-session');

        return this.createFunction({
            functionName: 'create-session-go',
            description: 'Go-based session creation Lambda function',
            sourceDir,
            timeout: cdk.Duration.seconds(30),
            memorySize: 256,
            initialPolicy: [
                new iam.PolicyStatement({
                    actions: [
                        'ecs:RunTask',
                        'ecs:DescribeServices',
                        'ecs:DescribeTasks',
                    ],
                    resources: ['*'],
                }),
                new iam.PolicyStatement({
                    actions: ['iam:PassRole'],
                    resources: ['*'],
                    conditions: {
                        StringEquals: {
                            'iam:PassedToService': 'ecs-tasks.amazonaws.com',
                        },
                    },
                }),
            ],
        });
    }

    /**
     * Create the websocket-connect Go Lambda function
     */
    public createWebSocketConnectFunction(): lambda.Function {
        const sourceDir = path.join(__dirname, '../../lambda/cmd/websocket-connect');

        return this.createFunction({
            functionName: 'websocket-connect-go',
            description: 'Go-based WebSocket connect Lambda function',
            sourceDir,
            timeout: cdk.Duration.seconds(30),
            memorySize: 256,
        });
    }

    /**
     * Create the websocket-message Go Lambda function
     */
    public createWebSocketMessageFunction(): lambda.Function {
        const sourceDir = path.join(__dirname, '../../lambda/cmd/websocket-message');

        return this.createFunction({
            functionName: 'websocket-message-go',
            description: 'Go-based WebSocket message Lambda function',
            sourceDir,
            timeout: cdk.Duration.minutes(1),
            memorySize: 512,
            initialPolicy: [
                new iam.PolicyStatement({
                    actions: [
                        'ecs:RunTask',
                        'ecs:DescribeTasks',
                    ],
                    resources: ['*'],
                }),
                new iam.PolicyStatement({
                    actions: ['iam:PassRole'],
                    resources: ['*'],
                    conditions: {
                        StringEquals: {
                            'iam:PassedToService': 'ecs-tasks.amazonaws.com',
                        },
                    },
                }),
            ],
        });
    }

    /**
     * Create the websocket-disconnect Go Lambda function
     */
    public createWebSocketDisconnectFunction(): lambda.Function {
        const sourceDir = path.join(__dirname, '../../lambda/cmd/websocket-disconnect');

        return this.createFunction({
            functionName: 'websocket-disconnect-go',
            description: 'Go-based WebSocket disconnect Lambda function',
            sourceDir,
            timeout: cdk.Duration.seconds(30),
            memorySize: 256,
            initialPolicy: [
                new iam.PolicyStatement({
                    actions: [
                        'ecs:DescribeTasks',
                        'ecs:ListTasks',
                        'ecs:StopTask',
                    ],
                    resources: ['*'],
                }),
            ],
        });
    }

    /**
     * Create the get-session Go Lambda function
     */
    public createGetSessionFunction(): lambda.Function {
        const sourceDir = path.join(__dirname, '../../lambda/cmd/get-session');

        return this.createFunction({
            functionName: 'get-session-go',
            description: 'Go-based session retrieval Lambda function',
            sourceDir,
            timeout: cdk.Duration.seconds(10),
            memorySize: 128,
        });
    }

    /**
     * Create the sessions-start Go Lambda function (Stagehand compatibility)
     */
    public createSessionsStartFunction(): lambda.Function {
        const sourceDir = path.join(__dirname, '../../lambda/cmd/sessions-start');

        return this.createFunction({
            functionName: 'sessions-start-go',
            description: 'Go-based Stagehand-compatible session start Lambda function',
            sourceDir,
            timeout: cdk.Duration.seconds(30),
            memorySize: 256,
            initialPolicy: [
                new iam.PolicyStatement({
                    actions: [
                        'ecs:RunTask',
                        'ecs:DescribeServices',
                        'ecs:DescribeTasks',
                    ],
                    resources: ['*'],
                }),
                new iam.PolicyStatement({
                    actions: ['iam:PassRole'],
                    resources: ['*'],
                    conditions: {
                        StringEquals: {
                            'iam:PassedToService': 'ecs-tasks.amazonaws.com',
                        },
                    },
                }),
            ],
        });
    }

    /**
     * Create the session-act Go Lambda function
     */
    public createSessionActFunction(): lambda.Function {
        const sourceDir = path.join(__dirname, '../../lambda/cmd/session-act');

        return this.createFunction({
            functionName: 'session-act-go',
            description: 'Go-based session act Lambda function',
            sourceDir,
            timeout: cdk.Duration.minutes(2),
            memorySize: 512,
            initialPolicy: [
                new iam.PolicyStatement({
                    actions: [
                        'ecs:RunTask',
                        'ecs:DescribeTasks',
                    ],
                    resources: ['*'],
                }),
                new iam.PolicyStatement({
                    actions: ['iam:PassRole'],
                    resources: ['*'],
                    conditions: {
                        StringEquals: {
                            'iam:PassedToService': 'ecs-tasks.amazonaws.com',
                        },
                    },
                }),
            ],
        });
    }

    /**
     * Create the session-extract Go Lambda function
     */
    public createSessionExtractFunction(): lambda.Function {
        const sourceDir = path.join(__dirname, '../../lambda/cmd/session-extract');

        return this.createFunction({
            functionName: 'session-extract-go',
            description: 'Go-based session extract Lambda function',
            sourceDir,
            timeout: cdk.Duration.minutes(2),
            memorySize: 512,
            initialPolicy: [
                new iam.PolicyStatement({
                    actions: [
                        'ecs:RunTask',
                        'ecs:DescribeTasks',
                    ],
                    resources: ['*'],
                }),
                new iam.PolicyStatement({
                    actions: ['iam:PassRole'],
                    resources: ['*'],
                    conditions: {
                        StringEquals: {
                            'iam:PassedToService': 'ecs-tasks.amazonaws.com',
                        },
                    },
                }),
            ],
        });
    }

    /**
     * Create the session-observe Go Lambda function
     */
    public createSessionObserveFunction(): lambda.Function {
        const sourceDir = path.join(__dirname, '../../lambda/cmd/session-observe');

        return this.createFunction({
            functionName: 'session-observe-go',
            description: 'Go-based session observe Lambda function',
            sourceDir,
            timeout: cdk.Duration.minutes(2),
            memorySize: 512,
            initialPolicy: [
                new iam.PolicyStatement({
                    actions: [
                        'ecs:RunTask',
                        'ecs:DescribeTasks',
                    ],
                    resources: ['*'],
                }),
                new iam.PolicyStatement({
                    actions: ['iam:PassRole'],
                    resources: ['*'],
                    conditions: {
                        StringEquals: {
                            'iam:PassedToService': 'ecs-tasks.amazonaws.com',
                        },
                    },
                }),
            ],
        });
    }

    /**
     * Create the session-end Go Lambda function
     */
    public createSessionEndFunction(): lambda.Function {
        const sourceDir = path.join(__dirname, '../../lambda/cmd/session-end');

        return this.createFunction({
            functionName: 'session-end-go',
            description: 'Go-based session end Lambda function',
            sourceDir,
            timeout: cdk.Duration.seconds(30),
            memorySize: 256,
            initialPolicy: [
                new iam.PolicyStatement({
                    actions: [
                        'ecs:DescribeTasks',
                        'ecs:ListTasks',
                        'ecs:StopTask',
                    ],
                    resources: ['*'],
                }),
            ],
        });
    }

    /**
     * Create the cleanup-sessions Go Lambda function
     */
    public createCleanupSessionsFunction(): lambda.Function {
        const sourceDir = path.join(__dirname, '../../lambda/cmd/cleanup-sessions');

        return this.createFunction({
            functionName: 'cleanup-sessions-go',
            description: 'Go-based session cleanup Lambda function',
            sourceDir,
            timeout: cdk.Duration.minutes(5),
            memorySize: 256,
            initialPolicy: [
                new iam.PolicyStatement({
                    actions: [
                        'ecs:DescribeTasks',
                        'ecs:ListTasks',
                        'ecs:StopTask',
                    ],
                    resources: ['*'],
                }),
            ],
        });
    }

    /**
     * Grant API Gateway management permissions to WebSocket functions
     */
    public grantApiGatewayManagement(apiArn: string, ...functionNames: string[]): void {
        const policy = new iam.PolicyStatement({
            actions: ['execute-api:ManageConnections'],
            resources: [apiArn],
        });

        functionNames.forEach(functionName => {
            const func = this.functions.get(functionName);
            if (func) {
                func.addToRolePolicy(policy);
            }
        });
    }

    /**
     * Grant secrets manager access to functions
     */
    public grantSecretsAccess(secret: cdk.aws_secretsmanager.ISecret, ...functionNames: string[]): void {
        functionNames.forEach(functionName => {
            const func = this.functions.get(functionName);
            if (func) {
                secret.grantRead(func);
            }
        });
    }

    /**
     * Get all Lambda functions as an array
     */
    public getAllFunctions(): lambda.Function[] {
        return Array.from(this.functions.values());
    }

    /**
 * Get a specific function by name
 */
    public getFunction(name: string): lambda.Function | undefined {
        return this.functions.get(name);
    }
} 