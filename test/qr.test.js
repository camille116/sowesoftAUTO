import './helpers.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import QRCode from 'qrcode';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { decodeQr } from '../src/qr.js';
import { parseCommand, sowesignUrl } from '../src/commands.js';
import { relayHandle } from '../src/relay/handle.js';
import { Bot } from '../src/bot.js';
import { Planning } from '../src/planning/index.js';
import { memoryStore } from './helpers.js';

const LINK = 'https://app.sowesign.com/student/qr/AbC123xYz?c=48213';
const qrPng = (text) => QRCode.toBuffer(text, { margin: 4, scale: 8 });

test('décode un QR code PNG', async () => {
  assert.equal(decodeQr(await qrPng(LINK)), LINK);
});

test('décode un QR code JPEG (ce que Telegram envoie pour une photo)', async () => {
  const png = PNG.sync.read(await qrPng('48213'));
  const jpg = jpeg.encode({ data: png.data, width: png.width, height: png.height }, 90).data;
  assert.equal(decodeQr(Buffer.from(jpg)), '48213');
});

test('image sans QR, vide ou corrompue : null, sans exception', () => {
  const blank = new PNG({ width: 80, height: 80 });
  blank.data.fill(255);
  assert.equal(decodeQr(PNG.sync.write(blank)), null);
  assert.equal(decodeQr(Buffer.from('pas une image')), null);
  assert.equal(decodeQr(Buffer.alloc(0)), null);
  assert.equal(decodeQr(null), null);
});

test('liens : seul https + sowesign.com est accepté (la session connectée ne s’ouvre pas n’importe où)', () => {
  assert.equal(sowesignUrl(`regarde ${LINK}.`), LINK); // ponctuation finale retirée, casse conservée
  assert.equal(sowesignUrl('https://sowesign.com/x'), 'https://sowesign.com/x');
  for (const bad of ['http://app.sowesign.com/x', 'https://evil.com/x', 'https://sowesign.com.evil.com/x',
    'https://app.sowesign.com@evil.com/x', 'https://user:pw@app.sowesign.com/x', 'https://notsowesign.com/x', 'bonjour']) {
    assert.equal(sowesignUrl(bad), null, bad);
  }
  assert.deepEqual(parseCommand(LINK), { type: 'link', url: LINK });
  assert.equal(parseCommand('https://evil.com/x').type, 'unknown');
});

function botWith(signLink) {
  const sent = [];
  const signer = { busy: false, signLinkCalls: [], async signLink(url) { this.signLinkCalls.push(url); return signLink; }, async sign() { return { ok: true }; } };
  const bot = new Bot({
    planning: new Planning({ icsUrl: '', keywords: [], manual: { weekly: [], dates: [] } }),
    store: memoryStore(), signer, offsets: [0], dryRun: false,
    send: async (text, image) => sent.push({ text, image }),
  });
  return { bot, sent, signer };
}

test('photo d’un QR contenant un lien SoWeSoft : le bot signe via ce lien', async () => {
  const { bot, sent, signer } = botWith({ ok: true, screenshot: '/tmp/x.png' });
  await bot.handlePhoto(await qrPng(LINK));
  assert.deepEqual(signer.signLinkCalls, [LINK]);
  assert.ok(sent.some((s) => /Signé/.test(s.text)));
  assert.ok(!sent.some((s) => s.text.includes('AbC123xYz')), 'le jeton du lien n’est jamais renvoyé');
});

test('lien envoyé en texte : même chemin que le QR ; lien qui demande un code : on le dit', async () => {
  const { bot, sent, signer } = botWith({ ok: false, needsCode: true });
  await bot.handle(LINK);
  assert.deepEqual(signer.signLinkCalls, [LINK]);
  assert.match(sent.at(-1).text, /code à 5 chiffres/);
});

test('QR au contenu inconnu ou image sans QR : rien n’est signé', async () => {
  const { bot, sent, signer } = botWith({ ok: true });
  await bot.handlePhoto(await qrPng('https://evil.com/phishing'));
  assert.match(sent.at(-1).text, /appli SoWeSign/);
  await bot.handlePhoto(Buffer.from('rien'));
  assert.match(sent.at(-1).text, /pas de QR code lisible/);
  assert.equal(signer.signLinkCalls.length, 0);
});

const snapshot = { owner: { chatId: 1, done: {} }, members: [], keywords: ['autonomie'], notify: { mode: 'auto' } };
const relay = (message, macOnline) => relayHandle({ update: { message: { chat: { id: 1 }, from: { id: 1 }, ...message } }, snapshot, macOnline });

test('relais : photo et lien mis en file pour le Mac (s’il est allumé)', () => {
  assert.deepEqual(relay({ photo: [{ file_id: 'small' }, { file_id: 'big' }] }, true).signCode, { photo: 'big' });
  assert.deepEqual(relay({ text: LINK }, true).signCode, { code: LINK });
  assert.equal(relay({ photo: [{ file_id: 'x' }] }, false).signCode, null);
  assert.match(relay({ text: LINK }, false).replies[0].text, /Mac est éteint/);
});

test('relais : la photo d’un inconnu est ignorée', () => {
  const r = relayHandle({ update: { message: { chat: { id: 99 }, from: { id: 99 }, photo: [{ file_id: 'x' }] } }, snapshot, macOnline: true });
  assert.equal(r.signCode, null);
  assert.equal(r.replies.length, 0);
});

test('Telegram : la photo du propriétaire est téléchargée et lue, celle d’un inconnu est ignorée', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { createTelegram } = await import('../src/telegram.js');
  const dataDir = mkdtempSync(join(tmpdir(), 'tg-'));
  writeFileSync(join(dataDir, 'telegram.json'), JSON.stringify({ owner: { chatId: 1, name: 'C' } }));
  const png = await qrPng('48213');
  const asked = [];
  const fetchImpl = async (url) => {
    if (url.includes('/file/bot')) return { ok: true, arrayBuffer: async () => png.buffer.slice(png.byteOffset, png.byteOffset + png.length) };
    asked.push(url.split('/').pop());
    return { ok: true, json: async () => ({ ok: true, result: url.endsWith('/getFile') ? { file_path: 'photos/p.jpg', file_size: png.length } : { username: 'bot' } }) };
  };
  const got = [];
  const tg = createTelegram({ dataDir, fetchImpl, onMessage: () => {}, onPhoto: async (buf) => got.push(decodeQr(buf)) });
  await tg.start('123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef', { sendOnly: true });
  const photo = (chatId) => ({ message: { chat: { id: chatId, type: 'private' }, from: { id: chatId }, photo: [{ file_id: 'a' }, { file_id: 'b' }] } });
  await tg.handleUpdate(photo(1));
  await tg.handleUpdate(photo(2)); // inconnu
  assert.deepEqual(got, ['48213']);
  assert.equal(asked.filter((x) => x === 'getFile').length, 1, 'le fichier de l’inconnu n’est même pas téléchargé');
});
