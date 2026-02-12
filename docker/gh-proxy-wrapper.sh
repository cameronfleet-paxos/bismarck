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
HOST_WORKTREE_PATH="${BISMARCK_HOST_WORKTREE_PATH:-}"

# Translate /workspace paths to host paths in arguments
# This is needed because file arguments like --body-file reference container paths
# but the command runs on the host where /workspace doesn't exist
translate_path() {
  local arg="$1"
  if [[ "$arg" == /workspace/* ]]; then
    # Replace /workspace with the host worktree path
    echo "${HOST_WORKTREE_PATH}${arg#/workspace}"
  elif [[ "$arg" == /workspace ]]; then
    echo "${HOST_WORKTREE_PATH}"
  else
    echo "$arg"
  fi
}

# Process arguments, translating file paths for flags that take file arguments
TRANSLATED_ARGS=()
SKIP_NEXT=false
TRANSLATE_NEXT=false

for i in "$@"; do
  if $SKIP_NEXT; then
    SKIP_NEXT=false
    continue
  fi

  if $TRANSLATE_NEXT; then
    # This argument is a file path that needs translation
    TRANSLATED_ARGS+=("$(translate_path "$i")")
    TRANSLATE_NEXT=false
    continue
  fi

  case "$i" in
    # Flags that take file path arguments (next arg is the path)
    -F|--body-file|-T|--template)
      TRANSLATED_ARGS+=("$i")
      TRANSLATE_NEXT=true
      ;;
    # Combined form: --body-file=path or -F=path
    --body-file=*|--template=*)
      FLAG="${i%%=*}"
      VALUE="${i#*=}"
      TRANSLATED_ARGS+=("${FLAG}=$(translate_path "$VALUE")")
      ;;
    -F=*|-T=*)
      FLAG="${i%%=*}"
      VALUE="${i#*=}"
      TRANSLATED_ARGS+=("${FLAG}=$(translate_path "$VALUE")")
      ;;
    *)
      TRANSLATED_ARGS+=("$i")
      ;;
  esac
done

# Build JSON payload with translated arguments
ARGS_JSON=$(printf '%s\n' "${TRANSLATED_ARGS[@]}" | jq -R . | jq -s .)

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

# Build JSON payload safely using jq (avoids shell injection via variable values)
JSON_PAYLOAD=$(jq -n --argjson args "$ARGS_JSON" --arg cwd "$HOST_WORKTREE_PATH" \
  '{args: $args, cwd: $cwd}')

# Build auth header if token is available
AUTH_HEADER=()
if [ -n "$TOOL_PROXY_TOKEN" ]; then
  AUTH_HEADER=(-H "Authorization: Bearer ${TOOL_PROXY_TOKEN}")
fi

# Make request to proxy
RESPONSE=$(curl -s -X POST "${PROXY_URL}${ENDPOINT}" \
  -H "Content-Type: application/json" \
  "${AUTH_HEADER[@]}" \
  -d "$JSON_PAYLOAD")

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
