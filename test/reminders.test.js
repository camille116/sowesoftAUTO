import './helpers.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dueReminders } from '../src/reminders.js';
import { makeSession } from '../src/planning/session.js';
import { memoryStore } from './helpers.js';

const session = makeSession({
  title: 'Autonomie', start: new Date('2026-10-06T13:30:00+02:00'), end: new Date('2026-10-06T17:00:00+02:00'),
});
const offsets = [-5, 0, 15, 45];
const at = (hhmm) => new Date(`2026-10-06T${hhmm}:00+02:00`);

test('rien avant le premier palier', () => {
  assert.deepEqual(dueReminders([session], memoryStore(), offsets, at('13:20')), []);
});

test('rappel 5 min avant puis au début', () => {
  const store = memoryStore();
  let due = dueReminders([session], store, offsets, at('13:25'));
  assert.equal(due.length, 1);
  assert.equal(due[0].offset, -5);
  store.update(session.id, { reminderIndex: due[0].index });

  assert.deepEqual(dueReminders([session], store, offsets, at('13:27')), []);
  due = dueReminders([session], store, offsets, at('13:30'));
  assert.equal(due[0].offset, 0);
});

test('après un redémarrage, un seul message pour le dernier palier atteint', () => {
  const due = dueReminders([session], memoryStore(), offsets, at('14:30'));
  assert.equal(due.length, 1);
  assert.equal(due[0].offset, 45);
  assert.equal(due[0].isLast, true);
});

test('plus de rappel une fois signé, ignoré ou terminé', () => {
  const store = memoryStore();
  store.markSigned(session.id, 'bot');
  assert.deepEqual(dueReminders([session], store, offsets, at('14:00')), []);
  assert.deepEqual(dueReminders([session], memoryStore(), offsets, at('17:30')), []);
});
