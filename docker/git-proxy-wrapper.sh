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

# NOTE: We intentionally do NOT use 'set -e' here to allow custom error handling
# for proxy connection failures. This provides better error messages when the
# Bismarck tool proxy is not running.

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
  # Log proxy decision for debugging
  echo "[git-proxy] Using proxy for git command: $*" >&2
  echo "[git-proxy] CWD=$CWD, HOST_WORKTREE_PATH=$HOST_WORKTREE_PATH, PROXY_URL=$PROXY_URL" >&2

  # Proxy git commands to the host for workspace operations
  # Build JSON payload with all arguments
  ARGS_JSON=$(printf '%s\n' "$@" | jq -R . | jq -s .)

  # Build JSON payload safely using jq (avoids shell injection via variable values)
  JSON_PAYLOAD=$(jq -n --argjson args "$ARGS_JSON" --arg cwd "$HOST_WORKTREE_PATH" \
    '{args: $args, cwd: $cwd}')

  # Build auth header if token is available
  AUTH_HEADER=()
  if [ -n "$TOOL_PROXY_TOKEN" ]; then
    AUTH_HEADER=(-H "Authorization: Bearer ${TOOL_PROXY_TOKEN}")
  fi

  # Make request to proxy with explicit error handling
  # We use -w to get HTTP status code and -o to save response body
  HTTP_CODE=$(curl -s -w "%{http_code}" -o /tmp/git_response.json -X POST "${PROXY_URL}/git" \
    -H "Content-Type: application/json" \
    "${AUTH_HEADER[@]}" \
    -d "$JSON_PAYLOAD" 2>/tmp/curl_error.txt)

  CURL_EXIT=$?

  # Check if curl itself failed (network error, proxy not running, etc.)
  if [ $CURL_EXIT -ne 0 ]; then
    echo "[git-proxy] ERROR: Failed to connect to Bismarck tool proxy at ${PROXY_URL}" >&2
    echo "[git-proxy] curl exit code: $CURL_EXIT" >&2
    echo "[git-proxy] git args were: $*" >&2
    echo "[git-proxy] CWD: $CWD" >&2
    echo "[git-proxy] HOST_WORKTREE_PATH: $HOST_WORKTREE_PATH" >&2
    if [ -s /tmp/curl_error.txt ]; then
      echo "[git-proxy] curl error: $(cat /tmp/curl_error.txt)" >&2
    fi
    echo "" >&2
    echo "The tool proxy must be running for git operations in worktrees." >&2
    echo "This usually means Bismarck is not running or the proxy failed to start." >&2
    echo "" >&2
    echo "To fix: Restart Bismarck or check its logs for errors." >&2
    exit 128
  fi

  # Check HTTP status
  if [ "$HTTP_CODE" != "200" ]; then
    echo "[git-proxy] ERROR: Tool proxy returned HTTP $HTTP_CODE" >&2
    echo "[git-proxy] git args were: $*" >&2
    if [ -s /tmp/git_response.json ]; then
      echo "[git-proxy] Response body:" >&2
      cat /tmp/git_response.json >&2
    fi
    exit 128
  fi

  echo "[git-proxy] Proxy request successful (HTTP $HTTP_CODE)" >&2

  # Check if response file exists and has content
  if [ ! -s /tmp/git_response.json ]; then
    echo "ERROR: Empty response from tool proxy" >&2
    exit 128
  fi

  # Extract fields from response
  SUCCESS=$(jq -r '.success' /tmp/git_response.json 2>/dev/null)
  STDOUT=$(jq -r '.stdout // empty' /tmp/git_response.json 2>/dev/null)
  STDERR=$(jq -r '.stderr // empty' /tmp/git_response.json 2>/dev/null)
  EXIT_CODE=$(jq -r '.exitCode // 1' /tmp/git_response.json 2>/dev/null)

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
  echo "[git-proxy] Using real git (not in /workspace or HOST_WORKTREE_PATH not set)" >&2
  echo "[git-proxy] CWD=$CWD, HOST_WORKTREE_PATH=${HOST_WORKTREE_PATH:-<not set>}" >&2
  exec "$REAL_GIT" "$@"
fi
