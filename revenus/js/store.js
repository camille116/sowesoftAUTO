// État de l'app : lignes de paiement + réglages, gardés dans le navigateur.
// Les suppressions sont des « tombstones » (deleted: true) pour pouvoir fusionner entre appareils et onglets.
// Tout ce qui vient de l'extérieur (stockage local, Drive, fichier importé) passe par sanitizeState.

import { MAX_AMOUNT, STATUS, isRealDate, parseAmount } from './calc.js';

export const STORAGE_KEY = 'revenus.v1';
const EPOCH = '1970-01-01T00:00:00.000Z';
const MAX_STAMP = '9000-01-01T00:00:00.000Z';
const MAX_ENTRIES = 20000;

// Taux global micro-entrepreneur BNC (cotisations + formation), en % du montant déclaré.
export const DEFAULT_SETTINGS = {
  rates: { 2025: 24.8, 2026: 25.8 },
  driveClientId: '',
  driveAuto: true,
  updatedAt: EPOCH,
};

export const emptyState = () => ({ entries: [], settings: { ...DEFAULT_SETTINGS, rates: { ...DEFAULT_SETTINGS.rates } } });

// ---------- Stockage ----------

// Si le navigateur refuse l'écriture (stockage plein ou bloqué), la valeur reste en mémoire
// pour la session et save() renvoie false : l'interface prévient l'utilisateur.
const memory = new Map();

function rawGet(key) {
  if (memory.has(key)) return memory.get(key);
  try { return globalThis.localStorage ? localStorage.getItem(key) : null; } catch { return null; }
}

function rawSet(key, value) {
  try {
    if (globalThis.localStorage) {
      localStorage.setItem(key, value);
      memory.delete(key);
      return true;
    }
  } catch { /* stockage plein ou bloqué */ }
  memory.set(key, value);
  return false;
}

let unreadableKept = false;

export function load() {
  const raw = rawGet(STORAGE_KEY);
  if (!raw) return emptyState();
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch { /* traité ci-dessous */ }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.entries)) {
    // Contenu illisible : on le met de côté une fois, avant que la prochaine sauvegarde ne l'écrase.
    if (!unreadableKept) { unreadableKept = true; rawSet(`${STORAGE_KEY}.illisible-${Date.now()}`, raw); }
    return emptyState();
  }
  const clean = sanitizeState(parsed);
  const stored = parsed.settings && typeof parsed.settings === 'object' ? parsed.settings : {};
  return {
    entries: clean.entries,
    settings: {
      rates: Object.keys(clean.settings.rates).length ? clean.settings.rates : { ...DEFAULT_SETTINGS.rates },
      driveClientId: typeof stored.driveClientId === 'string' ? stored.driveClientId.trim().slice(0, 200) : '',
      driveAuto: stored.driveAuto !== false,
      updatedAt: clean.settings.updatedAt,
    },
  };
}

/** Renvoie true si l'état est réellement écrit sur l'appareil. */
export function save(state) {
  return rawSet(STORAGE_KEY, JSON.stringify(state));
}

// ---------- Validation de ce qui vient de l'extérieur ----------

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const httpUrl = (v) => (/^https?:\/\//i.test(str(v, 2000)) ? str(v, 2000) : '');

/** Horodatage ISO normalisé. Une valeur absurde est bornée pour rester comparable et incrémentable. */
function stamp(v) {
  const t = typeof v === 'string' ? Date.parse(v) : NaN;
  if (Number.isNaN(t)) return EPOCH;
  const iso = new Date(t).toISOString();
  return iso.length !== 24 || iso > MAX_STAMP ? MAX_STAMP : iso;
}

/**
 * Remet une ligne dans la forme attendue, ou renvoie null si elle est inutilisable.
 * Rien de ce qui sort d'ici n'est autre chose qu'un texte borné, un entier ou un booléen :
 * l'affichage et les exports peuvent s'y fier.
 */
export function sanitizeEntry(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const id = str(raw.id, 80);
  if (!id || !isRealDate(raw.date)) return null;
  if (!Number.isInteger(raw.amount) || raw.amount <= 0 || raw.amount > MAX_AMOUNT) return null;
  const declared = Number.isInteger(raw.declared) && raw.declared >= 0 && raw.declared < raw.amount ? raw.declared : null;
  return {
    id,
    date: raw.date,
    client: str(raw.client, 200).trim() || '—',
    endClient: str(raw.endClient, 200),
    type: str(raw.type, 200),
    project: str(raw.project, 200),
    amount: raw.amount,
    declared,
    status: Object.values(STATUS).includes(raw.status) ? raw.status : STATUS.PAID,
    installment: str(raw.installment, 20),
    invoiceUrl: httpUrl(raw.invoiceUrl),
    videoUrl: httpUrl(raw.videoUrl),
    notes: str(raw.notes, 2000),
    review: raw.review === true,
    createdAt: stamp(raw.createdAt),
    updatedAt: stamp(raw.updatedAt),
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

/** État venu de l'extérieur, nettoyé. Ne lève jamais d'erreur. */
export function sanitizeState(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const entries = [];
  const seen = new Set();
  for (const item of Array.isArray(src.entries) ? src.entries.slice(0, MAX_ENTRIES) : []) {
    const e = sanitizeEntry(item);
    if (!e || seen.has(e.id)) continue;
    seen.add(e.id);
    entries.push(e);
  }
  const settings = src.settings && typeof src.settings === 'object' ? src.settings : {};
  const rates = sanitizeRates(settings.rates);
  // Sans taux valides, ces réglages ne doivent jamais l'emporter sur ceux de l'appareil.
  return { entries, settings: { rates, updatedAt: Object.keys(rates).length ? stamp(settings.updatedAt) : EPOCH } };
}

// ---------- Saisie ----------

const newId = () =>
  globalThis.crypto?.randomUUID ? crypto.randomUUID() : `e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** Champ montant : undefined si vide, null si illisible, sinon des centimes. */
function money(v) {
  if (v == null) return undefined;
  if (typeof v !== 'string') return v;
  return v.trim() === '' ? undefined : parseAmount(v);
}

/** Nettoie une saisie (montants en texte ou en centimes) et renvoie { entry } ou { errors }. */
export function normalizeEntry(input) {
  const errors = {};
  const text = (v, max = 200) => String(v ?? '').trim().slice(0, max);
  const amount = money(input.amount);
  const declared = money(input.declared);
  const e = {
    date: text(input.date, 10),
    client: text(input.client),
    endClient: text(input.endClient),
    type: text(input.type),
    project: text(input.project),
    amount,
    declared: declared === undefined ? null : declared,
    status: Object.values(STATUS).includes(input.status) ? input.status : STATUS.PAID,
    installment: text(input.installment, 20),
    invoiceUrl: text(input.invoiceUrl, 2000),
    videoUrl: text(input.videoUrl, 2000),
    notes: text(input.notes, 2000),
    review: Boolean(input.review),
  };

  if (!isRealDate(e.date)) errors.date = 'Choisis une date valide.';
  if (!e.client) errors.client = 'Indique le client.';

  if (amount === undefined) errors.amount = 'Indique le montant.';
  else if (amount === null || !Number.isInteger(amount)) errors.amount = 'Montant illisible. Exemple : 1200,50';
  else if (amount <= 0) errors.amount = 'Indique un montant supérieur à 0.';
  else if (amount > MAX_AMOUNT) errors.amount = 'Montant trop grand.';

  if (declared === null || (declared !== undefined && (!Number.isInteger(declared) || declared < 0))) {
    errors.declared = 'Montant illisible. Exemple : 250';
  } else if (declared !== undefined && Number.isInteger(amount) && declared > amount) {
    errors.declared = 'Le déclaré dépasse le montant.';
  } else if (declared === amount) {
    e.declared = null;
  }

  for (const field of ['invoiceUrl', 'videoUrl']) {
    if (e[field] && !/^https?:\/\//i.test(e[field])) errors[field] = 'Le lien doit commencer par https://';
  }
  return Object.keys(errors).length ? { errors } : { entry: e };
}

/**
 * Horodatage d'une modification : jamais antérieur à la version précédente, même si l'horloge
 * de l'appareil retarde sur celle d'un autre. Sans cela, une modification toute fraîche pourrait
 * perdre la fusion face à une version plus ancienne.
 */
const later = (now, previous) => (!previous || now > previous ? now : new Date(Date.parse(previous) + 1).toISOString());

export function addEntry(state, entry, now = new Date().toISOString()) {
  const full = { ...entry, id: newId(), createdAt: now, updatedAt: now, deleted: false };
  return { ...state, entries: [...state.entries, full] };
}

export function updateEntry(state, id, patch, now = new Date().toISOString()) {
  return {
    ...state,
    entries: state.entries.map((e) => (e.id === id ? { ...e, ...patch, id, updatedAt: later(now, e.updatedAt) } : e)),
  };
}

export function deleteEntry(state, id, now = new Date().toISOString()) {
  return updateEntry(state, id, { deleted: true }, now);
}

export function restoreEntry(state, id, now = new Date().toISOString()) {
  return updateEntry(state, id, { deleted: false }, now);
}

/** Modifie les taux (réglage partagé entre appareils). */
export function updateRates(state, rates, now = new Date().toISOString()) {
  return { ...state, settings: { ...state.settings, rates, updatedAt: later(now, state.settings.updatedAt) } };
}

/** Modifie un réglage propre à l'appareil (identifiant Google, envoi automatique) : pas d'horodatage partagé. */
export function updateDeviceSettings(state, patch) {
  return { ...state, settings: { ...state.settings, ...patch } };
}

// ---------- Fusion ----------

/**
 * Fusionne l'état local avec un autre (Drive, fichier importé, autre onglet) : pour chaque ligne,
 * la version modifiée le plus récemment gagne. Idem pour les taux, année par année manquante comprise.
 * Les réglages propres à l'appareil restent ceux de l'état local.
 */
export function mergeStates(local, otherRaw) {
  if (!otherRaw) return local;
  const other = sanitizeState(otherRaw);
  const map = new Map();
  for (const e of local.entries) map.set(e.id, e);
  for (const e of other.entries) {
    const mine = map.get(e.id);
    if (!mine || e.updatedAt > String(mine.updatedAt)) map.set(e.id, e);
  }
  const otherNewer = other.settings.updatedAt > String(local.settings.updatedAt || '');
  const settings = {
    ...local.settings,
    // Une année connue d'un seul côté est toujours gardée ; sinon le côté le plus récent décide.
    rates: otherNewer ? { ...local.settings.rates, ...other.settings.rates } : { ...other.settings.rates, ...local.settings.rates },
    updatedAt: otherNewer ? other.settings.updatedAt : local.settings.updatedAt,
  };
  return { entries: [...map.values()], settings };
}

/** Vrai si deux états portent les mêmes données partagées (lignes et taux). */
export function sameData(a, b) {
  return JSON.stringify(exportableState(a)) === JSON.stringify(exportableState(b));
}

/** Ce qui part sur Drive ou dans une sauvegarde : jamais l'identifiant Google ni les préférences d'appareil. */
export function exportableState(state) {
  // Forme canonique (mêmes champs, même ordre, lignes triées) : deux états identiques donnent le même texte,
  // qu'une ligne vienne d'être saisie ici ou relue depuis Drive.
  const entries = state.entries.map(sanitizeEntry).filter(Boolean).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const rates = Object.fromEntries(Object.entries(state.settings.rates).sort(([a], [b]) => a.localeCompare(b)));
  return { version: 1, entries, settings: { rates, updatedAt: state.settings.updatedAt } };
}

// ---------- Aides à la saisie ----------

/** Valeurs déjà saisies pour un champ, les plus fréquentes d'abord. `where` restreint les lignes prises en compte. */
export function suggestions(state, field, where = null) {
  const count = new Map();
  for (const e of state.entries) {
    if (e.deleted || !e[field] || (where && !where(e))) continue;
    count.set(e[field], (count.get(e[field]) || 0) + 1);
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([v]) => v);
}

const same = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

/** Dernière ligne connue d'un client (et d'un projet, si précisé), pour préremplir la saisie. */
export function latestFor(state, client, project = null) {
  let best = null;
  for (const e of state.entries) {
    if (e.deleted || !same(e.client, client) || (project != null && !same(e.project, project))) continue;
    if (!best || e.date > best.date || (e.date === best.date && e.updatedAt > best.updatedAt)) best = e;
  }
  return best;
}
