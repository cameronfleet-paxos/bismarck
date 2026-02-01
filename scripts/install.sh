#!/bin/bash
set -e

cd "$(dirname "$0")/.."

echo "Building Bismark..."
npm run build
npm run dist

echo "Installing to Applications..."
rm -rf ~/Applications/Bismark.app
cp -R dist/mac-arm64/Bismark.app ~/Applications/

echo "Done! Bismark installed to ~/Applications/Bismark.app"
