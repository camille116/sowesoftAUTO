import './helpers.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { manualSessions } from '../src/planning/manual.js';
import { parseIcs, autonomyFromCalendar } from '../src/planning/ics.js';
import { Planning } from '../src/planning/index.js';

const ics = parseIcs(readFileSync(new URL('./fixtures/agenda.ics', import.meta.url), 'utf8'));
const from = new Date('2026-10-05T00:00:00+02:00');
const to = new Date('2026-10-11T23:59:59+02:00');

test('ICS : ne garde que les créneaux d’autonomie (titre ou description), hors journées entières', () => {
  const sessions = autonomyFromCalendar(ics, ['autonomie'], from, to);
  assert.deepEqual(
    sessions.map((s) => s.start.toISOString()).sort(),
    ['2026-10-06T11:30:00.000Z', '2026-10-08T07:00:00.000Z'],
  );
});

test('ICS : les événements récurrents sont dépliés', () => {
  const month = autonomyFromCalendar(ics, ['autonomie'], from, new Date('2026-11-30T00:00:00Z'));
  assert.equal(month.filter((s) => s.title === 'Projet Brand').length, 4);
});

test('planning manuel : créneaux hebdo, dates ponctuelles et exceptions', () => {
  const manual = {
    weekly: [{ day: 'mardi', start: '13:30', end: '17:00', title: 'Auto' }],
    dates: [{ date: '2026-10-10', start: '09:00', end: '10:00' }],
    exceptions: ['2026-10-13'],
  };
  const sessions = manualSessions(manual, from, new Date('2026-10-20T00:00:00+02:00'));
  assert.deepEqual(sessions.map((s) => s.start.toISOString()), [
    '2026-10-06T11:30:00.000Z', // mardi 6
    '2026-10-10T07:00:00.000Z', // date ponctuelle
  ]);
});

test('fusion ICS + manuel sans doublon, et créneau courant', async () => {
  const planning = new Planning(
    { icsUrl: 'http://fake', keywords: ['autonomie'], manual: { weekly: [{ day: 'mardi', start: '13:30', end: '17:00' }] } },
    { fetcher: async () => ics },
  );
  const sessions = await planning.between(from, to);
  assert.equal(sessions.length, 2);
  const current = await planning.current(new Date('2026-10-06T14:00:00+02:00'));
  assert.equal(current.title, 'Projet Brand');
  const early = await planning.current(new Date('2026-10-06T13:25:00+02:00'));
  assert.ok(early, '5 min avant compte comme créneau en cours');
  assert.equal(await planning.current(new Date('2026-10-06T18:00:00+02:00')), null);
});
