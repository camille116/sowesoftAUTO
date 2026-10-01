import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';

const KEEP_DAYS = 30;
const HISTORY_SIZE = 200;

/** Petit état persistant en JSON : pause, créneaux signés, rappels déjà envoyés. */
export class Store {
  constructor(dir) {
    this.file = join(dir, 'state.json');
    mkdirSync(dir, { recursive: true });
    this.state = existsSync(this.file)
      ? JSON.parse(readFileSync(this.file, 'utf8'))
      : { paused: false, sessions: {} };
    this.state.history ||= [];
  }

  /** Journal affiché dans l'appli (signatures, rappels, erreurs). */
  log(type, data = {}) {
    this.state.history.unshift({ at: new Date().toISOString(), type, ...data });
    this.state.history.length = Math.min(this.state.history.length, HISTORY_SIZE);
    this.save();
  }

  get history() {
    return this.state.history;
  }

  save() {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.state, null, 2));
    renameSync(tmp, this.file);
  }

  session(id) {
    return this.state.sessions[id] || {};
  }

  update(id, patch) {
    this.state.sessions[id] = { ...this.session(id), ...patch, touchedAt: new Date().toISOString() };
    this.save();
  }

  isDone(id) {
    const s = this.session(id);
    return Boolean(s.signedAt || s.skipped);
  }

  markSigned(id, by) {
    this.update(id, { signedAt: new Date().toISOString(), signedBy: by });
  }

  markSkipped(id) {
    this.update(id, { skipped: true });
  }

  get paused() {
    return this.state.paused;
  }

  setPaused(value) {
    this.state.paused = value;
    this.save();
  }

  prune(now = new Date()) {
    const limit = now.getTime() - KEEP_DAYS * 24 * 3600e3;
    for (const [id, s] of Object.entries(this.state.sessions)) {
      if (new Date(s.touchedAt || 0).getTime() < limit) delete this.state.sessions[id];
    }
    this.save();
  }
}
