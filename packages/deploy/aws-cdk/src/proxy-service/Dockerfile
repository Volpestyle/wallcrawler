FROM oven/bun:1.0.20-alpine

WORKDIR /app

# Copy package files and configuration
COPY package.json ./
COPY bunfig.toml ./
COPY tsconfig.json ./
COPY bun.lockb* ./

# Install dependencies
RUN bun install --production

# Copy application code
COPY index.ts ./
COPY jwe-utils.ts ./
COPY healthcheck.ts ./

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD bun run healthcheck.ts || exit 1

# Run the proxy
CMD ["bun", "run", "index.ts"]