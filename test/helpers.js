process.env.TZ = 'Europe/Paris';

/** Faux store en mémoire avec la même API que src/store.js */
export function memoryStore() {
  const state = { paused: false, sessions: {} };
  return {
    state,
    session: (id) => state.sessions[id] || {},
    update(id, patch) { state.sessions[id] = { ...this.session(id), ...patch }; },
    isDone(id) { const s = this.session(id); return Boolean(s.signedAt || s.skipped); },
    markSigned(id, by) { this.update(id, { signedAt: 'now', signedBy: by }); },
    markSkipped(id) { this.update(id, { skipped: true }); },
    get paused() { return state.paused; },
    setPaused(v) { state.paused = v; },
  };
}
