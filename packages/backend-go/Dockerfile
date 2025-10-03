# Build stage: compile the Go controller
FROM golang:1.24-bullseye AS builder

WORKDIR /src

# Install dependencies first to leverage Docker layer caching
COPY go.mod go.sum ./
RUN go mod download

# Copy the remaining source files (filtered by .dockerignore)
COPY . .

# Build statically linked controller binary
RUN CGO_ENABLED=0 GOOS=linux go build \
    -trimpath \
    -ldflags "-s -w" \
    -o /out/controller \
    cmd/ecs-controller/main.go

# Runtime stage: minimal image with Chrome/Chromium and the controller binary
FROM debian:bullseye-slim

ENV CHROME_BIN=/usr/bin/google-chrome-stable \
    CHROMIUM_BIN=/usr/bin/chromium \
    DISPLAY=:99

# Install Chrome/Chromium depending on architecture
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        wget \
        gnupg \
        ca-certificates \
        apt-transport-https; \
    arch="$(dpkg --print-architecture)"; \
    if [ "$arch" = "amd64" ]; then \
        wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | apt-key add -; \
        echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list; \
        apt-get update; \
        apt-get install -y --no-install-recommends google-chrome-stable; \
        ln -sf /usr/bin/google-chrome-stable /usr/bin/chromium; \
    else \
        apt-get install -y --no-install-recommends chromium; \
        ln -sf /usr/bin/chromium /usr/bin/google-chrome-stable; \
    fi; \
    apt-get purge -y --auto-remove wget gnupg; \
    apt-get clean; \
    rm -rf /var/lib/apt/lists/*

# Create app directory and copy binary from builder stage
WORKDIR /app
COPY --from=builder /out/controller ./controller

# Create non-root user
RUN groupadd -g 1001 wallcrawler \
    && useradd -r -u 1001 -g wallcrawler wallcrawler \
    && chown -R wallcrawler:wallcrawler /app

USER wallcrawler

EXPOSE 9222

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD pgrep controller || exit 1

CMD ["./controller"]
