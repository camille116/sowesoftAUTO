import { spawn } from 'node:child_process';
import { existsSync, readFileSync, createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { log } from './logger.js';

const CACHE_MS = 10 * 60e3;

/**
 * Mise à jour en un clic depuis l'appli.
 * - version installée : fichier VERSION (SHA du commit), écrit par scripts/mac/update.sh ;
 * - dernière version : API GitHub publique (dépôt + branche configurables) ;
 * - installation : scripts/mac/update.sh (télécharge, remplace le code, garde data/ et .env),
 *   puis le processus s'arrête et launchd le relance avec le nouveau code.
 * Uniquement quand LinkeD tourne en service géré (LINKED_MANAGED=1, posé par l'installeur Mac).
 */
export function createUpdater({ root, dataDir, repo, branch, managed, fetchImpl = fetch, exit = (c) => process.exit(c) }) {
  const versionFile = join(root, 'VERSION');
  const script = join(root, 'scripts', 'mac', 'update.sh');
  let cache = { at: 0, latest: null, message: null, error: null };
  let updating = false;
  let lastError = null;

  const current = () => (existsSync(versionFile) ? readFileSync(versionFile, 'utf8').trim() || null : null);
  const canUpdate = () => Boolean(managed) && existsSync(script);

  // SHA de la branche via l'endpoint git (pas l'API REST) : non soumis à la limite 60 requêtes/h
  // qui provoquait les erreurs « GitHub HTTP 403 » quand on mettait à jour plusieurs fois.
  async function fetchLatestSha() {
    const res = await fetchImpl(`https://github.com/${repo}.git/info/refs?service=git-upload-pack`, {
      headers: { 'user-agent': 'LinkeD-updater' },
      signal: AbortSignal.timeout(15e3),
    });
    if (!res.ok) throw new Error(`GitHub HTTP ${res.status}`);
    const text = await res.text();
    const esc = branch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = text.match(new RegExp(`([0-9a-f]{40}) refs/heads/${esc}(?:\\0|\\n|$)`));
    if (!m) throw new Error(`branche ${branch} introuvable sur GitHub`);
    return m[1];
  }

  // message du dernier commit (confort) : via l'API REST, limitée à 60/h → on ignore ses erreurs
  async function fetchMessage(sha) {
    try {
      const res = await fetchImpl(`https://api.github.com/repos/${repo}/commits/${sha}`, {
        headers: { accept: 'application/vnd.github+json', 'user-agent': 'LinkeD-updater' },
        signal: AbortSignal.timeout(10e3),
      });
      if (!res.ok) return null;
      const data = await res.json();
      return String(data.commit?.message || '').split('\n')[0].slice(0, 120) || null;
    } catch {
      return null;
    }
  }

  async function latest(force = false) {
    if (!force && Date.now() - cache.at < CACHE_MS) return cache;
    try {
      const sha = await fetchLatestSha();
      const message = sha === cache.latest && cache.message ? cache.message : await fetchMessage(sha);
      cache = { at: Date.now(), latest: sha, message, error: null };
    } catch (err) {
      cache = { ...cache, at: Date.now() - CACHE_MS + 60e3, error: err.message }; // nouvel essai dans 1 min
    }
    return cache;
  }

  async function info() {
    const l = await latest();
    const cur = current();
    return {
      current: cur,
      latest: l.latest,
      latestMessage: l.message,
      error: l.error,
      updateAvailable: Boolean(l.latest && l.latest !== cur),
      canUpdate: canUpdate(),
      updating,
      lastError,
    };
  }

  async function update() {
    if (!canUpdate()) throw new Error('Mise à jour automatique indisponible ici (installe LinkeD avec l’installeur Mac)');
    if (updating) throw new Error('Mise à jour déjà en cours');
    const { latest: sha, error } = await latest(true);
    if (!sha) throw new Error(`Impossible de joindre GitHub (${error})`);

    updating = true;
    lastError = null;
    log.info(`Mise à jour vers ${sha.slice(0, 7)}…`);
    const out = createWriteStream(join(dataDir, 'update.log'), { flags: 'a' });
    const child = spawn('bash', [script, repo, sha], { cwd: root, env: process.env });
    child.stdout.pipe(out);
    child.stderr.pipe(out);
    child.on('exit', (code) => {
      updating = false;
      if (code === 0) {
        log.info('Mise à jour installée, redémarrage…');
        setTimeout(() => exit(0), 500); // launchd relance LinkeD avec le nouveau code
      } else {
        lastError = `le script a échoué (code ${code}), voir data/update.log`;
        log.error(`Mise à jour échouée : ${lastError}`);
      }
    });
    return { started: true, target: sha };
  }

  return { info, update, current };
}
