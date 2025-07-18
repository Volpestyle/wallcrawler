/**
 * Example: Using AwsProvider with SSM-based configuration
 * 
 * This example shows how to use the AwsProvider with automatic configuration
 * loading from AWS Systems Manager Parameter Store. This is the recommended
 * approach when using the @wallcrawler/deploy/aws-cdk package.
 */

import { AwsProvider } from '@wallcrawler/infra-aws';
import { Stagehand } from '@wallcrawler/stagehand';

async function main() {
    console.log('🚀 Starting WallCrawler with SSM-based configuration...');

    try {
        // Create provider with minimal configuration
        // All infrastructure details will be loaded from SSM Parameter Store
        const provider = new AwsProvider({
            region: process.env.AWS_REGION || 'us-east-1',
            apiKey: process.env.WALLCRAWLER_API_KEY || 'your-api-key',
            loadFromSsm: true,
            projectName: 'wallcrawler', // optional, defaults to 'wallcrawler'
            environment: process.env.ENVIRONMENT || 'dev', // optional, defaults to 'dev'
        });

        console.log('⚙️ Initializing provider (loading configuration from SSM)...');
        await provider.initialize();
        console.log('✅ Provider initialized successfully!');

        // Create Stagehand instance with the provider
        const stagehand = new Stagehand({ provider });
        console.log('🎭 Initializing Stagehand...');
        await stagehand.init();
        console.log('✅ Stagehand initialized successfully!');

        // Example browser automation via Stagehand
        console.log('🌐 Performing browser automation...');
        await stagehand.page.goto('https://example.com');
        console.log('📄 Navigated to example.com');

        // Extract page title using AI
        const pageData = await stagehand.page.extract({
            instruction: 'Get the page title and main heading',
            schema: {
                title: 'string',
                heading: 'string',
            },
        });

        console.log('📊 Extracted data:', pageData);

        // Take a screenshot
        const screenshot = await stagehand.page.screenshot();
        console.log('📸 Screenshot taken, size:', screenshot.length, 'bytes');

        // Cleanup
        console.log('🧹 Cleaning up...');
        await stagehand.close();
        console.log('✅ Cleanup completed');

    } catch (error) {
        console.error('❌ Error:', error);

        if (error instanceof Error) {
            if (error.message.includes('API key is required')) {
                console.error('💡 Tip: Set WALLCRAWLER_API_KEY environment variable or provide apiKey in config');
                console.error('💡 Example: export WALLCRAWLER_API_KEY=your-api-key');
            } else if (error.message.includes('Redis endpoint is required')) {
                console.error('💡 Tip: Ensure your CDK infrastructure is deployed and SSM parameters are available');
                console.error('💡 Run: cd packages/deploy/aws-cdk && ./deploy.sh');
            } else if (error.message.includes('must be initialized')) {
                console.error('💡 Tip: Make sure to call provider.initialize() before using provider methods');
            } else if (error.message.includes('Access Denied') || error.message.includes('UnauthorizedOperation')) {
                console.error('💡 Tip: Ensure your AWS credentials have the required SSM permissions');
                console.error('💡 Required: ssm:GetParametersByPath for /wallcrawler/* resources');
            }
        }

        process.exit(1);
    }
}

// Example with error handling and graceful shutdown
if (require.main === module) {
    main().catch(error => {
        console.error('Unhandled error:', error);
        process.exit(1);
    });

    // Graceful shutdown
    process.on('SIGINT', () => {
        console.log('\n⚠️ Received SIGINT, shutting down gracefully...');
        process.exit(0);
    });

    process.on('SIGTERM', () => {
        console.log('\n⚠️ Received SIGTERM, shutting down gracefully...');
        process.exit(0);
    });
} 