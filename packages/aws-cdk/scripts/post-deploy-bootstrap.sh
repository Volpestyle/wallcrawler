#!/bin/bash
set -euo pipefail

ENVIRONMENT="${CDK_CONTEXT_ENVIRONMENT:-dev}"
if [[ $# -ge 1 ]]; then
  ENVIRONMENT="$1"
fi

# Only auto-bootstrap lower environments.
if [[ "$ENVIRONMENT" == "prod" ]]; then
  echo "Skipping data bootstrap for prod environment."
  exit 0
fi

PYTHON_BIN="${PYTHON_BIN:-python3}"
if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  if command -v python >/dev/null 2>&1; then
    PYTHON_BIN="python"
  else
    echo "Python 3 is required to generate seeded API keys. Install it or set PYTHON_BIN to an available interpreter." >&2
    exit 1
  fi
fi

REGION=$(aws configure get region 2>/dev/null || echo "us-east-1")
DEFAULT_PROJECT_ID="${WALLCRAWLER_DEFAULT_PROJECT_ID:-project_default}"
PROJECTS_TABLE="${WALLCRAWLER_PROJECTS_TABLE:-wallcrawler-projects}"
API_KEYS_TABLE="${WALLCRAWLER_API_KEYS_TABLE:-wallcrawler-api-keys}"
TIMESTAMP_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)

create_default_project() {
  local tmp_file
  tmp_file=$(mktemp)
  cat <<JSON > "$tmp_file"
{
  "projectId": {"S": "$DEFAULT_PROJECT_ID"},
  "name": {"S": "Default Project"},
  "defaultTimeout": {"N": "3600"},
  "concurrency": {"N": "5"},
  "status": {"S": "ACTIVE"},
  "createdAt": {"S": "$TIMESTAMP_UTC"},
  "updatedAt": {"S": "$TIMESTAMP_UTC"}
}
JSON

  if output=$(aws dynamodb put-item \
      --table-name "$PROJECTS_TABLE" \
      --item file://"$tmp_file" \
      --condition-expression "attribute_not_exists(projectId)" \
      --region "$REGION" 2>&1); then
    echo "✔ Created default project '$DEFAULT_PROJECT_ID'."
  else
    if grep -q "ConditionalCheckFailedException" <<<"$output"; then
      echo "ℹ️  Project '$DEFAULT_PROJECT_ID' already exists; skipping creation."
    else
      echo "$output" >&2
      rm -f "$tmp_file"
      exit 1
    fi
  fi
  rm -f "$tmp_file"
}

create_default_api_key() {
  local count
  count=$(aws dynamodb scan \
    --table-name "$API_KEYS_TABLE" \
    --select COUNT \
    --limit 1 \
    --region "$REGION" \
    --output text \
    --query 'Count')

  if [[ "$count" != "0" ]]; then
    echo "ℹ️  API key table already contains entries; skipping automatic key creation."
    return 0
  fi

  local raw_key key_hash tmp_file
  raw_key=$("$PYTHON_BIN" - <<'PY'
import secrets, string
prefix = "wc_"
alphabet = string.ascii_lowercase + string.digits
body = ''.join(secrets.choice(alphabet) for _ in range(24))
print(prefix + body)
PY
)
  key_hash=$("$PYTHON_BIN" -c "import hashlib, sys; print(hashlib.sha256(sys.argv[1].encode()).hexdigest())" "$raw_key")

  tmp_file=$(mktemp)
  cat <<JSON > "$tmp_file"
{
  "apiKeyHash": {"S": "$key_hash"},
  "projectId": {"S": "$DEFAULT_PROJECT_ID"},
  "projectIds": {"L": [{"S": "$DEFAULT_PROJECT_ID"}]},
  "status": {"S": "ACTIVE"},
  "createdAt": {"S": "$TIMESTAMP_UTC"}
}
JSON

  aws dynamodb put-item \
    --table-name "$API_KEYS_TABLE" \
    --item file://"$tmp_file" \
    --region "$REGION"
  rm -f "$tmp_file"

  local output_file
  output_file="wallcrawler-api-key.txt"
  echo "$raw_key" > "$output_file"
  chmod 600 "$output_file" || true
  echo "✔ Created default Wallcrawler API key. Raw value saved to $(pwd)/$output_file"
}

create_default_project
create_default_api_key
