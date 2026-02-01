#!/bin/bash
#
# gh CLI proxy wrapper for Bismarck containers
#
# Instead of running gh directly (which would require tokens in the container),
# this script proxies all gh commands to the Bismarck tool proxy server running
# on the host.
#
# The tool proxy holds the GitHub token securely and executes commands on behalf
# of the container.
#
# Usage: gh pr create --title "..." --body "..."
# (Works just like normal gh CLI)

set -e

# Get proxy URL from environment (set by docker run)
PROXY_URL="${TOOL_PROXY_URL:-http://host.docker.internal:9847}"

# Build JSON payload with all arguments
ARGS_JSON=$(printf '%s\n' "$@" | jq -R . | jq -s .)

# Determine the endpoint based on first argument
ENDPOINT="/gh"
case "$1" in
  pr)
    case "$2" in
      create) ENDPOINT="/gh/pr/create" ;;
      view)   ENDPOINT="/gh/pr/view" ;;
      list)   ENDPOINT="/gh/pr/list" ;;
      *)      ENDPOINT="/gh" ;;
    esac
    ;;
  issue)
    case "$2" in
      create) ENDPOINT="/gh/issue/create" ;;
      view)   ENDPOINT="/gh/issue/view" ;;
      *)      ENDPOINT="/gh" ;;
    esac
    ;;
  api)
    ENDPOINT="/gh/api"
    ;;
esac

# Make request to proxy
RESPONSE=$(curl -s -X POST "${PROXY_URL}${ENDPOINT}" \
  -H "Content-Type: application/json" \
  -d "{\"args\": ${ARGS_JSON}}")

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
