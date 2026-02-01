#!/bin/bash
#
# Build the bismarck-agent-mock Docker image
#
# Usage: ./build-mock.sh
#
# This builds a minimal test image that outputs mock NDJSON events.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
IMAGE_NAME="bismarck-agent-mock:test"

echo "Building mock agent Docker image..."
echo "Image name: $IMAGE_NAME"
echo "Context: $SCRIPT_DIR"

docker build -t "$IMAGE_NAME" -f "$SCRIPT_DIR/Dockerfile.mock" "$SCRIPT_DIR"

echo ""
echo "Successfully built: $IMAGE_NAME"
echo ""
echo "To test the image:"
echo "  docker run --rm -e BISMARCK_TASK_ID=test-1 $IMAGE_NAME"
echo ""
echo "To test with custom interval (faster):"
echo "  docker run --rm -e BISMARCK_TASK_ID=test-1 -e MOCK_EVENT_INTERVAL_MS=500 $IMAGE_NAME"
