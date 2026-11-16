import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { byMonth, monthRange, parseAmount, rateFor, receivables, totals, breakdown, fmtEUR } from '../js/calc.js';
import * as store from '../js/store.js';
import { seedEntries } from '../js/seed.js';
import { toCSV, toXLSX } from '../js/export.js';

const settings = { rates: { 2025: 22, 2026: 24 } };

test('parseAmount lit les formats français', () => {
  assert.equal(parseAmount('1 249,38'), 124938);
  assert.equal(parseAmount('45€'), 4500);
  assert.equal(parseAmount('59.38'), 5938);
  assert.equal(parseAmount('700eur jamais payé'), null);
  assert.equal(parseAmount(''), null);
});

test('rateFor prend le taux de l’année, sinon le dernier connu', () => {
  assert.equal(rateFor('2025-05-01', settings), 0.22);
  assert.equal(rateFor('2027-01-01', settings), 0.24);
  assert.equal(rateFor('2024-01-01', settings), 0.22);
});

// Totaux par mois calculés sur les dates écrites dans l'Excel (quelques lignes y étaient rangées dans un autre onglet).
const EXCEL_CA = {
  '2025-05': 240, '2025-06': 90, '2025-07': 90, '2025-09': 425, '2025-10': 767, '2025-12': 1369,
  '2026-01': 1249.38, '2026-02': 1300, '2026-03': 1365, '2026-04': 400, '2026-05': 1450,
  '2026-06': 470, '2026-07': 200, '2026-08': 75, '2026-09': 900,
};

test('l’historique importé donne les totaux mensuels attendus', () => {
  const months = byMonth(seedEntries(), settings);
  assert.deepEqual([...months.keys()].sort(), Object.keys(EXCEL_CA).sort());
  for (const [k, ca] of Object.entries(EXCEL_CA)) assert.equal(months.get(k).ca, Math.round(ca * 100), k);
});

test('l’impayé Hooked ne compte pas dans le CA', () => {
  const june = seedEntries().filter((e) => e.date.startsWith('2025-06'));
  assert.equal(june.length, 3);
  assert.equal(totals(june, settings).ca, 9000);
});

test('les cotisations portent sur le montant déclaré', () => {
  const feb = seedEntries().filter((e) => e.date.startsWith('2026-02'));
  const t = totals(feb, settings);
  assert.equal(t.ca, 130000);
  assert.equal(t.declared, 55000);
  assert.equal(t.cotis, 13200);
  assert.equal(t.net, 116800);
});

test('receivables liste les paiements en attente et repère les retards', () => {
  const entries = [
    { id: 'a', date: '2026-11-01', amount: 100, status: 'pending' },
    { id: 'b', date: '2026-12-01', amount: 200, status: 'pending' },
    { id: 'c', date: '2026-10-01', amount: 300, status: 'paid' },
    { id: 'd', date: '2026-10-01', amount: 300, status: 'pending', deleted: true },
  ];
  const r = receivables(entries, '2026-11-16');
  assert.deepEqual(r.map((e) => [e.id, e.late]), [['a', true], ['b', false]]);
});

test('breakdown et monthRange', () => {
  const b = breakdown(seedEntries(), (e) => e.client);
  assert.equal(b[0].name, 'Vizionary');
  assert.ok(Math.abs(b.reduce((s, r) => s + r.share, 0) - 1) < 1e-9);
  assert.deepEqual(monthRange('2025-11', '2026-02'), ['2025-11', '2025-12', '2026-01', '2026-02']);
  assert.equal(fmtEUR(124938).replace(/\s/g, ' '), '1 249,38 €');
});

test('normalizeEntry valide la saisie', () => {
  assert.deepEqual(Object.keys(store.normalizeEntry({ date: '', client: '', amount: null }).errors).sort(), ['amount', 'client', 'date']);
  const ok = store.normalizeEntry({ date: '2026-11-16', client: ' Swivo ', amount: 4500, declared: 4500, status: 'nope' });
  assert.equal(ok.entry.client, 'Swivo');
  assert.equal(ok.entry.declared, null);
  assert.equal(ok.entry.status, 'paid');
  assert.ok(store.normalizeEntry({ date: '2026-11-16', client: 'A', amount: 100, declared: 200 }).errors.declared);
  assert.ok(store.normalizeEntry({ date: '2026-11-16', client: 'A', amount: 100, invoiceUrl: 'javascript:alert(1)' }).errors.invoiceUrl);
});

test('ajout, modification, suppression et restauration', () => {
  let s = store.emptyState();
  s = store.addEntry(s, { date: '2026-11-16', client: 'A', amount: 100, status: 'paid' }, '2026-11-16T10:00:00.000Z');
  const id = s.entries[0].id;
  s = store.updateEntry(s, id, { amount: 250 }, '2026-11-16T11:00:00.000Z');
  assert.equal(s.entries[0].amount, 250);
  s = store.deleteEntry(s, id, '2026-11-16T12:00:00.000Z');
  assert.equal(totals(s.entries, settings).ca, 0);
  s = store.restoreEntry(s, id, '2026-11-16T13:00:00.000Z');
  assert.equal(totals(s.entries, settings).ca, 250);
});

test('mergeStates garde la version la plus récente de chaque ligne', () => {
  const base = { id: 'x', date: '2026-01-01', client: 'A', amount: 100, status: 'paid' };
  const local = { ...store.emptyState(), entries: [{ ...base, updatedAt: '2026-01-02T00:00:00Z' }, { ...base, id: 'local-only', updatedAt: '2026-01-01T00:00:00Z' }] };
  local.settings.driveClientId = 'mine';
  const remote = {
    entries: [{ ...base, amount: 999, updatedAt: '2026-01-03T00:00:00Z' }, { ...base, id: 'remote-only', updatedAt: '2026-01-01T00:00:00Z' }, { ...base, id: 'local-only', deleted: true, updatedAt: '2025-12-01T00:00:00Z' }],
    settings: { rates: { 2026: 30 }, updatedAt: '2026-06-01T00:00:00Z' },
  };
  const m = store.mergeStates(local, remote);
  assert.equal(m.entries.length, 3);
  assert.equal(m.entries.find((e) => e.id === 'x').amount, 999);
  assert.equal(m.entries.find((e) => e.id === 'local-only').deleted, undefined);
  assert.deepEqual(m.settings.rates, { 2026: 30 });
  assert.equal(m.settings.driveClientId, 'mine');
  assert.equal(store.mergeStates(local, null), local);
  assert.equal(store.exportableState(local).settings.driveClientId, undefined);
});

test('toCSV : séparateur ;, décimales à virgule, formules neutralisées', () => {
  const csv = toCSV([
    { id: '1', date: '2026-01-10', client: 'Wenoble', type: 'Commission', amount: 5938, status: 'paid', createdAt: 'a', notes: 'a;b "c"' },
    { id: '2', date: '2026-01-11', client: '=HYPERLINK("x")', amount: 100, declared: 0, status: 'pending', createdAt: 'b' },
    { id: '3', date: '2026-01-12', client: 'Z', amount: 100, status: 'paid', createdAt: 'c', deleted: true },
  ]);
  const lines = csv.trim().split('\r\n');
  assert.ok(csv.startsWith('﻿'));
  assert.equal(lines.length, 3);
  assert.equal(lines[1], '10/01/2026;Wenoble;;Commission;;;59,38;59,38;Payé;;"a;b ""c""";');
  assert.ok(lines[2].includes('"\'=HYPERLINK(""x"")"'));
  assert.ok(lines[2].includes(';1,00;0,00;En attente;'));
});

test('toXLSX produit un classeur relisible avec les bons totaux', async () => {
  // Le bundle navigateur est un script UMD : on l'évalue comme un module CommonJS.
  const mod = { exports: {} };
  new Function('module', 'exports', readFileSync(new URL('../vendor/exceljs.min.js', import.meta.url), 'utf8'))(mod, mod.exports);
  const ExcelJS = mod.exports;
  const state = { entries: seedEntries(), settings };
  const buf = await toXLSX(state, ExcelJS);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.getWorksheet('Paiements');
  assert.equal(ws.rowCount, seedEntries().length + 1);
  assert.equal(ws.getRow(2).getCell(2).value, 'Swivo');
  assert.equal(ws.getRow(2).getCell(7).value, 150);
  const wm = wb.getWorksheet('Mois');
  assert.equal(wm.rowCount, Object.keys(EXCEL_CA).length + 2);
  assert.equal(wm.getRow(2).getCell(3).value, 240);
  assert.equal(wm.getRow(wm.rowCount).getCell(1).value, 'Total');
});
