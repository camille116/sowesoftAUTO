import './helpers.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { relayHandle } from '../src/relay/handle.js';
import { parseIcsLite, coursesFromLite } from '../src/planning/ics-lite.js';

function courses(offsetMin, type = 'AUTONOMIE', subject = 'Marketplaces') {
  const now = new Date();
  const d = (min) => new Date(now.getTime() + min * 60e3).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const ics = ['BEGIN:VCALENDAR', 'X-WR-TIMEZONE:Europe/Paris', 'BEGIN:VEVENT', 'UID:x',
    `DTSTART:${d(offsetMin)}`, `DTEND:${d(offsetMin + 120)}`, `SUMMARY:${subject} - ${type}`,
    `DESCRIPTION:Matière : ${subject}\\nSalle : Salle G006 - EIFFEL 4\\nType : ${type}\\n`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  return coursesFromLite(parseIcsLite(ics), new Date(now.getTime() - 12 * 3600e3), new Date(now.getTime() + 36 * 3600e3));
}

const snapshot = {
  owner: { chatId: 9, done: {} },
  members: [{ id: 'a', name: 'Léa', phone: '33612345678', chatId: 50, status: 'active', inviteCode: 'abcde', done: {} }],
  keywords: ['autonomie'], notify: { mode: 'auto' }, offsets: [-5, 0, 15], memberTemplate: '{prenom}',
};
const msgUpdate = (chatId, text, extra = {}) => ({ message: { chat: { id: chatId }, from: { id: chatId, first_name: 'X' }, text, ...extra } });

test('admin /demain Mac éteint : le cloud répond avec salle et campus', () => {
  const r = relayHandle({ update: msgUpdate(9, '/demain'), snapshot, coursesTomorrow: courses(24 * 60), macOnline: false });
  assert.equal(r.replies[0].chatId, 9);
  assert.match(r.replies[0].text, /Demain/);
  assert.match(r.replies[0].text, /EIFFEL 4|Eiffel 4/);
});

test('admin code Mac éteint : refuse de signer', () => {
  const r = relayHandle({ update: msgUpdate(9, '48213'), snapshot, coursesToday: courses(0), macOnline: false });
  assert.equal(r.signCode, null);
  assert.match(r.replies[0].text, /éteint/i);
});

test('admin code Mac allumé : met le code en file pour le Mac', () => {
  const r = relayHandle({ update: msgUpdate(9, '48213'), snapshot, coursesToday: courses(0), macOnline: true });
  assert.deepEqual(r.signCode, { code: '48213' });
  assert.match(r.replies[0].text, /transmis/i);
});

test('admin fait : marque le créneau signé dans les overrides', () => {
  const r = relayHandle({ update: msgUpdate(9, 'fait'), snapshot, coursesToday: courses(0), macOnline: false });
  const id = Object.keys(r.overrides.ownerDone)[0];
  assert.ok(id, 'un créneau marqué');
  assert.match(r.replies[0].text, /Noté/);
});

test('membre /planning et fait', () => {
  const day = courses(0);
  const r = relayHandle({ update: msgUpdate(50, 'planning'), snapshot, coursesToday: day });
  assert.match(r.replies[0].text, /Marketplaces/);
  const r2 = relayHandle({ update: msgUpdate(50, 'fait'), snapshot, coursesToday: day });
  assert.ok(Object.keys(r2.overrides.members.a.done).length === 1);
});

test('membre ne peut pas signer', () => {
  const r = relayHandle({ update: msgUpdate(50, '48213'), snapshot, coursesToday: courses(0) });
  assert.match(r.replies[0].text, /ne signe pas/i);
});

test('camarade partage son numéro Mac éteint : lié dans les overrides', () => {
  const snap = { ...snapshot, members: [{ id: 'b', name: 'Tom', phone: '33698765432', chatId: null, status: 'invited', inviteCode: 'zzzzz', done: {} }] };
  const r = relayHandle({ update: msgUpdate(70, '', { contact: { phone_number: '+33698765432', user_id: 70 } }), snapshot: snap });
  assert.equal(r.overrides.members.b.chatId, 70);
  assert.equal(r.overrides.members.b.status, 'active');
  assert.match(r.replies[0].text, /Tom/);
});

test('numéro inconnu refusé', () => {
  const r = relayHandle({ update: msgUpdate(71, '', { contact: { phone_number: '+33600000000', user_id: 71 } }), snapshot });
  assert.match(r.replies[0].text, /pas dans la liste/);
});

test('inconnu sans classe : bot privé', () => {
  const r = relayHandle({ update: msgUpdate(123, 'coucou'), snapshot: { owner: { chatId: 9 }, members: [] } });
  assert.match(r.replies[0].text, /privé/);
});
