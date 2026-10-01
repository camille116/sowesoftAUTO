import './helpers.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTelegram } from '../src/telegram.js';

const TOKEN = '123456789:AAHfakeTokenForTestsOnly_abcdefghijk';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Fausse API Telegram : on y pousse des messages, elle enregistre ce que le bot envoie. */
function fakeTelegram({ validToken = TOKEN } = {}) {
  const queue = [];
  const sent = [];
  let updateId = 1;
  const fetchImpl = async (url, { body }) => {
    const [, token, method] = /bot([^/]+)\/(\w+)$/.exec(url);
    const reply = (result) => ({ status: 200, json: async () => ({ ok: true, result }) });
    if (token !== validToken) return { status: 401, json: async () => ({ ok: false, error_code: 401, description: 'Unauthorized' }) };
    if (method === 'getMe') return reply({ username: 'LinkedTest_bot' });
    if (method === 'getUpdates') { await sleep(5); return reply(queue.splice(0)); }
    if (method === 'sendMessage') {
      const data = JSON.parse(body);
      if (data.parse_mode && data.text.includes('[cassé')) return { status: 400, json: async () => ({ ok: false, error_code: 400, description: "Bad Request: can't parse entities" }) };
      sent.push({ method, ...data });
      return reply({ message_id: sent.length });
    }
    if (method === 'sendPhoto') { sent.push({ method, chat_id: body.get('chat_id'), caption: body.get('caption'), photo: body.get('photo') }); return reply({}); }
    return reply(true);
  };
  const push = (chatId, text, first = 'Camille') =>
    queue.push({ update_id: updateId++, message: { text, chat: { id: chatId, type: 'private' }, from: { first_name: first } } });
  return { fetchImpl, push, sent };
}

function setup(opts) {
  const api = fakeTelegram(opts);
  const received = [];
  let ready = 0;
  const dataDir = mkdtempSync(join(tmpdir(), 'tg-'));
  const tg = createTelegram({ dataDir, fetchImpl: api.fetchImpl, pollTimeout: 0, onMessage: async (t) => received.push(t), onReady: () => ready++ });
  return { tg, api, received, dataDir, ready: () => ready };
}

test('se relie avec le code de l’appli, puis n’obéit qu’à cette personne', async () => {
  const { tg, api, received, dataDir, ready } = setup();
  await tg.start(TOKEN);
  assert.equal(tg.state.status, 'waiting_link');
  assert.equal(tg.linkUrl(), `https://t.me/LinkedTest_bot?start=${tg.state.linkCode}`);

  api.push(42, '/start mauvaiscode', 'Inconnu');
  api.push(7, `/start ${tg.state.linkCode}`);
  await sleep(60);
  assert.equal(tg.state.status, 'ready');
  assert.deepEqual(tg.state.owner, { chatId: 7, name: 'Camille' });
  assert.equal(ready(), 1);
  assert.match(api.sent.find((m) => m.chat_id === 42).text, /Relier Telegram/);
  assert.equal(JSON.parse(readFileSync(join(dataDir, 'telegram.json'), 'utf8')).owner.chatId, 7);

  api.push(7, '48213');
  api.push(7, '/planning@LinkedTest_bot');
  api.push(42, '11111', 'Inconnu');
  await sleep(60);
  assert.deepEqual(received, ['48213', 'planning']);
  assert.match(api.sent.filter((m) => m.chat_id === 42).at(-1).text, /privé/);
  tg.stop();
});

test('garde la liaison après un redémarrage', async () => {
  const { dataDir, api } = setup();
  writeFileSync(join(dataDir, 'telegram.json'), JSON.stringify({ owner: { chatId: 7, name: 'Camille' } }));
  const tg = createTelegram({ dataDir, fetchImpl: api.fetchImpl, pollTimeout: 0, onMessage: async () => {} });
  await tg.start(TOKEN);
  assert.equal(tg.state.status, 'ready');
  tg.stop();
});

test('envoi : retire le préfixe 🤖, repli sans mise en forme, capture en photo', async () => {
  const { dataDir, api } = setup();
  writeFileSync(join(dataDir, 'telegram.json'), JSON.stringify({ owner: { chatId: 7, name: 'Camille' } }));
  const tg = createTelegram({ dataDir, fetchImpl: api.fetchImpl, pollTimeout: 0, onMessage: async () => {} });
  await tg.start(TOKEN);

  await tg.send('🤖 ✅ *Signé !*');
  assert.equal(api.sent.at(-1).text, '✅ *Signé !*');
  assert.equal(api.sent.at(-1).parse_mode, 'Markdown');

  await tg.send('🤖 titre [cassé_ *');
  assert.equal(api.sent.at(-1).parse_mode, undefined);

  const shot = join(dataDir, 'shot.png');
  writeFileSync(shot, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  await tg.send('🤖 ✅ Signé', shot);
  assert.equal(api.sent.at(-1).method, 'sendPhoto');
  assert.equal(api.sent.at(-1).chat_id, '7');
  tg.stop();
});

test('token refusé : erreur claire', async () => {
  const { tg } = setup();
  await tg.start('999999:AAHmauvaisTokenmauvaisTokenmauvais12');
  assert.equal(tg.state.status, 'error');
  assert.match(tg.state.error, /Token refusé/);
});

test('délier : un nouveau code est généré', async () => {
  const { dataDir, api } = setup();
  writeFileSync(join(dataDir, 'telegram.json'), JSON.stringify({ owner: { chatId: 7, name: 'Camille' } }));
  const tg = createTelegram({ dataDir, fetchImpl: api.fetchImpl, pollTimeout: 0, onMessage: async () => {} });
  await tg.start(TOKEN);
  const code = tg.state.linkCode;
  tg.unlink();
  assert.equal(tg.state.status, 'waiting_link');
  assert.equal(tg.state.owner, null);
  assert.notEqual(tg.state.linkCode, code);
  tg.stop();
});
