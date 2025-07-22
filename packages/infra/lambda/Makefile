# Lambda Functions Build System
# This Makefile demonstrates the single module approach

# Configuration
GOOS := linux
GOARCH := amd64
CGO_ENABLED := 0
BUILD_FLAGS := -ldflags="-s -w" -trimpath

# Directories
DIST_DIR := dist
CMD_DIR := cmd

# Functions to build
FUNCTIONS := create-session websocket-connect websocket-message websocket-disconnect get-session sessions-start session-act session-extract session-observe session-end cleanup-sessions

# Default target
.PHONY: all
all: clean build-all

# Clean build artifacts
.PHONY: clean
clean:
	rm -rf $(DIST_DIR)
	rm -f */bootstrap

# Setup directories
.PHONY: setup-dirs
setup-dirs:
	mkdir -p $(DIST_DIR)
	$(foreach func,$(FUNCTIONS),mkdir -p $(DIST_DIR)/$(func);)

# Build individual functions
.PHONY: build-create-session
build-create-session: setup-dirs
	@echo "Building create-session..."
	cd $(CMD_DIR)/create-session && \
	GOOS=$(GOOS) GOARCH=$(GOARCH) CGO_ENABLED=$(CGO_ENABLED) \
	go build $(BUILD_FLAGS) -o ../../$(DIST_DIR)/create-session/bootstrap .

.PHONY: build-websocket-connect
build-websocket-connect: setup-dirs
	@echo "Building websocket-connect..."
	cd $(CMD_DIR)/websocket-connect && \
	GOOS=$(GOOS) GOARCH=$(GOARCH) CGO_ENABLED=$(CGO_ENABLED) \
	go build $(BUILD_FLAGS) -o ../../$(DIST_DIR)/websocket-connect/bootstrap .

.PHONY: build-websocket-message
build-websocket-message: setup-dirs
	@echo "Building websocket-message..."
	cd $(CMD_DIR)/websocket-message && \
	GOOS=$(GOOS) GOARCH=$(GOARCH) CGO_ENABLED=$(CGO_ENABLED) \
	go build $(BUILD_FLAGS) -o ../../$(DIST_DIR)/websocket-message/bootstrap .

.PHONY: build-websocket-disconnect
build-websocket-disconnect: setup-dirs
	@echo "Building websocket-disconnect..."
	cd $(CMD_DIR)/websocket-disconnect && \
	GOOS=$(GOOS) GOARCH=$(GOARCH) CGO_ENABLED=$(CGO_ENABLED) \
	go build $(BUILD_FLAGS) -o ../../$(DIST_DIR)/websocket-disconnect/bootstrap .

.PHONY: build-get-session
build-get-session: setup-dirs
	@echo "Building get-session..."
	cd $(CMD_DIR)/get-session && \
	GOOS=$(GOOS) GOARCH=$(GOARCH) CGO_ENABLED=$(CGO_ENABLED) \
	go build $(BUILD_FLAGS) -o ../../$(DIST_DIR)/get-session/bootstrap .

.PHONY: build-sessions-start
build-sessions-start: setup-dirs
	@echo "Building sessions-start..."
	cd $(CMD_DIR)/sessions-start && \
	GOOS=$(GOOS) GOARCH=$(GOARCH) CGO_ENABLED=$(CGO_ENABLED) \
	go build $(BUILD_FLAGS) -o ../../$(DIST_DIR)/sessions-start/bootstrap .

.PHONY: build-session-act
build-session-act: setup-dirs
	@echo "Building session-act..."
	cd $(CMD_DIR)/session-act && \
	GOOS=$(GOOS) GOARCH=$(GOARCH) CGO_ENABLED=$(CGO_ENABLED) \
	go build $(BUILD_FLAGS) -o ../../$(DIST_DIR)/session-act/bootstrap .

.PHONY: build-session-extract
build-session-extract: setup-dirs
	@echo "Building session-extract..."
	cd $(CMD_DIR)/session-extract && \
	GOOS=$(GOOS) GOARCH=$(GOARCH) CGO_ENABLED=$(CGO_ENABLED) \
	go build $(BUILD_FLAGS) -o ../../$(DIST_DIR)/session-extract/bootstrap .

.PHONY: build-session-observe
build-session-observe: setup-dirs
	@echo "Building session-observe..."
	cd $(CMD_DIR)/session-observe && \
	GOOS=$(GOOS) GOARCH=$(GOARCH) CGO_ENABLED=$(CGO_ENABLED) \
	go build $(BUILD_FLAGS) -o ../../$(DIST_DIR)/session-observe/bootstrap .

.PHONY: build-session-end
build-session-end: setup-dirs
	@echo "Building session-end..."
	cd $(CMD_DIR)/session-end && \
	GOOS=$(GOOS) GOARCH=$(GOARCH) CGO_ENABLED=$(CGO_ENABLED) \
	go build $(BUILD_FLAGS) -o ../../$(DIST_DIR)/session-end/bootstrap .

.PHONY: build-cleanup-sessions
build-cleanup-sessions: setup-dirs
	@echo "Building cleanup-sessions..."
	cd $(CMD_DIR)/cleanup-sessions && \
	GOOS=$(GOOS) GOARCH=$(GOARCH) CGO_ENABLED=$(CGO_ENABLED) \
	go build $(BUILD_FLAGS) -o ../../$(DIST_DIR)/cleanup-sessions/bootstrap .

# Build all functions
.PHONY: build-all
build-all: build-create-session build-websocket-connect build-websocket-message build-websocket-disconnect build-get-session build-sessions-start build-session-act build-session-extract build-session-observe build-session-end build-cleanup-sessions
	@echo "All functions built successfully!"
	@ls -la $(DIST_DIR)/*/bootstrap

# Development helpers
.PHONY: tidy
tidy:
	go mod tidy

.PHONY: format
format:
	go fmt ./...

.PHONY: test
test:
	go test ./...

.PHONY: lint
lint:
	golangci-lint run ./...

# Package functions for deployment
.PHONY: package
package: build-all
	@echo "Packaging functions..."
	$(foreach func,$(FUNCTIONS), \
		cd $(DIST_DIR)/$(func) && \
		zip ../$(func).zip bootstrap && \
		cd ../.. && \
		echo "Created $(DIST_DIR)/$(func).zip"; \
	)

# Development build (for local testing)
.PHONY: dev-build
dev-build:
	$(foreach func,$(FUNCTIONS), \
		echo "Building $(func) for development..." && \
		go build -o $(func)/bootstrap ./$(CMD_DIR)/$(func); \
	)

# Show help
.PHONY: help
help:
	@echo "Available targets:"
	@echo "  all               - Clean and build all functions"
	@echo "  build-all         - Build all Lambda functions"
	@echo "  build-<function>  - Build specific function"
	@echo "  package           - Build and package functions as ZIP files"
	@echo "  dev-build         - Build for local development/testing"
	@echo "  clean             - Remove build artifacts"
	@echo "  tidy              - Run go mod tidy"
	@echo "  format            - Format Go code"
	@echo "  test              - Run tests"
	@echo "  lint              - Run linter"
	@echo "  help              - Show this help"
	@echo ""
	@echo "Functions: $(FUNCTIONS)" 