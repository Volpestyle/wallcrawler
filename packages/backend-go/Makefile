.PHONY: build clean test help lambda-only docker-build

# Default target
help: ## Show this help message
	@echo "Available targets:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

build: ## Build all functions for AWS deployment
	@echo "Building all functions..."
	@./build.sh

lambda-only: ## Build only Lambda functions (excludes ECS controller)
	@echo "Building Lambda functions only..."
	@rm -rf build
	@mkdir -p build
	@for func_def in \
		"cmd/sdk/sessions-create:sdk/sessions-create" \
		"cmd/sdk/sessions-list:sdk/sessions-list" \
		"cmd/sdk/sessions-retrieve:sdk/sessions-retrieve" \
		"cmd/sdk/sessions-debug:sdk/sessions-debug" \
		"cmd/sdk/sessions-update:sdk/sessions-update" \
		"cmd/api/sessions-start:api/sessions-start" \
		"cmd/ecs-task-processor:ecs-task-processor"; do \
		source_path=$$(echo $$func_def | cut -d: -f1); \
		build_path=$$(echo $$func_def | cut -d: -f2); \
		func_name=$$(basename $$build_path); \
		echo "Building $$func_name from $$source_path..."; \
		mkdir -p "build/$$build_path"; \
		GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -ldflags="-s -w" -o "build/$$build_path/bootstrap" "./$$source_path"; \
		cd "build/$$build_path" && zip -q "../$$(basename $$build_path).zip" bootstrap && cd - > /dev/null; \
	done

docker-build: ## Build ECS controller Docker image
	@echo "Building ECS controller Docker image..."
	@docker build -t wallcrawler-ecs-controller .

test: ## Run tests
	@echo "Running tests..."
	@go test ./...

clean: ## Clean build artifacts
	@echo "Cleaning build directory..."
	@rm -rf build build-dev
	@echo "Clean complete."

# Development helpers
dev-build: ## Build for local development (current OS)
	@echo "Building for local development..."
	@rm -rf build-dev
	@mkdir -p build-dev
	@for func_def in \
		"cmd/sdk/sessions-create:sessions-create" \
		"cmd/sdk/sessions-list:sessions-list" \
		"cmd/sdk/sessions-retrieve:sessions-retrieve" \
		"cmd/sdk/sessions-debug:sessions-debug" \
		"cmd/sdk/sessions-update:sessions-update" \
		"cmd/api/sessions-start:sessions-start" \
		"cmd/ecs-controller:ecs-controller" \
		"cmd/ecs-task-processor:ecs-task-processor"; do \
		source_path=$$(echo $$func_def | cut -d: -f1); \
		build_name=$$(echo $$func_def | cut -d: -f2); \
		echo "Building $$build_name for development..."; \
		go build -o "build-dev/$$build_name" "./$$source_path"; \
	done

fmt: ## Format Go code
	@echo "Formatting Go code..."
	@go fmt ./...

lint: ## Run linter
	@echo "Running linter..."
	@golangci-lint run || echo "Install golangci-lint for linting"

deps: ## Download dependencies
	@echo "Downloading dependencies..."
	@go mod download
	@go mod tidy 