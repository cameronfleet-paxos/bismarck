#!/bin/bash
#
# git CLI proxy wrapper for Bismarck containers
#
# Instead of running git directly (which fails because the worktree's .git file
# references a path on the host that doesn't exist in the container), this script
# proxies all git commands to the Bismarck tool proxy server running on the host.
#
# The tool proxy:
# - Executes git commands in the actual worktree directory on the host
# - Has access to the main repository's .git directory
#
# Usage: git status, git add ., git commit -m "...", git push origin HEAD
# (Works just like normal git CLI)

set -e

# Get proxy URL and host worktree path from environment (set by docker run)
PROXY_URL="${TOOL_PROXY_URL:-http://host.docker.internal:9847}"
HOST_WORKTREE_PATH="${BISMARCK_HOST_WORKTREE_PATH:-}"

if [ -z "$HOST_WORKTREE_PATH" ]; then
  echo "Error: BISMARCK_HOST_WORKTREE_PATH environment variable not set" >&2
  echo "git commands must be proxied to the host because /workspace is a worktree" >&2
  exit 1
fi

# Build JSON payload with all arguments
ARGS_JSON=$(printf '%s\n' "$@" | jq -R . | jq -s .)

# Make request to proxy
RESPONSE=$(curl -s -X POST "${PROXY_URL}/git" \
  -H "Content-Type: application/json" \
  -d "{\"args\": ${ARGS_JSON}, \"cwd\": \"${HOST_WORKTREE_PATH}\"}")

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
