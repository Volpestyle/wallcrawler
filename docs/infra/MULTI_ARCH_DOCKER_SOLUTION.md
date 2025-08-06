# Multi-Architecture Docker Solution for WallCrawler

## Overview
This document explains how the Dockerfile has been updated to support both ARM64 (Apple Silicon) and AMD64 architectures, allowing local development on Apple Silicon Macs while maintaining compatibility with AWS ECS deployment.

## Solution Details

### 1. Architecture Detection
The Dockerfile now detects the build architecture at runtime using `dpkg --print-architecture`:
- **AMD64**: Installs Google Chrome Stable
- **ARM64**: Installs Chromium (open-source Chrome equivalent)

### 2. Symlink Strategy
To ensure application compatibility regardless of which browser is installed:
- On AMD64: Creates symlink `/usr/bin/chromium` → `/usr/bin/google-chrome-stable`
- On ARM64: Creates symlink `/usr/bin/google-chrome-stable` → `/usr/bin/chromium`

This allows the application to use either binary name interchangeably.

### 3. Complete Updated Dockerfile
```dockerfile
FROM golang:1.21-bullseye

# Install Chrome/Chromium based on architecture
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    apt-transport-https \
    && if [ "$(dpkg --print-architecture)" = "amd64" ]; then \
        # Install Google Chrome for AMD64
        wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | apt-key add - \
        && echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list \
        && apt-get update \
        && apt-get install -y google-chrome-stable \
        && ln -sf /usr/bin/google-chrome-stable /usr/bin/chromium; \
    else \
        # Install Chromium for ARM64 and other architectures
        apt-get install -y chromium \
        && ln -sf /usr/bin/chromium /usr/bin/google-chrome-stable; \
    fi \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Rest of Dockerfile remains the same...
```

## Multi-Architecture Build with CDK

### 1. Local Development (Apple Silicon)
When you run `cdk deploy` on Apple Silicon:
- Docker builds using your local ARM64 architecture
- Chromium is installed instead of Chrome
- The symlinks ensure the application works correctly

### 2. ECS Deployment (AMD64)
When CDK builds for ECS:
- AWS CodeBuild or ECR builds on AMD64 architecture
- Google Chrome Stable is installed
- The container runs natively on ECS Fargate (AMD64)

### 3. Enabling BuildKit (Already Configured)
Your `cdk.json` already has BuildKit enabled:
```json
"docker": {
    "buildKit": true,
    "cacheFrom": [...]
}
```

### 4. Optional: Explicit Multi-Platform Builds
If you need to build AMD64 images on Apple Silicon for testing:
```bash
# Build for AMD64 explicitly
docker buildx build --platform linux/amd64 -t wallcrawler:amd64 .

# Build for ARM64 explicitly  
docker buildx build --platform linux/arm64 -t wallcrawler:arm64 .

# Build for multiple platforms
docker buildx build --platform linux/amd64,linux/arm64 -t wallcrawler:multi .
```

## Chrome vs Chromium Differences

### Similarities
- Same rendering engine (Blink)
- Same JavaScript engine (V8)
- Same DevTools Protocol for CDP
- Same command-line flags

### Minor Differences
- Chromium lacks some proprietary codecs (H.264, AAC)
- Chromium doesn't include Flash or PDF viewer
- Chromium has different branding/icons
- Chromium may have slightly different default settings

For web scraping and automation purposes, these differences are negligible.

## Deployment Workflow

1. **Local Development**:
   ```bash
   # Builds with your local architecture
   cd packages/aws-cdk
   npm run deploy
   ```

2. **CI/CD Pipeline**:
   - GitHub Actions/CodeBuild runs on AMD64
   - Builds AMD64 image with Chrome
   - Pushes to ECR
   - Deploys to ECS

3. **Testing AMD64 Locally**:
   ```bash
   # Test AMD64 build on Apple Silicon
   docker buildx build --platform linux/amd64 -f packages/backend-go/Dockerfile packages/backend-go
   ```

## Troubleshooting

### Issue: Chrome/Chromium crashes
Add these flags to your Chrome launch:
```
--no-sandbox
--disable-gpu
--disable-dev-shm-usage
--disable-setuid-sandbox
```

### Issue: Different behavior between architectures
- Ensure your code doesn't hardcode Chrome-specific paths
- Use environment variables: `CHROME_BIN` or `CHROMIUM_BIN`
- Test both architectures before deployment

### Issue: Build fails on CI/CD
- Ensure CI/CD environment has Docker BuildKit enabled
- Check that ECR repository exists and has proper permissions
- Verify the base image supports your target architecture

## Best Practices

1. **Use Feature Detection**: Instead of checking for Chrome vs Chromium, detect features
2. **Abstract Browser Path**: Use environment variables for browser executable paths
3. **Test Both Architectures**: Include multi-arch testing in your CI/CD pipeline
4. **Monitor Performance**: Chrome and Chromium may have slight performance differences

## Conclusion

This solution provides seamless development on Apple Silicon while maintaining production compatibility with AWS ECS. The conditional installation and symlink strategy ensure your application works correctly regardless of the underlying architecture.