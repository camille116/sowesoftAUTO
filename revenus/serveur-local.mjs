// Petit serveur local pour utiliser Revenus sur ton ordinateur, sans rien installer d'autre que Node.
//   node serveur-local.mjs        (ou double-clic sur « Lancer Revenus.command » sur Mac)
// Il ne sert que ce dossier, uniquement à cet ordinateur (127.0.0.1), toujours à la même adresse :
// les données du navigateur étant liées à l'adresse, il ne faut pas changer de port d'une fois sur l'autre.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)));
const PORT = 4173;
const URL_LOCALE = `http://localhost:${PORT}/`;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

function openBrowser() {
  if (process.env.REVENUS_SANS_NAVIGATEUR) return;
  const [cmd, args] = process.platform === 'darwin' ? ['open', [URL_LOCALE]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', URL_LOCALE]]
      : ['xdg-open', [URL_LOCALE]];
  try { spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch { /* pas de navigateur à ouvrir */ }
}

const server = createServer(async (req, res) => {
  let path;
  try { path = decodeURIComponent(new URL(req.url, URL_LOCALE).pathname); } catch { path = null; }
  const file = path == null ? null : resolve(ROOT, `.${path.endsWith('/') ? `${path}index.html` : path}`);
  // Rien en dehors de ce dossier, ni les fichiers cachés.
  if (!file || !(file === ROOT || file.startsWith(ROOT + sep)) || file.slice(ROOT.length).split(sep).some((part) => part.startsWith('.'))) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Accès refusé');
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    res.end();
    return;
  }
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Introuvable');
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`Revenus tourne déjà : ${URL_LOCALE}`);
    openBrowser();
    return;
  }
  console.error(`Impossible de démarrer : ${err.message}`);
  process.exitCode = 1;
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Revenus est ouvert sur ${URL_LOCALE}`);
  console.log('Laisse cette fenêtre ouverte pendant que tu utilises l’app. Ctrl+C pour arrêter.');
  openBrowser();
});
