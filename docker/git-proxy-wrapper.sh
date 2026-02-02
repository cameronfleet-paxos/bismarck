#!/bin/bash
#
# Smart git CLI wrapper for Bismarck containers
#
# This wrapper decides whether to:
# 1. Proxy git commands to the host (for /workspace operations)
# 2. Use real git directly (for Bazel, Go modules, and other external operations)
#
# For /workspace operations:
#   The worktree's .git file references a path on the host that doesn't exist
#   in the container, so we proxy to the Bismarck tool proxy server.
#
# For Bazel/Go/external operations:
#   These tools clone repos to their own cache directories (~/.cache/bazel/,
#   ~/.cache/go/, etc.) and need real git with SSH authentication.
#
# Usage: git status, git add ., git commit -m "...", git push origin HEAD
# (Works just like normal git CLI)

set -e

# Configuration
PROXY_URL="${TOOL_PROXY_URL:-http://host.docker.internal:9847}"
HOST_WORKTREE_PATH="${BISMARCK_HOST_WORKTREE_PATH:-}"
REAL_GIT="/usr/bin/git"

# Get current working directory
CWD="$(pwd)"

# Determine if we should use the proxy or real git
# Use proxy only when:
# 1. We're in /workspace (the mounted worktree)
# 2. HOST_WORKTREE_PATH is set
#
# Use real git for:
# - Bazel cache operations (~/.cache/bazel/)
# - Go module operations (~/.cache/go/)
# - Any path outside /workspace
should_use_proxy() {
  # Not in workspace? Use real git
  case "$CWD" in
    /workspace|/workspace/*) ;;
    *) return 1 ;;
  esac

  # No host path configured? Use real git
  [ -n "$HOST_WORKTREE_PATH" ] || return 1

  return 0
}

if should_use_proxy; then
  # Proxy git commands to the host for workspace operations
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
else
  # Use real git for non-workspace operations (Bazel, Go modules, etc.)
  # SSH agent forwarding enables authentication for private repos
  exec "$REAL_GIT" "$@"
fi
