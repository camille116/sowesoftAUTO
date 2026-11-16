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
    return {
      entries: Array.isArray(s.entries) ? s.entries : [],
      settings: { ...DEFAULT_SETTINGS, ...(s.settings || {}), rates: { ...DEFAULT_SETTINGS.rates, ...(s.settings?.rates || {}) } },
      seeded: Boolean(s.seeded),
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

/**
 * Fusionne l'état local et l'état distant (Drive) : pour chaque ligne, la version
 * modifiée le plus récemment gagne. Idem pour les réglages (hors identifiant Google, propre à l'appareil).
 */
export function mergeStates(local, remote) {
  if (!remote) return local;
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
