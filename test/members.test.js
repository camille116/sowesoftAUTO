import './helpers.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Members, normalizePhone } from '../src/members.js';
import { createTelegram } from '../src/telegram.js';
import { Bot } from '../src/bot.js';
import { Planning } from '../src/planning/index.js';
import { renderTemplate } from '../src/messages.js';
import { memoryStore } from './helpers.js';

const TOKEN = '123456789:AAHfakeTokenForTestsOnly_abcdefghijk';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dir = () => mkdtempSync(join(tmpdir(), 'members-'));

test('numéros : formats français et internationaux', () => {
  assert.equal(normalizePhone('06 12 34 56 78'), '33612345678');
  assert.equal(normalizePhone('+33 6 12 34 56 78'), '33612345678');
  assert.equal(normalizePhone('0033612345678'), '33612345678');
  assert.equal(normalizePhone('33612345678'), '33612345678');
  assert.equal(normalizePhone('12'), '');
});

test('ajout, doublon, pause et suppression', () => {
  const m = new Members(dir());
  const lea = m.add({ name: 'Léa', phone: '06 12 34 56 78' });
  assert.equal(lea.status, 'invited');
  assert.throws(() => m.add({ name: 'Autre', phone: '+33612345678' }), /déjà/);
  assert.throws(() => m.add({ name: '', phone: '0611111111' }), /prénom/);
  assert.equal(m.byPhone('+33 6 12 34 56 78'), lea);
  m.link(lea, 99, 'Léa M.');
  m.setPaused(lea, true);
  assert.equal(lea.status, 'paused');
  m.remove(lea.id);
  assert.equal(m.all().length, 0);
  assert.equal(new Members(m.file.replace(/members\.json$/, '')).all().length, 0, 'persisté');
});

/** Fausse API Telegram (comme dans telegram.test.js) */
function fakeApi() {
  const queue = []; const sent = []; let id = 1;
  const fetchImpl = async (url, { body }) => {
    const method = url.split('/').pop();
    const ok = (result) => ({ status: 200, json: async () => ({ ok: true, result }) });
    if (method === 'getMe') return ok({ username: 'LinkedTest_bot' });
    if (method === 'getUpdates') { await sleep(5); return ok(queue.splice(0)); }
    if (method === 'sendMessage') { sent.push(JSON.parse(body)); return ok({}); }
    return ok(true);
  };
  const push = (message) => queue.push({ update_id: id++, message: { chat: { type: 'private', id: message.from.id }, ...message } });
  return { fetchImpl, push, sent };
}

test('un camarade rejoint en partageant SON numéro (pas celui d’un autre)', async () => {
  const d = dir();
  const members = new Members(d);
  const lea = members.add({ name: 'Léa', phone: '0612345678' });
  const api = fakeApi();
  const joined = [];
  const tg = createTelegram({
    dataDir: d, fetchImpl: api.fetchImpl, pollTimeout: 0, members,
    onMessage: async () => {}, onMemberLinked: (m) => joined.push(m.name), onMemberMessage: async () => {},
  });
  // le bot est déjà relié à l'admin
  tg.state.owner = { chatId: 1, name: 'Admin' };
  await tg.start(TOKEN);

  api.push({ from: { id: 50, first_name: 'Léa' }, text: '/start' });
  await sleep(40);
  assert.ok(api.sent.at(-1).reply_markup.keyboard[0][0].request_contact, 'propose « Partager mon numéro »');

  // tentative avec le contact de quelqu'un d'autre
  api.push({ from: { id: 50, first_name: 'Léa' }, contact: { phone_number: '+33612345678', user_id: 777 } });
  await sleep(40);
  assert.equal(lea.status, 'invited');
  assert.match(api.sent.at(-1).text, /ton\* numéro/);

  // numéro inconnu
  api.push({ from: { id: 60, first_name: 'Max' }, contact: { phone_number: '+33699999999', user_id: 60 } });
  await sleep(40);
  assert.match(api.sent.at(-1).text, /pas dans la liste/);

  // son propre numéro
  api.push({ from: { id: 50, first_name: 'Léa' }, contact: { phone_number: '+33612345678', user_id: 50 } });
  await sleep(40);
  assert.equal(lea.status, 'active');
  assert.equal(lea.chatId, 50);
  assert.deepEqual(joined, ['Léa']);
  tg.stop();
});

test('lien d’invitation personnel', async () => {
  const d = dir();
  const members = new Members(d);
  const tom = members.add({ name: 'Tom', phone: '0611111111' });
  const api = fakeApi();
  const tg = createTelegram({ dataDir: d, fetchImpl: api.fetchImpl, pollTimeout: 0, members, onMessage: async () => {}, onMemberLinked: () => {} });
  await tg.start(TOKEN);
  assert.equal(tg.inviteUrl(tom), `https://t.me/LinkedTest_bot?start=${tom.inviteCode}`);
  api.push({ from: { id: 70, first_name: 'Tom' }, text: `/start ${tom.inviteCode}` });
  await sleep(40);
  assert.equal(tom.chatId, 70);
  tg.stop();
});

function classBot() {
  const members = new Members(dir());
  const lea = members.add({ name: 'Léa', phone: '0612345678' });
  members.link(lea, 50, 'Léa');
  const toMembers = [];
  const bot = new Bot({
    planning: new Planning({ icsUrl: '', keywords: [], manual: { weekly: [{ day: 'mardi', start: '13:30', end: '17:00', title: 'Autonomie projet' }] } }),
    store: memoryStore(), signer: { busy: false }, offsets: [0, 15], dryRun: false,
    send: async () => {}, members, sendToMember: async (m, text) => toMembers.push({ name: m.name, text }),
    memberTemplate: 'Hey {prenom} ! Signe {cours} ({debut}–{fin}) {moment}',
  });
  return { bot, members, lea, toMembers };
}
const at = (hhmm) => new Date(`2026-10-06T${hhmm}:00+02:00`);

test('rappels de la classe avec le message personnalisé, puis « fait » et « stop »', async () => {
  const { bot, lea, toMembers } = classBot();
  await bot.tick(at('13:30'));
  assert.deepEqual(toMembers, [{ name: 'Léa', text: 'Hey Léa ! Signe Autonomie projet (13:30–17:00) maintenant' }]);

  await bot.handleMember(lea, 'fait', at('13:40'));
  assert.match(toMembers.at(-1).text, /plus de relance/);
  await bot.tick(at('13:46'));
  assert.equal(toMembers.filter((m) => m.text.startsWith('Hey')).length, 1, 'plus de relance après « fait »');

  await bot.handleMember(lea, 'stop', at('14:00'));
  assert.equal(lea.status, 'paused');
  await bot.handleMember(lea, '48213', at('14:00'));
  assert.match(toMembers.at(-1).text, /Je ne signe pas à ta place/);
});

test('modèle de message : variables', () => {
  const session = { subject: 'Anglais', type: 'CRS', start: at('09:00'), end: at('10:30') };
  assert.equal(renderTemplate('{prenom}·{cours}·{type}·{debut}·{fin}·{moment}·{inconnu}', { member: { name: 'Zoé' }, session, offset: -5 }),
    'Zoé·Anglais·CRS·09:00·10:30·dans 5 min·{inconnu}');
});
