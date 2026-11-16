// Exports : CSV (texte) et classeur Excel (.xlsx via ExcelJS, chargé dans la page).

import { STATUS, STATUS_LABEL, byMonth, declaredOf, fmtDate, fmtMonth, live, rateFor } from './calc.js';

const COLUMNS = [
  ['Date', (e) => fmtDate(e.date)],
  ['Client', (e) => e.client],
  ['Client final', (e) => e.endClient],
  ['Prestation', (e) => e.type],
  ['Projet', (e) => e.project],
  ['Tranche', (e) => e.installment],
  ['Montant', (e) => num(e.amount)],
  ['Montant déclaré', (e) => num(declaredOf(e))],
  ['Statut', (e) => STATUS_LABEL[e.status]],
  ['Facture', (e) => e.invoiceUrl],
  ['Notes', (e) => e.notes],
  ['À vérifier', (e) => (e.review ? 'oui' : '')],
];

const num = (cents) => (cents / 100).toFixed(2).replace('.', ',');

export const sorted = (entries) => live(entries).sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));

/** Neutralise les formules (=, +, -, @) qu'un tableur exécuterait à l'ouverture. */
const safe = (v) => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v);

function csvCell(v, raw = false) {
  let s = String(v ?? '');
  if (!raw) s = safe(s);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV pour Excel français : séparateur « ; », décimales à virgule, BOM UTF-8. */
export function toCSV(entries) {
  const lines = [COLUMNS.map(([h]) => csvCell(h)).join(';')];
  for (const e of sorted(entries)) {
    lines.push(COLUMNS.map(([h, get]) => csvCell(get(e), h.startsWith('Montant'))).join(';'));
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}

export function download(filename, data, mime) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Classeur : un onglet « Paiements » (toutes les lignes) et un onglet « Mois » (totaux). */
export async function toXLSX(state, ExcelJS = globalThis.ExcelJS) {
  if (!ExcelJS) throw new Error('ExcelJS indisponible');
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  const EUR = '#,##0.00 "€"';
  const head = (ws) => {
    const row = ws.getRow(1);
    row.font = { bold: true };
    row.alignment = { vertical: 'middle' };
    row.border = { bottom: { style: 'thin', color: { argb: 'FFBDBDBD' } } };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
  };

  const ws = wb.addWorksheet('Paiements');
  ws.columns = [
    { header: 'Date', key: 'date', width: 12, style: { numFmt: 'dd/mm/yyyy' } },
    { header: 'Client', key: 'client', width: 20 },
    { header: 'Client final', key: 'endClient', width: 18 },
    { header: 'Prestation', key: 'type', width: 20 },
    { header: 'Projet', key: 'project', width: 22 },
    { header: 'Tranche', key: 'installment', width: 9 },
    { header: 'Montant', key: 'amount', width: 13, style: { numFmt: EUR } },
    { header: 'Montant déclaré', key: 'declared', width: 16, style: { numFmt: EUR } },
    { header: 'Statut', key: 'status', width: 12 },
    { header: 'Facture', key: 'invoice', width: 14 },
    { header: 'Notes', key: 'notes', width: 46 },
    { header: 'À vérifier', key: 'review', width: 11 },
  ];
  const rows = sorted(state.entries);
  for (const e of rows) {
    const [y, m, d] = e.date.split('-').map(Number);
    const row = ws.addRow({
      date: new Date(Date.UTC(y, m - 1, d)),
      client: e.client,
      endClient: e.endClient,
      type: e.type,
      project: e.project,
      installment: e.installment,
      amount: e.amount / 100,
      declared: declaredOf(e) / 100,
      status: STATUS_LABEL[e.status],
      notes: e.notes,
      review: e.review ? 'oui' : '',
    });
    if (/^https?:\/\//i.test(e.invoiceUrl)) {
      row.getCell('invoice').value = { text: 'Ouvrir', hyperlink: e.invoiceUrl };
      row.getCell('invoice').font = { underline: true, color: { argb: 'FF1A56DB' } };
    }
    if (e.status !== STATUS.PAID) row.font = { color: { argb: 'FF8A8A8A' } };
  }
  head(ws);
  if (rows.length) ws.autoFilter = { from: 'A1', to: { row: 1, column: ws.columnCount } };

  const wm = wb.addWorksheet('Mois');
  wm.columns = [
    { header: 'Mois', key: 'month', width: 18 },
    { header: 'Paiements', key: 'count', width: 11 },
    { header: 'CA encaissé', key: 'ca', width: 14, style: { numFmt: EUR } },
    { header: 'CA déclaré', key: 'declared', width: 14, style: { numFmt: EUR } },
    { header: 'Taux', key: 'rate', width: 9, style: { numFmt: '0.0" %"' } },
    { header: 'Cotisations estimées', key: 'cotis', width: 20, style: { numFmt: EUR } },
    { header: 'Net estimé', key: 'net', width: 14, style: { numFmt: EUR } },
  ];
  const months = byMonth(state.entries, state.settings);
  const keys = [...months.keys()].sort();
  for (const k of keys) {
    const t = months.get(k);
    wm.addRow({
      month: fmtMonth(k),
      count: t.count,
      ca: t.ca / 100,
      declared: t.declared / 100,
      rate: rateFor(`${k}-01`, state.settings) * 100,
      cotis: t.cotis / 100,
      net: t.net / 100,
    });
  }
  if (keys.length) {
    const last = keys.length + 1;
    const total = wm.addRow({
      month: 'Total',
      count: { formula: `SUM(B2:B${last})` },
      ca: { formula: `SUM(C2:C${last})` },
      declared: { formula: `SUM(D2:D${last})` },
      cotis: { formula: `SUM(F2:F${last})` },
      net: { formula: `SUM(G2:G${last})` },
    });
    total.font = { bold: true };
    total.border = { top: { style: 'thin', color: { argb: 'FFBDBDBD' } } };
  }
  head(wm);

  return wb.xlsx.writeBuffer();
}
