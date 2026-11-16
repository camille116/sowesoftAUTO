import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { byMonth, monthRange, parseAmount, rateFor, receivables, totals, breakdown, fmtEUR } from '../js/calc.js';
import * as store from '../js/store.js';
import { toCSV, toXLSX } from '../js/export.js';

const settings = { rates: { 2025: 22, 2026: 24 } };

// Jeu de données inventé : aucun client ni montant réel.
const row = (id, date, client, type, euros, status = 'paid', declared = null, extra = {}) => ({
  id, date, client, endClient: '', type, project: '', amount: Math.round(euros * 100), status,
  declared: declared == null ? null : Math.round(declared * 100), installment: '', invoiceUrl: '', notes: '', review: false,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deleted: false, ...extra,
});
const sample = () => [
  row('a1', '2025-05-01', 'Atelier Nord', 'Montage', 150),
  row('a2', '2025-05-12', 'Atelier Nord', 'Logo animé', 45),
  row('a3', '2025-06-20', 'Studio Kite', 'Montage', 700, 'unpaid'),
  row('a4', '2025-06-26', 'Atelier Nord', 'Logo animé', 45),
  row('a5', '2026-01-10', 'Maison Lune', 'Commission', 59.38),
  row('a6', '2026-02-01', 'Studio Kite', 'Short', 200, 'paid', 0),
  row('a7', '2026-02-11', 'Agence Orme', 'Motion design', 1100, 'paid', 550),
  row('a8', '2026-03-02', 'Agence Orme', 'Motion design', 400, 'pending'),
];

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

test('byMonth additionne les lignes payées par mois', () => {
  const months = byMonth(sample(), settings);
  assert.deepEqual([...months.keys()].sort(), ['2025-05', '2025-06', '2026-01', '2026-02']);
  assert.equal(months.get('2025-05').ca, 19500);
  assert.equal(months.get('2026-01').ca, 5938);
});

test('un impayé ou un paiement en attente ne compte pas dans le CA', () => {
  const june = sample().filter((e) => e.date.startsWith('2025-06'));
  assert.equal(june.length, 2);
  assert.equal(totals(june, settings).ca, 4500);
  assert.equal(byMonth(sample(), settings).has('2026-03'), false);
});

test('les cotisations portent sur le montant déclaré', () => {
  const t = totals(sample().filter((e) => e.date.startsWith('2026-02')), settings);
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
  const b = breakdown(sample(), (e) => e.client);
  assert.equal(b[0].name, 'Agence Orme');
  assert.ok(Math.abs(b.reduce((s, r) => s + r.share, 0) - 1) < 1e-9);
  assert.deepEqual(monthRange('2025-11', '2026-02'), ['2025-11', '2025-12', '2026-01', '2026-02']);
  assert.equal(fmtEUR(124938).replace(/\s/g, ' '), '1 249,38 €');
});

test('normalizeEntry valide la saisie', () => {
  assert.deepEqual(Object.keys(store.normalizeEntry({ date: '', client: '', amount: null }).errors).sort(), ['amount', 'client', 'date']);
  const ok = store.normalizeEntry({ date: '2026-11-16', client: ' Atelier Nord ', amount: 4500, declared: 4500, status: 'nope' });
  assert.equal(ok.entry.client, 'Atelier Nord');
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
  const base = row('x', '2026-01-01', 'A', 'T', 1);
  const local = { ...store.emptyState(), entries: [{ ...base, updatedAt: '2026-01-02T00:00:00.000Z' }, { ...base, id: 'local-only' }] };
  local.settings.driveClientId = 'mine';
  const remote = {
    entries: [{ ...base, amount: 999, updatedAt: '2026-01-03T00:00:00.000Z' }, { ...base, id: 'remote-only' }, { ...base, id: 'local-only', deleted: true, updatedAt: '2025-12-01T00:00:00.000Z' }],
    settings: { rates: { 2026: 30 }, updatedAt: '2026-06-01T00:00:00.000Z' },
  };
  const m = store.mergeStates(local, remote);
  assert.equal(m.entries.length, 3);
  assert.equal(m.entries.find((e) => e.id === 'x').amount, 999);
  assert.equal(m.entries.find((e) => e.id === 'local-only').deleted, false);
  assert.deepEqual(m.settings.rates, { 2026: 30 });
  assert.equal(m.settings.driveClientId, 'mine');
  assert.equal(store.mergeStates(local, null), local);
  assert.equal(store.exportableState(local).settings.driveClientId, undefined);
});

test('les données venues de l’extérieur sont nettoyées avant fusion', () => {
  const now = '2026-11-16T10:00:00.000Z';
  const evil = '"><img src=x onerror=alert(1)>';
  assert.equal(store.sanitizeEntry({ ...row('a', '2026-01-01', 'A', 'T', 1), date: [evil] }, now), null);
  assert.equal(store.sanitizeEntry({ ...row('a', '2026-01-01', 'A', 'T', 1), date: 5 }, now), null);
  assert.equal(store.sanitizeEntry({ ...row('a', '2026-01-01', 'A', 'T', 1), amount: '100' }, now), null);
  assert.equal(store.sanitizeEntry(null, now), null);
  const e = store.sanitizeEntry({
    ...row('a', '2026-01-01', 'A', 'T', 1), status: evil, client: { formula: '1+1' }, invoiceUrl: 'javascript:alert(1)',
    notes: 'x'.repeat(5000), updatedAt: '9999-01-01T00:00:00.000Z', createdAt: 42, deleted: 'yes', extra: 'ignored',
  }, now);
  assert.equal(e.status, 'paid');
  assert.equal(e.client, '—');
  assert.equal(e.invoiceUrl, '');
  assert.equal(e.notes.length, 2000);
  assert.equal(e.updatedAt, now);
  assert.equal(e.createdAt, '1970-01-01T00:00:00.000Z');
  assert.equal(e.deleted, false);
  assert.equal('extra' in e, false);
  assert.deepEqual(store.sanitizeRates({ 2026: 25.8, [evil]: 1, 2027: '30', 2028: 400 }), { 2026: 25.8 });
  for (const junk of [null, 5, 'x', [], { entries: 'no' }, { entries: [1, null, {}] }]) assert.deepEqual(store.sanitizeState(junk, now).entries, []);

  // Une ligne supprimée à distance avec une date future ne doit pas verrouiller la ligne pour toujours.
  const local = { ...store.emptyState(), entries: [row('a', '2026-01-01', 'A', 'T', 1)] };
  const merged = store.mergeStates(local, { entries: [{ ...row('a', '2026-01-01', 'A', 'T', 1), deleted: true, updatedAt: '9999-01-01T00:00:00.000Z' }] });
  assert.ok(merged.entries[0].updatedAt < '9999');
  // Des taux distants invalides ne remplacent pas les taux locaux.
  assert.deepEqual(store.mergeStates(local, { entries: [], settings: { rates: { [evil]: 1 }, updatedAt: '2099-01-01T00:00:00.000Z' } }).settings.rates, local.settings.rates);
});

test('toCSV : séparateur ;, décimales à virgule, formules neutralisées', () => {
  const csv = toCSV([
    { id: '1', date: '2026-01-10', client: 'Maison Lune', type: 'Commission', amount: 5938, status: 'paid', createdAt: 'a', notes: 'a;b "c"' },
    { id: '2', date: '2026-01-11', client: '=HYPERLINK("x")', amount: 100, declared: 0, status: 'pending', createdAt: 'b' },
    { id: '3', date: '2026-01-12', client: 'Z', amount: 100, status: 'paid', createdAt: 'c', deleted: true },
  ]);
  const lines = csv.trim().split('\r\n');
  assert.ok(csv.startsWith('﻿'));
  assert.equal(lines.length, 3);
  assert.equal(lines[1], '10/01/2026;Maison Lune;;Commission;;;59,38;59,38;Payé;;"a;b ""c""";');
  assert.ok(lines[2].includes('"\'=HYPERLINK(""x"")"'));
  assert.ok(lines[2].includes(';1,00;0,00;En attente;'));
});

test('toXLSX produit un classeur relisible avec les bons totaux', async () => {
  // Le bundle navigateur est un script UMD : on l'évalue comme un module CommonJS.
  const mod = { exports: {} };
  new Function('module', 'exports', readFileSync(new URL('../vendor/exceljs.min.js', import.meta.url), 'utf8'))(mod, mod.exports);
  const ExcelJS = mod.exports;
  const buf = await toXLSX({ entries: sample(), settings }, ExcelJS);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.getWorksheet('Paiements');
  assert.equal(ws.rowCount, sample().length + 1);
  assert.equal(ws.getRow(2).getCell(2).value, 'Atelier Nord');
  assert.equal(ws.getRow(2).getCell(7).value, 150);
  const wm = wb.getWorksheet('Mois');
  assert.equal(wm.rowCount, 4 + 2);
  assert.equal(wm.getRow(2).getCell(3).value, 195);
  assert.equal(wm.getRow(wm.rowCount).getCell(1).value, 'Total');
});
