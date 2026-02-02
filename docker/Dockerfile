# Bismarck Agent Container
#
# Runs Claude Code in headless mode with tool proxy support.
#
# Build: docker build -t bismarck-agent:latest -f docker/Dockerfile docker/
# Run: docker run --rm -v /path/to/worktree:/workspace bismarck-agent:latest claude -p "..."

FROM node:20-bookworm

# Install non-sensitive dev tools
RUN apt-get update && apt-get install -y \
    curl \
    jq \
    git \
    openssh-client \
    python3 \
    python3-pip \
    python3-venv \
    && rm -rf /var/lib/apt/lists/*

# Install Playwright browser dependencies (Chromium)
# These are the system libraries Chromium needs to run headlessly
RUN apt-get update && apt-get install -y \
    # X11/display libraries for headless browser
    xvfb \
    libgtk-3-0 \
    libnotify-dev \
    libnss3 \
    libxss1 \
    libasound2 \
    libgbm1 \
    libatk-bridge2.0-0 \
    libdrm2 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libxkbcommon0 \
    # Electron CDP support
    lsof \
    && rm -rf /var/lib/apt/lists/*

# Install Bazelisk (manages Bazel versions automatically)
# Use dpkg --print-architecture to detect arm64 vs amd64
RUN ARCH=$(dpkg --print-architecture) && \
    curl -fsSL "https://github.com/bazelbuild/bazelisk/releases/download/v1.19.0/bazelisk-linux-${ARCH}" \
    -o /usr/local/bin/bazel && chmod +x /usr/local/bin/bazel

# Install Go (for Go projects)
# Use dpkg --print-architecture to detect arm64 vs amd64
RUN ARCH=$(dpkg --print-architecture) && \
    if [ "$ARCH" = "arm64" ]; then GOARCH="arm64"; else GOARCH="amd64"; fi && \
    curl -fsSL "https://go.dev/dl/go1.22.0.linux-${GOARCH}.tar.gz" | tar -C /usr/local -xzf - \
    && ln -s /usr/local/go/bin/go /usr/local/bin/go \
    && ln -s /usr/local/go/bin/gofmt /usr/local/bin/gofmt

# Install Claude Code CLI globally
RUN npm install -g @anthropic-ai/claude-code

# Copy gh CLI wrapper that calls the tool proxy
COPY gh-proxy-wrapper.sh /usr/local/bin/gh
RUN chmod +x /usr/local/bin/gh

# Copy bd CLI wrapper that calls the tool proxy
# This proxies bd commands to the host where the plan directory lives
COPY bd-proxy-wrapper.sh /usr/local/bin/bd
RUN chmod +x /usr/local/bin/bd

# Copy git CLI wrapper that calls the tool proxy
# This proxies git commands to the host where the worktree can be resolved
COPY git-proxy-wrapper.sh /usr/local/bin/git
RUN chmod +x /usr/local/bin/git

# Create non-root user (Claude refuses --dangerously-skip-permissions as root)
RUN useradd -m -s /bin/bash agent && \
    mkdir -p /workspace /plan && \
    chown -R agent:agent /workspace /plan

# Create workspace directory
WORKDIR /workspace

# Switch to non-root user
USER agent

# Configure git to use SSH for GitHub (enables private repo access via SSH agent)
# The SSH agent socket is forwarded from the host at runtime
# Each insteadOf entry needs to be added separately with --add to allow multiple values
RUN /usr/bin/git config --global url."ssh://git@github.com/".insteadOf "https://github.com/" && \
    /usr/bin/git config --global --add url."ssh://git@github.com/".insteadOf "git://github.com/"

# Add GitHub's SSH host keys to known_hosts (prevents "Host key verification failed")
RUN mkdir -p ~/.ssh && \
    ssh-keyscan github.com >> ~/.ssh/known_hosts 2>/dev/null

# Install Playwright Chromium browser as agent user
# This ensures the browser is available when running as non-root
RUN npx playwright install chromium

# Environment variables
# TOOL_PROXY_URL is set at runtime via docker run -e
ENV TOOL_PROXY_URL="http://host.docker.internal:9847"

# Default command
CMD ["claude"]
