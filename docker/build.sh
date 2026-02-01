#!/bin/bash
#
# Build the bismark-agent Docker image
#
# Usage: ./build.sh [image-name]
#
# This script:
# 1. Copies the bd binary for Linux (if building on Mac, needs cross-compile)
# 2. Builds the Docker image
# 3. Tags it appropriately

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
IMAGE_NAME="${1:-bismark-agent:latest}"

echo "Building bismark-agent Docker image..."
echo "Image name: $IMAGE_NAME"
echo "Context: $SCRIPT_DIR"

# Check if bd binary exists, create placeholder if not
if [ ! -f "$SCRIPT_DIR/bd" ]; then
  echo "Warning: bd binary not found at $SCRIPT_DIR/bd"
  echo "Creating placeholder script. For full functionality, build bd for Linux."

  # Create a placeholder that outputs a helpful message
  cat > "$SCRIPT_DIR/bd" << 'PLACEHOLDER'
#!/bin/bash
echo "Error: bd binary not available in container" >&2
echo "The bd CLI needs to be built for Linux and placed at docker/bd" >&2
exit 1
PLACEHOLDER
  chmod +x "$SCRIPT_DIR/bd"
fi

# Build the image
docker build -t "$IMAGE_NAME" -f "$SCRIPT_DIR/Dockerfile" "$SCRIPT_DIR"

echo ""
echo "Successfully built: $IMAGE_NAME"
echo ""
echo "To test the image:"
echo "  docker run --rm $IMAGE_NAME claude --version"
echo ""
echo "To run an agent:"
echo "  docker run --rm -v /path/to/worktree:/workspace \\"
echo "    -e ANTHROPIC_API_KEY=\$ANTHROPIC_API_KEY \\"
echo "    $IMAGE_NAME claude --dangerously-skip-permissions -p 'Hello'"
