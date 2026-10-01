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

/** Extrait les créneaux d'autonomie d'un calendrier ICS déjà parsé. */
export function autonomyFromCalendar(calendar, keywords, from, to) {
  const sessions = [];
  for (const event of Object.values(calendar)) {
    if (event.type !== 'VEVENT' || !isAutonomy(event, keywords)) continue;
    const instances = ical.expandRecurringEvent(event, { from, to, expandOngoing: true });
    for (const inst of instances) {
      if (inst.isFullDay) continue;
      sessions.push(makeSession({
        title: textOf(inst.summary) || textOf(event.summary),
        start: new Date(inst.start),
        end: new Date(inst.end),
        source: 'ics',
      }));
    }
  }
  return sessions.filter((s) => s.end >= from && s.start <= to);
}

export function parseIcs(text) {
  return ical.sync.parseICS(text);
}

export async function fetchIcs(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'sowesoft-auto/1.0' } });
  if (!res.ok) throw new Error(`ICS HTTP ${res.status}`);
  return parseIcs(await res.text());
}
