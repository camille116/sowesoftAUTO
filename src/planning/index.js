import { manualSessions } from './manual.js';
import { fetchIcs, autonomyFromCalendar } from './ics.js';
import { mergeSessions } from './session.js';
import { log } from '../logger.js';

const ICS_TTL_MS = 30 * 60 * 1000; // on re-télécharge l'agenda toutes les 30 min

/**
 * Source unique du planning : agenda ICS (filtré sur les mots-clés « autonomie »)
 * + planning manuel. Le calendrier ICS est mis en cache pour éviter de spammer le serveur.
 */
export class Planning {
  constructor({ icsUrl, keywords, manual }, { fetcher = fetchIcs } = {}) {
    this.icsUrl = icsUrl;
    this.keywords = keywords;
    this.manual = manual;
    this.fetcher = fetcher;
    this.calendar = null;
    this.fetchedAt = 0;
  }

  async refresh(force = false) {
    if (!this.icsUrl) return;
    if (!force && this.calendar && Date.now() - this.fetchedAt < ICS_TTL_MS) return;
    try {
      this.calendar = await this.fetcher(this.icsUrl);
      this.fetchedAt = Date.now();
      log.info('Agenda ICS mis à jour');
    } catch (err) {
      // on garde l'ancienne version en cache plutôt que de tout perdre
      log.warn(`Impossible de récupérer l'agenda ICS : ${err.message}`);
    }
  }

  async between(from, to) {
    await this.refresh();
    const fromIcs = this.calendar ? autonomyFromCalendar(this.calendar, this.keywords, from, to) : [];
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
