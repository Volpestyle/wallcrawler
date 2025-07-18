# WallCrawler Multi-Session Container
# Handles multiple browser contexts with Playwright

FROM mcr.microsoft.com/playwright:v1.40.0-jammy

# Playwright image already includes Chromium, Firefox, and WebKit
# Use Node.js (already included in Playwright image) for better compatibility

# Create app directory
WORKDIR /app

# Copy package files
COPY package.json ./
COPY package-lock.json* ./

# Install dependencies with npm
RUN npm install --production

# Copy application source
COPY src/ ./src/

# Playwright user already exists as 'pwuser'
# No need for Xvfb as Playwright handles headless mode

# Expose port
# 8080: Internal WebSocket and HTTP API
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:8080/health || exit 1

# Run as playwright user
USER pwuser

# Start with Node.js
CMD ["node", "src/index.js"]