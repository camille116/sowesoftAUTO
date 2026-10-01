import './helpers.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.js';
import { createWebServer } from '../src/web/server.js';

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const startSlot = new Date(Math.max(now.getTime() - 10 * 60e3, new Date(now).setHours(0, 0, 0, 0)));
const endSlot = new Date(Math.min(now.getTime() + 60 * 60e3, new Date(now).setHours(23, 59, 0, 0)));

const dataDir = mkdtempSync(join(tmpdir(), 'emile-web-'));
const config = {
  dataDir,
  planning: { icsUrl: '', keywords: ['autonomie'], manual: { dates: [{ date: ymd(now), start: hhmm(startSlot), end: hhmm(endSlot), title: 'Autonomie test' }] } },
  reminders: { offsets: [0, 15], tickSeconds: 30 },
  sowesign: { site: {}, dryRun: true, auth: { method: 'password', institution: '7705', email: 'a@b.fr', password: 'secret-initial' } },
  browser: {},
};

const signer = { busy: false, dryRun: true, auth: {}, loginLocked: null, calls: [], async sign(code) { this.calls.push(code); return { ok: true }; }, async check() { return { ok: true }; } };
const sent = [];
const app = createApp(config, { signer, send: async (t) => sent.push(t) });
const whatsapp = {
  state: { status: 'qr', qr: 'hello' },
  resets: 0,
  sent: [],
  async send(text) { this.sent.push(text); },
  async pair(phone) { if (!phone) throw new Error('Numéro invalide'); this.state.status = 'code'; this.state.code = 'ABCD1234'; return 'ABCD1234'; },
  async reset() { this.resets++; this.state.status = 'qr'; },
};
let server, base, cookie = '';

const call = async (path, body) => {
  const res = await fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null), headers: res.headers };
};

before(async () => {
  server = createWebServer({ app, whatsapp, password: 'mdp-appli', dataDir });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server?.close());

test('sert l’interface et bloque l’API sans connexion', async () => {
  const html = await fetch(base + '/').then((r) => r.text());
  assert.match(html, /<title>Émile<\/title>/);
  assert.equal((await call('/api/status')).status, 401);
  assert.equal((await call('/api/login', { password: 'faux' })).status, 401);
});

test('connexion puis statut avec le créneau en cours', async () => {
  const login = await call('/api/login', { password: 'mdp-appli' });
  assert.equal(login.status, 200);
  cookie = login.headers.get('set-cookie').split(';')[0];
  const { body } = await call('/api/status');
  assert.equal(body.whatsapp, 'qr');
  assert.equal(body.current.title, 'Autonomie test');
  assert.equal(body.current.status, 'pending');
});

test('QR code WhatsApp en image', async () => {
  const { body } = await call('/api/qr');
  assert.match(body.image, /^data:image\/png;base64,/);
});

test('signature depuis l’appli : appelle le robot, marque le créneau, notifie WhatsApp', async () => {
  assert.equal((await call('/api/sign', { code: '123' })).status, 400);
  const { body } = await call('/api/sign', { code: '48213' });
  assert.equal(body.ok, true);
  assert.deepEqual(signer.calls, ['48213']);
  assert.ok(sent.some((t) => /Signé/.test(t)));
  const status = await call('/api/status');
  assert.equal(status.body.current.status, 'signed');
  const history = await call('/api/history');
  assert.equal(history.body.history[0].type, 'sign');
});

test('planning et actions sur un créneau', async () => {
  const { body } = await call('/api/planning?days=1');
  const id = body.sessions[0].id;
  assert.equal((await call('/api/session', { id, action: 'reset' })).body.session.status, 'pending');
  assert.equal((await call('/api/session', { id, action: 'skip' })).body.session.status, 'skipped');
  assert.equal((await call('/api/session', { id: 'nope', action: 'done' })).status, 404);
});

test('réglages : appliqués à chaud, secrets jamais renvoyés, mot de passe vide = inchangé', async () => {
  const before = await call('/api/settings');
  assert.equal(before.body.auth.hasPassword, true);
  assert.equal(JSON.stringify(before.body).includes('secret-initial'), false);

  const saved = await call('/api/settings', { dryRun: false, reminderOffsets: '-10, 0, 20', keywords: 'autonomie, elearning', auth: { method: 'password', email: 'c@d.fr', password: '' } });
  assert.equal(saved.status, 200);
  assert.deepEqual(app.bot.offsets, [-10, 0, 20]);
  assert.equal(signer.dryRun, false);
  assert.equal(signer.auth.email, 'c@d.fr');
  assert.equal(signer.auth.password, 'secret-initial');
  assert.deepEqual(app.planning.keywords, ['autonomie', 'elearning']);

  const persisted = JSON.parse(readFileSync(join(dataDir, 'settings.json'), 'utf8'));
  assert.equal(persisted.auth.email, 'c@d.fr');

  const bad = await call('/api/settings', { auth: { pin: '12' } });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /PIN/);
});

test('pause des rappels', async () => {
  assert.equal((await call('/api/pause', { paused: true })).body.paused, true);
  assert.equal((await call('/api/pause', { paused: false })).body.paused, false);
});

test('captures : nom de fichier contrôlé', async () => {
  assert.equal((await call('/api/screenshots/..%2F..%2Fsettings.json')).status, 404);
  assert.equal((await call('/api/screenshots/absente.png')).status, 404);
});

test('WhatsApp : connexion par code et réinitialisation', async () => {
  assert.equal((await call('/api/whatsapp/pair', { phone: '' })).status, 400);
  assert.equal((await call('/api/whatsapp/pair', { phone: '0612345678' })).body.code, 'ABCD1234');
  const q = await call('/api/qr');
  assert.equal(q.body.status, 'code');
  assert.equal(q.body.code, 'ABCD1234');
  assert.equal(q.body.image, null, 'pas de QR pendant l’appairage par code');
  assert.equal((await call('/api/whatsapp/reset', {})).status, 200);
  assert.equal(whatsapp.resets, 1);
});

test('WhatsApp : notification de test (seulement une fois connecté)', async () => {
  whatsapp.state.status = 'qr';
  assert.equal((await call('/api/whatsapp/test', {})).status, 409);
  whatsapp.state.status = 'ready';
  assert.equal((await call('/api/whatsapp/test', {})).status, 200);
  assert.match(whatsapp.sent.at(-1), /Notification de test/);
});
