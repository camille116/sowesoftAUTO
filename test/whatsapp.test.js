import './helpers.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWhatsApp } from '../src/whatsapp.js';

const OWNER = '33612345678';

/** Faux client whatsapp-web.js : seule la discussion rangée sous le LID existe (cas réel « Moi »). */
function fakeClient({ selfBot = true } = {}) {
  const c = new EventEmitter();
  c.sent = [];
  c.info = { wid: { user: selfBot ? OWNER : '33700000000', _serialized: selfBot ? `${OWNER}@c.us` : '33700000000@c.us' } };
  c.pupPage = { evaluate: async () => (selfBot ? '111@lid' : '222@lid') };
  c.initialize = async () => {};
  c.destroy = async () => {};
  c.getNumberId = async () => ({ _serialized: `${OWNER}@c.us` });
  c.getContactLidAndPhone = async () => [{ lid: '111@lid', pn: `${OWNER}@c.us` }];
  c.sendMessage = async (chatId, text) => {
    if (chatId !== '111@lid') return undefined; // getChat() introuvable → whatsapp-web.js renvoie undefined
    c.sent.push({ chatId, text });
    return { id: { _serialized: `msg-${c.sent.length}` } };
  };
  return c;
}

function setup(opts) {
  const received = [];
  const client = fakeClient(opts);
  const wa = createWhatsApp({
    ownerNumber: OWNER,
    dataDir: mkdtempSync(join(tmpdir(), 'wa-')),
    browser: {},
    onMessage: async (text) => received.push(text),
    clientFactory: () => client,
  });
  return { wa, client, received };
}

test('envoie dans la discussion « Moi » même quand WhatsApp la range sous un LID', async () => {
  const { wa, client } = setup();
  await wa.start();
  client.emit('ready');
  assert.equal(wa.state.status, 'ready');
  await wa.send('🤖 test');
  assert.deepEqual(client.sent, [{ chatId: '111@lid', text: '🤖 test' }]);
  await wa.send('🤖 encore');
  assert.equal(client.sent.length, 2, 'garde le bon destinataire');
});

test('erreur claire si aucune discussion n’est trouvée', async () => {
  const { wa, client } = setup();
  client.sendMessage = async () => undefined;
  await wa.start();
  client.emit('ready');
  await assert.rejects(wa.send('🤖 test'), /discussion WhatsApp introuvable/);
});

test('écoute tes messages dans « Moi » (LID) et ignore ses propres réponses', async () => {
  const { wa, client, received } = setup();
  await wa.start();
  client.emit('ready');
  const msg = (body, extra = {}) => ({ id: { _serialized: `in-${Math.random()}` }, type: 'chat', body, fromMe: true, to: '111@lid', ...extra });
  client.emit('message_create', msg('48213'));
  client.emit('message_create', msg('🤖 réponse du bot'));
  client.emit('message_create', msg('pour un ami', { to: '33699999999@c.us' }));
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(received, ['48213']);
});

test('bot sur un 2e numéro : reconnaît le propriétaire par son LID', async () => {
  const { wa, client, received } = setup({ selfBot: false });
  await wa.start();
  client.emit('ready');
  client.emit('message_create', { id: { _serialized: 'a' }, type: 'chat', body: 'aide', fromMe: false, from: '111@lid', getContact: async () => ({ number: '' }) });
  client.emit('message_create', { id: { _serialized: 'b' }, type: 'chat', body: 'spam', fromMe: false, from: '999@lid', getContact: async () => ({ number: '33611111111' }) });
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(received, ['aide']);
});
