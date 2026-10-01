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

test('format Hyperplanning (OMNES) : détecte « Type : AUTONOMIE », ignore CRS et ELEARNING', () => {
  const hp = parseIcs(readFileSync(new URL('./fixtures/hyperplanning.ics', import.meta.url), 'utf8'));
  const keywords = ['autonomie', 'autonome', 'travail personnel', 'distanciel'];
  const week = [new Date('2026-10-19T00:00:00+02:00'), new Date('2026-10-25T23:59:59+02:00')];
  const sessions = autonomyFromCalendar(hp, keywords, ...week);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].start.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }), '17:30');
  assert.match(sessions[0].title, /^Marketplaces/);

  const withElearning = autonomyFromCalendar(hp, [...keywords, 'elearning'], ...week);
  assert.equal(withElearning.length, 2);
});

test('choix des cours : auto (mots-clés), tous, ou matières cochées', async () => {
  const { coursesFromCalendar, selectCourses, courseInfo } = await import('../src/planning/ics.js');
  const hp = parseIcs(readFileSync(new URL('./fixtures/hyperplanning.ics', import.meta.url), 'utf8'));
  const week = [new Date('2026-10-19T00:00:00+02:00'), new Date('2026-10-25T23:59:59+02:00')];
  const all = coursesFromCalendar(hp, ...week);
  assert.equal(all.length, 3);
  assert.deepEqual(all.map((c) => `${c.subject}|${c.type}`).sort(), ["Marketplaces|AUTONOMIE", 'Marketplaces|CRS', "Outil d'analyse|ELEARNING"]);

  assert.equal(selectCourses(all, { mode: 'auto' }, ['autonomie']).length, 1);
  assert.equal(selectCourses(all, { mode: 'all' }).length, 3);
  assert.deepEqual(selectCourses(all, { mode: 'custom', subjects: ['marketplaces'] }).map((c) => c.type).sort(), ['AUTONOMIE', 'CRS']);
  assert.equal(selectCourses(all, { mode: 'custom', subjects: [] }).length, 0);

  assert.deepEqual(courseInfo({ summary: 'Anglais - TD - CRS', description: '' }), { subject: 'Anglais', type: 'CRS' });
});

test('liste des matières pour l’appli', async () => {
  const hp = readFileSync(new URL('./fixtures/hyperplanning.ics', import.meta.url), 'utf8');
  const planning = new Planning({ icsUrl: 'http://x', keywords: ['autonomie'], manual: {} }, { fetcher: async () => parseIcs(hp) });
  const subjects = await planning.subjects(new Date('2026-10-19T00:00:00+02:00'), new Date('2026-10-25T23:59:59+02:00'));
  const market = subjects.find((s) => s.subject === 'Marketplaces');
  assert.equal(market.count, 2);
  assert.deepEqual(market.types, ['AUTONOMIE', 'CRS']);

  planning.notify = { mode: 'custom', subjects: ["Outil d'analyse"] };
  const sessions = await planning.between(new Date('2026-10-19T00:00:00+02:00'), new Date('2026-10-25T23:59:59+02:00'));
  assert.deepEqual(sessions.map((s) => s.subject), ["Outil d'analyse"]);
});

test('salles, bâtiment et campus (format OMNES)', async () => {
  const { coursesFromCalendar, parseRooms, calendarCampus } = await import('../src/planning/ics.js');
  const hp = parseIcs(readFileSync(new URL('./fixtures/hyperplanning.ics', import.meta.url), 'utf8'));
  assert.equal(calendarCampus(hp), 'Paris');
  const courses = coursesFromCalendar(hp, new Date('2026-10-19T00:00:00+02:00'), new Date('2026-10-25T23:59:59+02:00'));
  const crs = courses.find((c) => c.type === 'CRS');
  assert.deepEqual(crs.rooms.map((r) => r.label), ['EM009 · Eiffel 1', 'P436 · Eiffel 2']);
  assert.equal(crs.rooms[0].kind, 'Amphithéâtre');
  assert.equal(crs.campus, 'Paris');
  const auto = courses.find((c) => c.type === 'AUTONOMIE');
  assert.deepEqual(auto.rooms.map((r) => r.label), ['C-3.12 · Eiffel 3'], 'salle lue dans la description');
  assert.deepEqual(courses.find((c) => c.type === 'ELEARNING').rooms, []);
  assert.deepEqual(parseRooms({ location: 'Salle G006 - EIFFEL 4 (Meet-up)' }).map((r) => r.label), ['G006 · Eiffel 4']);
});
