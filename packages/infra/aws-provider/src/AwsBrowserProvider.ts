/**
 * AWS Browser Provider for Stagehand
 * Implements Stagehand's BrowserProvider interface to integrate with Stagehand's browser automation
 * Bridges the gap between Stagehand and AWS infrastructure
 */

import { chromium } from 'playwright';
import { SSMClient, GetParametersByPathCommand, type GetParametersByPathCommandOutput } from '@aws-sdk/client-ssm';
import type { BrowserProvider, GetBrowserOptions } from '@wallcrawler/stagehand/types/browserProvider';
import type { BrowserResult } from '@wallcrawler/stagehand/types/browser';
import type { AwsProviderConfig } from './types';
import type { SessionDetails } from '@wallcrawler/utils/types';
import type { SessionCreateParams } from "@browserbasehq/sdk/resources/index";

/**
 * AWS Browser Provider for Stagehand
 * Provides serverless browser automation via AWS infrastructure
 * Acts as a bridge between Stagehand's expectations and your AWS backend
 */
export class AwsBrowserProvider implements BrowserProvider {
    public readonly type = 'aws' as const;

    private config: AwsProviderConfig;
    private isInitialized = false;
    private apiEndpoint!: string;

    constructor(config: AwsProviderConfig) {
        this.config = config;
    }

    /**
     * Initialize the provider (loads config from SSM if requested)
     */
    async initialize(): Promise<void> {
        if (this.isInitialized) {
            return;
        }

        // Load configuration from SSM if requested
        if (this.config.loadFromSsm) {
            await this.loadConfigFromSsm();
        }

        // Validate required configuration
        this.validateConfig();

        // Set API endpoint for Lambda calls
        this.apiEndpoint = this.config.apiEndpoint ||
            `https://${this.config.apiId}.execute-api.${this.config.region}.amazonaws.com/${this.config.environment || 'dev'}`;

        this.isInitialized = true;
        console.log(`[AwsBrowserProvider] Initialized AWS provider in region ${this.config.region}`);
    }

    /**
     * Get the API endpoint that Stagehand should use
     * This allows Stagehand to call your AWS infrastructure instead of Browserbase
     */
    getApiEndpoint(): string {
        this.ensureInitialized();
        return this.apiEndpoint;
    }

    /**
     * Get API configuration for Stagehand
     * Returns the configuration that Stagehand needs to use your AWS API
     */
    getStagehandConfig(): { baseApiUrl: string; apiKey: string; projectId?: string } {
        this.ensureInitialized();
        return {
            baseApiUrl: this.apiEndpoint,
            apiKey: this.config.apiKey,
            projectId: this.config.projectName || 'wallcrawler',
        };
    }

    /**
     * Get a browser connection via AWS infrastructure
     * This is the main method that Stagehand calls to get a browser
     */
    async getBrowser(options: GetBrowserOptions): Promise<BrowserResult> {
        this.ensureInitialized();

        const { logger, sessionId, sessionCreateParams } = options;

        try {
            let sessionDetails: SessionDetails;

            if (sessionId) {
                // Resume existing session - call get-session Lambda
                logger({
                    category: 'init',
                    message: 'resuming AWS browser session',
                    level: 1,
                    auxiliary: {
                        sessionId: {
                            value: sessionId,
                            type: 'string',
                        },
                    },
                });
                sessionDetails = await this.getSession(sessionId);
            } else if (sessionCreateParams) {
                // Create new session - call create-session Lambda
                logger({
                    category: 'init',
                    message: 'creating AWS browser session',
                    level: 1,
                });
                sessionDetails = await this.createSession(sessionCreateParams);
            } else {
                throw new Error('No session ID or session create params provided');
            }

            // Extract connection info from session details
            // The Lambda should have stored CDP connection details in browserSettings
            const cdpUrl = this.extractCdpUrl(sessionDetails);
            const debugUrl = this.extractDebugUrl(sessionDetails);
            const sessionUrl = this.buildSessionUrl(sessionDetails);

            logger({
                category: 'init',
                message: 'connecting to AWS browser via CDP',
                level: 1,
                auxiliary: {
                    cdpUrl: {
                        value: cdpUrl.replace(/token=[^&]+/, 'token=***'),
                        type: 'string',
                    },
                },
            });

            // Connect to the browser using CDP
            const browser = await chromium.connectOverCDP(cdpUrl);
            const context = browser.contexts()[0];

            logger({
                category: 'init',
                message: 'AWS browser session established',
                auxiliary: {
                    sessionId: {
                        value: sessionDetails.id,
                        type: 'string',
                    },
                },
            });

            // Transform SessionDetails into BrowserResult that Stagehand expects
            return {
                browser,
                context,
                sessionId: sessionDetails.id,
                env: 'LOCAL', // AWS provider appears as LOCAL to Stagehand for compatibility
                debugUrl: debugUrl,
                sessionUrl: sessionUrl,
                contextPath: undefined, // Not applicable for remote browsers
            };
        } catch (error) {
            logger({
                category: 'init',
                message: 'failed to get AWS browser',
                level: 0,
                auxiliary: {
                    error: {
                        value: (error as Error).message,
                        type: 'string',
                    },
                },
            });
            throw error;
        }
    }

    /**
     * Create a new browser session via AWS API
     * Calls the create-session Lambda function
     */
    private async createSession(sessionCreateParams: SessionCreateParams): Promise<SessionDetails> {
        const response = await fetch(`${this.apiEndpoint}/sessions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.config.apiKey}`,
            },
            body: JSON.stringify({
                browserSettings: sessionCreateParams,
                timeout: 60, // Default 60 minutes
            }),
        });

        if (!response.ok) {
            throw new Error(`Failed to create AWS browser session: ${response.status} ${response.statusText}`);
        }

        const sessionDetails: SessionDetails = await response.json();
        return sessionDetails;
    }

    /**
     * Get existing session details via AWS API
     * Calls the get-session Lambda function
     */
    private async getSession(sessionId: string): Promise<SessionDetails> {
        const response = await fetch(`${this.apiEndpoint}/sessions/${sessionId}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${this.config.apiKey}`,
            },
        });

        if (!response.ok) {
            throw new Error(`Failed to get AWS browser session: ${response.status} ${response.statusText}`);
        }

        const sessionDetails: SessionDetails = await response.json();
        return sessionDetails;
    }

    /**
     * Extract CDP connection URL from session details
     */
    private extractCdpUrl(sessionDetails: SessionDetails): string {
        const browserSettings = sessionDetails.browserSettings as { cdpUrl?: string; token?: string };
        let cdpUrl = browserSettings.cdpUrl;

        if (!cdpUrl) {
            throw new Error('CDP URL not found in session details');
        }

        // Add authentication token if not already included
        if (!cdpUrl.includes('token=') && browserSettings.token) {
            cdpUrl += `${cdpUrl.includes('?') ? '&' : '?'}token=${browserSettings.token}`;
        }

        return cdpUrl;
    }

    /**
     * Extract debug URL from session details
     */
    private extractDebugUrl(sessionDetails: SessionDetails): string | undefined {
        const browserSettings = sessionDetails.browserSettings as { debugUrl?: string };
        return browserSettings.debugUrl;
    }

    /**
     * Build session management URL from session details
     */
    private buildSessionUrl(sessionDetails: SessionDetails): string | undefined {
        if (sessionDetails.taskArn) {
            // Extract region and task ID from ARN
            const arnParts = sessionDetails.taskArn.split(':');
            const region = arnParts[3];
            const taskId = arnParts[5]?.split('/').pop();

            return `https://console.aws.amazon.com/ecs/home?region=${region}#/clusters/wallcrawler-cluster/tasks/${taskId}`;
        }
        return undefined;
    }

    /**
     * Clean up resources
     */
    async close(): Promise<void> {
        // AWS provider cleanup is handled by the serverless infrastructure
        // No persistent connections to clean up on client side
        console.log('[AwsBrowserProvider] Cleanup completed');
    }

    /**
     * Load configuration from AWS Systems Manager Parameter Store
     */
    private async loadConfigFromSsm(): Promise<void> {
        const region = this.config.region || 'us-east-1';
        const ssmClient = new SSMClient({ region });
        const projectName = this.config.projectName || 'wallcrawler';
        const environment = this.config.environment || 'dev';
        const path = `/${projectName}/${environment}/`;

        console.log(`[AwsBrowserProvider] Loading configuration from SSM path: ${path}`);

        let nextToken: string | undefined;
        do {
            const command = new GetParametersByPathCommand({
                Path: path,
                WithDecryption: true,
                NextToken: nextToken,
            });
            const response: GetParametersByPathCommandOutput = await ssmClient.send(command);

            response.Parameters?.forEach((param: { Name?: string; Value?: string }) => {
                const name = param.Name?.replace(path, '') || '';
                const value = param.Value || '';

                switch (name) {
                    case 'rest-api-endpoint':
                        this.config.apiEndpoint = value;
                        break;
                    case 'websocket-api-endpoint':
                        this.config.websocketEndpoint = value;
                        break;
                    default:
                        // Store other parameters for potential future use
                        break;
                }
            });

            nextToken = response.NextToken;
        } while (nextToken);

        console.log(`[AwsBrowserProvider] Loaded configuration from SSM successfully`);
    }

    /**
     * Validate that all required configuration is present
     */
    private validateConfig(): void {
        if (!this.config.apiKey) {
            throw new Error('API key is required for authentication. Provide it in config.');
        }
        if (!this.config.loadFromSsm && !this.config.apiEndpoint && !this.config.apiId) {
            throw new Error('API endpoint or API Gateway ID is required. Either provide it in config or enable loadFromSsm.');
        }
    }

    /**
     * Ensure the provider is initialized before using
     */
    private ensureInitialized(): void {
        if (!this.isInitialized) {
            throw new Error('AwsBrowserProvider must be initialized before use. Call initialize() first.');
        }
    }
} 