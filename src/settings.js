import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';

const SECRET_FIELDS = ['password', 'pin'];
const METHODS = ['password', 'code', 'sso'];

/**
 * Réglages modifiables depuis l'appli web.
 * Valeurs de départ = .env ; ce qui est changé dans l'appli est gardé dans data/settings.json
 * (jamais commité) et prend le dessus.
 */
export class Settings {
  constructor(dataDir, defaults) {
    mkdirSync(dataDir, { recursive: true });
    this.file = join(dataDir, 'settings.json');
    const saved = existsSync(this.file) ? JSON.parse(readFileSync(this.file, 'utf8')) : {};
    this.values = {
      ...defaults,
      ...saved,
      auth: { ...defaults.auth, ...(saved.auth || {}) },
    };
  }

  get() {
    return this.values;
  }

  /** Version sans secrets, pour l'affichage. */
  public() {
    const { auth, ...rest } = this.values;
    const safeAuth = { ...auth };
    for (const f of SECRET_FIELDS) {
      safeAuth[`has${f[0].toUpperCase()}${f.slice(1)}`] = Boolean(auth[f]);
      delete safeAuth[f];
    }
    return { ...rest, auth: safeAuth };
  }

  update(patch) {
    const next = structuredClone(this.values);

    if ('icsUrl' in patch) next.icsUrl = String(patch.icsUrl || '').trim();
    if ('keywords' in patch) next.keywords = toList(patch.keywords).map((k) => k.toLowerCase());
    if ('reminderOffsets' in patch) {
      const offsets = toList(patch.reminderOffsets).map(Number);
      if (!offsets.length || offsets.some((n) => !Number.isFinite(n) || n < -120 || n > 600)) {
        throw new Error('Rappels : des minutes entre -120 et 600, séparées par des virgules');
      }
      next.reminderOffsets = [...new Set(offsets)].sort((a, b) => a - b);
    }
    if ('dryRun' in patch) next.dryRun = Boolean(patch.dryRun);

    if (patch.auth) {
      const a = patch.auth;
      if ('method' in a) {
        if (!METHODS.includes(a.method)) throw new Error('Méthode de connexion inconnue');
        next.auth.method = a.method;
      }
      for (const f of ['institution', 'email', 'id']) if (f in a) next.auth[f] = String(a[f] || '').trim();
      // champ secret laissé vide = on garde l'ancienne valeur
      for (const f of SECRET_FIELDS) if (a[f]) next.auth[f] = String(a[f]);
      if (next.auth.institution && !/^\d{4}$/.test(next.auth.institution)) throw new Error('Code établissement : 4 chiffres');
      if (next.auth.id && !/^\d{8}$/.test(next.auth.id)) throw new Error('Identifiant : 8 chiffres');
      if (next.auth.pin && !/^\d{4}$/.test(next.auth.pin)) throw new Error('PIN : 4 chiffres');
    }

    this.values = next;
    writeFileSync(this.file, JSON.stringify(next, null, 2));
    try { chmodSync(this.file, 0o600); } catch { /* Windows */ }
    return this.values;
  }
}

function toList(value) {
  if (Array.isArray(value)) return value.map(String).map((s) => s.trim()).filter(Boolean);
  return String(value || '').split(',').map((s) => s.trim()).filter(Boolean);
}
