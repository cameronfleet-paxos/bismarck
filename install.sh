#!/bin/bash
#
# Bismarck Installer
# One-line install: curl -fsSL https://raw.githubusercontent.com/anthropics/bismarck/main/install.sh | bash
#
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

info() { echo -e "${GREEN}==>${NC} $1"; }
warn() { echo -e "${YELLOW}Warning:${NC} $1"; }
error() { echo -e "${RED}Error:${NC} $1"; exit 1; }

# Check requirements
check_requirements() {
    # macOS only
    if [[ "$(uname)" != "Darwin" ]]; then
        error "Bismarck only supports macOS"
    fi

    # arm64 only
    if [[ "$(uname -m)" != "arm64" ]]; then
        error "Bismarck only supports Apple Silicon (arm64). Intel Macs are not supported."
    fi

    # curl required
    if ! command -v curl &> /dev/null; then
        error "curl is required but not installed"
    fi

    # tar required
    if ! command -v tar &> /dev/null; then
        error "tar is required but not installed"
    fi
}

# Get latest release version from GitHub API
get_latest_version() {
    local latest
    latest=$(curl -fsSL "https://api.github.com/repos/anthropics/bismarck/releases/latest" 2>/dev/null | grep '"tag_name"' | sed -E 's/.*"([^"]+)".*/\1/')
    if [[ -z "$latest" ]]; then
        error "Failed to fetch latest release version. Check your internet connection or try specifying a version with BISMARCK_VERSION=v1.0.0"
    fi
    echo "$latest"
}

# Main installation
main() {
    info "Installing Bismarck..."

    check_requirements

    # Determine version (use env var or fetch latest)
    local version="${BISMARCK_VERSION:-}"
    if [[ -z "$version" ]]; then
        info "Fetching latest version..."
        version=$(get_latest_version)
    fi
    info "Version: $version"

    # Download URL
    local download_url="https://github.com/anthropics/bismarck/releases/download/${version}/Bismarck-arm64.tar.gz"
    local tmp_dir=$(mktemp -d)
    local archive_path="${tmp_dir}/Bismarck-arm64.tar.gz"

    # Download
    info "Downloading Bismarck..."
    if ! curl -fsSL "$download_url" -o "$archive_path"; then
        rm -rf "$tmp_dir"
        error "Failed to download Bismarck from $download_url"
    fi

    # Extract
    info "Extracting..."
    if ! tar -xzf "$archive_path" -C "$tmp_dir"; then
        rm -rf "$tmp_dir"
        error "Failed to extract archive"
    fi

    # Ensure ~/Applications exists
    mkdir -p ~/Applications

    # Remove existing installation
    if [[ -d ~/Applications/Bismarck.app ]]; then
        info "Removing existing installation..."
        rm -rf ~/Applications/Bismarck.app
    fi

    # Move to ~/Applications
    info "Installing to ~/Applications..."
    mv "${tmp_dir}/Bismarck.app" ~/Applications/

    # Remove quarantine attribute (allows app to run without Gatekeeper warning)
    info "Removing quarantine attribute..."
    xattr -rd com.apple.quarantine ~/Applications/Bismarck.app 2>/dev/null || true

    # Cleanup
    rm -rf "$tmp_dir"

    echo ""
    info "Bismarck installed successfully!"
    echo ""
    echo "To launch:"
    echo "  open ~/Applications/Bismarck.app"
    echo ""
    echo "Or find it in Finder: ~/Applications/Bismarck.app"
    echo ""
}

main "$@"
