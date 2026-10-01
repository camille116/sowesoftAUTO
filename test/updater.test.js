import './helpers.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createUpdater } from '../src/updater.js';

const SHA_OLD = 'a'.repeat(40);
const SHA_NEW = 'b'.repeat(40);

function setup({ managed = true, script = 'echo ok; echo "$2" > VERSION', fail = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'upd-'));
  mkdirSync(join(root, 'scripts', 'mac'), { recursive: true });
  mkdirSync(join(root, 'data'));
  writeFileSync(join(root, 'scripts', 'mac', 'update.sh'), fail ? 'exit 3' : script);
  writeFileSync(join(root, 'VERSION'), SHA_OLD);
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return { ok: true, json: async () => ({ sha: SHA_NEW, commit: { message: 'Nouvelle interface LinkeD\n\ndétails' } }) };
  };
  let exited = null;
  const updater = createUpdater({ root, dataDir: join(root, 'data'), repo: 'moi/linked', branch: 'main', managed, fetchImpl, exit: (c) => { exited = c; } });
  return { root, updater, calls, exited: () => exited };
}

test('détecte une nouvelle version sur GitHub', async () => {
  const { updater, calls } = setup();
  const info = await updater.info();
  assert.equal(info.current, SHA_OLD);
  assert.equal(info.latest, SHA_NEW);
  assert.equal(info.updateAvailable, true);
  assert.equal(info.latestMessage, 'Nouvelle interface LinkeD');
  assert.match(calls[0], /api\.github\.com\/repos\/moi\/linked\/commits\/main/);
});

test('mise à jour : lance le script avec le bon commit puis redémarre', async () => {
  const { updater, root, exited } = setup();
  const r = await updater.update();
  assert.equal(r.target, SHA_NEW);
  await new Promise((res) => setTimeout(res, 900));
  assert.equal(readFileSync(join(root, 'VERSION'), 'utf8').trim(), SHA_NEW);
  assert.equal(exited(), 0, 'le processus s’arrête pour être relancé par launchd');
  assert.equal((await updater.info()).updateAvailable, false);
});

test('échec du script : pas de redémarrage, erreur visible', async () => {
  const { updater, exited } = setup({ fail: true });
  await updater.update();
  await new Promise((res) => setTimeout(res, 400));
  assert.equal(exited(), null);
  assert.match((await updater.info()).lastError, /échoué/);
});

test('hors installation Mac : bouton désactivé', async () => {
  const { updater } = setup({ managed: false });
  assert.equal((await updater.info()).canUpdate, false);
  await assert.rejects(updater.update(), /indisponible/);
});
