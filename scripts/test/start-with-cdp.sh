#!/bin/bash
#
# Start Bismark with Chrome DevTools Protocol (CDP) enabled
#
# This script starts the app with remote debugging on port 9222,
# enabling automated testing via CDP.
#
# Usage:
#   ./start-with-cdp.sh         # Start everything
#   ./start-with-cdp.sh --clean # Kill existing processes first
#

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
CDP_PORT=9222

cd "$PROJECT_DIR"

# Handle --clean flag
if [ "$1" = "--clean" ]; then
    echo "Cleaning up existing processes..."
    pkill -f "electron.*bismark" 2>/dev/null || true
    pkill -f "vite.*bismark" 2>/dev/null || true
    sleep 1
fi

# Check if CDP port is already in use
if lsof -Pi :$CDP_PORT -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo "CDP port $CDP_PORT is already in use"
    echo "Use --clean to kill existing processes, or connect to existing instance"
    echo ""
    echo "To check existing targets: curl http://localhost:$CDP_PORT/json"
    exit 1
fi

# Check if Vite is running
if ! lsof -Pi :5173 -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo "Vite dev server not running. Starting it..."
    npm run dev &
    VITE_PID=$!
    echo "Vite starting with PID: $VITE_PID"

    # Wait for Vite to be ready
    echo "Waiting for Vite to be ready on port 5173..."
    for i in {1..30}; do
        if lsof -Pi :5173 -sTCP:LISTEN -t >/dev/null 2>&1; then
            echo "Vite is ready!"
            break
        fi
        sleep 1
    done

    if ! lsof -Pi :5173 -sTCP:LISTEN -t >/dev/null 2>&1; then
        echo "Error: Vite failed to start within 30 seconds"
        exit 1
    fi
else
    echo "Vite dev server already running on port 5173"
fi

# Build main process
echo "Building main process..."
npm run build:main

# Start Electron with CDP
echo "Starting Electron with remote debugging on port $CDP_PORT..."
NODE_ENV=development npx electron --remote-debugging-port=$CDP_PORT . &
ELECTRON_PID=$!
echo "Electron starting with PID: $ELECTRON_PID"

# Wait for CDP to be available
echo "Waiting for CDP endpoint..."
for i in {1..30}; do
    if curl -s "http://localhost:$CDP_PORT/json" >/dev/null 2>&1; then
        echo ""
        echo "=== CDP Ready ==="
        echo "Endpoint: http://localhost:$CDP_PORT"
        echo ""
        echo "Available targets:"
        curl -s "http://localhost:$CDP_PORT/json" | grep -E '"title"|"webSocketDebuggerUrl"' | head -10
        echo ""
        echo "Start CDP server for fast interactions:"
        echo "  npm run test:server"
        echo ""
        echo "Then use curl:"
        echo "  curl -s localhost:9333/health"
        echo "  curl -s localhost:9333/screenshot?path=/tmp/claude/screenshot.png"
        echo "  curl -s localhost:9333/state"
        echo ""
        exit 0
    fi
    sleep 1
done

echo "Error: CDP endpoint not available within 30 seconds"
echo "Check if Electron started correctly"
exit 1
