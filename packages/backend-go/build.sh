#!/bin/bash

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Building Wallcrawler Lambda functions...${NC}"

# Clean build directory
rm -rf build
mkdir -p build

# Get list of Lambda functions from cmd directory
LAMBDA_FUNCTIONS=$(find cmd -mindepth 1 -maxdepth 1 -type d -exec basename {} \;)

# Build each Lambda function
for FUNCTION in $LAMBDA_FUNCTIONS; do
    echo -e "${YELLOW}Building $FUNCTION...${NC}"
    
    # Create function-specific build directory
    BUILD_DIR="build/$FUNCTION"
    mkdir -p "$BUILD_DIR"
    
    # Build the function for Linux (AWS Lambda runtime)
    GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build \
        -ldflags="-s -w" \
        -o "$BUILD_DIR/bootstrap" \
        "./cmd/$FUNCTION"
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓ Successfully built $FUNCTION${NC}"
        
        # Create a deployment package (zip file)
        cd "$BUILD_DIR"
        zip -q "../${FUNCTION}.zip" bootstrap
        cd - > /dev/null
        
        echo -e "${GREEN}✓ Created deployment package: build/${FUNCTION}.zip${NC}"
    else
        echo -e "${RED}✗ Failed to build $FUNCTION${NC}"
        exit 1
    fi
    
    echo ""
done

echo -e "${GREEN}All Lambda functions built successfully!${NC}"
echo ""
echo -e "${YELLOW}Build outputs:${NC}"
ls -la build/ 