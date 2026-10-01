import './helpers.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SowesignSigner } from '../src/sowesign/signer.js';
import { startMockSowesign } from './fixtures/mock-sowesign.js';

// Test de bout en bout avec un vrai Chromium contre la fausse plateforme.
const chrome = process.env.CHROME_PATH || '/opt/pw-browsers/chromium';
const skip = !existsSync(chrome) && 'Chromium introuvable (définis CHROME_PATH)';

const site = JSON.parse(readFileSync(new URL('../config/sowesign.json', import.meta.url), 'utf8'));
let mock;

function signer(overrides = {}) {
  return new SowesignSigner({
    site: { ...site, url: mock.url, timeoutMs: 8000 },
    login: 'eleve@ecole.fr',
    password: 'secret',
    dryRun: false,
    browser: { headless: true, executablePath: chrome },
    dataDir: mkdtempSync(join(tmpdir(), 'sowesign-')),
    ...overrides,
  });
}

before(async () => { mock = await startMockSowesign(); });
after(() => mock?.close());

test('se connecte et signe avec un code en cases séparées', { skip }, async () => {
  const result = await signer().sign('4821');
  assert.equal(result.ok, true, result.reason);
  assert.ok(existsSync(result.screenshot));
  assert.equal(mock.signatures.at(-1), '4821');
});

test('remonte l’erreur si le code est faux', { skip }, async () => {
  const result = await signer().sign('0000');
  assert.equal(result.ok, false);
  assert.match(result.reason, /code incorrect/);
});

test('mode test : remplit sans valider', { skip }, async () => {
  const before = mock.signatures.length;
  const result = await signer({ dryRun: true }).sign('4821');
  assert.equal(result.dryRun, true);
  assert.equal(mock.signatures.length, before);
});

test('mauvais identifiants', { skip }, async () => {
  const result = await signer({ password: 'faux' }).check();
  assert.equal(result.ok, false);
  assert.match(result.reason, /connexion refusée/);
});
