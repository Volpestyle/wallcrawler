/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@wallcrawler/stagehand', '@wallcrawler/infra-local'],
  experimental: {
    // Handle external packages that use workers or native modules
    serverComponentsExternalPackages: [
      'playwright',
      'playwright-core',
      'thread-stream',
      '@ai-sdk/core',
      '@ai-sdk/anthropic',
      '@ai-sdk/openai',
    ],
    // Enable ESM in server components
    esmExternals: true,
  },
  // Handle worker files and other assets
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Ignore worker files that may cause issues in server builds
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        os: false,
      };
    }
    return config;
  },
};

module.exports = nextConfig;
