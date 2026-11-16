// Règles de calcul. Tous les montants sont en centimes (entiers).

export const STATUS = { PAID: 'paid', PENDING: 'pending', UNPAID: 'unpaid' };
export const STATUS_LABEL = { paid: 'Payé', pending: 'En attente', unpaid: 'Impayé' };

export const todayISO = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const monthKey = (iso) => iso.slice(0, 7);
export const yearOf = (iso) => iso.slice(0, 4);

/** "1 234,56" / "1234.5" / "45€" -> centimes, ou null si illisible. */
export function parseAmount(input) {
  if (typeof input === 'number') return Number.isFinite(input) ? Math.round(input * 100) : null;
  const s = String(input ?? '').replace(/[\s  €]/g, '').replace(',', '.');
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return null;
  return Math.round(parseFloat(s) * 100);
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
export const paid = (entries) => live(entries).filter((e) => e.status === STATUS.PAID);

/** Totaux d'un ensemble de lignes payées. */
export function totals(entries, settings) {
  let ca = 0, declared = 0, cotis = 0;
  for (const e of entries) {
    if (e.deleted || e.status !== STATUS.PAID) continue;
    const d = declaredOf(e);
    ca += e.amount;
    declared += d;
    cotis += d * rateFor(e.date, settings);
  }
  cotis = Math.round(cotis);
  return { ca, declared, cotis, net: ca - cotis, count: entries.filter((e) => !e.deleted && e.status === STATUS.PAID).length };
}

/** Map "AAAA-MM" -> totaux, pour les lignes payées. */
export function byMonth(entries, settings) {
  const groups = new Map();
  for (const e of paid(entries)) {
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
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}

export function addMonths(key, n) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Paiements attendus : en attente, triés par date ; "late" si la date est passée. */
export function receivables(entries, today = todayISO()) {
  return live(entries)
    .filter((e) => e.status === STATUS.PENDING)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((e) => ({ ...e, late: e.date < today }));
}

/** Répartition du CA payé par clé (client, type...), triée décroissante. */
export function breakdown(entries, keyFn) {
  const map = new Map();
  let total = 0;
  for (const e of paid(entries)) {
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
  return live(entries).filter((e) => quarterKey(e.date) === qKey);
}

// --- Formats d'affichage (fr-FR) ---

const eur0 = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const eur2 = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 });

/** Euros : sans centimes s'ils sont nuls, sinon avec. */
export function fmtEUR(cents, { exact = false } = {}) {
  if (cents == null) return '—';
  return (exact || cents % 100 !== 0 ? eur2 : eur0).format(cents / 100);
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
