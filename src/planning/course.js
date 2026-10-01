/**
 * Logique « cours » sans dépendance externe : matière, type, salles, campus, choix des cours notifiés.
 * Partagée par l'app (node-ical) et le relais cloud (lecteur iCal léger, Cloudflare Workers).
 */
import { makeSession } from './session.js';

export function normalize(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

export function textOf(value) {
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

export const titleCase = (t) => t.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (m, sep, c) => sep + c.toUpperCase());

/**
 * Salles d'un cours. Hyperplanning (OMNES) écrit par ex. « Salle G006 - EIFFEL 4 (Meet-up) »
 * ou « Salle EM009 - Amphithéâtre - EIFFEL 1, Salle P436 - EIFFEL 2 » (dans LOCATION ou « Salle(s) : … »).
 * → [{ room: 'G006', building: 'Eiffel 4', label: 'G006 · Eiffel 4' }]
 */
export function parseRooms(event) {
  const raw = textOf(event.location).trim()
    || /Salles?\s*:\s*([^\n]+)/i.exec(textOf(event.description))?.[1]?.trim() || '';
  if (!raw) return [];
  return raw.split(/,\s*(?=Salle\s)/i).map((part) => {
    const pieces = part.replace(/\([^)]*\)/g, '').split(/\s+-\s+/).map((x) => x.trim()).filter(Boolean);
    const room = (pieces[0] || '').replace(/^Salle\s+/i, '').trim();
    const building = pieces.length > 1 ? titleCase(pieces[pieces.length - 1]) : '';
    const kind = pieces.length > 2 ? pieces.slice(1, -1).join(' ') : '';
    return { room, building, kind, label: [room, building].filter(Boolean).join(' · ') };
  }).filter((r) => r.room);
}

/** Campus indiqué dans l'en-tête du calendrier Hyperplanning, ex. « … (Campus PARIS) » → « Paris ». */
export function campusFromText(text) {
  const m = /Campus\s+([\p{L} '-]+?)\)/iu.exec(String(text || ''));
  return m ? titleCase(m[1].trim()) : '';
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

/** Construit un cours (session) à partir des champs d'un événement iCal. */
export function toCourse(event, start, end, campus) {
  const { subject, type } = courseInfo(event);
  return {
    ...makeSession({ title: textOf(event.summary), start, end, source: 'ics' }),
    subject, type, campus,
    rooms: parseRooms(event),
    text: `${textOf(event.summary)} ${textOf(event.description)} ${textOf(event.location)}`,
  };
}
