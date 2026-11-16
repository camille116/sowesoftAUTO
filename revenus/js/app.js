// Interface : routage, rendu des trois écrans, formulaire, synchronisation Drive.

import {
  STATUS, STATUS_LABEL, addMonths, breakdown, byMonth, declaredOf, fmtDate, fmtDateShort, fmtEUR, fmtMonth,
  inQuarter, live, monthKey, monthRange, paid, parseAmount, quarterKey, rateFor, receivables, todayISO, totals, yearOf,
} from './calc.js';
import * as store from './store.js';
import { XLSX_MIME, download, toCSV, toXLSX } from './export.js';
import * as drive from './drive.js';

let state = store.load();

const ui = { range: 'last12', status: 'all', query: '', month: '' };
const $ = (sel, root = document) => root.querySelector(sel);
const view = $('#view');
const sheet = $('#sheet');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inputAmount = (cents) => (cents == null ? '' : (cents / 100).toFixed(cents % 100 ? 2 : 0).replace('.', ','));

const svg = (d) => `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  calendar: svg('<rect x="2.5" y="3.5" width="11" height="10" rx="2.5"/><path d="M2.5 7h11M5.5 2v3M10.5 2v3"/>'),
  percent: svg('<path d="M12.5 3.5l-9 9"/><circle cx="4.5" cy="4.5" r="1.7"/><circle cx="11.5" cy="11.5" r="1.7"/>'),
  clock: svg('<circle cx="8" cy="8" r="5.5"/><path d="M8 5v3.2l2 1.3"/>'),
  arrow: svg('<path d="M5 11l6-6M6 5h5v5"/>'),
};

/** Pastille dégradée propre à chaque client : la couleur vient du nom, toujours la même. */
function orb(name) {
  let h = 0;
  for (const c of String(name)) h = (h * 31 + c.codePointAt(0)) % 360;
  h = (h * 137) % 360;
  return `<span class="orb" aria-hidden="true" style="--a:hsl(${h} 92% 74%);--b:hsl(${(h + 48) % 360} 88% 62%);--c:hsl(${(h + 300) % 360} 85% 70%)"></span>`;
}

// ---------- Changement d'état ----------

function commit(next, { sync = true } = {}) {
  state = next;
  store.save(state);
  render();
  if (sync) scheduleSync();
}

// ---------- Routage ----------

const ROUTES = { '': 'overview', paiements: 'payments', reglages: 'settings' };
const route = () => ROUTES[location.hash.replace(/^#\/?/, '').split('?')[0]] || 'overview';

function render() {
  const r = route();
  document.querySelectorAll('.nav a').forEach((a) => {
    if (a.dataset.route === r) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  ({ overview: renderOverview, payments: renderPayments, settings: renderSettings })[r]();
  renderSync();
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
  const hero = ev.target.closest?.('.hero');
  if (!hero) return;
  const r = hero.getBoundingClientRect();
  art.mx = ((ev.clientX - r.left) / r.width) * 2 - 1;
  art.my = ((ev.clientY - r.top) / r.height) * 2 - 1;
  applyArt();
});
view.addEventListener('pointerout', (ev) => {
  if (!ev.target.closest?.('.hero') || ev.relatedTarget?.closest?.('.hero')) return;
  art.mx = 0; art.my = 0;
  applyArt();
});

// ---------- Aperçu ----------

function sumPaid(entries, test) {
  return paid(entries).filter(test).reduce((s, e) => s + e.amount, 0);
}

function renderOverview() {
  const today = todayISO();
  const thisMonth = monthKey(today);
  const prevMonth = addMonths(thisMonth, -1);
  const year = yearOf(today);
  const day = today.slice(8);
  const months = byMonth(state.entries, state.settings);
  const years = [...new Set(live(state.entries).map((e) => yearOf(e.date)))].sort();

  // Chiffres clés, chacun comparé à la même durée écoulée de la période précédente.
  const caMonth = months.get(thisMonth)?.ca ?? 0;
  const caPrevSame = sumPaid(state.entries, (e) => monthKey(e.date) === prevMonth && e.date.slice(8) <= day);
  const caYear = sumPaid(state.entries, (e) => yearOf(e.date) === year && e.date <= today);
  const lastYear = String(Number(year) - 1);
  const caLastYearSame = sumPaid(state.entries, (e) => yearOf(e.date) === lastYear && e.date.slice(5) <= today.slice(5));
  const q = quarterKey(today);
  const tq = totals(inQuarter(state.entries, q), state.settings);
  const due = receivables(state.entries, today);
  const dueTotal = due.reduce((s, e) => s + e.amount, 0);
  const lateCount = due.filter((e) => e.late).length;
  const reviewCount = live(state.entries).filter((e) => e.review).length;

  // Plage du graphique et des répartitions.
  const rangeKeys = ui.range === 'last12' ? monthRange(addMonths(thisMonth, -11), thisMonth) : monthRange(`${ui.range}-01`, `${ui.range}-12`);
  const inRange = live(state.entries).filter((e) => rangeKeys.includes(monthKey(e.date)));
  const tr = totals(inRange, state.settings);
  const max = Math.max(1, ...rangeKeys.map((k) => months.get(k)?.ca ?? 0));

  const cols = rangeKeys.map((k) => {
    const t = months.get(k);
    const f = t ? Math.max(0.015, t.ca / max).toFixed(4) : 0;
    const current = k === thisMonth;
    return `<a class="col" href="#/paiements" data-month="${k}" style="--f:${f}" ${t ? '' : 'data-empty'} ${current ? 'data-current' : ''}
      aria-label="${esc(fmtMonth(k))} : ${t ? esc(fmtEUR(t.ca)) : 'aucun paiement'}${current ? ', mois en cours' : ''}">
      <span class="col-tip"><b>${t ? fmtEUR(t.ca) : '—'}</b>${esc(fmtMonth(k))}${t ? ` · cotisations ${fmtEUR(t.cotis)}` : ''}</span>
      <span class="col-bar"></span>
      <span class="col-label"><span>${esc(fmtMonth(k, { short: true, year: false }))}</span><i aria-hidden="true">${esc(fmtMonth(k, { year: false })[0].toUpperCase())}</i></span>
    </a>`;
  }).join('');

  const rank = (rows, withOrb = false) => rows.length
    ? `<ol class="rank">${rows.slice(0, 6).map((r) => `<li style="--share:${r.share.toFixed(4)}"><span>${withOrb ? orb(r.name) : ''}${esc(r.name)}</span><span>${fmtEUR(r.amount)}<em>${Math.round(r.share * 100)} %</em></span></li>`).join('')}</ol>`
    : '<p class="empty">Aucun paiement sur cette période.</p>';

  const dueList = due.length
    ? `<ul class="due">${due.map((e) => `<li>
        <div><div class="due-who">${orb(e.client)}${esc(e.client)}</div><div class="due-what">${esc([e.project || e.type, e.installment].filter(Boolean).join(' · '))}</div></div>
        <div class="due-amount">${fmtEUR(e.amount)}</div>
        <div class="due-act">
          <span class="chip ${e.late ? 'chip-alert' : ''}">${e.late ? 'En retard, prévu le' : 'Prévu le'} ${fmtDateShort(e.date)}</span>
          <button type="button" class="link" data-mark-paid="${esc(e.id)}">Marquer payé</button>
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
  const lateTotal = due.filter((e) => e.late).reduce((sum, e) => sum + e.amount, 0);
  const go = (href, label, attrs = '') => `<a class="kpi-go" href="${href}" ${attrs} aria-label="${label}">${ICON.arrow}</a>`;

  view.innerHTML = `
    <section class="hero">
      <div class="hero-art${art.pulse ? ' pulse' : ''}" aria-hidden="true" style="${artStyle()}"><i></i><i></i><i></i><i></i></div>
      <div class="seg hero-seg" role="group" aria-label="Période">
        <button type="button" data-range="last12" aria-pressed="${ui.range === 'last12'}">12 mois</button>
        ${years.map((y) => `<button type="button" data-range="${y}" aria-pressed="${ui.range === y}">${y}</button>`).join('')}
      </div>
      <div class="hero-card">
        <p class="hero-label">Encaissé en ${esc(fmtMonth(thisMonth))}</p>
        <h1 class="hero-value">${fmtEUR(caMonth)}</h1>
        <p class="kpi-base"><b>${fmtEUR(caPrevSame)}</b> au ${Number(day)} ${esc(fmtMonth(prevMonth, { short: true, year: false }))}</p>
      </div>
    </section>

    <section class="kpis" aria-label="Chiffres clés">
      <div class="kpi">
        <div class="kpi-head"><span class="kpi-label">${ICON.calendar}Année ${year}</span>${go('#/paiements', 'Voir les paiements')}</div>
        <div class="kpi-value">${fmtEUR(caYear)}</div>
        <div class="kpi-base"><b>${fmtEUR(caLastYearSame)}</b> à la même date en ${lastYear}</div>
        ${spark}
      </div>
      <div class="kpi" title="Estimation : montant déclaré × taux réglé pour l'année. Trimestre ${esc(q.replace('-', ' '))}.">
        <div class="kpi-head"><span class="kpi-label">${ICON.percent}Cotisations du trimestre</span>${go('#/reglages', 'Régler les taux')}</div>
        <div class="kpi-value">${fmtEUR(tq.cotis)}</div>
        <div class="kpi-base">estimées sur <b>${fmtEUR(tq.declared)}</b> déclarés</div>
        ${ticks(tq.ca ? tq.declared / tq.ca : 0)}
      </div>
      <div class="kpi">
        <div class="kpi-head"><span class="kpi-label">${ICON.clock}À encaisser</span>${go('#/paiements', 'Voir les paiements en attente', 'data-pending')}</div>
        <div class="kpi-value">${due.length ? fmtEUR(dueTotal) : '—'}</div>
        <div class="kpi-base">${lateCount ? `<span class="warn">${lateCount} en retard</span>` : `${due.length} paiement${due.length > 1 ? 's' : ''} attendu${due.length > 1 ? 's' : ''}`}</div>
        ${ticks(dueTotal ? lateTotal / dueTotal : 0, true)}
      </div>
    </section>

    <div class="grid-2">
      <section class="panel">
        <div class="panel-head"><h2>Encaissé par mois</h2><span>${fmtEUR(tr.ca)} · net estimé ${fmtEUR(tr.net)}</span></div>
        <div class="chart">${cols}</div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>À encaisser</h2>${reviewCount ? `<a class="link" href="#/paiements" data-review>${reviewCount} ligne${reviewCount > 1 ? 's' : ''} à vérifier</a>` : ''}</div>
        ${dueList}
      </section>
    </div>

    <div class="grid-eq">
      <section class="panel"><div class="panel-head"><h2>Clients</h2><span>${ui.range === 'last12' ? '12 derniers mois' : ui.range}</span></div>${rank(breakdown(inRange, (e) => e.client), true)}</section>
      <section class="panel"><div class="panel-head"><h2>Prestations</h2><span>${ui.range === 'last12' ? '12 derniers mois' : ui.range}</span></div>${rank(breakdown(inRange, (e) => e.type))}</section>
    </div>`;
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

function rowHTML(e) {
  const tags = [];
  if (e.installment) tags.push(`<span class="chip">${esc(e.installment)}</span>`);
  if (e.status === STATUS.PENDING) tags.push(`<span class="chip ${e.date < todayISO() ? 'chip-alert' : ''}">${e.date < todayISO() ? 'En retard' : 'En attente'}</span>`);
  if (e.status === STATUS.UNPAID) tags.push('<span class="chip">Impayé</span>');
  if (e.declared != null) tags.push(`<span class="chip" title="Montant déclaré">${e.declared === 0 ? 'Non déclaré' : `Déclaré ${fmtEUR(e.declared)}`}</span>`);
  if (e.review) tags.push('<span class="chip chip-alert">À vérifier</span>');
  return `<button type="button" class="row" data-edit="${esc(e.id)}" data-status="${e.status}">
    <span class="row-date">${fmtDateShort(e.date)}</span>
    <span class="row-client">${orb(e.client)}${esc(e.client)}${e.endClient ? `<em>${esc(e.endClient)}</em>` : ''}</span>
    <span class="row-what">${esc([e.type, e.project].filter(Boolean).join(' · '))}</span>
    <span class="row-tags">${tags.join('')}</span>
    <span class="row-amount">${fmtEUR(e.amount)}</span>
  </button>`;
}

function renderPayments() {
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
        <div class="month-head"><h2>${esc(fmtMonth(k))}</h2><span>cotisations estimées ${fmtEUR(t.cotis)}<b>${fmtEUR(t.ca)}</b></span></div>
        <div class="rows">${rows.map(rowHTML).join('')}</div></section>`;
    }).join('')
    : `<p class="empty">${live(state.entries).length ? 'Aucun paiement ne correspond à ces filtres.' : 'Aucun paiement pour l’instant. Ajoute le premier avec le bouton en haut.'}</p>`;

  // Le champ de recherche garde le focus pendant la frappe : on ne remplace que la liste.
  if ($('#list') && view.dataset.route === 'payments') {
    $('#list').innerHTML = body;
    $('#month-chip').innerHTML = monthChip();
    document.querySelectorAll('[data-filter]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === ui.status)));
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
      <input class="search" id="search" type="search" placeholder="Chercher un client, un projet, une note" aria-label="Chercher" value="${esc(ui.query)}">
      <div class="seg" role="group" aria-label="Filtrer par statut">
        ${FILTERS.map(([k, label]) => `<button type="button" data-filter="${k}" aria-pressed="${ui.status === k}">${label}</button>`).join('')}
      </div>
      <span id="month-chip">${monthChip()}</span>
    </div>
    <div id="list">${body}</div>`;
  view.dataset.route = 'payments';
}

const monthChip = () => (ui.month ? `<button type="button" class="btn btn-quiet" data-clear-month>${esc(fmtMonth(ui.month))} ✕</button>` : '');

// ---------- Réglages ----------

function renderSettings() {
  const s = state.settings;
  const years = Object.keys(s.rates).sort();
  const origin = location.origin;
  const link = drive.fileLink('xlsx');
  view.innerHTML = `
    <div class="page-head"><h1 class="page-title">Réglages</h1></div>
    <div class="settings">
      <section class="panel">
        <h2>Taux de cotisations</h2>
        <p>Micro-entrepreneur BNC : cotisations sociales et formation, en pourcentage du montant déclaré. Ajoute 2,2 points si tu as choisi le versement libératoire de l’impôt. Vérifie le taux sur ton espace URSSAF.</p>
        <form id="rates">
          ${years.map((y) => `<div class="rate-row"><label for="rate-${y}">${y}</label>
            <input class="field-input" id="rate-${y}" name="${y}" inputmode="decimal" value="${String(s.rates[y]).replace('.', ',')}" aria-describedby="rate-unit-${y}"><span id="rate-unit-${y}">%</span></div>`).join('')}
          <div class="inline" style="margin-top:14px">
            <button class="btn btn-primary" type="submit">Enregistrer les taux</button>
            <button class="btn btn-quiet" type="button" data-add-year>Ajouter ${Number(years.at(-1) || yearOf(todayISO())) + 1}</button>
          </div>
        </form>
      </section>

      <section class="panel">
        <h2>Google Drive</h2>
        <p>À chaque modification, l’app remplace <span class="mono">${drive.FILES.xlsx.name}</span> dans ton Drive et y garde une copie des données pour tes autres appareils. Elle ne peut lire que les fichiers qu’elle a créés.</p>
        <ol class="steps">
          <li>Sur <a class="link" href="https://console.cloud.google.com/" target="_blank" rel="noopener">console.cloud.google.com</a>, crée un projet puis active « Google Drive API ».</li>
          <li>Écran de consentement OAuth : type « Externe », puis publie l’app (« En production »), sinon la connexion expire au bout de 7 jours.</li>
          <li>Identifiants : crée un « ID client OAuth » de type « Application Web », avec l’origine JavaScript <code>${esc(origin)}</code></li>
          <li>Colle l’ID client ci-dessous et connecte ton compte.</li>
        </ol>
        <form id="drive-form">
          <label class="field"><span>ID client OAuth</span>
            <input class="field-input" name="clientId" value="${esc(s.driveClientId)}" placeholder="1234567890-abc.apps.googleusercontent.com" autocomplete="off" spellcheck="false"></label>
          <label class="check"><input type="checkbox" name="auto" ${s.driveAuto ? 'checked' : ''}> Envoyer sur Drive à chaque modification</label>
          <div class="inline" style="margin-top:18px">
            <button class="btn btn-primary" type="submit">${drive.isConnected() ? 'Synchroniser maintenant' : 'Connecter Google Drive'}</button>
            ${drive.isConnected() ? '<button class="btn btn-quiet" type="button" data-drive-off>Déconnecter</button>' : ''}
            ${link ? `<a class="link" href="${esc(link)}" target="_blank" rel="noopener">Ouvrir le fichier Excel</a>` : ''}
          </div>
          <p class="status-line" id="drive-status">${esc(syncMessage())}</p>
        </form>
      </section>

      <section class="panel">
        <h2>Données</h2>
        <p>Le CSV s’ouvre directement dans Excel ou Google Sheets. Le fichier Excel contient un onglet par paiement et un onglet de totaux mensuels. La sauvegarde est un fichier à réimporter ici, sur cet appareil ou un autre.</p>
        <div class="inline">
          <button type="button" class="btn btn-quiet" data-export="csv">Exporter en CSV</button>
          <button type="button" class="btn btn-quiet" data-export="xlsx">Exporter en Excel</button>
          <button type="button" class="btn btn-quiet" data-export="json">Exporter une sauvegarde</button>
          <label class="btn btn-quiet">Importer une sauvegarde<input type="file" id="import" accept="application/json,.json" hidden></label>
        </div>
      </section>
    </div>`;
  view.dataset.route = 'settings';
}

// ---------- Formulaire d'ajout / modification ----------

function openSheet(id = null) {
  const e = id ? state.entries.find((x) => x.id === id) : null;
  const v = e || { date: todayISO(), status: STATUS.PAID };
  const list = (field) => store.suggestions(state, field).map((x) => `<option value="${esc(x)}">`).join('');
  const hasMore = Boolean(v.endClient || v.installment || v.declared != null || v.invoiceUrl || v.notes || v.review);
  sheet.innerHTML = `
    <form method="dialog" novalidate data-id="${esc(id || '')}">
      <div class="sheet-head">
        <h2 id="sheet-title">${e ? 'Modifier le paiement' : 'Nouveau paiement'}</h2>
        <button type="button" class="close" data-close aria-label="Fermer">✕</button>
      </div>
      <div class="fields">
        <label class="field wide"><span>Montant en euros</span>
          <input class="field-input amount-input" name="amount" inputmode="decimal" autocomplete="off" placeholder="0" value="${inputAmount(v.amount)}" required>
          <span class="error" data-error="amount"></span></label>
        <label class="field"><span>Client</span>
          <input class="field-input" name="client" list="dl-client" autocomplete="off" value="${esc(v.client)}" required>
          <span class="error" data-error="client"></span></label>
        <label class="field"><span>Date</span>
          <input class="field-input" type="date" name="date" value="${esc(v.date)}" required>
          <span class="error" data-error="date"></span></label>
        <label class="field"><span>Prestation</span>
          <input class="field-input" name="type" list="dl-type" autocomplete="off" placeholder="Motion design, montage…" value="${esc(v.type)}"></label>
        <label class="field"><span>Projet</span>
          <input class="field-input" name="project" list="dl-project" autocomplete="off" value="${esc(v.project)}"></label>
        <fieldset class="field wide"><legend>Statut</legend>
          <div class="seg">${Object.values(STATUS).map((k) => `<label><input type="radio" name="status" value="${k}" ${v.status === k ? 'checked' : ''}><span>${STATUS_LABEL[k]}</span></label>`).join('')}</div>
        </fieldset>
        <details class="more" ${hasMore ? 'open' : ''}>
          <summary>Acompte, déclaration, facture, notes</summary>
          <div class="fields">
            <label class="field"><span>Client final (si agence)</span>
              <input class="field-input" name="endClient" list="dl-endClient" autocomplete="off" value="${esc(v.endClient)}"></label>
            <label class="field"><span>Tranche</span>
              <input class="field-input" name="installment" placeholder="1/2" autocomplete="off" value="${esc(v.installment)}"></label>
            <label class="field"><span>Montant déclaré</span>
              <input class="field-input" name="declared" inputmode="decimal" autocomplete="off" placeholder="Tout le montant" value="${inputAmount(v.declared)}">
              <span class="error" data-error="declared"></span></label>
            <label class="field"><span>Lien de la facture</span>
              <input class="field-input" name="invoiceUrl" type="url" placeholder="https://drive.google.com/…" value="${esc(v.invoiceUrl)}">
              <span class="error" data-error="invoiceUrl"></span></label>
            ${e ? '' : `<label class="field"><span>Solde restant à encaisser</span>
              <input class="field-input" name="restAmount" inputmode="decimal" autocomplete="off" placeholder="Aucun">
              <span class="error" data-error="restAmount"></span></label>
            <label class="field"><span>Solde prévu le</span>
              <input class="field-input" type="date" name="restDate"></label>`}
            <label class="field wide"><span>Notes</span>
              <textarea class="field-input" name="notes">${esc(v.notes)}</textarea></label>
            <label class="check wide"><input type="checkbox" name="review" ${v.review ? 'checked' : ''}> À vérifier plus tard</label>
          </div>
        </details>
      </div>
      <div class="sheet-foot">
        ${e ? '<button type="button" class="btn btn-danger" data-delete>Supprimer</button>' : '<span></span>'}
        <div class="inline">
          ${e?.invoiceUrl ? `<a class="link" href="${esc(e.invoiceUrl)}" target="_blank" rel="noopener">Ouvrir la facture</a>` : ''}
          <button type="submit" class="btn btn-primary">${e ? 'Enregistrer' : 'Ajouter le paiement'}</button>
        </div>
      </div>
      <datalist id="dl-client">${list('client')}</datalist>
      <datalist id="dl-endClient">${list('endClient')}</datalist>
      <datalist id="dl-type">${list('type')}</datalist>
      <datalist id="dl-project">${list('project')}</datalist>
    </form>`;
  sheet.showModal();
  $('[name="amount"]', sheet).focus();
}

function submitSheet(form) {
  const f = Object.fromEntries(new FormData(form));
  const id = form.dataset.id;
  const declaredRaw = String(f.declared || '').trim();
  const input = {
    ...f,
    amount: parseAmount(f.amount),
    declared: declaredRaw === '' ? null : parseAmount(declaredRaw) ?? NaN,
    review: f.review === 'on',
  };
  const { entry, errors = {} } = store.normalizeEntry(input);

  let rest = null;
  const restRaw = String(f.restAmount || '').trim();
  if (!id && restRaw) {
    const restAmount = parseAmount(restRaw);
    if (!restAmount) errors.restAmount = 'Montant illisible.';
    else rest = { amount: restAmount, date: f.restDate || f.date };
  }

  form.querySelectorAll('[data-error]').forEach((el) => {
    el.textContent = errors[el.dataset.error] || '';
    $(`[name="${el.dataset.error}"]`, form)?.setAttribute('aria-invalid', String(Boolean(errors[el.dataset.error])));
  });
  if (Object.keys(errors).length) {
    if (errors.declared || errors.invoiceUrl || errors.restAmount) $('.more', form).open = true;
    $('[aria-invalid="true"]', form)?.focus();
    return;
  }

  let next = id ? store.updateEntry(state, id, entry) : store.addEntry(state, entry);
  if (rest) {
    next = store.addEntry(next, {
      ...entry, ...rest, status: STATUS.PENDING, declared: null, invoiceUrl: '', notes: '', review: false,
      installment: entry.installment === '1/2' ? '2/2' : 'Solde',
    });
  }
  sheet.close();
  commit(next);
  if (entry.status === STATUS.PAID) pulseArt();
  toast(id ? 'Paiement enregistré' : rest ? 'Paiement et solde ajoutés' : 'Paiement ajouté');
}

// ---------- Messages ----------

let toastTimer;
function toast(message, action) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(message)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ''}`;
  if (action) $('button', el).onclick = () => { action.run(); el.hidden = true; };
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, action ? 7000 : 2600);
}

// ---------- Exports ----------

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

// ---------- Synchronisation Drive ----------

const sync = { state: 'off', at: null, error: '' }; // off | idle | busy | ok | auth | error
let syncTimer;
let syncing = false;
let syncAgain = false;

function syncMessage() {
  if (!state.settings.driveClientId) return 'Drive non configuré : les données restent dans ce navigateur.';
  return {
    busy: 'Envoi vers Drive en cours…',
    ok: `Drive à jour, dernier envoi à ${sync.at?.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}.`,
    auth: 'Google demande une reconnexion : clique sur « Connecter Google Drive ».',
    error: `Dernier envoi échoué : ${sync.error} Les données sont en sécurité dans ce navigateur.`,
  }[sync.state] || 'Pas encore connecté sur cet appareil.';
}

function renderSync() {
  const el = $('#sync');
  const configured = Boolean(state.settings.driveClientId);
  el.hidden = !configured;
  if (!configured) return;
  el.dataset.state = sync.state;
  el.textContent = { busy: 'Envoi…', ok: 'Drive à jour', auth: 'Reconnecter Drive', error: 'Drive : réessayer' }[sync.state] || 'Connecter Drive';
  el.title = syncMessage();
  const line = $('#drive-status');
  if (line) line.textContent = syncMessage();
}

function scheduleSync() {
  if (!state.settings.driveClientId || !state.settings.driveAuto) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => runSync({ interactive: false }), 2500);
}

async function runSync({ interactive }) {
  if (!state.settings.driveClientId) return;
  if (syncing) { syncAgain = true; return; }
  syncing = true;
  sync.state = 'busy';
  renderSync();
  try {
    if (!drive.isConnected()) await drive.connect(state.settings.driveClientId, { interactive });
    const remote = await drive.readData();
    const merged = store.mergeStates(state, remote);
    const changed = JSON.stringify(merged.entries) !== JSON.stringify(state.entries) || JSON.stringify(merged.settings) !== JSON.stringify(state.settings);
    state = merged;
    store.save(state);
    await drive.upload('data', JSON.stringify(store.exportableState(state)));
    await drive.upload('xlsx', new Blob([await toXLSX(state)], { type: XLSX_MIME }));
    sync.state = 'ok';
    sync.at = new Date();
    if (changed && !sheet.open) render();
  } catch (err) {
    console.error(err);
    const needsClick = err.code === 'auth' || !drive.isConnected();
    sync.state = needsClick ? 'auth' : 'error';
    sync.error = err.message;
    if (interactive) toast(needsClick ? 'Connexion à Google impossible. Vérifie l’ID client et l’origine autorisée.' : 'Envoi vers Drive échoué.');
  } finally {
    syncing = false;
    renderSync();
    if (route() === 'settings' && !sheet.open && document.activeElement?.tagName !== 'INPUT') renderSettings();
    if (syncAgain) { syncAgain = false; scheduleSync(); }
  }
}

// ---------- Événements ----------

$('#add').addEventListener('click', () => openSheet());
$('#sync').addEventListener('click', () => runSync({ interactive: true }));
window.addEventListener('hashchange', () => { delete view.dataset.route; render(); window.scrollTo(0, 0); });

document.addEventListener('click', (ev) => {
  const t = ev.target.closest('[data-range],[data-month],[data-review],[data-pending],[data-mark-paid],[data-edit],[data-filter],[data-clear-month],[data-export],[data-add-year],[data-drive-off],[data-close],[data-delete]');
  if (!t) return;
  const d = t.dataset;
  if (d.range) { ui.range = d.range; renderOverview(); artForRange(d.range); requestAnimationFrame(applyArt); }
  else if (d.month) { ui.month = d.month; ui.status = 'all'; ui.query = ''; }
  else if ('pending' in d) { ui.month = ''; ui.status = 'pending'; ui.query = ''; }
  else if ('review' in d) { ui.month = ''; ui.status = 'review'; ui.query = ''; }
  else if (d.markPaid) {
    const id = d.markPaid;
    const before = state.entries.find((e) => e.id === id);
    commit(store.updateEntry(state, id, { status: STATUS.PAID, date: todayISO() }));
    pulseArt();
    toast('Marqué payé aujourd’hui', { label: 'Annuler', run: () => commit(store.updateEntry(state, id, { status: before.status, date: before.date })) });
  }
  else if (d.edit) openSheet(d.edit);
  else if (d.filter) { ui.status = d.filter; renderPayments(); }
  else if ('clearMonth' in d) { ui.month = ''; renderPayments(); }
  else if (d.export) runExport(d.export);
  else if ('addYear' in d) {
    const years = Object.keys(state.settings.rates).sort();
    const next = Number(years.at(-1) || yearOf(todayISO())) + 1;
    commit(store.updateSettings(state, { rates: { ...state.settings.rates, [next]: state.settings.rates[years.at(-1)] ?? 0 } }));
  }
  else if ('driveOff' in d) { drive.disconnect(); sync.state = 'idle'; render(); }
  else if ('close' in d) sheet.close();
  else if ('delete' in d) {
    const id = t.closest('form').dataset.id;
    sheet.close();
    commit(store.deleteEntry(state, id));
    toast('Paiement supprimé', { label: 'Annuler', run: () => commit(store.restoreEntry(state, id)) });
  }
});

// Import d'une sauvegarde : fusionnée avec l'existant, la version la plus récente de chaque ligne gagne.
document.addEventListener('change', async (ev) => {
  if (ev.target.id !== 'import' || !ev.target.files[0]) return;
  try {
    const incoming = store.sanitizeState(JSON.parse(await ev.target.files[0].text()));
    if (!incoming.entries.length) { toast('Ce fichier ne contient aucun paiement lisible.'); return; }
    const before = live(state.entries).length;
    commit(store.mergeStates(state, incoming));
    const added = live(state.entries).length - before;
    toast(added > 0 ? `${added} paiement${added > 1 ? 's' : ''} importé${added > 1 ? 's' : ''}` : 'Sauvegarde importée, rien de nouveau');
  } catch {
    toast('Fichier illisible : choisis une sauvegarde exportée depuis cette app.');
  }
});

document.addEventListener('input', (ev) => {
  if (ev.target.id === 'search') { ui.query = ev.target.value; renderPayments(); }
});

document.addEventListener('submit', (ev) => {
  const form = ev.target;
  ev.preventDefault();
  if (form.closest('#sheet')) return submitSheet(form);
  if (form.id === 'rates') {
    const rates = {};
    for (const [y, raw] of new FormData(form)) {
      const n = Number(String(raw).replace(',', '.').trim());
      if (!Number.isFinite(n) || n < 0 || n > 100) { toast(`Taux ${y} illisible : indique un nombre entre 0 et 100.`); return; }
      rates[y] = n;
    }
    commit(store.updateSettings(state, { rates }));
    toast('Taux enregistrés');
  }
  if (form.id === 'drive-form') {
    const f = new FormData(form);
    const clientId = String(f.get('clientId') || '').trim();
    // L'identifiant et le choix d'envoi automatique sont propres à cet appareil : pas d'horodatage de réglages partagé.
    state = { ...state, settings: { ...state.settings, driveClientId: clientId, driveAuto: f.get('auto') === 'on' } };
    store.save(state);
    if (!clientId) { toast('Colle d’abord ton ID client OAuth.'); render(); return; }
    runSync({ interactive: true });
  }
});

// Clic sur le fond du formulaire : fermeture.
sheet.addEventListener('click', (ev) => { if (ev.target === sheet) sheet.close(); });

render();
// Au démarrage : tentative de reprise silencieuse de la session Google, puis synchronisation.
if (state.settings.driveClientId) runSync({ interactive: false });
