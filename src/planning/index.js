import { manualSessions } from './manual.js';
import { fetchIcs, coursesFromCalendar, selectCourses } from './ics.js';
import { mergeSessions } from './session.js';
import { log } from '../logger.js';

const ICS_TTL_MS = 30 * 60 * 1000; // on re-télécharge l'agenda toutes les 30 min

/**
 * Source unique du planning : agenda ICS (filtré sur les mots-clés « autonomie »)
 * + planning manuel. Le calendrier ICS est mis en cache pour éviter de spammer le serveur.
 */
export class Planning {
  constructor({ icsUrl, keywords, manual, notify }, { fetcher = fetchIcs } = {}) {
    this.icsUrl = icsUrl;
    this.keywords = keywords;
    this.notify = notify || { mode: 'auto', subjects: [] }; // quels cours déclenchent un rappel
    this.manual = manual;
    this.fetcher = fetcher;
    this.calendar = null;
    this.fetchedAt = 0;
    this.lastError = null; // affiché dans l'appli si l'agenda est illisible
  }

  async refresh(force = false) {
    if (!this.icsUrl) return;
    if (!force && this.calendar && Date.now() - this.fetchedAt < ICS_TTL_MS) return;
    try {
      this.calendar = await this.fetcher(this.icsUrl);
      this.fetchedAt = Date.now();
      this.lastError = null;
      log.info('Agenda ICS mis à jour');
    } catch (err) {
      this.lastError = err.message;
      this.fetchedAt = Date.now() - ICS_TTL_MS + 60e3; // nouvel essai dans 1 min
      // on garde l'ancienne version en cache plutôt que de tout perdre
      log.warn(`Impossible de récupérer l'agenda ICS : ${err.message}`);
    }
  }

  async between(from, to) {
    await this.refresh();
    const fromIcs = this.calendar ? selectCourses(coursesFromCalendar(this.calendar, from, to), this.notify, this.keywords) : [];
    return mergeSessions(fromIcs, manualSessions(this.manual, from, to));
  }

  /** Toutes les matières de l'agenda (pour choisir lesquelles notifier dans l'appli). */
  async subjects(from, to) {
    await this.refresh();
    if (!this.calendar) return [];
    const bySubject = new Map();
    for (const c of coursesFromCalendar(this.calendar, from, to)) {
      const entry = bySubject.get(c.subject) || { subject: c.subject, types: new Set(), count: 0, next: null };
      entry.types.add(c.type);
      entry.count++;
      if (c.end >= new Date() && (!entry.next || c.start < entry.next)) entry.next = c.start;
      bySubject.set(c.subject, entry);
    }
    return [...bySubject.values()]
      .map((e) => ({ ...e, types: [...e.types].filter(Boolean).sort() }))
      .sort((a, b) => (a.next ?? Infinity) - (b.next ?? Infinity) || a.subject.localeCompare(b.subject));
  }

  /** Tous les cours d'un jour (pas seulement ceux à signer), avec salles et campus. */
  async allDay(date) {
    await this.refresh();
    const from = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const to = new Date(from.getTime() + 24 * 3600 * 1000 - 1);
    const fromIcs = this.calendar ? coursesFromCalendar(this.calendar, from, to) : [];
    return mergeSessions(fromIcs, manualSessions(this.manual, from, to));
  }

  async day(date) {
    const from = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const to = new Date(from.getTime() + 24 * 3600 * 1000 - 1);
    return this.between(from, to);
  }

  /** Créneau en cours (ou qui commence dans les `marginMin` minutes). */
  async current(now = new Date(), marginMin = 10) {
    const sessions = await this.between(new Date(now.getTime() - 12 * 3600e3), new Date(now.getTime() + 12 * 3600e3));
    const soon = now.getTime() + marginMin * 60e3;
    return sessions.find((s) => s.start.getTime() <= soon && s.end >= now) || null;
  }
}
