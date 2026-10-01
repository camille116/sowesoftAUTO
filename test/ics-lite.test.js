import './helpers.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseIcs, coursesFromCalendar } from '../src/planning/ics.js';
import { parseIcsLite, coursesFromLite, zonedTime } from '../src/planning/ics-lite.js';

const read = (f) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8');
const pick = (list) => list.map((c) => ({ id: c.id, subject: c.subject, type: c.type, rooms: c.rooms.map((r) => r.label), campus: c.campus }))
  .sort((a, b) => a.id.localeCompare(b.id));

for (const [file, from, to] of [
  ['agenda.ics', '2026-10-01T00:00:00+02:00', '2026-11-30T00:00:00+01:00'],
  ['hyperplanning.ics', '2026-10-19T00:00:00+02:00', '2026-10-25T23:59:59+02:00'],
]) {
  test(`lecteur léger = node-ical (${file})`, () => {
    const a = pick(coursesFromCalendar(parseIcs(read(file)), new Date(from), new Date(to)));
    const b = pick(coursesFromLite(parseIcsLite(read(file)), new Date(from), new Date(to)));
    assert.ok(a.length > 0);
    assert.deepEqual(b, a);
  });
}

test('fuseaux horaires : heure de Paris en été et en hiver', () => {
  assert.equal(zonedTime(2026, 10, 6, 13, 30, 0, 'Europe/Paris').toISOString(), '2026-10-06T11:30:00.000Z');
  assert.equal(zonedTime(2026, 11, 6, 13, 30, 0, 'Europe/Paris').toISOString(), '2026-11-06T12:30:00.000Z');
});

test('récurrence hebdomadaire qui traverse le changement d’heure', () => {
  const ics = 'BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:x\nDTSTART;TZID=Europe/Paris:20261020T090000\nDTEND;TZID=Europe/Paris:20261020T100000\nRRULE:FREQ=WEEKLY;COUNT=3\nEXDATE;TZID=Europe/Paris:20261103T090000\nSUMMARY:Anglais - CRS\nEND:VEVENT\nEND:VCALENDAR';
  const list = coursesFromLite(parseIcsLite(ics), new Date('2026-10-01'), new Date('2026-12-01'));
  assert.deepEqual(list.map((c) => c.start.toISOString()), ['2026-10-20T07:00:00.000Z', '2026-10-27T08:00:00.000Z']);
  assert.equal(list[0].subject, 'Anglais');
});
