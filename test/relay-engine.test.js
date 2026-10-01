import './helpers.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { computeReminders } = await import('../src/relay/engine.js');

// Agenda avec un créneau d'autonomie « aujourd'hui » autour de maintenant
function icsWith(startMin, durMin = 120, type = 'AUTONOMIE', subject = 'Marketplaces') {
  const now = new Date();
  const d = (min) => new Date(now.getTime() + min * 60e3).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'X-WR-TIMEZONE:Europe/Paris', 'BEGIN:VEVENT', 'UID:x',
    `DTSTART:${d(startMin)}`, `DTEND:${d(startMin + durMin)}`,
    `SUMMARY:${subject} - ${type}`, `DESCRIPTION:Matière : ${subject}\\nType : ${type}\\n`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
}

const base = {
  keywords: ['autonomie'], notify: { mode: 'auto' }, offsets: [-5, 0, 15],
  memberTemplate: '{prenom} : signe {cours} !', owner: { chatId: 1, done: {} },
  members: [{ id: 'a', name: 'Léa', chatId: 50, status: 'active', done: {} }],
};

test('au début du créneau : rappel à l’admin et à chaque membre actif', () => {
  const { actions, sentUpdates } = computeReminders(base, {}, icsWith(0));
  assert.deepEqual(actions.map((a) => a.chatId).sort(), [1, 50]);
  assert.match(actions.find((a) => a.chatId === 1).text, /signer/i);
  assert.equal(actions.find((a) => a.chatId === 50).text, 'Léa : signe Marketplaces !');
  assert.equal(Object.keys(sentUpdates).length, 2);
});

test('pas de doublon : ce qui est déjà envoyé n’est pas renvoyé', () => {
  const first = computeReminders(base, {}, icsWith(0));
  const sent = first.sentUpdates;
  const second = computeReminders(base, sent, icsWith(0));
  assert.deepEqual(second.actions, []);
});

test('membre en pause ou créneau signé : pas de rappel', () => {
  const snap = {
    ...base,
    owner: { chatId: 1, done: { } },
    members: [{ id: 'a', name: 'Léa', chatId: 50, status: 'paused', done: {} }],
  };
  const { actions } = computeReminders(snap, {}, icsWith(0));
  assert.deepEqual(actions.map((a) => a.chatId), [1], 'seul l’admin');

  // admin a signé
  const signed = { ...base, owner: { chatId: 1, done: {} }, members: [] };
  const courses = computeReminders(signed, {}, icsWith(0));
  const sid = courses.actions[0].key.split(':')[1];
  const snap2 = { ...signed, owner: { chatId: 1, done: { [sid]: true } } };
  assert.deepEqual(computeReminders(snap2, {}, icsWith(0)).actions, []);
});

test('rappels en pause (admin) : rien', () => {
  const { actions } = computeReminders({ ...base, paused: true, members: [] }, {}, icsWith(0));
  assert.deepEqual(actions, []);
});

test('avant le premier palier : rien', () => {
  assert.deepEqual(computeReminders(base, {}, icsWith(30)).actions, []);
});

test('agenda illisible : pas d’erreur, rien à envoyer', () => {
  assert.deepEqual(computeReminders(base, {}, 'pas du ical').actions, []);
});

test('mode « tous les cours » : un CRS déclenche aussi un rappel', () => {
  const snap = { ...base, notify: { mode: 'all' }, members: [] };
  const { actions } = computeReminders(snap, {}, icsWith(0, 120, 'CRS'));
  assert.equal(actions.length, 1);
});
