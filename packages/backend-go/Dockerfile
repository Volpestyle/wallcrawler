FROM golang:1.21-bullseye

# Install Chrome dependencies
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    apt-transport-https \
    && wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update \
    && apt-get install -y google-chrome-stable \
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

# Set Chrome to run in sandbox mode
ENV CHROME_BIN=/usr/bin/google-chrome
ENV DISPLAY=:99

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD pgrep controller || exit 1

# Start the controller
CMD ["./controller"] 