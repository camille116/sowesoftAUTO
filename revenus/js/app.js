// Interface : routage, rendu des trois écrans, formulaire, synchronisation Drive, envoi de vidéos.

import {
  STATUS, STATUS_LABEL, addDays, addMonths, breakdown, byMonth, fmtDateLong, fmtDateShort, fmtEUR, fmtMonth, fmtSize,
  inQuarter, live, monthKey, monthRange, quarterKey, receivables, todayISO, totals, yearOf,
} from './calc.js';
import * as store from './store.js';
import { XLSX_MIME, download, loadExcelJS, toCSV, toXLSX } from './export.js';
import * as drive from './drive.js';
import { isDragging, sortable } from './dnd.js';

let state = store.load();
let saveFailed = !store.save(state); // détecte dès l'ouverture un stockage plein ou bloqué
let pendingRender = false;

const ui = { range: 'last12', status: 'all', query: '', month: '', chartMonth: '', draft: null };
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const view = $('#view');
const sheet = $('#sheet');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const noHover = matchMedia('(hover: none)');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inputAmount = (cents) => (cents == null ? '' : (cents / 100).toFixed(cents % 100 ? 2 : 0).replace('.', ','));
const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;
const attrSel = (name, value) => `[${name}="${CSS.escape(value)}"]`;
const isHttp = (v) => /^https?:\/\//i.test(String(v ?? ''));

const svg = (d) => `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  calendar: svg('<rect x="2.5" y="3.5" width="11" height="10" rx="2.5"/><path d="M2.5 7h11M5.5 2v3M10.5 2v3"/>'),
  percent: svg('<path d="M12.5 3.5l-9 9"/><circle cx="4.5" cy="4.5" r="1.7"/><circle cx="11.5" cy="11.5" r="1.7"/>'),
  clock: svg('<circle cx="8" cy="8" r="5.5"/><path d="M8 5v3.2l2 1.3"/>'),
  arrow: svg('<path d="M5 11l6-6M6 5h5v5"/>'),
  grip: '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><circle cx="5.5" cy="3.5" r="1.25"/><circle cx="10.5" cy="3.5" r="1.25"/><circle cx="5.5" cy="8" r="1.25"/><circle cx="10.5" cy="8" r="1.25"/><circle cx="5.5" cy="12.5" r="1.25"/><circle cx="10.5" cy="12.5" r="1.25"/></svg>',
};

/** Pastille dégradée propre à chaque client : la couleur vient du nom, toujours la même. */
function orb(name) {
  let h = 0;
  for (const c of String(name)) h = (h * 31 + c.codePointAt(0)) % 360;
  h = (h * 137) % 360;
  return `<span class="orb" aria-hidden="true" style="--a:hsl(${h} 92% 74%);--b:hsl(${(h + 48) % 360} 88% 62%);--c:hsl(${(h + 300) % 360} 85% 70%)"></span>`;
}

// ---------- Changement d'état ----------

function commit(next, { sync = true, focus = null } = {}) {
  // Un autre onglet a pu enregistrer entre-temps : on fusionne avec ce qui est sur l'appareil avant d'écrire.
  state = store.mergeStates(next, store.load());
  saveFailed = !store.save(state);
  render({ focus });
  if (sync) requestSync();
}

// Un autre onglet vient d'enregistrer : on reprend ses données au lieu de les écraser plus tard.
window.addEventListener('storage', (ev) => {
  if (ev.key !== store.STORAGE_KEY || ev.newValue == null) return;
  const disk = store.load();
  state = store.updateDeviceSettings(store.mergeStates(state, disk), {
    driveClientId: disk.settings.driveClientId,
    driveAuto: disk.settings.driveAuto,
  });
  if (sheet.open) pendingRender = true;
  else render();
});

// ---------- Routage ----------

const ROUTES = new Map([['', 'overview'], ['paiements', 'payments'], ['reglages', 'settings']]);
const TITLES = { overview: 'Aperçu', payments: 'Paiements', settings: 'Réglages' };
const route = () => ROUTES.get(location.hash.replace(/^#\/?/, '').split('?')[0]) || 'overview';

const FOCUS_ATTRS = ['data-edit', 'data-filter', 'data-range', 'data-month', 'data-mark-paid', 'data-export', 'data-drag'];

function focusKey(el) {
  if (!el || !view.contains(el)) return null;
  if (el.id) return `#${CSS.escape(el.id)}`;
  const attr = FOCUS_ATTRS.find((a) => el.hasAttribute(a));
  return attr ? attrSel(attr, el.getAttribute(attr)) : null;
}

function render({ focus = null } = {}) {
  // Pendant un glisser-déposer, on ne reconstruit pas l'écran sous la main de l'utilisateur : ce sera fait au lâcher.
  if (isDragging()) { pendingRender = true; return; }
  const r = route();
  const hadFocus = view.contains(document.activeElement);
  const key = focusKey(document.activeElement);
  document.title = `${TITLES[r]} – Revenus`;
  for (const a of $$('.nav a')) {
    if (a.dataset.route === r) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  ({ overview: renderOverview, payments: renderPayments, settings: renderSettings })[r]();
  view.dataset.route = r;
  renderSync();
  renderNotice();
  // L'écran vient d'être reconstruit : si le focus s'est perdu, on le rend à l'élément équivalent, sinon au contenu.
  const lost = !document.activeElement || document.activeElement === document.body;
  if (!sheet.open && lost && (hadFocus || focus)) {
    const target = (focus && $(focus, view)) || (key && $(key, view)) || view;
    target.focus({ preventScroll: true });
  }
}

function renderNotice() {
  const el = $('#notice');
  el.hidden = !saveFailed;
  if (saveFailed && !el.firstChild) {
    el.innerHTML = '<p>Rien n’est enregistré sur cet appareil : le stockage du navigateur est plein ou bloqué. Exporte une sauvegarde avant de fermer cette page.</p><button type="button" class="btn" data-export="json">Exporter une sauvegarde</button>';
  }
}

// ---------- Halo du bandeau ----------
// Le halo réagit à trois choses, discrètement : il suit le pointeur, se replace quand on change
// de période, et gonfle une fois quand un paiement est encaissé. L'écran étant reconstruit à chaque
// rendu, l'état vit ici et la phase de l'animation est reprise où elle en était.

const art = { mx: 0, my: 0, rx: 0, ry: 0, pulse: false, pulseTimer: 0 };
const artStyle = () => `--mx:${art.mx.toFixed(3)};--my:${art.my.toFixed(3)};--rx:${art.rx};--ry:${art.ry};--t:-${(performance.now() / 1000).toFixed(2)}s`;
const applyArt = () => { const el = $('.hero-art'); if (el) for (const k of ['mx', 'my', 'rx', 'ry']) el.style.setProperty(`--${k}`, art[k]); };

/** Position de repos propre à chaque période : même période, même forme. */
function artForRange(range) {
  let h = 7;
  for (const c of String(range)) h = (h * 31 + c.codePointAt(0)) % 997;
  art.rx = ((h % 21) - 10) / 10;
  art.ry = (((h * 7) % 21) - 10) / 10;
}

function pulseArt() {
  art.pulse = true;
  clearTimeout(art.pulseTimer);
  art.pulseTimer = setTimeout(() => { art.pulse = false; $('.hero-art')?.classList.remove('pulse'); }, 1800);
  $('.hero-art')?.classList.add('pulse');
}

view.addEventListener('pointermove', (ev) => {
  // Mouvement réduit demandé : le halo ne suit pas le pointeur (et on évite un redessin à chaque déplacement).
  if (reducedMotion.matches) return;
  const hero = ev.target.closest?.('.hero');
  if (!hero) return;
  const r = hero.getBoundingClientRect();
  art.mx = ((ev.clientX - r.left) / r.width) * 2 - 1;
  art.my = ((ev.clientY - r.top) / r.height) * 2 - 1;
  applyArt();
});
view.addEventListener('pointerout', (ev) => {
  if (reducedMotion.matches || !ev.target.closest?.('.hero') || ev.relatedTarget?.closest?.('.hero')) return;
  art.mx = 0; art.my = 0;
  applyArt();
});

// ---------- Disposition du tableau de bord ----------
// L'ordre des cartes et des panneaux se change par glisser-déposer (ou au clavier, sur la poignée).
// Il est propre à l'appareil : un téléphone et un ordinateur n'ont pas les mêmes besoins.

const LAYOUT_KEY = 'revenus.layout';
const DEFAULT_LAYOUT = { kpis: ['year', 'cotis', 'due'], panels: ['chart', 'due', 'clients', 'types'] };
const ITEM_LABEL = {
  kpis: { year: 'Année', cotis: 'Cotisations du trimestre', due: 'À encaisser' },
  panels: { chart: 'Encaissé par mois', due: 'À encaisser', clients: 'Clients', types: 'Prestations' },
};

/** Ordre enregistré, ramené aux éléments connus : un inconnu est ignoré, un manquant est ajouté à la fin. */
function cleanLayout(saved) {
  return Object.fromEntries(Object.entries(DEFAULT_LAYOUT).map(([group, ids]) => {
    const kept = Array.isArray(saved?.[group]) ? [...new Set(saved[group])].filter((id) => ids.includes(id)) : [];
    return [group, [...kept, ...ids.filter((id) => !kept.includes(id))]];
  }));
}

function loadLayout() {
  try { return cleanLayout(JSON.parse(localStorage.getItem(LAYOUT_KEY) || '{}')); } catch { return cleanLayout({}); }
}

let layout = loadLayout();
const customLayout = () => JSON.stringify(layout) !== JSON.stringify(DEFAULT_LAYOUT);

function saveLayout(next) {
  layout = cleanLayout(next);
  try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)); } catch { /* stockage bloqué : l'ordre vaut pour cette session */ }
  const note = $('#layout-note');
  if (note) note.hidden = !customLayout();
}

// ---------- Aperçu ----------

function sumPaid(entries, test) {
  let sum = 0;
  for (const e of entries) if (e.status === STATUS.PAID && test(e)) sum += e.amount;
  return sum;
}

function renderOverview() {
  const today = todayISO();
  const thisMonth = monthKey(today);
  const prevMonth = addMonths(thisMonth, -1);
  const year = yearOf(today);
  const lastYear = String(Number(year) - 1);
  const day = today.slice(8);
  const entries = live(state.entries);
  const months = byMonth(entries, state.settings);
  const years = [...new Set(entries.map((e) => yearOf(e.date)))].sort();
  if (ui.range !== 'last12' && !years.includes(ui.range)) ui.range = 'last12';

  // Chiffres clés. Le mois et l'année comptent toutes les lignes payées de la période ;
  // seule la référence (période précédente) est coupée à la même durée écoulée.
  const caMonth = months.get(thisMonth)?.ca ?? 0;
  const caPrevSame = sumPaid(entries, (e) => monthKey(e.date) === prevMonth && e.date.slice(8) <= day);
  const caYear = sumPaid(entries, (e) => yearOf(e.date) === year);
  const caLastYearSame = sumPaid(entries, (e) => yearOf(e.date) === lastYear && e.date.slice(5) <= today.slice(5));
  const q = quarterKey(today);
  const tq = totals(inQuarter(entries, q), state.settings);
  const due = receivables(entries, today);
  const dueTotal = due.reduce((s, e) => s + e.amount, 0);
  const lateTotal = due.filter((e) => e.late).reduce((s, e) => s + e.amount, 0);
  const lateCount = due.filter((e) => e.late).length;
  const reviewCount = entries.filter((e) => e.review).length;

  // Plage du graphique et des répartitions.
  const rangeKeys = ui.range === 'last12' ? monthRange(addMonths(thisMonth, -11), thisMonth) : monthRange(`${ui.range}-01`, `${ui.range}-12`);
  const inRangeSet = new Set(rangeKeys);
  const inRange = entries.filter((e) => inRangeSet.has(monthKey(e.date)));
  const tr = totals(inRange, state.settings);
  const max = Math.max(1, ...rangeKeys.map((k) => months.get(k)?.ca ?? 0));
  const rangeLabel = ui.range === 'last12' ? '12 derniers mois' : esc(ui.range);
  if (!inRangeSet.has(ui.chartMonth)) ui.chartMonth = '';
  const picked = ui.chartMonth ? months.get(ui.chartMonth) : null;

  const cols = rangeKeys.map((k) => {
    const t = months.get(k);
    const f = t ? Math.max(0.015, t.ca / max).toFixed(4) : 0;
    const current = k === thisMonth;
    return `<a class="col" href="#/paiements" data-month="${k}" style="--f:${f}" ${t ? '' : 'data-empty'} ${current ? 'data-current' : ''} ${k === ui.chartMonth ? 'data-selected' : ''}
      aria-label="${esc(fmtMonth(k))} : ${t ? esc(fmtEUR(t.ca)) : 'aucun paiement'}${current ? ', mois en cours' : ''}. Voir les paiements.">
      <span class="col-tip"><b>${t ? fmtEUR(t.ca) : '—'}</b>${esc(fmtMonth(k))}${t ? `, cotisations ${fmtEUR(t.cotis)}` : ''}</span>
      <span class="col-bar"></span>
      <span class="col-label"><span>${esc(fmtMonth(k, { short: true, year: false }))}</span><i aria-hidden="true">${esc(fmtMonth(k, { year: false })[0].toUpperCase())}</i></span>
    </a>`;
  }).join('');

  // Au toucher, pas de survol : le mois choisi s'affiche ici, avec le lien vers ses paiements.
  const chartInfo = ui.chartMonth
    ? `${esc(fmtMonth(ui.chartMonth))} : <b>${picked ? fmtEUR(picked.ca) : 'aucun paiement'}</b><a class="link" href="#/paiements" data-month="${ui.chartMonth}">Voir les paiements</a>`
    : `${fmtEUR(tr.ca)} encaissés, net estimé ${fmtEUR(tr.net)}`;

  const rank = (rows, withOrb = false) => rows.length
    ? `<ol class="rank">${rows.slice(0, 6).map((r) => `<li style="--share:${r.share.toFixed(4)}"><span>${withOrb ? orb(r.name) : ''}${esc(r.name)}</span><span>${fmtEUR(r.amount)}<em>${Math.round(r.share * 100)} %</em></span></li>`).join('')}</ol>`
    : '<p class="empty">Aucun paiement sur cette période.</p>';

  const dueList = due.length
    ? `<ul class="due">${due.map((e) => `<li>
        <div><div class="due-who">${orb(e.client)}${esc(e.client)}</div><div class="due-what">${esc([e.project || e.type, e.installment].filter(Boolean).join(' · '))}</div></div>
        <div class="due-amount">${fmtEUR(e.amount)}</div>
        <div class="due-act">
          <span class="chip ${e.late ? 'chip-alert' : ''}">${e.late ? 'En retard, prévu le' : 'Prévu le'} ${fmtDateShort(e.date)}</span>
          <button type="button" class="btn btn-quiet btn-small" data-mark-paid="${esc(e.id)}" aria-label="Marquer payé : ${esc(e.client)}, ${esc(fmtEUR(e.amount))}">Marquer payé</button>
        </div></li>`).join('')}</ul>`
    : '<p class="empty">Rien à encaisser. Ajoute un paiement « En attente » pour suivre un solde ou une facture envoyée.</p>';

  // Mini-graphiques des cartes : chaque trait porte une information (mois, part déclarée, part en retard).
  const yearMonths = monthRange(`${year}-01`, `${year}-12`);
  const yearMax = Math.max(1, ...yearMonths.map((k) => months.get(k)?.ca ?? 0));
  const spark = `<div class="spark" aria-hidden="true">${yearMonths.map((k) => `<i style="--f:${((months.get(k)?.ca ?? 0) / yearMax).toFixed(3)}" ${k > thisMonth ? 'data-future' : ''}></i>`).join('')}</div>`;
  const ticks = (share, alert = false) => {
    const on = Math.round(Math.min(1, Math.max(0, share)) * 36);
    return `<div class="ticks ${alert ? 'ticks-alert' : ''}" aria-hidden="true">${Array.from({ length: 36 }, (_, i) => `<i ${i < on ? 'data-on' : ''}></i>`).join('')}</div>`;
  };
  const go = (href, label, attrs = '') => `<a class="kpi-go" href="${href}" ${attrs} aria-label="${label}">${ICON.arrow}</a>`;
  const grip = (group, id) => `<button type="button" class="grip" data-drag="${group}:${id}" aria-label="Déplacer « ${ITEM_LABEL[group][id]} ». Flèches du clavier pour changer la position." title="Glisser pour déplacer">${ICON.grip}</button>`;

  // Cartes et panneaux sont construits par identifiant, puis posés dans l'ordre choisi par glisser-déposer.
  const kpis = {
    year: `<div class="kpi" data-item="year">
        <div class="kpi-head" data-drag-area><span class="kpi-label">${ICON.calendar}Année ${year}</span><span class="kpi-tools">${grip('kpis', 'year')}${go('#/paiements', 'Voir tous les paiements', 'data-show-all')}</span></div>
        <div class="kpi-value">${fmtEUR(caYear)}</div>
        <p class="kpi-base"><b>${fmtEUR(caLastYearSame)}</b> à la même date en ${lastYear}</p>
        ${spark}
      </div>`,
    cotis: `<div class="kpi" data-item="cotis">
        <div class="kpi-head" data-drag-area><span class="kpi-label">${ICON.percent}Cotisations du trimestre</span><span class="kpi-tools">${grip('kpis', 'cotis')}${go('#/reglages', 'Régler les taux')}</span></div>
        <div class="kpi-value">${fmtEUR(tq.cotis)}</div>
        <p class="kpi-base">estimées sur <b>${fmtEUR(tq.declared)}</b> déclarés</p>
        <details class="explain"><summary>Comment c’est calculé</summary><p>Montant déclaré du trimestre (${esc(q.replace('-', ' '))}) multiplié par le taux de l’année, réglable dans Réglages. C’est une estimation, pas le montant officiel de l’URSSAF.</p></details>
        ${ticks(tq.ca ? tq.declared / tq.ca : 0)}
      </div>`,
    due: `<div class="kpi" data-item="due">
        <div class="kpi-head" data-drag-area><span class="kpi-label">${ICON.clock}À encaisser</span><span class="kpi-tools">${grip('kpis', 'due')}${go('#/paiements', 'Voir les paiements en attente', 'data-pending')}</span></div>
        <div class="kpi-value">${due.length ? fmtEUR(dueTotal) : '—'}</div>
        <p class="kpi-base">${lateCount ? `<span class="warn">${lateCount} en retard</span>` : `${plural(due.length, 'paiement')} ${due.length > 1 ? 'attendus' : 'attendu'}`}</p>
        ${ticks(dueTotal ? lateTotal / dueTotal : 0, true)}
      </div>`,
  };
  const panel = (id, title, tools, body) => `<section class="panel" data-item="${id}">
      <div class="panel-head" data-drag-area><h2>${title}</h2><div class="panel-tools">${tools}${grip('panels', id)}</div></div>
      ${body}
    </section>`;
  const panels = {
    chart: panel('chart', 'Encaissé par mois', `<span id="chart-info">${chartInfo}</span>`, `<div class="chart">${cols}</div>`),
    due: panel('due', 'À encaisser', reviewCount ? `<a class="link" href="#/paiements" data-review>${plural(reviewCount, 'ligne')} à vérifier</a>` : '', dueList),
    clients: panel('clients', 'Clients', `<span>${rangeLabel}</span>`, rank(breakdown(inRange, (e) => e.client), true)),
    types: panel('types', 'Prestations', `<span>${rangeLabel}</span>`, rank(breakdown(inRange, (e) => e.type))),
  };

  view.innerHTML = `
    <section class="hero">
      <div class="hero-art${art.pulse ? ' pulse' : ''}" aria-hidden="true" style="${artStyle()}"><i></i><i></i><i></i><i></i></div>
      <div class="seg hero-seg" role="group" aria-label="Période">
        <button type="button" data-range="last12" aria-pressed="${ui.range === 'last12'}">12 mois</button>
        ${years.map((y) => `<button type="button" data-range="${esc(y)}" aria-pressed="${ui.range === y}">${esc(y)}</button>`).join('')}
      </div>
      <div class="hero-card">
        <p class="hero-label">Encaissé en ${esc(fmtMonth(thisMonth))}</p>
        <h1 class="hero-value">${fmtEUR(caMonth)}</h1>
        <p class="kpi-base"><b>${fmtEUR(caPrevSame)}</b> au ${Number(day)} ${esc(fmtMonth(prevMonth, { short: true, year: false }))}</p>
      </div>
    </section>

    <section class="kpis" aria-label="Chiffres clés" data-group="kpis">${layout.kpis.map((id) => kpis[id]).join('')}</section>
    <div class="panels" data-group="panels">${layout.panels.map((id) => panels[id]).join('')}</div>
    <p class="layout-note" id="layout-note" ${customLayout() ? '' : 'hidden'}>Disposition personnalisée sur cet appareil. <button type="button" class="link" data-reset-layout>Rétablir l’ordre d’origine</button></p>`;
}

// ---------- Paiements ----------

const FILTERS = [['all', 'Tous'], ['paid', 'Payés'], ['pending', 'En attente'], ['unpaid', 'Impayés'], ['review', 'À vérifier']];

function filteredEntries() {
  const q = ui.query.trim().toLowerCase();
  return live(state.entries).filter((e) => {
    if (ui.month && monthKey(e.date) !== ui.month) return false;
    if (ui.status === 'review' ? !e.review : ui.status !== 'all' && e.status !== ui.status) return false;
    if (q && ![e.client, e.endClient, e.type, e.project, e.notes].join(' ').toLowerCase().includes(q)) return false;
    return true;
  });
}

function rowHTML(e, today) {
  const late = e.status === STATUS.PENDING && e.date < today;
  const status = e.status === STATUS.PENDING ? (late ? 'en retard' : 'en attente') : STATUS_LABEL[e.status].toLowerCase();
  const declared = e.declared == null ? '' : e.declared === 0 ? 'Non déclaré' : `Déclaré ${fmtEUR(e.declared)}`;
  const who = `${e.client}${e.endClient ? ` pour ${e.endClient}` : ''}`;
  // Le bouton porte toute la ligne pour les lecteurs d'écran ; les cellules visuelles sont masquées pour ne pas la lire deux fois.
  const label = [`Modifier le paiement : ${who}`, fmtEUR(e.amount), fmtDateLong(e.date), status, e.type, e.project,
    e.installment && `tranche ${e.installment}`, declared.toLowerCase(), e.review && 'à vérifier'].filter(Boolean).join(', ');
  const tags = [];
  const chip = (text, alert = false) => tags.push(`<span class="chip${alert ? ' chip-alert' : ''}" aria-hidden="true">${esc(text)}</span>`);
  if (e.installment) chip(e.installment);
  if (e.status === STATUS.PENDING) chip(late ? 'En retard' : 'En attente', late);
  if (e.status === STATUS.UNPAID) chip('Impayé');
  if (declared) chip(declared);
  if (e.review) chip('À vérifier', true);
  if (isHttp(e.invoiceUrl)) tags.push(`<a class="chip" href="${esc(e.invoiceUrl)}" target="_blank" rel="noopener noreferrer" aria-label="Ouvrir la facture, ${esc(who)}">Facture</a>`);
  if (isHttp(e.videoUrl)) tags.push(`<a class="chip" href="${esc(e.videoUrl)}" target="_blank" rel="noopener noreferrer" aria-label="Voir la vidéo, ${esc(who)}">Vidéo</a>`);
  return `<div class="row" data-status="${esc(e.status)}">
    <span class="row-date" aria-hidden="true">${fmtDateShort(e.date)}</span>
    <button type="button" class="row-client" data-edit="${esc(e.id)}" aria-label="${esc(label)}">${orb(e.client)}${esc(e.client)}${e.endClient ? `<em>${esc(e.endClient)}</em>` : ''}</button>
    <span class="row-what" aria-hidden="true">${esc([e.type, e.project].filter(Boolean).join(' · '))}</span>
    <span class="row-tags">${tags.join('')}</span>
    <span class="row-amount" aria-hidden="true">${fmtEUR(e.amount)}</span>
  </div>`;
}

const monthChip = () => (ui.month ? `<button type="button" class="btn btn-quiet" data-clear-month aria-label="Retirer le filtre ${esc(fmtMonth(ui.month))}">${esc(fmtMonth(ui.month))} ✕</button>` : '');

function renderPayments() {
  const today = todayISO();
  const list = filteredEntries().sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  const groups = new Map();
  for (const e of list) {
    const k = monthKey(e.date);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }
  const body = groups.size
    ? [...groups.entries()].map(([k, rows]) => {
      const t = totals(rows, state.settings);
      return `<section class="month">
        <div class="month-head"><h2>${esc(fmtMonth(k))}</h2><span>cotisations estimées ${fmtEUR(t.cotis)}<b><span class="sr">, encaissé </span>${fmtEUR(t.ca)}</b></span></div>
        <div class="rows">${rows.map((e) => rowHTML(e, today)).join('')}</div></section>`;
    }).join('')
    : `<p class="empty">${live(state.entries).length ? 'Aucun paiement ne correspond à ces filtres.' : 'Aucun paiement pour l’instant. Ajoute le premier avec le bouton en haut, ou importe une sauvegarde dans Réglages.'}</p>`;

  // Le champ de recherche garde le focus pendant la frappe : on ne remplace que la liste.
  if (view.dataset.route === 'payments' && $('#list')) {
    $('#list').innerHTML = body;
    $('#month-chip').innerHTML = monthChip();
    for (const b of $$('[data-filter]')) b.setAttribute('aria-pressed', String(b.dataset.filter === ui.status));
    return;
  }
  view.innerHTML = `
    <div class="page-head">
      <h1 class="page-title">Paiements</h1>
      <div class="inline">
        <button type="button" class="btn btn-quiet" data-export="csv">Exporter en CSV</button>
        <button type="button" class="btn btn-quiet" data-export="xlsx">Exporter en Excel</button>
      </div>
    </div>
    <div class="tools">
      <input class="search" id="search" type="search" placeholder="Chercher un client, un projet, une note" aria-label="Chercher un paiement" value="${esc(ui.query)}" enterkeyhint="search">
      <div class="seg" role="group" aria-label="Filtrer par statut">
        ${FILTERS.map(([k, label]) => `<button type="button" data-filter="${k}" aria-pressed="${ui.status === k}">${label}</button>`).join('')}
      </div>
      <span id="month-chip">${monthChip()}</span>
    </div>
    <div id="list">${body}</div>`;
}

// ---------- Réglages ----------

function renderSettings() {
  const s = state.settings;
  const years = Object.keys(s.rates).sort();
  const link = drive.fileLink('xlsx');
  view.innerHTML = `
    <div class="page-head"><h1 class="page-title">Réglages</h1></div>
    <div class="settings">
      <section class="panel">
        <h2>Taux de cotisations</h2>
        <p>Micro-entrepreneur BNC : cotisations sociales et formation, en pourcentage du montant déclaré. Ajoute 2,2 points si tu as choisi le versement libératoire de l’impôt. Vérifie le taux sur ton espace URSSAF.</p>
        <form id="rates" novalidate>
          ${years.map((y) => `<div class="rate-row"><label for="rate-${esc(y)}">${esc(y)}</label>
            <input class="field-input" id="rate-${esc(y)}" name="${esc(y)}" inputmode="decimal" autocomplete="off" value="${esc(String(s.rates[y]).replace('.', ','))}" aria-describedby="rate-unit-${esc(y)}"><span id="rate-unit-${esc(y)}">%</span></div>`).join('')}
          <div class="inline" style="margin-top:14px">
            <button class="btn btn-primary" type="submit" id="rates-submit">Enregistrer les taux</button>
            <button class="btn btn-quiet" type="button" id="add-year" data-add-year>Ajouter ${Number(years.at(-1) || yearOf(todayISO())) + 1}</button>
          </div>
        </form>
      </section>

      <section class="panel">
        <h2>Google Drive</h2>
        <p>À chaque modification, l’app remplace <span class="mono">${drive.FILES.xlsx.name}</span> dans le dossier « Revenus » de ton Drive, y garde une copie des données pour tes autres appareils et y range les vidéos que tu ajoutes aux paiements. Elle ne peut lire que les fichiers qu’elle a créés.</p>
        <ol class="steps">
          <li>Sur <a class="link" href="https://console.cloud.google.com/" target="_blank" rel="noopener noreferrer">console.cloud.google.com</a>, crée un projet puis active « Google Drive API ».</li>
          <li>Écran de consentement OAuth : type « Externe », puis publie l’app (« En production »), sinon la connexion expire au bout de 7 jours.</li>
          <li>Identifiants : crée un « ID client OAuth » de type « Application Web », avec l’origine JavaScript <code>${esc(location.origin)}</code></li>
          <li>Colle l’ID client ci-dessous et connecte ton compte.</li>
        </ol>
        <form id="drive-form" novalidate>
          <div class="field">
            <label for="drive-client">ID client OAuth</label>
            <input class="field-input" id="drive-client" name="clientId" value="${esc(s.driveClientId)}" placeholder="1234567890-abc.apps.googleusercontent.com" autocomplete="off" autocapitalize="off" spellcheck="false">
          </div>
          <label class="check"><input type="checkbox" name="auto" id="drive-auto" ${s.driveAuto ? 'checked' : ''}> Envoyer sur Drive à chaque modification</label>
          <div class="inline" style="margin-top:18px">
            <button class="btn btn-primary" type="submit" id="drive-submit">${drive.isConnected() ? 'Synchroniser maintenant' : 'Connecter Google Drive'}</button>
            <button class="btn btn-quiet" type="button" id="drive-off" data-drive-off ${drive.isConnected() ? '' : 'hidden'}>Déconnecter</button>
            <a class="link" id="drive-file" href="${esc(link || '#/reglages')}" target="_blank" rel="noopener noreferrer" ${link ? '' : 'hidden'}>Ouvrir le fichier Excel</a>
          </div>
          <p class="status-line" id="drive-status" aria-live="polite">${esc(syncMessage())}</p>
        </form>
      </section>

      <section class="panel">
        <h2>Données</h2>
        <p>Le CSV s’ouvre dans Excel ou Google Sheets. Le fichier Excel contient un onglet des paiements et un onglet des totaux mensuels. La sauvegarde se réimporte ici, sur cet appareil ou un autre : elle s’ajoute à l’existant sans rien écraser de plus récent.</p>
        <div class="inline">
          <button type="button" class="btn btn-quiet" data-export="csv">Exporter en CSV</button>
          <button type="button" class="btn btn-quiet" data-export="xlsx">Exporter en Excel</button>
          <button type="button" class="btn btn-quiet" data-export="json">Exporter une sauvegarde</button>
          <label class="btn btn-quiet">Importer une sauvegarde<input class="sr" type="file" id="import" accept="application/json,.json"></label>
        </div>
      </section>
    </div>`;
}

// ---------- Formulaire d'ajout / modification ----------

const STATUS_HINT = {
  paid: 'Argent reçu. Compte dans le chiffre d’affaires.',
  pending: 'Pas encore reçu. Passe « en retard » après la date prévue.',
  unpaid: 'Ne sera jamais payé. Ne compte pas dans le chiffre d’affaires.',
};
const DATE_LABEL = { paid: 'Encaissé le', pending: 'Prévu le', unpaid: 'Date' };
const DRAFT_FIELDS = ['amount', 'client', 'type', 'project', 'endClient', 'installment', 'declared', 'invoiceUrl', 'videoUrl', 'restAmount', 'notes'];
let sheetSeq = 0;

const options = (list) => list.slice(0, 60).map((x) => `<option value="${esc(x)}"></option>`).join('');
const snapshot = (form) => JSON.stringify([...new FormData(form)].filter(([, v]) => typeof v === 'string'));
const sheetForm = () => (sheet.open ? $('form', sheet) : null);

/** Projets proposés : ceux du client saisi d'abord, puis les autres. */
function projectOptions(client) {
  const key = client.trim().toLowerCase();
  const mine = key ? store.suggestions(state, 'project', (e) => e.client.trim().toLowerCase() === key) : [];
  return options([...new Set([...mine, ...store.suggestions(state, 'project')])]);
}

function field({ name, label, value = '', wide = false, hint = '', attrs = '', cls = '', labelId = '' }) {
  return `<div class="field${wide ? ' wide' : ''}">
    <label for="f-${name}"${labelId ? ` id="${labelId}"` : ''}>${label}</label>
    <input class="field-input${cls ? ` ${cls}` : ''}" id="f-${name}" name="${name}" value="${esc(value)}" aria-describedby="${hint ? `h-${name} ` : ''}e-${name}" ${attrs}>
    ${hint ? `<p class="hint" id="h-${name}">${hint}</p>` : ''}
    <p class="error" id="e-${name}" data-error="${name}"></p>
  </div>`;
}

function fillSheet(id = null) {
  const e = id ? state.entries.find((x) => x.id === id && !x.deleted) : null;
  if (id && !e) return false;
  const draft = e ? null : ui.draft;
  const v = e
    ? { ...e, amount: inputAmount(e.amount), declared: inputAmount(e.declared) }
    : { date: todayISO(), status: STATUS.PAID, ...(draft || {}), review: draft?.review === 'on' };
  if (!Object.values(STATUS).includes(v.status)) v.status = STATUS.PAID;
  const uploading = video.job?.status === 'uploading' && id && video.job.entryId === id;
  const hasMore = Boolean(v.endClient || v.installment || v.declared || v.invoiceUrl || v.videoUrl || v.notes || v.review || v.restAmount || uploading);
  const url = (name, text) => (e && isHttp(e[name]) ? `<a class="link" href="${esc(e[name])}" target="_blank" rel="noopener noreferrer">${text}</a>` : '');

  sheet.innerHTML = `
    <form method="dialog" novalidate data-id="${esc(id || '')}" data-key="${++sheetSeq}">
      <div class="sheet-head">
        <h2 id="sheet-title" tabindex="-1">${e ? 'Modifier le paiement' : 'Nouveau paiement'}</h2>
        <button type="button" class="close" data-close aria-label="Fermer sans enregistrer">✕</button>
      </div>
      ${draft ? '<p class="draft-note">Saisie précédente reprise. <button type="button" class="link" data-clear-draft>Repartir de zéro</button></p>' : ''}
      <div class="fields">
        ${field({ name: 'amount', label: 'Montant en euros', value: v.amount, wide: true, cls: 'amount-input', attrs: 'inputmode="decimal" autocomplete="off" placeholder="0" enterkeyhint="next" required' })}
        ${field({ name: 'client', label: 'Client', value: v.client, attrs: 'list="dl-client" autocomplete="off" enterkeyhint="next" required' })}
        ${field({ name: 'date', label: DATE_LABEL[v.status], labelId: 'date-label', value: v.date, attrs: 'type="date" min="2000-01-01" max="2100-12-31" required' })}
        ${field({ name: 'type', label: 'Prestation', value: v.type, attrs: 'list="dl-type" autocomplete="off" placeholder="Motion design, montage…" enterkeyhint="next"' })}
        ${field({ name: 'project', label: 'Projet', value: v.project, attrs: 'list="dl-project" autocomplete="off" enterkeyhint="done"' })}
        <fieldset class="field wide"><legend>Statut</legend>
          <div class="seg">${Object.values(STATUS).map((k) => `<label><input type="radio" name="status" value="${k}" ${v.status === k ? 'checked' : ''}><span>${STATUS_LABEL[k]}</span></label>`).join('')}</div>
          <p class="hint" id="status-hint" aria-live="polite">${STATUS_HINT[v.status]}</p>
        </fieldset>
        <details class="more" ${hasMore ? 'open' : ''}>
          <summary>Acompte, déclaration, facture, vidéo, notes</summary>
          <div class="fields">
            ${field({ name: 'endClient', label: 'Client final (si agence)', value: v.endClient, attrs: 'list="dl-endClient" autocomplete="off"' })}
            ${field({ name: 'installment', label: 'Acompte ou solde', value: v.installment, attrs: 'placeholder="1/2" autocomplete="off" maxlength="20"' })}
            ${field({ name: 'declared', label: 'Montant déclaré', value: v.declared, hint: 'Vide : tout est déclaré. Sert au calcul des cotisations.', attrs: 'inputmode="decimal" autocomplete="off" placeholder="Tout le montant"' })}
            ${field({ name: 'invoiceUrl', label: 'Lien de la facture', value: v.invoiceUrl, hint: url('invoiceUrl', 'Ouvrir la facture'), attrs: 'type="url" inputmode="url" autocomplete="off" placeholder="https://…"' })}
            <div class="field wide">
              <label for="f-videoUrl">Vidéo du projet</label>
              <input class="field-input" id="f-videoUrl" name="videoUrl" value="${esc(v.videoUrl)}" type="url" inputmode="url" autocomplete="off" placeholder="Lien Drive, Frame.io, YouTube…" aria-describedby="e-videoUrl">
              <div class="upload" data-upload></div>
              ${url('videoUrl', 'Voir la vidéo') ? `<p class="hint">${url('videoUrl', 'Voir la vidéo')}</p>` : ''}
              <p class="error" id="e-videoUrl" data-error="videoUrl"></p>
            </div>
            ${e ? '' : `
            ${field({ name: 'restAmount', label: 'Solde restant à encaisser', value: v.restAmount, hint: 'Crée une deuxième ligne « En attente ».', attrs: 'inputmode="decimal" autocomplete="off" placeholder="Aucun"' })}
            ${field({ name: 'restDate', label: 'Solde prévu le', value: v.restDate || addDays(todayISO(), 30), hint: 'Dans 30 jours par défaut.', attrs: 'type="date" min="2000-01-01" max="2100-12-31"' })}`}
            <div class="field wide">
              <label for="f-notes">Notes</label>
              <textarea class="field-input" id="f-notes" name="notes" maxlength="2000">${esc(v.notes)}</textarea>
            </div>
            <label class="check wide"><input type="checkbox" name="review" ${v.review ? 'checked' : ''}> À vérifier plus tard</label>
          </div>
        </details>
      </div>
      <div class="sheet-foot">
        ${e ? '<button type="button" class="btn btn-danger" data-delete>Supprimer</button>' : '<span></span>'}
        <button type="submit" class="btn btn-primary">${e ? 'Enregistrer' : 'Ajouter le paiement'}</button>
      </div>
      <datalist id="dl-client">${options(store.suggestions(state, 'client'))}</datalist>
      <datalist id="dl-endClient">${options(store.suggestions(state, 'endClient'))}</datalist>
      <datalist id="dl-type">${options(store.suggestions(state, 'type'))}</datalist>
      <datalist id="dl-project">${projectOptions(v.client || '')}</datalist>
    </form>`;
  const form = $('form', sheet);
  form.dataset.initial = snapshot(form);
  renderUpload();
  return true;
}

function openSheet(id = null) {
  if (sheet.open || !fillSheet(id)) return;
  sheet.showModal();
  // Ajout : le clavier s'ouvre directement sur le montant. Modification : on ne l'ouvre pas, on vient peut-être seulement regarder.
  (id ? $('#sheet-title', sheet) : $('#f-amount', sheet)).focus();
}

/** Ferme sans enregistrer. Une saisie commencée pour un nouveau paiement est gardée pour la prochaine ouverture. */
function dismissSheet() {
  const form = sheetForm();
  if (form) {
    if (!form.dataset.id) {
      const f = Object.fromEntries(new FormData(form));
      ui.draft = DRAFT_FIELDS.some((k) => String(f[k] || '').trim()) ? f : null;
    }
    const job = video.job;
    if (job?.status === 'uploading' && job.formKey === form.dataset.key && !job.entryId) {
      job.ctrl.abort();
      toast('Envoi de la vidéo annulé');
    }
  }
  if (sheet.open) sheet.close();
}

/** Reprend les habitudes du client : sa prestation la plus récente, et pour un projet connu son client final et sa vidéo. */
function prefill(form, changed) {
  const client = form.elements.client.value.trim();
  if (!client) return;
  if (changed === 'client') {
    const last = store.latestFor(state, client);
    if (last?.type && !form.elements.type.value) form.elements.type.value = last.type;
    $('#dl-project', form).innerHTML = projectOptions(client);
  }
  const project = form.elements.project.value.trim();
  const sameProject = project ? store.latestFor(state, client, project) : null;
  if (!sameProject) return;
  for (const k of ['type', 'endClient', 'videoUrl']) {
    if (sameProject[k] && !form.elements[k].value) form.elements[k].value = sameProject[k];
  }
}

function showErrors(form, errors) {
  for (const el of $$('[data-error]', form)) {
    const name = el.dataset.error;
    el.textContent = errors[name] || '';
    $(`#f-${name}`, form)?.setAttribute('aria-invalid', String(Boolean(errors[name])));
  }
  const first = $('[aria-invalid="true"]', form);
  if (!first) return false;
  const more = first.closest('.more');
  if (more) more.open = true;
  first.focus();
  return true;
}

function submitSheet(form) {
  const f = Object.fromEntries(new FormData(form));
  const id = form.dataset.id;
  const { entry, errors = {} } = store.normalizeEntry({ ...f, review: f.review === 'on' });

  let rest = null;
  if (!id && String(f.restAmount || '').trim()) {
    const r = store.normalizeEntry({ ...f, amount: f.restAmount, declared: '', date: f.restDate || addDays(todayISO(), 30) });
    if (r.errors?.amount) errors.restAmount = r.errors.amount;
    if (r.errors?.date) errors.restDate = r.errors.date;
    rest = r.entry;
  }
  if (showErrors(form, errors)) return;

  const before = id ? state.entries.find((e) => e.id === id) : null;
  let next;
  let savedId = id;
  if (id) {
    // deleted: false : si la ligne a été supprimée ailleurs pendant la saisie, l'enregistrer la fait revenir.
    next = store.updateEntry(state, id, { ...entry, deleted: false });
  } else {
    next = store.addEntry(state, entry);
    savedId = next.entries.at(-1).id;
  }
  if (rest) {
    next = store.addEntry(next, {
      ...entry, amount: rest.amount, date: rest.date, status: STATUS.PENDING, declared: null, invoiceUrl: '', notes: '', review: false,
      installment: entry.installment === '1/2' ? '2/2' : 'Solde',
    });
  }
  // Une vidéo encore en cours d'envoi sera rattachée à cette ligne quand elle arrivera.
  if (video.job?.status === 'uploading' && video.job.formKey === form.dataset.key) video.job.entryId = savedId;
  if (!id) ui.draft = null;
  sheet.close();
  commit(next, { focus: attrSel('data-edit', savedId) });
  if (entry.status === STATUS.PAID && before?.status !== STATUS.PAID) pulseArt();
  toast(id ? 'Paiement enregistré' : rest ? 'Paiement et solde ajoutés' : 'Paiement ajouté');
}

// ---------- Vidéo du projet : envoi sur Drive ----------

const video = { job: null, seq: 0 };
const percent = (job) => (job.total ? Math.floor((job.loaded / job.total) * 100) : 0);

function videoName(form, file) {
  const parts = [form.elements.client.value, form.elements.project.value || form.elements.type.value].map((s) => s.trim()).filter(Boolean);
  return [...parts, file.name].join(' - ').replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').slice(0, 200);
}

/** Zone d'envoi sous le champ « Vidéo du projet » : son contenu dépend de l'état de Drive et de l'envoi en cours. */
function renderUpload() {
  const box = $('[data-upload]', sheet);
  if (!box) return;
  const form = box.closest('form');
  const job = video.job;
  const mine = Boolean(job) && (job.formKey === form.dataset.key || (job.entryId && job.entryId === form.dataset.id));
  const pick = (label) => `<label class="btn btn-quiet btn-small">${label}<input class="sr" type="file" accept="video/*" data-video-file></label>`;

  if (job?.status === 'uploading' && mine) {
    const text = `${percent(job)} %, ${fmtSize(job.loaded)} sur ${fmtSize(job.total)}`;
    const bar = $('progress', box);
    if (bar) { // envoi déjà affiché : on met à jour sans reconstruire, pour ne pas voler le focus du bouton Annuler
      bar.value = percent(job);
      $('[data-upload-text]', box).textContent = text;
      return;
    }
    box.innerHTML = `<progress max="100" value="${percent(job)}" aria-label="Envoi de la vidéo sur Drive"></progress>
      <button type="button" class="btn btn-quiet btn-small" data-upload-cancel>Annuler l’envoi</button>
      <p class="hint"><span data-upload-text>${text}</span>. Tu peux enregistrer : l’envoi continue et la vidéo se rattache toute seule. Garde l’onglet ouvert.</p>`;
  } else if (job?.status === 'uploading') {
    box.innerHTML = `<p class="hint">Un autre envoi de vidéo est en cours (${percent(job)} %). Attends qu’il se termine pour en lancer un nouveau.</p>`;
  } else if (!state.settings.driveClientId) {
    box.innerHTML = '<p class="hint">Colle un lien, ou connecte Google Drive dans Réglages pour envoyer un fichier depuis cet appareil.</p>';
  } else if (!drive.isConnected()) {
    box.innerHTML = '<button type="button" class="btn btn-quiet btn-small" data-drive-connect>Connecter Drive pour envoyer un fichier</button>';
  } else if (mine && job.status === 'error') {
    box.innerHTML = `${pick('Réessayer avec un fichier')}<p class="error">${esc(job.error)}</p>`;
  } else if (mine && job.status === 'done') {
    box.innerHTML = `${pick('Remplacer par un autre fichier')}<p class="hint">Vidéo envoyée sur Drive, lien ajouté ci-dessus.</p>`;
  } else {
    box.innerHTML = pick('Envoyer un fichier sur Drive');
  }
}

async function startVideoUpload(file, form) {
  if (video.job?.status === 'uploading') return;
  const job = {
    id: ++video.seq, formKey: form.dataset.key, entryId: form.dataset.id || null,
    loaded: 0, total: file.size, status: 'uploading', error: '', ctrl: new AbortController(),
  };
  video.job = job;
  const refresh = () => { renderUpload(); renderSync(); };
  refresh();
  try {
    const { url } = await drive.uploadVideo(file, {
      name: videoName(form, file),
      signal: job.ctrl.signal,
      onProgress: (loaded, total) => { job.loaded = loaded; job.total = total; refresh(); },
    });
    job.status = 'done';
    const open = sheetForm();
    const shown = open && (open.dataset.key === job.formKey || (job.entryId && open.dataset.id === job.entryId));
    // Ligne déjà enregistrée : le lien y est écrit tout de suite. Sinon il part avec le formulaire encore ouvert.
    if (job.entryId) commit(store.updateEntry(state, job.entryId, { videoUrl: url }));
    if (shown) open.elements.videoUrl.value = url;
    else toast('Vidéo envoyée sur Drive');
  } catch (err) {
    job.status = err.code === 'abort' ? 'cancelled' : 'error';
    job.error = err.message;
    const open = sheetForm();
    if (err.code !== 'abort' && !(open && open.dataset.key === job.formKey)) toast(`Envoi de la vidéo échoué. ${err.message}`);
  } finally {
    refresh();
  }
}

window.addEventListener('beforeunload', (ev) => {
  if (video.job?.status !== 'uploading') return;
  ev.preventDefault();
  ev.returnValue = '';
});

// ---------- Messages ----------

const toastEl = $('#toast');
const toastText = $('#toast-text');
const toastBtn = $('#toast-action');
let toastTimer = 0;
let toastAction = null;

function hideToast() {
  toastEl.classList.remove('on');
  toastAction = null;
  toastBtn.hidden = true;
  // Le texte est vidé une fois le message disparu : le même message sera ainsi ré-annoncé la fois suivante.
  setTimeout(() => { if (!toastEl.classList.contains('on')) toastText.textContent = ''; }, 250);
}

/** Le message reste dans une zone toujours présente dans la page : les lecteurs d'écran l'annoncent. */
function toast(message, action = null) {
  toastText.textContent = message;
  toastAction = action;
  toastBtn.hidden = !action;
  toastBtn.textContent = action ? action.label : '';
  toastEl.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, action ? 9000 : 3200);
}

toastBtn.addEventListener('click', () => {
  const action = toastAction;
  clearTimeout(toastTimer);
  hideToast();
  action?.run();
});

// ---------- Exports et import ----------

async function runExport(kind) {
  const stamp = todayISO();
  try {
    if (kind === 'csv') download(`revenus-${stamp}.csv`, toCSV(state.entries), 'text/csv;charset=utf-8');
    else if (kind === 'json') download(`revenus-sauvegarde-${stamp}.json`, JSON.stringify(store.exportableState(state)), 'application/json');
    else download(`revenus-${stamp}.xlsx`, new Blob([await toXLSX(state)], { type: XLSX_MIME }));
    toast({ csv: 'CSV exporté', json: 'Sauvegarde exportée', xlsx: 'Fichier Excel exporté' }[kind]);
  } catch (err) {
    console.error(err);
    toast('Export impossible. Recharge la page puis réessaie.');
  }
}

async function runImport(input) {
  const file = input.files[0];
  input.value = '';
  if (!file) return;
  try {
    const incoming = store.sanitizeState(JSON.parse(await file.text()));
    if (!incoming.entries.length) { toast('Ce fichier ne contient aucun paiement lisible.'); return; }
    const before = live(state.entries).length;
    commit(store.mergeStates(state, incoming));
    const added = live(state.entries).length - before;
    toast(added > 0 ? `${plural(added, 'paiement')} ${added > 1 ? 'importés' : 'importé'}` : 'Sauvegarde importée, rien de nouveau');
  } catch {
    toast('Fichier illisible : choisis une sauvegarde exportée depuis cette app.');
  }
}

// ---------- Synchronisation Drive ----------

// idle : pas de session Google ouverte | pending : des changements attendent une reconnexion
// busy : envoi en cours | ok : Drive à jour | error : échec, nouvel essai programmé
const sync = { state: 'idle', at: null, error: '', dirty: false, running: false, again: false, timer: 0, retryTimer: 0, expiryTimer: 0, retries: 0 };
const SENT_KEY = 'revenus.drive.sent';
const RETRY_DELAYS = [15_000, 60_000, 300_000];

function fingerprint(text) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return `${text.length}:${h}`;
}
const lastSent = () => { try { return localStorage.getItem(SENT_KEY) || ''; } catch { return ''; } };
const rememberSent = (print) => { try { localStorage.setItem(SENT_KEY, print); } catch { /* stockage bloqué */ } };

function syncLabel() {
  if (sync.state === 'idle') return sync.dirty ? 'Envoyer sur Drive' : 'Drive en veille';
  return { pending: 'Drive : reconnecter', busy: 'Envoi…', ok: 'Drive à jour', error: 'Drive : réessayer' }[sync.state];
}

function syncMessage() {
  if (!state.settings.driveClientId) return 'Drive non configuré : les données restent dans ce navigateur.';
  if (sync.state === 'idle') {
    return sync.dirty
      ? 'Des modifications ne sont pas encore sur Drive. Clique sur « Synchroniser maintenant ».'
      : 'Session Google en veille. Elle se rouvre à la prochaine modification, ou d’un clic sur le bouton.';
  }
  return {
    pending: 'Des modifications attendent : Google demande une reconnexion. Clique sur le bouton ci-dessus.',
    busy: 'Envoi vers Drive en cours…',
    ok: `Drive à jour, dernier envoi à ${sync.at?.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}.`,
    error: `Dernier envoi échoué : ${sync.error} Nouvel essai automatique. Les données sont en sécurité dans ce navigateur.`,
  }[sync.state];
}

/** Pastilles de la barre haute (Drive, envoi de vidéo) et panneau Drive des réglages, mis à jour sans reconstruire la page. */
function renderSync() {
  const pill = $('#sync');
  const configured = Boolean(state.settings.driveClientId);
  pill.hidden = !configured;
  if (configured) {
    pill.dataset.state = sync.state;
    pill.textContent = syncLabel();
    pill.title = syncMessage();
  }

  const up = $('#upload');
  const job = video.job;
  const background = job && (job.status === 'uploading' || job.status === 'error') && !(sheetForm()?.dataset.key === job.formKey);
  up.hidden = !background;
  if (background) {
    up.dataset.state = job.status === 'error' ? 'error' : 'busy';
    up.textContent = job.status === 'error' ? 'Vidéo : échec' : `Vidéo ${percent(job)} %`;
    up.title = job.status === 'error' ? job.error : 'Envoi de la vidéo sur Drive en cours. Clique pour ouvrir le paiement.';
  }

  const submit = $('#drive-submit');
  if (submit) {
    submit.textContent = drive.isConnected() ? 'Synchroniser maintenant' : 'Connecter Google Drive';
    $('#drive-off').hidden = !drive.isConnected();
    const link = drive.fileLink('xlsx');
    $('#drive-file').hidden = !link;
    if (link) $('#drive-file').href = link;
    $('#drive-status').textContent = syncMessage();
  }
}

function setSync(next) {
  sync.state = next;
  clearTimeout(sync.expiryTimer);
  if (next === 'ok') {
    // Le jeton Google dure une heure : à son expiration, la pastille repasse en veille.
    sync.expiryTimer = setTimeout(() => { if (!drive.isConnected()) setSync(sync.dirty ? 'pending' : 'idle'); }, Math.max(1000, drive.expiresAt() - Date.now() - 25_000));
  }
  renderSync();
}

/** Appelé après chaque modification enregistrée. */
function requestSync() {
  const { driveClientId, driveAuto } = state.settings;
  if (!driveClientId) return;
  sync.dirty = true;
  if (!driveAuto) { if (!sync.running) setSync('idle'); return; } // envoi manuel : la pastille propose « Envoyer sur Drive »
  if (sync.running) { sync.again = true; return; }
  if (drive.isConnected()) {
    clearTimeout(sync.timer);
    sync.timer = setTimeout(runSync, 2500);
    return;
  }
  // Session expirée : Google n'en rouvre une que pendant un geste. On profite du clic qui vient d'enregistrer.
  if (navigator.userActivation?.isActive) runSync({ interactive: true, quiet: true });
  else setSync('pending');
}

async function runSync({ interactive = false, quiet = false } = {}) {
  const clientId = state.settings.driveClientId;
  if (!clientId) return;
  if (sync.running) { sync.again = true; return; }
  // La demande de connexion doit partir avant tout « await », sinon le navigateur ne la relie plus au clic et bloque la fenêtre Google.
  const connecting = !drive.isConnected() && interactive ? drive.connect(clientId) : null;
  if (!drive.isConnected() && !connecting) { setSync(sync.dirty ? 'pending' : 'idle'); return; }

  sync.running = true;
  sync.dirty = false; // toute modification faite pendant l'envoi le remettra à vrai
  clearTimeout(sync.timer);
  clearTimeout(sync.retryTimer);
  setSync('busy');
  try {
    if (connecting) await connecting;
    renderUpload();
    const remote = await drive.readData();
    const merged = store.mergeStates(state, remote);
    const changed = !store.sameData(merged, state);
    if (changed) {
      state = merged;
      saveFailed = !store.save(state);
    }
    // Rien n'a changé depuis le dernier envoi complet et Drive a déjà ces données : inutile de tout renvoyer.
    const payload = JSON.stringify(store.exportableState(state));
    const print = fingerprint(payload);
    const upToDate = Boolean(remote) && lastSent() === print && store.sameData(store.sanitizeState(remote), state);
    if (!upToDate) {
      await drive.upload('data', payload);
      await drive.upload('xlsx', new Blob([await toXLSX(state)], { type: XLSX_MIME }));
      rememberSent(print);
    }
    sync.at = new Date();
    sync.retries = 0;
    sync.error = '';
    setSync('ok');
    if (changed) {
      if (sheet.open) pendingRender = true;
      else render();
    }
  } catch (err) {
    console.error(err);
    sync.dirty = true;
    sync.error = err.message;
    const needsClick = err.code === 'auth' || !drive.isConnected();
    setSync(needsClick ? 'pending' : 'error');
    if (interactive && !quiet) toast(needsClick ? `Connexion à Google impossible. ${err.message}` : `Envoi vers Drive échoué. ${err.message}`);
    if (!needsClick) {
      sync.retryTimer = setTimeout(runSync, RETRY_DELAYS[Math.min(sync.retries, RETRY_DELAYS.length - 1)]);
      sync.retries += 1;
    }
  } finally {
    sync.running = false;
    renderUpload();
    if (sync.again) {
      sync.again = false;
      if (drive.isConnected()) sync.timer = setTimeout(runSync, 2500);
    }
  }
}

window.addEventListener('online', () => { if (sync.dirty || sync.state === 'error') runSync(); });
document.addEventListener('visibilitychange', () => {
  // Retour sur l'onglet avec une session ouverte : on récupère ce que les autres appareils ont envoyé.
  if (document.visibilityState === 'visible' && state.settings.driveClientId && drive.isConnected()) runSync();
});

// ---------- Événements ----------

const CLICKABLE = ['range', 'month', 'review', 'pending', 'show-all', 'mark-paid', 'edit', 'filter', 'clear-month', 'export', 'add-year', 'drive-off',
  'close', 'delete', 'clear-draft', 'drive-connect', 'upload-cancel', 'reset-layout'].map((k) => `[data-${k}]`).join(',');

$('#add').addEventListener('click', () => openSheet());
$('#sync').addEventListener('click', () => runSync({ interactive: true }));
$('#upload').addEventListener('click', () => { if (video.job?.entryId) openSheet(video.job.entryId); });

window.addEventListener('hashchange', () => {
  render();
  window.scrollTo(0, 0);
  view.focus({ preventScroll: true });
});

document.addEventListener('click', (ev) => {
  const t = ev.target.closest(CLICKABLE);
  if (!t) return;
  const d = t.dataset;
  if (d.range) {
    ui.range = d.range;
    ui.chartMonth = '';
    render();
    artForRange(d.range);
    requestAnimationFrame(applyArt);
  } else if (d.month) {
    // Au toucher, le premier appui affiche le mois dans l'en-tête du graphique ; le second ouvre ses paiements.
    if (t.classList.contains('col') && noHover.matches && ui.chartMonth !== d.month) {
      ev.preventDefault();
      ui.chartMonth = d.month;
      render();
      return;
    }
    ui.month = d.month; ui.status = 'all'; ui.query = '';
  } else if ('review' in d) {
    ui.month = ''; ui.status = 'review'; ui.query = '';
  } else if ('pending' in d) {
    ui.month = ''; ui.status = 'pending'; ui.query = '';
  } else if ('showAll' in d) {
    ui.month = ''; ui.status = 'all'; ui.query = '';
  } else if (d.markPaid) {
    const id = d.markPaid;
    const before = state.entries.find((e) => e.id === id);
    if (!before) return;
    commit(store.updateEntry(state, id, { status: STATUS.PAID, date: todayISO() }), { focus: '[data-mark-paid]' });
    pulseArt();
    toast('Marqué payé aujourd’hui', { label: 'Annuler', run: () => commit(store.updateEntry(state, id, { status: before.status, date: before.date })) });
  } else if (d.edit) {
    openSheet(d.edit);
  } else if (d.filter) {
    ui.status = d.filter;
    renderPayments();
  } else if ('clearMonth' in d) {
    ui.month = '';
    render(); // le focus revient au contenu, pas au champ de recherche : sur téléphone cela ouvrirait le clavier
  } else if (d.export) {
    runExport(d.export);
  } else if ('addYear' in d) {
    const years = Object.keys(state.settings.rates).sort();
    const next = Number(years.at(-1) || yearOf(todayISO())) + 1;
    commit(store.updateRates(state, { ...state.settings.rates, [next]: state.settings.rates[years.at(-1)] ?? 0 }), { focus: `#rate-${next}` });
  } else if ('driveOff' in d) {
    drive.disconnect();
    setSync(sync.dirty ? 'pending' : 'idle');
  } else if ('close' in d) {
    dismissSheet();
  } else if ('delete' in d) {
    const id = t.closest('form').dataset.id;
    sheet.close();
    commit(store.deleteEntry(state, id));
    toast('Paiement supprimé', { label: 'Annuler', run: () => commit(store.restoreEntry(state, id), { focus: attrSel('data-edit', id) }) });
  } else if ('clearDraft' in d) {
    ui.draft = null;
    fillSheet(null);
    $('#f-amount', sheet).focus();
  } else if ('driveConnect' in d) {
    // Depuis le formulaire : on ouvre la session Google, puis on en profite pour synchroniser.
    runSync({ interactive: true });
  } else if ('uploadCancel' in d) {
    video.job?.ctrl.abort();
  } else if ('resetLayout' in d) {
    saveLayout(DEFAULT_LAYOUT);
    render();
    toast('Ordre d’origine rétabli');
  }
});

sortable(view, {
  onReorder(group, ids, { id, position, total }) {
    saveLayout({ ...layout, [group]: ids });
    $('#live').textContent = `${ITEM_LABEL[group][id]} : position ${position} sur ${total}.`;
  },
  onEnd() {
    // Un rendu demandé pendant le déplacement (synchronisation, autre onglet) est fait maintenant.
    if (pendingRender && !sheet.open) { pendingRender = false; render(); }
  },
});

let searchTimer = 0;
document.addEventListener('input', (ev) => {
  if (ev.target.id === 'search') {
    ui.query = ev.target.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderPayments, 150);
  }
});

// Le script Google est chargé dès qu'on s'apprête à se connecter : le clic ouvrira la fenêtre sans délai.
document.addEventListener('focusin', (ev) => { if (ev.target.id === 'drive-client') drive.preload().catch(() => {}); });

document.addEventListener('change', (ev) => {
  const t = ev.target;
  if (t.id === 'import') { runImport(t); return; }
  if (t.id === 'drive-auto') {
    state = store.updateDeviceSettings(state, { driveAuto: t.checked });
    saveFailed = !store.save(state);
    renderNotice();
    renderSync();
    return;
  }
  const form = t.closest('#sheet form');
  if (!form) return;
  if (t.name === 'status') {
    $('#status-hint', form).textContent = STATUS_HINT[t.value];
    $('#date-label', form).textContent = DATE_LABEL[t.value];
  } else if (t.name === 'client' || t.name === 'project') {
    prefill(form, t.name);
  } else if ('videoFile' in t.dataset && t.files[0]) {
    startVideoUpload(t.files[0], form);
  }
});

document.addEventListener('submit', (ev) => {
  const form = ev.target;
  ev.preventDefault();
  if (form.closest('#sheet')) { submitSheet(form); return; }
  if (form.id === 'rates') {
    const rates = {};
    for (const [y, raw] of new FormData(form)) {
      const text = String(raw).replace(',', '.').trim();
      const n = Number(text);
      if (text === '' || !Number.isFinite(n) || n < 0 || n > 100) {
        toast(`Taux ${y} illisible : indique un nombre entre 0 et 100.`);
        $(`#rate-${CSS.escape(y)}`)?.focus();
        return;
      }
      rates[y] = n;
    }
    commit(store.updateRates(state, rates));
    toast('Taux enregistrés');
  }
  if (form.id === 'drive-form') {
    const f = new FormData(form);
    const clientId = String(f.get('clientId') || '').trim();
    // L'identifiant et le choix d'envoi automatique sont propres à cet appareil : ils ne partent pas sur Drive.
    state = store.updateDeviceSettings(state, { driveClientId: clientId, driveAuto: f.get('auto') === 'on' });
    saveFailed = !store.save(state);
    renderNotice();
    if (!clientId) { toast('Colle d’abord ton ID client OAuth.'); renderSync(); return; }
    if (!/\.apps\.googleusercontent\.com$/.test(clientId)) {
      toast('Cet identifiant ne ressemble pas à un ID client Google : il finit par .apps.googleusercontent.com');
      renderSync();
      return;
    }
    runSync({ interactive: true });
  }
});

// Annuler la dernière action au clavier, tant que le message est affiché.
document.addEventListener('keydown', (ev) => {
  if (!(ev.ctrlKey || ev.metaKey) || ev.shiftKey || ev.key.toLowerCase() !== 'z' || !toastAction || sheet.open) return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')) return;
  ev.preventDefault();
  toastBtn.click();
});

// Fermeture du formulaire : Échap passe par la même porte que le bouton ✕ (la saisie d'un nouveau paiement est gardée).
sheet.addEventListener('cancel', (ev) => { ev.preventDefault(); dismissSheet(); });
sheet.addEventListener('close', () => {
  renderSync();
  if (pendingRender) { pendingRender = false; render(); }
});
// Clic sur le fond : on ferme seulement si rien n'a été saisi, et si le clic a bien commencé sur le fond.
// (jugé sur la position : un clic sur la barre de défilement de la feuille vise lui aussi la feuille)
const outsideSheet = (ev) => {
  const r = sheet.getBoundingClientRect();
  return ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom;
};
let pressedOnBackdrop = false;
sheet.addEventListener('pointerdown', (ev) => { pressedOnBackdrop = ev.target === sheet && outsideSheet(ev); });
sheet.addEventListener('click', (ev) => {
  const form = sheetForm();
  if (ev.target === sheet && pressedOnBackdrop && outsideSheet(ev) && form && snapshot(form) === form.dataset.initial) dismissSheet();
});

// Sur téléphone, le clavier recouvre le bas de l'écran : on donne à la feuille la hauteur réellement visible.
const vv = window.visualViewport;
if (vv) {
  const fit = () => {
    const root = document.documentElement.style;
    const keyboard = vv.scale === 1 ? Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)) : 0;
    root.setProperty('--vvh', `${Math.round(vv.scale === 1 ? vv.height : window.innerHeight)}px`);
    root.setProperty('--kb', `${keyboard}px`);
  };
  vv.addEventListener('resize', fit);
  vv.addEventListener('scroll', fit);
  fit();
}

// ---------- Démarrage ----------

render();
if (state.settings.driveClientId) {
  // Drive configuré : on prépare la connexion et le module Excel pendant un moment creux, sans retarder l'affichage.
  drive.preload().catch(() => {});
  (window.requestIdleCallback || ((fn) => setTimeout(fn, 2500)))(() => loadExcelJS().catch(() => {}));
}
