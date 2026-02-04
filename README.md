# Bismarck

<p align="center">
  <img src="assets/icon.svg" alt="Bismarck Logo" width="128" height="128">
</p>

A desktop app for managing multiple Claude Code agents from a single dashboard.

## Quick Install

```bash
git clone https://github.com/anthropics/bismarck.git
cd bismarck
npm install
./scripts/install.sh
```

The app installs to `~/Applications/Bismarck.app`.

### Let Claude Install It

Paste this into Claude Code:

> Clone and install Bismarck from https://github.com/anthropics/bismarck - run `npm install` then `./scripts/install.sh`

## Requirements

- Node.js 22+
- macOS (arm64)

## Development

```bash
npm install

# Terminal 1: Start Vite dev server
npm run dev

# Terminal 2: Start Electron
npm run dev:electron
```

## Configuration

Bismarck stores data in `~/.bismarck/`:
- `settings.json` - App settings
- `sockets/` - Unix sockets for agent communication
- `hooks/` - Auto-generated hook scripts

On first launch, Bismarck configures Claude Code hooks in `~/.claude/settings.json` to receive agent notifications.

## License

ISC
