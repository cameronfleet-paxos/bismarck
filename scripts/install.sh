#!/bin/bash
set -e

cd "$(dirname "$0")/.."

echo "Installing dependencies..."
npm ci

echo "Building Bismarck..."
npm run build
npm run dist

echo "Installing to Applications..."
rm -rf ~/Applications/Bismarck.app
cp -R dist/mac-arm64/Bismarck.app ~/Applications/

echo "Done! Bismarck installed to ~/Applications/Bismarck.app"
