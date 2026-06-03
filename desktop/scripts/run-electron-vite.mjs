import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);

if (args.length === 0) {
  console.error('[electron-vite] Missing command. Expected one of: dev, preview, build.');
  process.exit(1);
}

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const localBinName = process.platform === 'win32' ? 'electron-vite.cmd' : 'electron-vite';
const localElectronVite = path.resolve(scriptDir, '..', 'node_modules', '.bin', localBinName);
const electronViteCommand = existsSync(localElectronVite) ? localElectronVite : 'electron-vite';

console.info(`[electron-vite] Starting: ${electronViteCommand} ${args.join(' ')}`);

const child = spawn(electronViteCommand, args, {
  env,
  shell: process.platform === 'win32',
  stdio: 'inherit',
});

child.on('error', (error) => {
  console.error(`[electron-vite] Failed to start: ${error.message}`);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    console.info(`[electron-vite] Exited from signal: ${signal}`);
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
