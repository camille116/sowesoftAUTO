import { makeSession } from './session.js';

const DAYS = {
  dimanche: 0, lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6,
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
};

function dayIndex(day) {
  if (typeof day === 'number') return day % 7;
  const key = String(day).toLowerCase().trim();
  if (!(key in DAYS)) throw new Error(`Jour inconnu dans planning.json : "${day}"`);
  return DAYS[key];
}

function at(date, hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), h, m || 0, 0, 0);
}

function isoDay(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Génère les créneaux du planning manuel (heure locale, cf. TZ) qui chevauchent [from, to]. */
export function manualSessions(manual, from, to) {
  const { weekly = [], dates = [], exceptions = [] } = manual || {};
  const skip = new Set(exceptions);
  const sessions = [];

  const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  while (cursor <= to) {
    const day = isoDay(cursor);
    if (!skip.has(day)) {
      for (const slot of weekly) {
        if (dayIndex(slot.day) === cursor.getDay()) {
          sessions.push(makeSession({
            title: slot.title, start: at(cursor, slot.start), end: at(cursor, slot.end), source: 'manuel',
          }));
        }
      }
      for (const slot of dates) {
        if (slot.date === day) {
          sessions.push(makeSession({
            title: slot.title, start: at(cursor, slot.start), end: at(cursor, slot.end), source: 'manuel',
          }));
        }
      }
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return sessions.filter((s) => s.end >= from && s.start <= to);
}
