FROM golang:1.24-bullseye

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

# Set working directory
WORKDIR /app

# Copy go mod files
COPY go.mod go.sum ./

# Download dependencies
RUN go mod download

# Copy source code
COPY . .

# Build the controller
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o controller cmd/ecs-controller/main.go

# Create non-root user for security
RUN groupadd -g 1001 wallcrawler \
    && useradd -r -u 1001 -g wallcrawler wallcrawler \
    && chown -R wallcrawler:wallcrawler /app

# Switch to non-root user
USER wallcrawler

# Expose port if needed (optional for debugging)
EXPOSE 9222

# Set Chrome/Chromium environment variables
# The symlinks created above ensure compatibility regardless of which browser is installed
ENV CHROME_BIN=/usr/bin/google-chrome-stable
ENV CHROMIUM_BIN=/usr/bin/chromium
ENV DISPLAY=:99

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD pgrep controller || exit 1

# Start the controller
CMD ["./controller"] 