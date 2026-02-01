#!/bin/bash
#
# bd CLI proxy wrapper for Bismarck containers
#
# Instead of running bd directly (which would require access to the host's
# ~/.bismarck/plans/ directory), this script proxies all bd commands to the
# Bismarck tool proxy server running on the host.
#
# The tool proxy:
# - Executes bd commands in the correct plan directory on the host
# - Automatically adds --sandbox flag (no need to include it)
#
# Usage: bd close <task-id> --message "Completed"
# (The --sandbox flag is added automatically by the proxy)

set -e

# Get proxy URL and plan ID from environment (set by docker run)
PROXY_URL="${TOOL_PROXY_URL:-http://host.docker.internal:9847}"
PLAN_ID="${BISMARCK_PLAN_ID:-}"

if [ -z "$PLAN_ID" ]; then
  echo "Error: BISMARCK_PLAN_ID environment variable not set" >&2
  exit 1
fi

# Build JSON payload with all arguments
# Note: We pass args as-is; the proxy will add --sandbox automatically
ARGS_JSON=$(printf '%s\n' "$@" | jq -R . | jq -s .)

# Make request to proxy
RESPONSE=$(curl -s -X POST "${PROXY_URL}/bd" \
  -H "Content-Type: application/json" \
  -H "X-Bismarck-Plan-Id: ${PLAN_ID}" \
  -d "{\"args\": ${ARGS_JSON}, \"planId\": \"${PLAN_ID}\"}")

# Extract fields from response
SUCCESS=$(echo "$RESPONSE" | jq -r '.success')
STDOUT=$(echo "$RESPONSE" | jq -r '.stdout // empty')
STDERR=$(echo "$RESPONSE" | jq -r '.stderr // empty')
EXIT_CODE=$(echo "$RESPONSE" | jq -r '.exitCode // 1')

# Output results
if [ -n "$STDOUT" ]; then
  echo "$STDOUT"
fi

if [ -n "$STDERR" ]; then
  echo "$STDERR" >&2
fi

# Exit with same code as proxied command
exit "$EXIT_CODE"
