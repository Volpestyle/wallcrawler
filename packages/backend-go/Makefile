.PHONY: build clean test help lambda-only docker-build

# Default target
help: ## Show this help message
	@echo "Available targets:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

build: ## Build all Lambda functions for AWS deployment
	@echo "Building all Lambda functions..."
	@./build.sh

lambda-only: ## Build only Lambda functions (without ECS controller)
	@echo "Building Lambda functions only..."
	@rm -rf build
	@mkdir -p build
	@for func in $$(find cmd -mindepth 1 -maxdepth 1 -type d -exec basename {} \; | grep -v ecs-controller); do \
		echo "Building $$func..."; \
		mkdir -p "build/$$func"; \
		GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -ldflags="-s -w" -o "build/$$func/bootstrap" "./cmd/$$func"; \
		cd "build/$$func" && zip -q "../$$func.zip" bootstrap && cd - > /dev/null; \
	done

docker-build: ## Build ECS controller Docker image
	@echo "Building ECS controller Docker image..."
	@docker build -t wallcrawler-ecs-controller .

test: ## Run tests
	@echo "Running tests..."
	@go test ./...

clean: ## Clean build artifacts
	@echo "Cleaning build directory..."
	@rm -rf build
	@echo "Clean complete."

# Individual function builds
build-act: ## Build act Lambda function
	@mkdir -p build/act
	@GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -ldflags="-s -w" -o build/act/bootstrap ./cmd/act
	@cd build/act && zip -q ../act.zip bootstrap

build-screencast: ## Build screencast Lambda function
	@mkdir -p build/screencast
	@GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -ldflags="-s -w" -o build/screencast/bootstrap ./cmd/screencast
	@cd build/screencast && zip -q ../screencast.zip bootstrap

build-sessions-start: ## Build sessions-start Lambda function
	@mkdir -p build/sessions-start
	@GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -ldflags="-s -w" -o build/sessions-start/bootstrap ./cmd/sessions-start
	@cd build/sessions-start && zip -q ../sessions-start.zip bootstrap

build-ecs-controller: ## Build ECS controller
	@mkdir -p build/ecs-controller
	@GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -ldflags="-s -w" -o build/ecs-controller/bootstrap ./cmd/ecs-controller
	@cd build/ecs-controller && zip -q ../ecs-controller.zip bootstrap

# Development helpers
dev-build: ## Build for local development (current OS)
	@echo "Building for local development..."
	@rm -rf build-dev
	@mkdir -p build-dev
	@for func in $$(find cmd -mindepth 1 -maxdepth 1 -type d -exec basename {} \;); do \
		echo "Building $$func for development..."; \
		go build -o "build-dev/$$func" "./cmd/$$func"; \
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