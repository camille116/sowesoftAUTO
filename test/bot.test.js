import './helpers.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Bot } from '../src/bot.js';
import { Planning } from '../src/planning/index.js';
import { memoryStore } from './helpers.js';

const manual = { weekly: [{ day: 'mardi', start: '13:30', end: '17:00', title: 'Autonomie projet' }] };
const at = (hhmm) => new Date(`2026-10-06T${hhmm}:00+02:00`); // un mardi

function setup(signResult = { ok: true, screenshot: '/tmp/x.png' }) {
  const sent = [];
  const store = memoryStore();
  const signer = { busy: false, calls: [], async sign(code) { this.calls.push(code); return signResult; }, async check() { return { ok: true }; } };
  const bot = new Bot({
    planning: new Planning({ icsUrl: '', keywords: [], manual }),
    store, signer, offsets: [-5, 0, 15], dryRun: false,
    send: async (text, image) => sent.push({ text, image }),
  });
  return { bot, sent, store, signer };
}

test('envoie le rappel au début du créneau, une seule fois', async () => {
  const { bot, sent } = setup();
  await bot.tick(at('13:30'));
  await bot.tick(at('13:31'));
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /C'est l'heure de signer/);
});

test('un code envoyé signe et coupe les rappels', async () => {
  const { bot, sent, signer } = setup();
  await bot.handle('4821', at('13:32'));
  assert.deepEqual(signer.calls, ['4821']);
  assert.match(sent.at(-1).text, /Signé/);
  assert.equal(sent.at(-1).image, '/tmp/x.png');
  const count = sent.length;
  await bot.tick(at('13:50'));
  assert.equal(sent.length, count, 'plus de rappel après signature');
});

test('échec de signature : le bot prévient et continue de relancer', async () => {
  const { bot, sent } = setup({ ok: false, reason: 'code expiré' });
  await bot.handle('code 1111', at('13:32'));
  assert.match(sent.at(-1).text, /code expiré/);
  await bot.tick(at('13:46'));
  assert.match(sent.at(-1).text, /rappel/i);
});

test('« fait » marque le créneau comme signé', async () => {
  const { bot, sent, store } = setup();
  await bot.handle('fait', at('14:00'));
  assert.match(sent.at(-1).text, /Noté/);
  await bot.tick(at('14:00'));
  assert.equal(sent.length, 1);
  assert.equal(Object.values(store.state.sessions)[0].signedBy, 'manuel');
});

test('pause coupe les rappels', async () => {
  const { bot, sent } = setup();
  await bot.handle('pause', at('13:00'));
  await bot.tick(at('13:30'));
  assert.equal(sent.length, 1);
});

test('planning du jour', async () => {
  const { bot, sent } = setup();
  await bot.handle('planning', at('09:00'));
  assert.match(sent[0].text, /13:30–17:00 · Autonomie projet/);
});
