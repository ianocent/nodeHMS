// watchlogs.js - run both servers, capture ALL terminal output to logs/
// Usage: node watchlogs.js   (Ctrl+C to stop both)
// Logs: backend-node/logs/backend-<stamp>.log, frontend-<stamp>.log + latest-backend.log/latest-frontend.log
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const net = require('net');

const BACKEND_DIR = __dirname;
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend-node');
const LOG_DIR = path.join(__dirname, 'logs');
fs.mkdirSync(LOG_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');

function portFree(port) {
  return new Promise(resolve => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(port);
  });
}

function start(name, dir, cmd, stampFile, latestFile) {
  const out = fs.createWriteStream(stampFile, { flags: 'a' });
  const latest = fs.createWriteStream(latestFile, { flags: 'a' });
  console.log(`[${name}] starting in ${dir}: ${cmd}`);
  out.write(`=== ${cmd} @ ${new Date().toISOString()} ===\n`);
  const child = spawn(cmd, { cwd: dir, shell: true });
  const pipe = d => {
    const lines = d.toString().split(/\r?\n/).filter(Boolean);
    lines.forEach(l => {
      const line = `[${new Date().toISOString()}] [${name}] ${l}`;
      out.write(line + '\n');
      latest.write(line + '\n');
      process.stdout.write(line + '\n');
    });
  };
  child.stdout.on('data', pipe);
  child.stderr.on('data', d => {
    const lines = d.toString().split(/\r?\n/).filter(Boolean);
    lines.forEach(l => {
      const line = `[${new Date().toISOString()}] [${name}] [ERR] ${l}`;
      out.write(line + '\n');
      latest.write(line + '\n');
      process.stdout.write(line + '\n');
    });
  });
  child.on('error', e => console.log(`[${name}] spawn error: ${e.message}`));
  child.on('exit', code => console.log(`[${name}] exited code=${code} (server stop) [ERR]`));
  return child;
}

async function main() {
  const beOk = await portFree(3001);
  const feOk = await portFree(3000);
  if (!beOk) console.log('[warn] port 3001 busy - kill existing backend first (old terminal still running?)');
  if (!feOk) console.log('[warn] port 3000 busy - kill existing frontend first');
  console.log('--- logs will go to:', path.join(LOG_DIR, '*-' + stamp + '.log'), '---');

  const children = [];
  children.push(start('backend', BACKEND_DIR,
    'npm start',
    path.join(LOG_DIR, `backend-${stamp}.log`),
    path.join(LOG_DIR, 'latest-backend.log')));
  children.push(start('frontend', FRONTEND_DIR,
    'npm start',
    path.join(LOG_DIR, `frontend-${stamp}.log`),
    path.join(LOG_DIR, 'latest-frontend.log')));

  const killAll = () => {
    console.log('\n[watchlogs] stopping both servers...');
    children.forEach(c => {
      try { execSync(`taskkill /pid ${c.pid} /T /F`, { stdio: 'ignore' }); } catch (e) {}
    });
    process.exit(0);
  };
  process.on('SIGINT', killAll);
  process.on('SIGTERM', killAll);
}
main();