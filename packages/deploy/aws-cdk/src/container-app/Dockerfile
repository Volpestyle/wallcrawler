# WallCrawler Multi-Session Container
# Handles multiple browser contexts with Playwright

FROM mcr.microsoft.com/playwright:v1.40.0-jammy

# Playwright image already includes Chromium, Firefox, and WebKit
# Just need to add Bun runtime

# Install specific Bun version
RUN curl -fsSL https://bun.sh/install | bash -s -- bun-v1.0.20
ENV PATH="/root/.bun/bin:${PATH}"

# Create app directory
WORKDIR /app

# Copy package files
COPY package.json ./
COPY bunfig.toml ./
COPY bun.lockb* ./

# Install dependencies with Bun
RUN bun install --production

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

# Start with Bun
CMD ["bun", "run", "src/index.ts"]