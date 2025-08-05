#!/bin/bash

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Building Wallcrawler functions...${NC}"

# Clean build directory
rm -rf build
mkdir -p build

# Define functions that need to be built
# Format: "source_directory:build_path"
FUNCTIONS=(
    "cmd/sdk/sessions-create:sdk/sessions-create"
    "cmd/sdk/sessions-list:sdk/sessions-list"
    "cmd/sdk/sessions-retrieve:sdk/sessions-retrieve"
    "cmd/sdk/sessions-debug:sdk/sessions-debug"
    "cmd/sdk/sessions-update:sdk/sessions-update"
    "cmd/api/sessions-start:api/sessions-start"
    "cmd/ecs-controller:ecs-controller"
    "cmd/ecs-task-processor:ecs-task-processor"
    "cmd/proxy:proxy"
)

# Build each function
for FUNCTION_DEF in "${FUNCTIONS[@]}"; do
    # Split the definition
    IFS=':' read -r SOURCE_PATH BUILD_PATH <<< "$FUNCTION_DEF"
    FUNCTION_NAME=$(basename "$BUILD_PATH")
    
    echo -e "${YELLOW}Building $FUNCTION_NAME from $SOURCE_PATH...${NC}"
    
    # Check if main.go exists
    if [ ! -f "$SOURCE_PATH/main.go" ]; then
        echo -e "${RED}✗ No main.go found in $SOURCE_PATH, skipping...${NC}"
        continue
    fi
    
    # Create function-specific build directory
    BUILD_DIR="build/$BUILD_PATH"
    mkdir -p "$BUILD_DIR"
    
    # Build the function for Linux (AWS Lambda/ECS runtime)
    GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build \
        -ldflags="-s -w" \
        -o "$BUILD_DIR/bootstrap" \
        "./$SOURCE_PATH"
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓ Successfully built $FUNCTION_NAME${NC}"
        
        # Create a deployment package (zip file)
        cd "$BUILD_DIR"
        zip -q "../$(basename "$BUILD_PATH").zip" bootstrap
        cd - > /dev/null
        
        echo -e "${GREEN}✓ Created deployment package: build/$(basename "$BUILD_PATH").zip${NC}"
    else
        echo -e "${RED}✗ Failed to build $FUNCTION_NAME${NC}"
        exit 1
    fi
    
    echo ""
done

echo -e "${GREEN}All functions built successfully!${NC}"
echo ""
echo -e "${YELLOW}Build outputs:${NC}"
find build/ -name "*.zip" | sort 