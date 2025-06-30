#!/bin/bash
# claude-lint.sh

RELATIVE_FILE="$1"
WORKSPACE_DIR="$2"

cd "$WORKSPACE_DIR"

echo "===================="
echo "RUNNING TYPECHECK FOR PROJECT (focusing on: $RELATIVE_FILE)"
echo "===================="

# Run the project's typecheck command
echo "🔍 Running pnpm typecheck..."
TYPECHECK_OUTPUT=$(pnpm typecheck 2>&1)
TYPECHECK_EXIT_CODE=$?

echo "pnpm typecheck Results (exit code: $TYPECHECK_EXIT_CODE):"
echo "$TYPECHECK_OUTPUT"
echo ""

echo "🤖 Analyzing with Claude Code..."
echo "===================="

# Send to Claude
PROMPT="Please analyze the file $RELATIVE_FILE. Here is the project's typecheck output:

\`\`\`
$TYPECHECK_OUTPUT
\`\`\`

Exit code: $TYPECHECK_EXIT_CODE

Based on this actual typecheck output, try to fix all the errors in this file"

echo "$PROMPT" | claude --print --add-dir "$WORKSPACE_DIR"