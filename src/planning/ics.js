import ical from 'node-ical';
import { textOf, campusFromText, selectCourses, toCourse } from './course.js';

export { isAutonomy, courseInfo, parseRooms, selectCourses } from './course.js';

/** Campus indiqué dans l'en-tête du calendrier (node-ical range X-WR-CALDESC à la racine). */
export function calendarCampus(calendar) {
  const candidates = [...Object.entries(calendar), ...Object.entries(calendar.vcalendar || {})];
  for (const [key, value] of candidates) {
    if (!/CALDESC|CALNAME/i.test(key)) continue;
    const campus = campusFromText(textOf(value));
    if (campus) return campus;
  }
  return '';
}

/** Tous les cours (hors journées entières) d'un calendrier ICS parsé, entre from et to. */
export function coursesFromCalendar(calendar, from, to) {
  const sessions = [];
  const campus = calendarCampus(calendar);
  for (const event of Object.values(calendar)) {
    if (event.type !== 'VEVENT') continue;
    const instances = ical.expandRecurringEvent(event, { from, to, expandOngoing: true });
    for (const inst of instances) {
      if (inst.isFullDay) continue;
      sessions.push(toCourse({ ...event, summary: textOf(inst.summary) || textOf(event.summary) }, new Date(inst.start), new Date(inst.end), campus));
    }
  }
  return sessions.filter((s) => s.end >= from && s.start <= to);
}

/** Créneaux d'autonomie (mode « auto ») – conservé pour compatibilité. */
export function autonomyFromCalendar(calendar, keywords, from, to) {
  return selectCourses(coursesFromCalendar(calendar, from, to), { mode: 'auto' }, keywords);
}

export function parseIcs(text) {
  return ical.sync.parseICS(text);
}

export async function fetchIcs(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'linked/1.0' } });
  if (!res.ok) throw new Error(`ICS HTTP ${res.status}`);
  return parseIcs(await res.text());
}
