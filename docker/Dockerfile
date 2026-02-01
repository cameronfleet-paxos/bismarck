# Bismark Agent Container
#
# Runs Claude Code in headless mode with tool proxy support.
#
# Build: docker build -t bismark-agent:latest -f docker/Dockerfile docker/
# Run: docker run --rm -v /path/to/worktree:/workspace bismark-agent:latest claude -p "..."

FROM node:20-bookworm

# Install non-sensitive dev tools
RUN apt-get update && apt-get install -y \
    curl \
    jq \
    git \
    python3 \
    python3-pip \
    python3-venv \
    && rm -rf /var/lib/apt/lists/*

# Install Go (for Go projects)
RUN curl -fsSL https://go.dev/dl/go1.22.0.linux-amd64.tar.gz | tar -C /usr/local -xzf - \
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

# Environment variables
# TOOL_PROXY_URL is set at runtime via docker run -e
ENV TOOL_PROXY_URL="http://host.docker.internal:9847"

# Default command
CMD ["claude"]
