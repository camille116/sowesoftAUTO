import { spawn } from 'node:child_process';
import { existsSync, rmSync, appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Diagnostic et réparation de l'app Mac LinkeD (Electron).
 * Sert à comprendre pourquoi l'app s'ouvre dans Chrome au lieu de sa propre fenêtre.
 */
export function createDesktop({ root, dataDir, managed, platform = process.platform, home = homedir() }) {
  const electron = join(root, 'desktop', 'node_modules', 'electron', 'dist', 'Electron.app');
  const appPaths = ['/Applications/LinkeD.app', join(home, 'Applications', 'LinkeD.app')];
  // raccourcis créés par Chrome quand on « installe » un site comme une app
  const chromeShortcuts = [
    join(home, 'Applications', 'Chrome Apps.localized', 'LinkeD.app'),
    join(home, 'Applications', 'Chrome Apps', 'LinkeD.app'),
  ];
  const logFile = join(dataDir, 'make-app.log');
  let running = false;
  let last = null; // { ok, output, at }

  function status() {
    const app = appPaths.find((p) => existsSync(p)) || null;
    const native = Boolean(app && existsSync(join(app, 'Contents', 'Resources', 'app', 'main.js')));
    return {
      mac: platform === 'darwin',
      managed: Boolean(managed),
      electronInstalled: existsSync(electron),
      app,
      kind: !app ? 'none' : native ? 'native' : 'launcher',
      chromeShortcuts: chromeShortcuts.filter((p) => existsSync(p)),
      repairing: running,
      last,
    };
  }

  /** Reconstruit LinkeD.app (télécharge Electron si besoin) et supprime les raccourcis Chrome. */
  function repair() {
    if (platform !== 'darwin' || !managed) throw new Error('Réparation disponible sur Mac, une fois LinkeD installé avec l’installeur');
    if (running) throw new Error('Réparation déjà en cours');
    running = true;
    for (const p of chromeShortcuts) if (existsSync(p)) rmSync(p, { recursive: true, force: true });
    let output = '';
    const child = spawn('bash', [join(root, 'scripts', 'mac', 'make-app.sh')], { cwd: root, env: process.env });
    const onData = (d) => { output += d; try { appendFileSync(logFile, d); } catch { /* journal facultatif */ } };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    const timer = setTimeout(() => child.kill('SIGTERM'), 10 * 60e3);
    child.on('exit', (code) => {
      clearTimeout(timer);
      running = false;
      const s = status();
      last = { ok: code === 0 && s.kind === 'native', code, output: output.slice(-4000), at: new Date().toISOString() };
    });
    return { started: true };
  }

  return { status, repair };
}
