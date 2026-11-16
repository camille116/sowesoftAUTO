// Règles de calcul. Tous les montants sont en centimes (entiers).

export const STATUS = { PAID: 'paid', PENDING: 'pending', UNPAID: 'unpaid' };
export const STATUS_LABEL = { paid: 'Payé', pending: 'En attente', unpaid: 'Impayé' };

/** 100 millions d'euros, en centimes : au-delà, c'est une faute de frappe. */
export const MAX_AMOUNT = 100_000_000_00;

const pad = (n) => String(n).padStart(2, '0');

export const todayISO = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const monthKey = (iso) => iso.slice(0, 7);
export const yearOf = (iso) => iso.slice(0, 4);

/** Vraie date du calendrier au format AAAA-MM-JJ, entre 2000 et 2100. */
export function isRealDate(iso) {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const [y, m, d] = iso.split('-').map(Number);
  if (y < 2000 || y > 2100) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/**
 * "1 234,56" / "1234.5" / "45€" / "1.234,56" / "1,234.56" -> centimes, ou null si illisible.
 * Avec deux séparateurs, le dernier est celui des décimales et l'autre celui des milliers.
 */
export function parseAmount(input) {
  if (typeof input === 'number') {
    const cents = Math.round(input * 100);
    return Number.isFinite(input) && input >= 0 && Number.isSafeInteger(cents) ? cents : null;
  }
  let s = String(input ?? '').replace(/[\s  €]/g, '');
  if (s.includes(',') && s.includes('.')) {
    const dec = s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.';
    const parts = s.split(dec);
    const groups = parts[0].split(dec === ',' ? '.' : ',');
    if (parts.length !== 2 || !/^\d{1,3}$/.test(groups[0]) || !groups.slice(1).every((g) => /^\d{3}$/.test(g))) return null;
    s = `${groups.join('')}.${parts[1]}`;
  } else {
    s = s.replace(',', '.');
  }
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return null;
  // Calcul en entiers : pas d'erreur d'arrondi du type 1,15 × 100 = 114,99…
  const [whole, frac = ''] = s.split('.');
  const cents = Number(whole) * 100 + Number(`${frac}00`.slice(0, 2));
  return Number.isSafeInteger(cents) ? cents : null;
}

/** Montant déclaré d'une ligne : égal au montant encaissé si non précisé. */
export const declaredOf = (e) => (e.declared == null ? e.amount : e.declared);

/** Taux de cotisations (0..1) applicable à une date, selon les réglages par année. */
export function rateFor(iso, settings) {
  const rates = settings?.rates || {};
  const y = yearOf(iso);
  if (rates[y] != null) return rates[y] / 100;
  const known = Object.keys(rates).sort();
  if (!known.length) return 0;
  const before = known.filter((k) => k <= y).pop();
  return rates[before ?? known[0]] / 100;
}

export const live = (entries) => entries.filter((e) => !e.deleted);
export const paid = (entries) => entries.filter((e) => !e.deleted && e.status === STATUS.PAID);

/** Totaux d'un ensemble de lignes : seules les lignes payées comptent. */
export function totals(entries, settings) {
  let ca = 0, declared = 0, cotis = 0, count = 0;
  for (const e of entries) {
    if (e.deleted || e.status !== STATUS.PAID) continue;
    const d = declaredOf(e);
    ca += e.amount;
    declared += d;
    cotis += d * rateFor(e.date, settings);
    count += 1;
  }
  cotis = Math.round(cotis);
  return { ca, declared, cotis, net: ca - cotis, count };
}

/** Map "AAAA-MM" -> totaux, pour les lignes payées. */
export function byMonth(entries, settings) {
  const groups = new Map();
  for (const e of entries) {
    if (e.deleted || e.status !== STATUS.PAID) continue;
    const k = monthKey(e.date);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }
  const out = new Map();
  for (const [k, list] of groups) out.set(k, totals(list, settings));
  return out;
}

/** Liste continue de mois "AAAA-MM" entre deux mois inclus. */
export function monthRange(from, to) {
  const out = [];
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${String(y).padStart(4, '0')}-${pad(m)}`);
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}

export function addMonths(key, n) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${String(d.getFullYear()).padStart(4, '0')}-${pad(d.getMonth() + 1)}`;
}

/** Paiements attendus : en attente, triés par date ; "late" si la date prévue est passée. */
export function receivables(entries, today = todayISO()) {
  return entries
    .filter((e) => !e.deleted && e.status === STATUS.PENDING)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((e) => ({ ...e, late: e.date < today }));
}

/** Répartition du CA payé par clé (client, prestation...), triée décroissante. */
export function breakdown(entries, keyFn) {
  const map = new Map();
  let total = 0;
  for (const e of entries) {
    if (e.deleted || e.status !== STATUS.PAID) continue;
    const k = keyFn(e) || '—';
    map.set(k, (map.get(k) || 0) + e.amount);
    total += e.amount;
  }
  return [...map.entries()]
    .map(([name, amount]) => ({ name, amount, share: total ? amount / total : 0 }))
    .sort((a, b) => b.amount - a.amount);
}

/** Trimestre civil "AAAA-Tn" d'une date. */
export const quarterKey = (iso) => `${yearOf(iso)}-T${Math.ceil(Number(iso.slice(5, 7)) / 3)}`;

export function inQuarter(entries, qKey) {
  return entries.filter((e) => !e.deleted && quarterKey(e.date) === qKey);
}

// --- Formats d'affichage (fr-FR) ---

const eur0 = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const eur2 = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 });

/** Euros : sans centimes s'ils sont nuls, sinon avec. */
export function fmtEUR(cents, { exact = false } = {}) {
  if (cents == null) return '—';
  return (exact || cents % 100 !== 0 ? eur2 : eur0).format(cents / 100);
}

/** Taille de fichier lisible : "286 Mo". */
export function fmtSize(bytes) {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1).replace('.', ',')} Go`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} Mo`;
  return `${Math.max(1, Math.round(bytes / 1e3))} Ko`;
}

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const MONTHS_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

export function fmtMonth(key, { short = false, year = true } = {}) {
  const [y, m] = key.split('-').map(Number);
  const name = (short ? MONTHS_SHORT : MONTHS)[m - 1];
  return year ? `${name} ${y}` : name;
}

export function fmtDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export function fmtDateShort(iso) {
  const [, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS_SHORT[m - 1]}`;
}

export function fmtDateLong(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}
