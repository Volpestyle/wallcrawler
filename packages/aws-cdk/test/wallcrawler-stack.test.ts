import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { WallcrawlerStack } from '../src/lib/wallcrawler-stack';

describe('WallcrawlerStack', () => {
    test('creates API Gateway', () => {
        const app = new cdk.App();
        const stack = new WallcrawlerStack(app, 'TestWallcrawlerStack');
        const template = Template.fromStack(stack);

        // Verify API Gateway is created
        template.hasResourceProperties('AWS::ApiGateway::RestApi', {
            Name: 'Wallcrawler API',
        });
    });

    test('creates Lambda functions', () => {
        const app = new cdk.App();
        const stack = new WallcrawlerStack(app, 'TestWallcrawlerStack');
        const template = Template.fromStack(stack);

        // Verify Lambda functions are created
        template.resourceCountIs('AWS::Lambda::Function', 11); // 11 lambda functions
    });

    test('creates ECS cluster', () => {
        const app = new cdk.App();
        const stack = new WallcrawlerStack(app, 'TestWallcrawlerStack');
        const template = Template.fromStack(stack);

        // Verify ECS cluster is created
        template.hasResourceProperties('AWS::ECS::Cluster', {
            ClusterName: 'wallcrawler-browsers',
        });
    });

    test('creates Redis cluster', () => {
        const app = new cdk.App();
        const stack = new WallcrawlerStack(app, 'TestWallcrawlerStack');
        const template = Template.fromStack(stack);

        // Verify Redis cluster is created
        template.hasResourceProperties('AWS::ElastiCache::CacheCluster', {
            Engine: 'redis',
        });
    });

    test('creates VPC with correct configuration', () => {
        const app = new cdk.App();
        const stack = new WallcrawlerStack(app, 'TestWallcrawlerStack');
        const template = Template.fromStack(stack);

        // Verify VPC is created
        template.hasResourceProperties('AWS::EC2::VPC', {
            EnableDnsHostnames: true,
            EnableDnsSupport: true,
        });
    });

    test('creates security groups with correct rules', () => {
        const app = new cdk.App();
        const stack = new WallcrawlerStack(app, 'TestWallcrawlerStack');
        const template = Template.fromStack(stack);

        // Verify security groups are created
        template.resourceCountIs('AWS::EC2::SecurityGroup', 3); // Lambda, ECS, Redis
    });

    test('creates WebSocket API', () => {
        const app = new cdk.App();
        const stack = new WallcrawlerStack(app, 'TestWallcrawlerStack');
        const template = Template.fromStack(stack);

        // Verify WebSocket API is created
        template.hasResourceProperties('AWS::ApiGatewayV2::Api', {
            Name: 'Wallcrawler WebSocket API',
            ProtocolType: 'WEBSOCKET',
        });
    });

    test('creates WAF protection', () => {
        const app = new cdk.App();
        const stack = new WallcrawlerStack(app, 'TestWallcrawlerStack');
        const template = Template.fromStack(stack);

        // Verify WAF is created
        template.hasResourceProperties('AWS::WAFv2::WebACL', {
            Scope: 'REGIONAL',
        });
    });

    test('outputs required values', () => {
        const app = new cdk.App();
        const stack = new WallcrawlerStack(app, 'TestWallcrawlerStack');
        const template = Template.fromStack(stack);

        // Verify outputs are defined
        template.hasOutput('APIGatewayURL', {});
        template.hasOutput('WebSocketAPIURL', {});
        template.hasOutput('ApiKeyId', {});
        template.hasOutput('RedisEndpoint', {});
        template.hasOutput('ECSClusterName', {});
        template.hasOutput('VPCId', {});
    });
}); 