import './helpers.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SowesignSigner, signatureStrokes } from '../src/sowesign/signer.js';
import { startMockSowesign } from './fixtures/mock-sowesign.js';

// Bout en bout avec un vrai Chromium contre une fausse appli SoWeSoft (même structure que la vraie).
const chrome = process.env.CHROME_PATH || '/opt/pw-browsers/chromium';
const skip = !existsSync(chrome) && 'Chromium introuvable (définis CHROME_PATH)';

const site = JSON.parse(readFileSync(new URL('../config/sowesign.json', import.meta.url), 'utf8'));
let mock;

function signer({ auth = {}, ...overrides } = {}) {
  return new SowesignSigner({
    site: { ...site, portalUrl: `${mock.base}/login`, studentUrl: `${mock.base}/student/`, timeoutMs: 8000 },
    auth: { method: 'password', institution: '7705', email: 'eleve@ecole.fr', password: 'secret', ...auth },
    dryRun: false,
    browser: { headless: true, executablePath: chrome },
    dataDir: mkdtempSync(join(tmpdir(), 'sowesign-')),
    ...overrides,
  });
}

before(async () => { mock = await startMockSowesign(); });
after(() => mock?.close());

test('la signature dessinée occupe le cadre', () => {
  const xs = signatureStrokes(400, 200).flat().map(([x]) => x);
  assert.ok(Math.max(...xs) - Math.min(...xs) > 400 * 0.7);
});

test('chaque style de signature remplit le cadre sans déborder', () => {
  for (const opts of ['claude', 'psg', { style: 'name', name: 'Camille Redon' }]) {
    const pts = signatureStrokes(360, 200, opts).flat();
    assert.ok(pts.length > 10, `trop peu de points pour ${JSON.stringify(opts)}`);
    const xs = pts.map(([x]) => x);
    const ys = pts.map(([, y]) => y);
    assert.ok(Math.max(...xs) - Math.min(...xs) > 360 * 0.5, 'assez large (SoWeSoft refuse les petites signatures)');
    assert.ok(Math.min(...xs) >= -1 && Math.max(...xs) <= 361, 'reste dans le cadre en X');
    assert.ok(Math.min(...ys) >= -1 && Math.max(...ys) <= 201, 'reste dans le cadre en Y');
  }
});

test('se connecte, ferme la popup, tape le code, dessine la signature', { skip }, async () => {
  const result = await signer().sign('48213');
  assert.equal(result.ok, true, result.reason);
  assert.ok(existsSync(result.screenshot));
  assert.equal(mock.signatures.at(-1), '48213');
});

test('réutilise la session sans se reconnecter', { skip }, async () => {
  const s = signer();
  assert.equal((await s.check()).ok, true);
  const logins = mock.logins.length;
  const result = await s.sign('48213');
  assert.equal(result.ok, true, result.reason);
  assert.equal(mock.logins.length, logins, 'pas de nouvelle connexion');
});

test('remonte le refus du code', { skip }, async () => {
  const result = await signer().sign('11111');
  assert.equal(result.ok, false);
  assert.match(result.reason, /code refusé : Code invalide/);
});

test('refuse un code qui n’a pas 5 chiffres sans ouvrir le navigateur', async () => {
  const result = await signer().sign('1234');
  assert.equal(result.ok, false);
  assert.match(result.reason, /5 chiffres/);
});

test('mode test : tape 4 chiffres et s’arrête avant la vérification', { skip }, async () => {
  const before = mock.signatures.length;
  const result = await signer({ dryRun: true }).sign('48213');
  assert.equal(result.dryRun, true, result.reason);
  assert.equal(mock.signatures.length, before);
});

test('mauvais mot de passe : une seule tentative, puis plus de reconnexion automatique', { skip }, async () => {
  const s = signer({ auth: { password: 'faux' } });
  const first = await s.sign('48213');
  assert.equal(first.ok, false);
  assert.match(first.reason, /connexion refusée/);
  const attempts = mock.logins.length;
  const second = await s.sign('48213');
  assert.match(second.reason, /connexion suspendue/);
  assert.equal(mock.logins.length, attempts, 'aucune nouvelle tentative');
});
