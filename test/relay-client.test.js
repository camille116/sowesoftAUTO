import './helpers.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRelayClient } from '../src/relay-client.js';
import { memoryStore } from './helpers.js';

function setup() {
  const settings = { values: { icsUrl: 'https://x/ical', keywords: ['autonomie'], notify: { mode: 'auto' }, reminderOffsets: [0, 15], memberTemplate: '{prenom}', telegramToken: 'T', relayUrl: 'https://r.workers.dev', relaySecret: 'K' }, get() { return this.values; } };
  const store = memoryStore();
  store.update('sess1', { reminderIndex: 1 });
  store.update('sess2', { signedAt: 'now' });
  const members = {
    list: [{ id: 'a', name: 'Léa', chatId: 50, status: 'active', sessions: { sess1: { reminderIndex: 0 } } }],
    all() { return this.list; },
    markReminded(m, id, i) { m.sessions[id] = { reminderIndex: i }; },
  };
  const telegram = { state: { owner: { chatId: 9 } } };
  return { settings, store, members, telegram };
}

test('snapshot : réglages, done de l’admin, membres actifs, et « déjà rappelé »', () => {
  const { settings, store, members, telegram } = setup();
  const relay = createRelayClient({ settings, store, members, telegram, fetchImpl: async () => {} });
  const snap = relay.snapshot();
  assert.equal(snap.icsUrl, 'https://x/ical');
  assert.equal(snap.owner.chatId, 9);
  assert.equal(snap.owner.done.sess2, true);
  assert.equal(snap.members.length, 1);
  assert.equal(snap.reminded['9:sess1'], 1);
  assert.equal(snap.reminded['50:sess1'], 0);
});

test('push : envoie le snapshot avec la clé et fusionne le sent reçu', async () => {
  const { settings, store, members, telegram } = setup();
  let seen;
  const fetchImpl = async (url, opts) => {
    seen = { url, auth: opts.headers.authorization, body: JSON.parse(opts.body) };
    return { ok: true, json: async () => ({ sent: { '9:sess1': 5, '50:sess1': 3 } }) };
  };
  const relay = createRelayClient({ settings, store, members, telegram, fetchImpl });
  await relay.push();
  assert.equal(seen.url, 'https://r.workers.dev/push');
  assert.equal(seen.auth, 'Bearer K');
  // le relais était plus avancé → l'état du Mac est mis à jour (anti-doublon)
  assert.equal(store.session('sess1').reminderIndex, 5);
  assert.equal(members.all()[0].sessions.sess1.reminderIndex, 3);
});

test('test() : clé incorrecte → message clair', async () => {
  const { settings, store, members, telegram } = setup();
  const relay = createRelayClient({ settings, store, members, telegram, fetchImpl: async () => ({ status: 401, ok: false }) });
  await assert.rejects(relay.test('https://r.workers.dev', 'mauvaise'), /incorrecte/);
});
