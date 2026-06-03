import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const installScript = path.resolve(scriptDir, '..', 'node_modules', 'electron', 'install.js');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(process.execPath, [installScript], {
  env,
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
