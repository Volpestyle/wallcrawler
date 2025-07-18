/**
 * Example: Unified AwsProvider Integration Modes
 * 
 * This example demonstrates both ways to use the unified AwsProvider:
 * 1. Stagehand-First (Recommended) - Let Stagehand handle everything
 * 2. Direct Task Management - Manual control over ECS tasks and CDP connections
 */

import { AwsProvider } from '@wallcrawler/infra-aws';
import { Stagehand } from '@wallcrawler/stagehand';

async function stagehandFirstExample() {
    console.log('🎭 Starting Stagehand-First Example...');

    // Create provider with SSM-based configuration
    const provider = new AwsProvider({
        region: process.env.AWS_REGION || 'us-east-1',
        apiKey: process.env.WALLCRAWLER_API_KEY || 'your-api-key',
        loadFromSsm: true,
        projectName: 'wallcrawler',
        environment: process.env.ENVIRONMENT || 'dev',
    });

    // Initialize provider (loads configuration from SSM)
    await provider.initialize();

    // Create Stagehand - provider handles everything automatically
    const stagehand = new Stagehand({ provider });
    await stagehand.init();

    console.log('🌐 Performing browser automation...');

    // Use Stagehand normally - provider handles:
    // - ECS task creation/management
    // - CDP WebSocket proxying
    // - Redis session state
    // - S3 artifact storage
    await stagehand.page.goto('https://example.com');
    await stagehand.page.act('Click any button on the page');

    const data = await stagehand.page.extract({
        instruction: 'Get the page title and main heading',
        schema: {
            title: 'string',
            heading: 'string',
        },
    });

    console.log('📄 Extracted data:', data);

    // Take screenshot - automatically saved to S3
    const screenshot = await stagehand.page.screenshot();
    console.log('📸 Screenshot taken, size:', screenshot.length, 'bytes');

    // Cleanup - provider handles task termination
    await stagehand.close();
    console.log('✅ Stagehand-First example completed');
}

async function directTaskManagementExample() {
    console.log('⚙️ Starting Direct Task Management Example...');

    // Create provider with manual configuration
    const provider = new AwsProvider({
        region: 'us-east-1',
        apiKey: 'your-api-key',
        ecsClusterName: 'wallcrawler-cluster',
        ecsTaskDefinition: 'wallcrawler-browser-task',
        subnetIds: ['subnet-123', 'subnet-456'],
        securityGroupIds: ['sg-789'],
        redis: {
            endpoint: 'wallcrawler-redis.cache.amazonaws.com',
            port: 6379,
        },
        s3: {
            bucketName: 'wallcrawler-artifacts',
            keyPrefix: 'browser-sessions/',
        },
    });

    await provider.initialize();

    console.log('🚀 Starting ECS task manually...');

    // Manually start an automation task
    const taskInfo = await provider.startAutomationTask({
        sessionId: 'manual-session-123',
        userId: 'user-456',
        environment: 'dev',
        region: 'us-east-1',
        environmentVariables: {
            CUSTOM_VAR: 'custom-value',
        },
    });

    console.log(`📋 Task started: ${taskInfo.taskId}`);

    // Wait for task to be ready and get endpoint
    const endpoint = await provider.getTaskEndpoint(taskInfo.taskId, 120000); // 2 minute timeout
    console.log(`🔗 Task endpoint: ${endpoint}`);

    // Create session and connect to browser
    const session = await provider.createSession({
        userMetadata: {
            userId: 'user-456',
            taskId: taskInfo.taskId,
        },
    });

    console.log(`📱 Session created: ${session.sessionId}`);

    // Connect to browser via CDP proxy
    const { browser } = await provider.connectToBrowser(session);
    console.log('🔌 Connected to browser via CDP proxy');

    // Use browser directly (lower-level than Stagehand)
    const page = await browser.newPage();
    await page.goto('https://example.com');
    console.log('🌐 Navigated to example.com');

    // Save screenshot as artifact
    const screenshotBuffer = await page.screenshot();
    const artifact = await provider.saveArtifact(
        session.sessionId,
        'manual-screenshot.png',
        screenshotBuffer
    );
    console.log(`📸 Screenshot saved as artifact: ${artifact.id}`);

    // List all artifacts for this session
    const artifacts = await provider.getArtifacts(session.sessionId);
    console.log(`📁 Total artifacts: ${artifacts.artifacts.length}`);

    // Cleanup
    await browser.close();
    await provider.endSession(session.sessionId);
    console.log('✅ Direct Task Management example completed');
}

async function main() {
    console.log('🚀 WallCrawler Unified Provider Examples');
    console.log('=========================================');

    try {
        // Example 1: Stagehand-First (Recommended)
        await stagehandFirstExample();

        console.log('\n' + '='.repeat(50) + '\n');

        // Example 2: Direct Task Management
        await directTaskManagementExample();

    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

// Run examples if this file is executed directly
if (require.main === module) {
    main().catch(console.error);
}

export { stagehandFirstExample, directTaskManagementExample }; 