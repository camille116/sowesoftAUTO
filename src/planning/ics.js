import ical from 'node-ical';
import { makeSession } from './session.js';

function normalize(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

function textOf(value) {
  // node-ical renvoie parfois { val, params } pour les champs avec paramètres
  if (value && typeof value === 'object' && 'val' in value) return value.val;
  return value || '';
}

export function isAutonomy(event, keywords) {
  const haystack = normalize(`${textOf(event.summary)} ${textOf(event.description)} ${textOf(event.location)}`);
  return keywords.some((k) => haystack.includes(normalize(k)));
}

/**
 * Matière et type d'un cours. Hyperplanning écrit « Matière : … » et « Type : AUTONOMIE / CRS / ELEARNING… »
 * dans la description ; sinon on prend le début du titre.
 */
export function courseInfo(event) {
  const summary = textOf(event.summary).trim();
  const description = textOf(event.description);
  const subject = (/Matière\s*:\s*([^\n]+)/i.exec(description)?.[1] || summary.split(' - ')[0] || summary).trim();
  const type = (/Type\s*:\s*([^\n]+)/i.exec(description)?.[1]
    || (/ - ([A-ZÉÈ]{2,})$/.exec(summary)?.[1]) || '').trim().toUpperCase();
  return { subject, type };
}

/** Tous les cours (hors journées entières) d'un calendrier ICS parsé, entre from et to. */
export function coursesFromCalendar(calendar, from, to) {
  const sessions = [];
  for (const event of Object.values(calendar)) {
    if (event.type !== 'VEVENT') continue;
    const { subject, type } = courseInfo(event);
    const text = `${textOf(event.summary)} ${textOf(event.description)} ${textOf(event.location)}`;
    const instances = ical.expandRecurringEvent(event, { from, to, expandOngoing: true });
    for (const inst of instances) {
      if (inst.isFullDay) continue;
      sessions.push({
        ...makeSession({ title: textOf(inst.summary) || textOf(event.summary), start: new Date(inst.start), end: new Date(inst.end), source: 'ics' }),
        subject, type, text,
      });
    }
  }
  return sessions.filter((s) => s.end >= from && s.start <= to);
}

/**
 * Garde les cours pour lesquels on veut être notifié :
 *  - auto   : ceux qui contiennent un mot-clé (autonomie, e-learning…)
 *  - all    : tous les cours
 *  - custom : les matières cochées dans l'appli
 */
export function selectCourses(sessions, { mode = 'auto', subjects = [] } = {}, keywords = []) {
  if (mode === 'all') return sessions;
  if (mode === 'custom') {
    const wanted = new Set(subjects.map(normalize));
    return sessions.filter((s) => wanted.has(normalize(s.subject)));
  }
  return sessions.filter((s) => keywords.some((k) => normalize(s.text).includes(normalize(k))));
}

/** Créneaux d'autonomie (mode « auto ») – conservé pour compatibilité. */
export function autonomyFromCalendar(calendar, keywords, from, to) {
  return selectCourses(coursesFromCalendar(calendar, from, to), { mode: 'auto' }, keywords);
}

export function parseIcs(text) {
  return ical.sync.parseICS(text);
}

export async function fetchIcs(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'sowesoft-auto/1.0' } });
  if (!res.ok) throw new Error(`ICS HTTP ${res.status}`);
  return parseIcs(await res.text());
}
