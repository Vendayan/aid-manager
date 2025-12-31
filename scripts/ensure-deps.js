#!/usr/bin/env node
const { existsSync } = require('fs');
const { join } = require('path');
const { spawnSync } = require('child_process');

const root = process.cwd();
const webviewDir = join(root, 'webview-ui');

const runInstall = (cwd, label) => {
  const hasLock = existsSync(join(cwd, 'package-lock.json'));
  const cmd = ['npm', hasLock ? 'ci' : 'install'];
  console.log(`[ensure-deps] installing ${label} deps with "${cmd.join(' ')}"...`);
  const result = spawnSync(cmd[0], cmd.slice(1), {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });

  if (result.status !== 0) {
    throw new Error(`[ensure-deps] failed installing ${label} dependencies (exit ${result.status})`);
  }
};

const needsRoot = !existsSync(join(root, 'node_modules'));
const needsWebview = !existsSync(join(webviewDir, 'node_modules'));

if (!needsRoot && !needsWebview) {
  console.log('[ensure-deps] dependencies already installed');
  process.exit(0);
}

if (needsRoot) {
  runInstall(root, 'root');
}

if (needsWebview) {
  runInstall(webviewDir, 'webview-ui');
}

console.log('[ensure-deps] done');
