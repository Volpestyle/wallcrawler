import type { ConstructorParams } from "@wallcrawler/stagehand";
import dotenv from "dotenv";

dotenv.config();

/**
 * Stagehand configuration for local development
 * This removes all Browserbase dependencies and focuses on local automation
 */
const StagehandConfig: ConstructorParams = {
  // Always use LOCAL environment - no Browserbase
  env: "LOCAL",
  
  // Verbose logging for demo purposes
  verbose: 2,
  
  // DOM settle timeout
  domSettleTimeoutMs: 30_000,

  // Local browser configuration
  localBrowserLaunchOptions: {
    headless: false,
    viewport: {
      width: 1280,
      height: 720,
    },
    // Additional security and performance options
    args: [
      "--disable-blink-features=AutomationControlled",
      "--disable-web-security",
      "--disable-dev-shm-usage",
    ],
    bypassCSP: true,
    ignoreHTTPSErrors: true,
  },

  // Self-healing capabilities
  selfHeal: true,

  // Enable experimental features if needed
  experimental: false,
};

/**
 * Validate required environment variables for the given model
 */
export function validateModelConfig(modelProvider: string): {
  modelName: string;
  apiKey: string;
} {
  const apiKeyEnvVar = `${modelProvider.toUpperCase()}_API_KEY`;
  const modelEnvVar = `${modelProvider.toUpperCase()}_MODEL`;
  
  const apiKey = process.env[apiKeyEnvVar];
  const modelName = process.env[modelEnvVar];

  if (!apiKey) {
    throw new Error(
      `Missing ${apiKeyEnvVar} environment variable. ` +
      `Please set your ${modelProvider} API key.`
    );
  }

  if (!modelName) {
    throw new Error(
      `Missing ${modelEnvVar} environment variable. ` +
      `Please specify the model name for ${modelProvider}.`
    );
  }

  return { modelName, apiKey };
}

export default StagehandConfig;