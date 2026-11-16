// État de l'app : lignes de paiement + réglages, gardés dans le navigateur.
// Les suppressions sont des « tombstones » (deleted: true) pour pouvoir fusionner entre appareils.

import { STATUS } from './calc.js';

const KEY = 'revenus.v1';

// Taux global micro-entrepreneur BNC (cotisations + formation), en % du montant déclaré.
export const DEFAULT_SETTINGS = {
  rates: { 2025: 24.8, 2026: 25.8 },
  driveClientId: '',
  driveAuto: true,
  updatedAt: '1970-01-01T00:00:00.000Z',
};

export const emptyState = () => ({ entries: [], settings: { ...DEFAULT_SETTINGS, rates: { ...DEFAULT_SETTINGS.rates } }, seeded: false });

const memory = new Map();
const storage = {
  get(k) { try { return globalThis.localStorage ? localStorage.getItem(k) : memory.get(k) ?? null; } catch { return memory.get(k) ?? null; } },
  set(k, v) { try { if (globalThis.localStorage) { localStorage.setItem(k, v); return; } } catch { /* stockage bloqué */ } memory.set(k, v); },
};

export function load() {
  try {
    const raw = storage.get(KEY);
    if (!raw) return emptyState();
    const s = JSON.parse(raw);
    const clean = sanitizeState(s);
    const stored = s && typeof s.settings === 'object' && s.settings ? s.settings : {};
    return {
      entries: clean.entries,
      settings: {
        ...DEFAULT_SETTINGS,
        rates: Object.keys(clean.settings.rates).length ? clean.settings.rates : { ...DEFAULT_SETTINGS.rates },
        driveClientId: typeof stored.driveClientId === 'string' ? stored.driveClientId.slice(0, 200) : '',
        driveAuto: stored.driveAuto !== false,
        updatedAt: clean.settings.updatedAt,
      },
      seeded: clean.seeded,
    };
  } catch {
    return emptyState();
  }
}

export function save(state) {
  storage.set(KEY, JSON.stringify(state));
}

const newId = () =>
  globalThis.crypto?.randomUUID ? crypto.randomUUID() : `e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** Nettoie une saisie et renvoie { entry } ou { errors }. */
export function normalizeEntry(input) {
  const errors = {};
  const text = (v) => String(v ?? '').trim();
  const e = {
    date: text(input.date),
    client: text(input.client),
    endClient: text(input.endClient),
    type: text(input.type),
    project: text(input.project),
    amount: input.amount,
    declared: input.declared ?? null,
    status: Object.values(STATUS).includes(input.status) ? input.status : STATUS.PAID,
    installment: text(input.installment),
    invoiceUrl: text(input.invoiceUrl),
    notes: text(input.notes),
    review: Boolean(input.review),
  };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date) || Number.isNaN(Date.parse(e.date))) errors.date = 'Choisis une date.';
  if (!e.client) errors.client = 'Indique le client.';
  if (!Number.isInteger(e.amount) || e.amount <= 0) errors.amount = 'Indique un montant supérieur à 0.';
  if (e.declared != null && (!Number.isInteger(e.declared) || e.declared < 0)) errors.declared = 'Montant déclaré illisible.';
  if (e.declared != null && Number.isInteger(e.amount) && e.declared > e.amount) errors.declared = 'Le déclaré dépasse le montant.';
  if (e.declared === e.amount) e.declared = null;
  if (e.invoiceUrl && !/^https?:\/\//i.test(e.invoiceUrl)) errors.invoiceUrl = 'Le lien doit commencer par https://';
  return Object.keys(errors).length ? { errors } : { entry: e };
}

export function addEntry(state, entry, now = new Date().toISOString()) {
  const full = { ...entry, id: newId(), createdAt: now, updatedAt: now, deleted: false };
  return { ...state, entries: [...state.entries, full] };
}

export function updateEntry(state, id, patch, now = new Date().toISOString()) {
  return { ...state, entries: state.entries.map((e) => (e.id === id ? { ...e, ...patch, id, updatedAt: now } : e)) };
}

export function deleteEntry(state, id, now = new Date().toISOString()) {
  return updateEntry(state, id, { deleted: true }, now);
}

export function restoreEntry(state, id, now = new Date().toISOString()) {
  return updateEntry(state, id, { deleted: false }, now);
}

export function updateSettings(state, patch, now = new Date().toISOString()) {
  return { ...state, settings: { ...state.settings, ...patch, updatedAt: now } };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const EPOCH = '1970-01-01T00:00:00.000Z';
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const httpUrl = (v) => (/^https?:\/\//i.test(str(v, 2000)) ? str(v, 2000) : '');

/** Horodatage ISO valide ; une date dans le futur est ramenée à maintenant (sinon elle gagnerait toutes les fusions). */
function stamp(v, now) {
  if (typeof v !== 'string' || Number.isNaN(Date.parse(v))) return EPOCH;
  const iso = new Date(v).toISOString();
  return iso > now ? now : iso;
}

/**
 * Remet une ligne venue de l'extérieur (Drive, fichier importé, stockage ancien) dans la forme attendue.
 * Renvoie null si elle est inutilisable. Rien de ce qui sort d'ici n'est autre chose qu'un texte borné,
 * un entier ou un booléen : l'affichage et l'export peuvent s'y fier.
 */
export function sanitizeEntry(raw, now = new Date().toISOString()) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const id = str(raw.id, 80);
  const date = str(raw.date, 10);
  if (!id || !ISO_DATE.test(date) || Number.isNaN(Date.parse(date))) return null;
  if (!Number.isInteger(raw.amount) || raw.amount <= 0 || raw.amount > 1e11) return null;
  const declared = Number.isInteger(raw.declared) && raw.declared >= 0 && raw.declared < raw.amount ? raw.declared : null;
  return {
    id,
    date,
    client: str(raw.client, 200).trim() || '—',
    endClient: str(raw.endClient, 200),
    type: str(raw.type, 200),
    project: str(raw.project, 200),
    amount: raw.amount,
    declared,
    status: Object.values(STATUS).includes(raw.status) ? raw.status : STATUS.PAID,
    installment: str(raw.installment, 20),
    invoiceUrl: httpUrl(raw.invoiceUrl),
    notes: str(raw.notes, 2000),
    review: raw.review === true,
    createdAt: stamp(raw.createdAt, now),
    updatedAt: stamp(raw.updatedAt, now),
    deleted: raw.deleted === true,
  };
}

/** Taux par année : clés AAAA, valeurs entre 0 et 100. */
export function sanitizeRates(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [y, v] of Object.entries(raw)) {
    if (/^\d{4}$/.test(y) && typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100) out[y] = v;
  }
  return out;
}

const MAX_ENTRIES = 20000;

/** État venu de l'extérieur, nettoyé. Ne lève jamais d'erreur. */
export function sanitizeState(raw, now = new Date().toISOString()) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const entries = (Array.isArray(src.entries) ? src.entries.slice(0, MAX_ENTRIES) : []).map((e) => sanitizeEntry(e, now)).filter(Boolean);
  const rates = sanitizeRates(src.settings?.rates);
  return {
    entries,
    settings: { rates, updatedAt: Object.keys(rates).length ? stamp(src.settings?.updatedAt, now) : EPOCH },
    seeded: src.seeded === true,
  };
}

/**
 * Fusionne l'état local et l'état distant (Drive) : pour chaque ligne, la version
 * modifiée le plus récemment gagne. Idem pour les réglages (hors identifiant Google, propre à l'appareil).
 */
export function mergeStates(local, remoteRaw) {
  if (!remoteRaw) return local;
  const remote = sanitizeState(remoteRaw);
  const map = new Map();
  for (const e of local.entries) map.set(e.id, e);
  for (const e of remote.entries || []) {
    const mine = map.get(e.id);
    if (!mine || String(e.updatedAt) > String(mine.updatedAt)) map.set(e.id, e);
  }
  const remoteNewer = String(remote.settings?.updatedAt || '') > String(local.settings.updatedAt || '');
  const settings = remoteNewer
    ? { ...local.settings, rates: { ...remote.settings.rates }, updatedAt: remote.settings.updatedAt }
    : local.settings;
  return { entries: [...map.values()], settings, seeded: local.seeded || Boolean(remote.seeded) };
}

/** Ce qui part sur Drive : jamais l'identifiant Google ni les préférences d'appareil. */
export function exportableState(state) {
  return {
    version: 1,
    seeded: state.seeded,
    entries: state.entries,
    settings: { rates: state.settings.rates, updatedAt: state.settings.updatedAt },
  };
}

/** Valeurs déjà saisies pour un champ, les plus fréquentes d'abord (suggestions). */
export function suggestions(state, field) {
  const count = new Map();
  for (const e of state.entries) {
    if (e.deleted || !e[field]) continue;
    count.set(e[field], (count.get(e[field]) || 0) + 1);
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([v]) => v);
}
