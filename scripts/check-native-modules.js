#!/usr/bin/env node
const { execSync } = require('child_process');
const path = require('path');

try {
  execSync('npx electron -e "require(\'node-pty\')"', {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    stdio: 'pipe',
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1'
    },
    timeout: 10000
  });
  console.log('Native modules are correctly built for Electron');
  process.exit(0);
} catch (e) {
  console.error('ERROR: Native modules not built for Electron');
  console.error('Run: npm run rebuild');
  process.exit(1);
}
