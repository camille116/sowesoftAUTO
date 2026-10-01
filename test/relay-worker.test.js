import './helpers.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runOnce } from '../relay/worker.js';

// Faux D1 Cloudflare en mémoire (juste ce que le worker utilise)
function fakeDB() {
  const kv = new Map();
  return {
    kv,
    prepare(sql) {
      let args = [];
      return {
        bind(...a) { args = a; return this; },
        async first() { return kv.has(args[0]) ? { v: kv.get(args[0]) } : null; },
        async run() { kv.set(args[0], args[1]); return { success: true }; },
      };
    },
  };
}

function icsNow(startMin) {
  const now = new Date();
  const d = (min) => new Date(now.getTime() + min * 60e3).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:x', `DTSTART:${d(startMin)}`, `DTEND:${d(startMin + 120)}`,
    'SUMMARY:Marketplaces - AUTONOMIE', 'DESCRIPTION:Matière : Marketplaces\\nType : AUTONOMIE\\n', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
}

const snapshot = {
  telegramToken: 'T', icsUrl: 'https://x/ical', keywords: ['autonomie'], notify: { mode: 'auto' }, offsets: [0, 15],
  owner: { chatId: 1, done: {} }, members: [{ id: 'a', name: 'Léa', chatId: 50, status: 'active', done: {} }],
  memberTemplate: '{prenom} : signe {cours}',
};

async function seed(db, { lastSeenMinAgo = 10 } = {}) {
  db.kv.set('snapshot', JSON.stringify(snapshot));
  db.kv.set('lastSeen', JSON.stringify(new Date(Date.now() - lastSeenMinAgo * 60e3).toISOString()));
}

test('Mac hors ligne : le relais envoie les rappels', async () => {
  const db = fakeDB(); await seed(db);
  const sent = [];
  const r = await runOnce({ DB: db }, new Date(), { fetchIcs: async () => icsNow(0), send: async (t, chat, text) => { sent.push({ chat, text }); return true; } });
  assert.equal(r.sent, 2);
  assert.deepEqual(sent.map((s) => s.chat).sort(), [1, 50]);
  // 2e passage : plus rien (dédup persisté)
  const r2 = await runOnce({ DB: db }, new Date(), { fetchIcs: async () => icsNow(0), send: async () => { throw new Error('ne doit pas envoyer'); } });
  assert.equal(r2.attempted, 0);
});

test('Mac en ligne (battement récent) : le relais ne double pas', async () => {
  const db = fakeDB(); await seed(db, { lastSeenMinAgo: 1 });
  const r = await runOnce({ DB: db }, new Date(), { fetchIcs: async () => icsNow(0), send: async () => true });
  assert.equal(r.skipped, 'mac-online');
});

test('échec d’envoi : réessayé au passage suivant', async () => {
  const db = fakeDB(); await seed(db);
  let fail = true;
  const calls = [];
  const send = async (t, chat) => { calls.push(chat); if (fail) return false; return true; };
  await runOnce({ DB: db }, new Date(), { fetchIcs: async () => icsNow(0), send });
  fail = false;
  const r = await runOnce({ DB: db }, new Date(), { fetchIcs: async () => icsNow(0), send });
  assert.ok(r.sent >= 1, 'renvoyé après l’échec');
});

test('pas de snapshot ou agenda illisible : rien', async () => {
  const empty = fakeDB();
  assert.equal((await runOnce({ DB: empty })).skipped, 'no-snapshot');
  const db = fakeDB(); await seed(db);
  assert.equal((await runOnce({ DB: db }, new Date(), { fetchIcs: async () => { throw new Error('x'); } })).skipped, 'ics-error');
});

test('/test-reminder : le cloud envoie à l’admin et aux membres actifs', async () => {
  const db = fakeDB(); await seed(db, { lastSeenMinAgo: 1 });
  const sent = [];
  const { runOnce } = await import('../relay/worker.js');
  // on appelle le fetch handler directement
  const mod = (await import('../relay/worker.js')).default;
  const send = [];
  // simule l'envoi Telegram en interceptant fetch global
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => { send.push(JSON.parse(opts.body)); return { json: async () => ({ ok: true }) }; };
  try {
    const req = new Request('https://r/test-reminder', { method: 'POST', headers: { authorization: 'Bearer S' } });
    const res = await mod.fetch(req, { DB: db, RELAY_SECRET: 'S' });
    const body = await res.json();
    assert.equal(body.recipients, 2, 'admin + 1 membre actif');
    assert.equal(send.length, 2);
    assert.match(send[0].text, /relais cloud/i);
  } finally { globalThis.fetch = realFetch; }
});

test('/test-reminder : clé incorrecte refusée', async () => {
  const db = fakeDB(); await seed(db);
  const mod = (await import('../relay/worker.js')).default;
  const res = await mod.fetch(new Request('https://r/test-reminder', { method: 'POST', headers: { authorization: 'Bearer MAUVAISE' } }), { DB: db, RELAY_SECRET: 'S' });
  assert.equal(res.status, 401);
});

test('webhook : /demain répond et persiste, un code est mis en file (Mac en ligne)', async () => {
  const { handleWebhook } = await import('../relay/worker.js');
  const db = fakeDB(); await seed(db, { lastSeenMinAgo: 1 }); // Mac en ligne
  const sent = [];
  const deps = { fetchIcs: async () => icsNow(0), send: async (t, chat, text) => sent.push({ chat, text }) };
  // /demain de l'admin
  await handleWebhook({ DB: db }, { message: { chat: { id: 1 }, from: { id: 1, first_name: 'C' }, text: '/demain' } }, deps);
  assert.ok(sent.find((x) => x.chat === 1 && /Demain/i.test(x.text)));
  // un code → mis en file (Mac en ligne)
  await handleWebhook({ DB: db }, { message: { chat: { id: 1 }, from: { id: 1 }, text: '48213' } }, deps);
  const queue = JSON.parse(db.kv.get('codeQueue'));
  assert.deepEqual(queue.map((q) => q.code), ['48213']);
  // le Mac récupère la file via /push et elle se vide
  const mod = (await import('../relay/worker.js')).default;
  const res = await mod.fetch(new Request('https://r/push', { method: 'POST', headers: { authorization: 'Bearer S', 'content-type': 'application/json' }, body: JSON.stringify(snapshot) }), { DB: db, RELAY_SECRET: 'S' }, { waitUntil() {} });
  const body = await res.json();
  assert.deepEqual(body.codeQueue.map((q) => q.code), ['48213']);
  assert.deepEqual(JSON.parse(db.kv.get('codeQueue')), []);
});

test('webhook : fait coupe les rappels (override pris en compte par le cron)', async () => {
  const { handleWebhook, runOnce } = await import('../relay/worker.js');
  const db = fakeDB(); await seed(db, { lastSeenMinAgo: 10 }); // Mac hors ligne
  const deps = { fetchIcs: async () => icsNow(0), send: async () => {} };
  await handleWebhook({ DB: db }, { message: { chat: { id: 1 }, from: { id: 1 }, text: 'fait' } }, deps);
  const ov = JSON.parse(db.kv.get('overrides'));
  assert.ok(Object.keys(ov.ownerDone).length === 1, 'créneau marqué signé');
  // le cron ne doit plus envoyer de rappel à l'admin pour ce créneau
  const sent = [];
  await runOnce({ DB: db }, new Date(), { fetchIcs: async () => icsNow(0), send: async (t, chat) => sent.push(chat) });
  assert.ok(!sent.includes(1), 'plus de rappel admin après fait');
});

test('webhook : secret d’en-tête invalide → 401', async () => {
  const db = fakeDB(); await seed(db);
  const mod = (await import('../relay/worker.js')).default;
  const res = await mod.fetch(new Request('https://r/tg', { method: 'POST', headers: { 'x-telegram-bot-api-secret-token': 'MAUVAIS', 'content-type': 'application/json' }, body: '{}' }), { DB: db, RELAY_SECRET: 'S' }, { waitUntil() {} });
  assert.equal(res.status, 401);
});
