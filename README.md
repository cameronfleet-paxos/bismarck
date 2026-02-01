# Bismarck

<p align="center">
  <img src="assets/icon.svg" alt="Bismarck Logo" width="128" height="128">
</p>

A desktop application for monitoring and managing Claude Code agent workspaces.

## Features

- **Workspace Management** - Monitor multiple Claude Code sessions from a single dashboard
- **Real-time Updates** - Receive live status updates via Unix socket hooks
- **Automatic Hook Configuration** - Hooks are automatically installed on first launch
- **Session Persistence** - Workspaces persist across app restarts

## Prerequisites

- Node.js 18+
- npm

## Installation

```bash
# Install dependencies
npm install

# Build and install to ~/Applications
./scripts/deploy-local.sh
```

The app will be installed to `~/Applications/Bismarck.app`.

## Development

```bash
# Install dependencies
npm install

# Start Vite dev server (terminal 1)
npm run dev

# Start Electron (terminal 2)
npm run dev:electron
```

## Build Commands

| Command | Description |
|---------|-------------|
| `npm run build` | Build both main and renderer processes |
| `npm run dist` | Create distributable package |
| `npm run pack` | Create unpacked directory |

## Configuration

Bismarck stores its configuration in `~/.bismarck/`:

- `settings.json` - Application settings
- `sockets/` - Unix sockets for agent communication
- `hooks/` - Auto-generated hook scripts

## Claude Code Integration

On first launch, Bismarck automatically configures Claude Code hooks in `~/.claude/settings.json`:

- **Stop Hook** - Notifies when an agent stops and needs input
- **Notification Hook** - Notifies when an agent requires permission approval

## License

ISC
