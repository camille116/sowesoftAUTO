/**
 * Lecteur iCal (ICS) léger, sans dépendance : utilisé par le relais cloud (Cloudflare Workers),
 * où node-ical ne fonctionne pas. Gère ce que produisent Hyperplanning, Google Agenda, Outlook… :
 * lignes repliées, échappements, heures UTC / TZID / flottantes, journées entières,
 * récurrences simples (RRULE DAILY/WEEKLY avec INTERVAL, COUNT, UNTIL, BYDAY) et EXDATE.
 */
import { campusFromText, toCourse } from './course.js';

const DAYS = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

const unescape = (v) => v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');

function tzOffsetMs(date, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Heure locale d'un fuseau → instant UTC. */
export function zonedTime(y, mo, d, h, mi, s, timeZone) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  let t = guess - tzOffsetMs(new Date(guess), timeZone);
  t = guess - tzOffsetMs(new Date(t), timeZone); // 2e passe : changement d'heure
  return new Date(t);
}

function parseDate(value, params, defaultTz) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (h === undefined || params.VALUE === 'DATE') return { date: new Date(Date.UTC(+y, +mo - 1, +d)), allDay: true };
  if (z) return { date: new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s || 0))), allDay: false };
  let tz = params.TZID || defaultTz || 'Europe/Paris';
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); } catch { tz = defaultTz || 'Europe/Paris'; } // TZID Windows exotique
  return { date: zonedTime(+y, +mo, +d, +h, +mi, +(s || 0), tz), allDay: false };
}

/** Texte ICS → { header: { CALDESC, CALNAME, TZ }, events: [...] } */
export function parseIcsLite(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const header = {};
  const events = [];
  let ev = null;
  for (const line of lines) {
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const [rawName, ...rawParams] = line.slice(0, idx).split(';');
    const name = rawName.toUpperCase();
    const value = line.slice(idx + 1);
    const params = Object.fromEntries(rawParams.map((p) => {
      const [k, ...v] = p.split('=');
      return [k.toUpperCase(), v.join('=').replace(/^"|"$/g, '')];
    }));
    if (name === 'BEGIN' && value === 'VEVENT') { ev = { exdates: [] }; continue; }
    if (name === 'END' && value === 'VEVENT') { if (ev?.start) events.push(ev); ev = null; continue; }
    if (!ev) {
      if (name === 'X-WR-CALDESC') header.CALDESC = unescape(value);
      if (name === 'X-WR-CALNAME') header.CALNAME = unescape(value);
      if (name === 'X-WR-TIMEZONE') header.TZ = value.trim();
      continue;
    }
    switch (name) {
      case 'SUMMARY': ev.summary = unescape(value); break;
      case 'DESCRIPTION': ev.description = unescape(value); break;
      case 'LOCATION': ev.location = unescape(value); break;
      case 'UID': ev.uid = value; break;
      case 'STATUS': ev.status = value.toUpperCase(); break;
      case 'RRULE': ev.rrule = Object.fromEntries(value.split(';').map((p) => p.split('='))); break;
      case 'DTSTART': { const r = parseDate(value, params, header.TZ); if (r) { ev.start = r.date; ev.allDay = r.allDay; } break; }
      case 'DTEND': { const r = parseDate(value, params, header.TZ); if (r) ev.end = r.date; break; }
      case 'EXDATE': for (const v of value.split(',')) { const r = parseDate(v, params, header.TZ); if (r) ev.exdates.push(r.date.getTime()); } break;
      default: break;
    }
  }
  for (const e of events) if (!e.end) e.end = new Date(e.start.getTime() + (e.allDay ? 24 * 3600e3 : 3600e3));
  return { header, events };
}

/** Occurrences d'un événement (récurrences simples) qui chevauchent [from, to]. */
function occurrences(ev, from, to) {
  const dur = ev.end - ev.start;
  if (!ev.rrule) return ev.end >= from && ev.start <= to ? [ev.start] : [];
  const r = ev.rrule;
  const freq = (r.FREQ || '').toUpperCase();
  if (!['DAILY', 'WEEKLY'].includes(freq)) return ev.end >= from && ev.start <= to ? [ev.start] : [];
  const interval = Math.max(1, +r.INTERVAL || 1);
  const count = r.COUNT ? +r.COUNT : Infinity;
  const until = r.UNTIL ? parseDate(r.UNTIL, {}, 'UTC')?.date : null;
  const byDay = freq === 'WEEKLY' && r.BYDAY ? r.BYDAY.split(',').map((d) => DAYS[d.slice(-2)]).filter((d) => d !== undefined) : null;
  const out = [];
  let n = 0;
  const DAY = 24 * 3600e3;
  // on avance jour par jour (heure locale conservée grâce au pas de 24 h corrigé par l'offset du fuseau)
  const tz = 'Europe/Paris';
  const startOffset = tzOffsetMs(ev.start, tz);
  for (let i = 0; i < 3660 && n < count; i++) {
    const naive = new Date(ev.start.getTime() + i * DAY);
    const t = new Date(naive.getTime() + startOffset - tzOffsetMs(naive, tz));
    if (until && t > until) break;
    if (t > to) break;
    const weeks = Math.floor(i / 7);
    let match;
    if (freq === 'DAILY') match = i % interval === 0;
    else match = weeks % interval === 0 && (byDay ? byDay.includes(new Date(t.getTime() + tzOffsetMs(t, tz)).getUTCDay()) : i % 7 === 0);
    if (!match) continue;
    n++;
    if (ev.exdates.includes(t.getTime())) continue;
    if (t.getTime() + dur >= from.getTime()) out.push(t);
  }
  return out;
}

/** Tous les cours (hors journées entières et annulés) entre from et to, au même format que l'app. */
export function coursesFromLite(parsed, from, to) {
  const campus = campusFromText(parsed.header.CALDESC) || campusFromText(parsed.header.CALNAME);
  const out = [];
  for (const ev of parsed.events) {
    if (ev.allDay || ev.status === 'CANCELLED') continue;
    for (const start of occurrences(ev, from, to)) {
      out.push(toCourse(ev, start, new Date(start.getTime() + (ev.end - ev.start)), campus));
    }
  }
  return out.filter((s) => s.end >= from && s.start <= to).sort((a, b) => a.start - b.start);
}
