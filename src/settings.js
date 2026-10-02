import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';

const SECRET_FIELDS = ['password', 'pin'];
const METHODS = ['password', 'code', 'sso'];
const CHANNELS = ['telegram', 'whatsapp'];

/**
 * Réglages modifiables depuis l'appli web.
 * Valeurs de départ = .env ; ce qui est changé dans l'appli est gardé dans data/settings.json
 * (jamais commité) et prend le dessus.
 */
export class Settings {
  constructor(dataDir, defaults) {
    mkdirSync(dataDir, { recursive: true });
    this.file = join(dataDir, 'settings.json');
    this.defaults = defaults;
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
    const { auth, telegramToken, relaySecret, ...rest } = this.values;
    rest.hasTelegramToken = Boolean(telegramToken);
    rest.hasRelaySecret = Boolean(relaySecret);
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
    if (patch.notify) {
      const mode = patch.notify.mode ?? next.notify?.mode ?? 'auto';
      if (!['auto', 'all', 'custom'].includes(mode)) throw new Error('Choix de notifications inconnu');
      const subjects = 'subjects' in patch.notify ? toList(patch.notify.subjects) : next.notify?.subjects || [];
      next.notify = { mode, subjects: [...new Set(subjects)] };
    }
    if ('relayUrl' in patch) {
      const u = String(patch.relayUrl || '').trim();
      if (u && !/^https:\/\/[\w.-]+\.workers\.dev(\/.*)?$/.test(u) && !/^https:\/\//.test(u)) throw new Error('URL du relais invalide (https://…)');
      next.relayUrl = u.replace(/\/+$/, '');
    }
    if ('relaySecret' in patch) next.relaySecret = String(patch.relaySecret || '').trim();
    if ('memberTemplate' in patch) {
      const t = String(patch.memberTemplate || '').trim();
      if (t.length > 1000) throw new Error('Message trop long (1000 caractères max)');
      next.memberTemplate = t || this.defaults.memberTemplate;
    }
    if ('whatsappNumber' in patch) {
      const n = String(patch.whatsappNumber || '').replace(/\D/g, '').replace(/^0(\d{9})$/, '33$1');
      if (n && n.length < 10) throw new Error('Numéro WhatsApp invalide (ex : 0612345678)');
      next.whatsappNumber = n;
    }
    if ('channel' in patch) {
      if (!CHANNELS.includes(patch.channel)) throw new Error('Messagerie inconnue');
      next.channel = patch.channel;
    }
    if (patch.telegramToken) {
      const t = String(patch.telegramToken).trim();
      if (!/^\d{5,}:[\w-]{30,}$/.test(t)) throw new Error('Token Telegram invalide : il ressemble à 123456789:AAH…, copie-le en entier depuis @BotFather');
      next.telegramToken = t;
    }

    if (patch.whatsappScan) {
      const w = patch.whatsappScan;
      const cur = next.whatsappScan || { enabled: false, groupId: '', groupName: '' };
      next.whatsappScan = {
        enabled: 'enabled' in w ? Boolean(w.enabled) : cur.enabled,
        groupId: 'groupId' in w ? String(w.groupId || '').trim() : cur.groupId,
        groupName: 'groupName' in w ? String(w.groupName || '').trim().slice(0, 80) : cur.groupName,
      };
    }

    if (patch.signature) {
      const sg = patch.signature;
      const style = sg.style ?? next.signature?.style ?? 'claude';
      if (!['claude', 'name', 'psg'].includes(style)) throw new Error('Style de signature inconnu');
      let name = 'name' in sg ? String(sg.name || '').trim() : next.signature?.name || '';
      if (name.length > 40) throw new Error('Nom de signature trop long (40 caractères max)');
      next.signature = { style, name: name || 'Camille Redon' };
    }

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
