// Запускает server и web одним npm-скриптом, без доп. зависимостей (concurrently и т.п.).
import { spawn } from 'node:child_process';

const procs = [
  spawn('npm', ['run', 'dev', '--workspace=server'], { stdio: 'inherit', shell: true }),
  spawn('npm', ['run', 'dev', '--workspace=web'], { stdio: 'inherit', shell: true }),
];

let shuttingDown = false;
function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const p of procs) {
    if (!p.killed) p.kill('SIGTERM');
  }
  process.exit(code ?? 0);
}

for (const p of procs) {
  p.on('exit', (code) => shutdown(code ?? 0));
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
