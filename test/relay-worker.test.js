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
