// LinkeD – interface web (sans framework). Parle à l'API de src/web/server.js.
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const fmtTime = (iso) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const fmtDay = (iso) => new Date(iso).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const fmtShort = (iso) => new Date(iso).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
const fmtWhen = (iso) => {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today ? `aujourd'hui ${fmtTime(iso)}` : `${fmtShort(iso)} ${fmtTime(iso)}`;
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/api/login') { showLogin(); throw new Error('Connexion requise'); }
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  return data;
}

let toastTimer;
function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

function openShot(name) {
  $('#lightbox-img').src = `/api/screenshots/${encodeURIComponent(name)}`;
  $('#lightbox').showModal();
}
document.addEventListener('click', (e) => {
  const shot = e.target.closest('[data-shot]');
  if (shot) openShot(shot.dataset.shot);
});

// ── Navigation ────────────────────────────────────────────
const views = ['home', 'planning', 'class', 'history', 'settings'];
function route() {
  const name = views.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'home';
  $$('.view').forEach((v) => (v.hidden = v.dataset.view !== name));
  $$('.nav a').forEach((a) => {
    if (a.dataset.tab === name) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  ({ home: loadStatus, planning: loadPlanning, class: loadClass, history: loadHistory, settings: loadSettings })[name]();
}
window.addEventListener('hashchange', route);

// ── Connexion à l'appli ───────────────────────────────────
function showLogin() {
  $('#shell').hidden = true;
  $('#login').hidden = false;
  $('#login-password').focus();
}
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#login-error').textContent = '';
  try {
    await api('/api/login', { password: $('#login-password').value });
    start();
  } catch (err) {
    $('#login-error').textContent = err.message;
  }
});

// ── Accueil ───────────────────────────────────────────────
const TG = {
  ready: ['Telegram relié', 'ok'], waiting_link: ['Telegram à relier', 'warn'], starting: ['Telegram démarre', 'warn'],
  error: ['Erreur Telegram', 'danger'], off: ['Telegram à configurer', 'warn'],
};
const WA = {
  ready: ['WhatsApp connecté', 'ok'], qr: ['WhatsApp à connecter', 'warn'], code: ['WhatsApp à connecter', 'warn'],
  starting: ['WhatsApp démarre', 'warn'], syncing: ['WhatsApp se synchronise', 'warn'],
  disconnected: ['WhatsApp déconnecté', 'danger'], error: ['Erreur WhatsApp', 'danger'], off: ['WhatsApp coupé', ''],
};

async function loadStatus() {
  let s;
  try { s = await api('/api/status'); } catch { return; }

  const { channel, status } = s.messaging;
  const [chText, chClass] = channel === 'whatsapp'
    ? (WA[status] || WA.off)
    : (TG[status] || TG.off);
  const pill = $('#pill-channel');
  pill.textContent = chText;
  pill.className = `pill ${chClass}`;
  const pillMode = $('#pill-mode');
  pillMode.textContent = s.dryRun ? 'Mode test' : 'Signature réelle';
  pillMode.className = `pill ${s.dryRun ? 'warn' : 'ok'}`;

  const banner = $('#alert-login');
  banner.hidden = !s.loginLocked;
  if (s.loginLocked) banner.innerHTML = `<b>Connexion SoWeSoft suspendue</b> après un échec (${esc(s.loginLocked)}). Vérifie tes identifiants dans <a href="#settings">Réglages</a>, puis teste la connexion.`;

  const hero = $('#session-card');
  const badge = $('#hero-badge');
  hero.classList.remove('is-todo', 'is-done');
  const progress = $('#hero-progress');
  if (s.current) {
    const done = s.current.status === 'signed' || s.current.status === 'skipped';
    hero.classList.add(done ? 'is-done' : 'is-todo');
    badge.hidden = false;
    badge.className = `badge ${done ? 'done' : 'todo'}`;
    badge.textContent = done ? 'Signé' : 'À signer';
    $('#hero-eyebrow').textContent = 'Session en cours';
    $('#hero-title').textContent = s.current.subject || s.current.title;
    const left = Math.max(0, Math.round((new Date(s.current.end) - Date.now()) / 60000));
    $('#hero-meta').textContent = `${fmtTime(s.current.start)} – ${fmtTime(s.current.end)} · ${left} min restantes`;
    const total = new Date(s.current.end) - new Date(s.current.start);
    progress.hidden = false;
    progress.firstElementChild.style.width = `${Math.min(100, ((Date.now() - new Date(s.current.start)) / total) * 100)}%`;
  } else {
    badge.hidden = true;
    $('#hero-eyebrow').textContent = 'Session en cours';
    $('#hero-title').textContent = 'Aucune session en cours';
    $('#hero-meta').textContent = 'Un code t’a été donné ? Tu peux quand même signer avec lui.';
    progress.hidden = true;
  }

  $('#today-label').textContent = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  $('#kpi-today').textContent = s.today ? String(s.today.pending) : '—';
  $('#kpi-today-sub').textContent = s.today ? `à signer sur ${s.today.total} aujourd'hui` : '';
  $('#kpi-signed').textContent = s.stats ? String(s.stats.signed) : '—';
  $('#kpi-signed-sub').textContent = s.stats ? `dont ${s.stats.byBot} par LinkeD` : '';
  $('#next-title').textContent = s.next ? (s.next.subject || s.next.title) : 'Rien de prévu';
  $('#next-meta').textContent = s.next ? `${fmtShort(s.next.start)} · ${fmtTime(s.next.start)}` : '14 prochains jours';

  loadToday();
  $('#toggle-reminders').checked = !s.paused;
  $('#reminders-label').textContent = s.paused ? 'En pause' : 'Actifs';
}

async function loadToday() {
  let data;
  try { data = await api('/api/planning?days=1'); } catch { return; }
  const list = $('#today-list');
  if (!data.sessions.length) {
    list.innerHTML = '<li class="empty small">Rien à signer aujourd’hui 🌿</li>';
    return;
  }
  list.innerHTML = data.sessions.map((x) => `
    <li>
      <span class="t">${fmtTime(x.start)}–${fmtTime(x.end)}</span>
      <span class="n">${esc(x.subject || x.title)}${x.rooms?.length ? ` <span class="muted small">· ${esc(x.rooms[0])}</span>` : ''}</span>
      <span class="status status-${x.status}">${STATUS[x.status]}</span>
    </li>`).join('');
}

function renderOtp() {
  const value = $('#code').value;
  $$('.otp-cell').forEach((cell, i) => {
    cell.textContent = value[i] || '';
    cell.classList.toggle('filled', Boolean(value[i]));
    cell.classList.toggle('active', i === Math.min(value.length, 4));
  });
}
$('#code').addEventListener('input', (e) => {
  e.target.value = e.target.value.replace(/\D/g, '').slice(0, 5);
  renderOtp();
});
$('#code').addEventListener('focus', () => { $('#otp').classList.add('focused'); renderOtp(); });
$('#code').addEventListener('blur', () => $('#otp').classList.remove('focused'));

function renderResult(el, r, { okText, testText }) {
  el.hidden = false;
  el.className = `result ${r.dryRun ? 'is-test' : r.ok ? 'is-ok' : 'is-error'}`;
  const title = r.dryRun ? testText : r.ok ? okText : 'Ça n’a pas marché';
  const text = r.dryRun
    ? 'J’ai tapé les 4 premiers chiffres et je me suis arrêté. Vérifie la capture, puis désactive le mode test dans Réglages.'
    : r.ok ? 'SoWeSoft a confirmé. Une copie t’est envoyée sur ta messagerie.' : `${r.reason || 'Erreur inconnue'}. Signe à la main sur SoWeSoft si besoin.`;
  el.innerHTML = `
    <div class="row" style="align-items:flex-start;flex-wrap:nowrap">
      ${r.screenshot ? `<img class="thumb" src="/api/screenshots/${encodeURIComponent(r.screenshot)}" data-shot="${esc(r.screenshot)}" alt="Capture SoWeSoft">` : ''}
      <div><strong>${esc(title)}</strong><p class="small">${esc(text)}</p></div>
    </div>`;
}

$('#sign-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = $('#code').value;
  if (!/^\d{5}$/.test(code)) return toast('Le code fait 5 chiffres');
  const btn = $('#sign-btn');
  btn.disabled = true;
  btn.classList.add('is-loading');
  btn.querySelector('.btn-label').textContent = 'Signature en cours';
  try {
    const r = await api('/api/sign', { code });
    if (r.busy) toast('Une signature est déjà en cours');
    else renderResult($('#sign-result'), r, { okText: r.already ? 'Déjà signé ✓' : 'Signé ✓', testText: 'Mode test réussi' });
    if (r.ok && !r.dryRun) { $('#code').value = ''; renderOtp(); }
  } catch (err) {
    toast(err.message);
  } finally {
    btn.disabled = false;
    btn.classList.remove('is-loading');
    btn.querySelector('.btn-label').textContent = 'Signer maintenant';
    loadStatus();
  }
});

$('#toggle-reminders').addEventListener('change', async (e) => {
  try {
    await api('/api/pause', { paused: !e.target.checked });
    toast(e.target.checked ? 'Rappels réactivés' : 'Rappels en pause');
    loadStatus();
  } catch (err) { toast(err.message); }
});

// ── Planning ──────────────────────────────────────────────
let planningDays = 7;
const STATUS = { signed: 'Signé', pending: 'À signer', missed: 'Non signé', skipped: 'Ignoré' };

async function loadPlanning() {
  const list = $('#planning-list');
  let data;
  try { data = await api(`/api/planning?days=${planningDays}`); } catch { return; }
  const alert = $('#ics-alert');
  alert.hidden = data.ics.configured && !data.ics.error;
  if (!data.ics.configured) alert.innerHTML = '<b>Aucun lien Hyperplanning.</b> Colle ton lien iCal dans <a href="#settings">Réglages</a> pour voir tes vrais créneaux.';
  else if (data.ics.error) alert.innerHTML = `<b>Hyperplanning illisible</b> (${esc(data.ics.error)}). Vérifie le lien iCal dans <a href="#settings">Réglages</a>.`;
  if (!data.sessions.length) {
    list.innerHTML = '<div class="empty card"><b>🌿</b>Aucun cours à signer sur la période.<br><span class="small">Choisis les cours notifiés dans <a href="#settings">Réglages → Notifications</a>.</span></div>';
    return;
  }
  const days = new Map();
  for (const s of data.sessions) {
    const key = new Date(s.start).toDateString();
    if (!days.has(key)) days.set(key, []);
    days.get(key).push(s);
  }
  list.innerHTML = [...days.values()].map((slots) => `
    <section class="day">
      <h3>${esc(fmtDay(slots[0].start))}</h3>
      <div class="day-slots">
      ${slots.map((s) => `
        <div class="slot ${s.current ? 'is-current' : ''}" data-id="${s.id}">
          <div class="slot-time">${fmtTime(s.start)}<span>${fmtTime(s.end)}</span></div>
          <div>
            <div class="slot-title">${esc(s.subject || s.title)}</div>
            <div class="slot-meta">
              <span class="status status-${s.status}">${STATUS[s.status]}${s.signedBy === 'bot' ? ' par LinkeD' : ''}</span>
              ${s.type ? `<span class="tag">${esc(s.type)}</span>` : ''}
              <span class="slot-sub">${s.rooms?.length ? `📍 ${esc(s.rooms.join(', '))}${s.campus ? ` · ${esc(s.campus)}` : ''}` : s.source === 'ics' ? 'Hyperplanning' : 'ajouté à la main'}</span>
            </div>
          </div>
          <div class="slot-actions">
            ${s.status === 'pending' || s.status === 'missed'
              ? `<button class="chip-btn" data-action="done" title="J'ai signé moi-même">✓ Fait</button>
                 <button class="chip-btn" data-action="skip" title="Pas besoin de signer ce créneau">Ignorer</button>`
              : `<button class="chip-btn" data-action="reset" title="Revenir à « à signer »">Annuler</button>`}
          </div>
        </div>`).join('')}
      </div>
    </section>`).join('');
}

$('#planning-list').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const id = btn.closest('.slot').dataset.id;
  try {
    await api('/api/session', { id, action: btn.dataset.action });
    toast({ done: 'Marqué comme signé', skip: 'Créneau ignoré', reset: 'Annulé' }[btn.dataset.action]);
    loadPlanning();
  } catch (err) { toast(err.message); }
});

$('#planning-range').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-days]');
  if (!btn) return;
  planningDays = Number(btn.dataset.days);
  $$('#planning-range button').forEach((b) => b.setAttribute('aria-selected', String(b === btn)));
  loadPlanning();
});

// ── Historique ────────────────────────────────────────────
function describe(h) {
  switch (h.type) {
    case 'sign':
      if (h.dryRun) return ['🧪', `Mode test avec ${h.code}`, h.title];
      if (h.ok) return ['✅', h.already ? 'Déjà signé sur SoWeSoft' : `Signé avec ${h.code}`, h.title];
      return ['❌', 'Signature échouée', h.reason];
    case 'reminder': return ['🔔', h.offset < 0 ? `Rappel ${-h.offset} min avant` : h.offset === 0 ? 'Rappel au début' : `Relance +${h.offset} min`, h.title];
    case 'done': return ['👍', 'Marqué signé à la main', h.title];
    case 'skip': return ['🙈', 'Créneau ignoré', h.title];
    case 'pause': return ['⏸️', 'Rappels en pause'];
    case 'resume': return ['▶️', 'Rappels réactivés'];
    case 'test': return [h.ok ? '🔌' : '⚠️', h.ok ? 'Connexion SoWeSoft OK' : 'Connexion SoWeSoft échouée', h.reason];
    case 'settings': return ['⚙️', 'Réglages modifiés'];
    case 'members-reminder': return ['👥', `Rappel envoyé à ${h.count} membre${h.count > 1 ? 's' : ''}`, h.title];
    case 'member-joined': return ['🎉', `${h.title} a rejoint les rappels`];
    case 'member-added': return ['➕', `${h.title} ajouté·e à la classe`];
    case 'member-removed': return ['➖', `${h.title} retiré·e de la classe`];
    case 'notif-test': return ['📱', `Notification de test envoyée${h.channel ? ` (${h.channel})` : ''}`];
    default: return ['•', h.type];
  }
}

async function loadHistory() {
  const list = $('#history-list');
  let data;
  try { data = await api('/api/history'); } catch { return; }
  if (!data.history.length) {
    list.innerHTML = '<li class="empty" style="display:block">Rien pour l’instant. Ton premier rappel arrivera au prochain créneau.</li>';
    return;
  }
  list.innerHTML = data.history.map((h) => {
    const [icon, title, sub] = describe(h);
    return `<li>
      <span class="tl-icon" aria-hidden="true">${icon}</span>
      <div><div class="tl-title">${esc(title)}</div><div class="tl-time">${esc(fmtWhen(h.at))}${sub ? ` · ${esc(sub)}` : ''}</div></div>
      ${h.screenshot ? `<img class="thumb" style="width:48px" src="/api/screenshots/${encodeURIComponent(h.screenshot)}" data-shot="${esc(h.screenshot)}" alt="Capture">` : '<span></span>'}
    </li>`;
  }).join('');
}

// ── Réglages ──────────────────────────────────────────────
let method = 'password';
function setMethod(m) {
  method = m;
  $$('#method button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.method === m)));
  $$('[data-for]').forEach((el) => (el.hidden = el.dataset.for !== m));
}
$('#method').addEventListener('click', (e) => {
  const b = e.target.closest('[data-method]');
  if (b) setMethod(b.dataset.method);
});

let qrTimer;
async function loadWhatsApp() {
  clearTimeout(qrTimer);
  let q;
  try { q = await api('/api/qr'); } catch { return; }
  const text = {
    ready: '✅ Connecté. LinkeD t’écrit dans ta discussion « Moi (Vous) » (ou au numéro du bot).',
    qr: 'Scanne ce QR code pour relier ton WhatsApp :',
    code: 'Connexion par code :',
    starting: '⏳ Démarrage de WhatsApp… le QR code arrive (jusqu’à 1 min).',
    syncing: `✅ C’est scanné ! Synchronisation de WhatsApp${q.percent ? ` : ${q.percent} %` : '…'} Ça peut prendre 1 à 3 min, garde ton téléphone allumé avec internet.`,
    disconnected: `⚠️ ${q.error || 'Déconnecté'}. Reconnexion automatique en cours…`,
    error: `❌ ${q.error || 'Erreur WhatsApp'}`,
    off: 'WhatsApp n’est pas lancé.',
  }[q.status] || '—';
  $('#wa-text').textContent = text;
  if (document.activeElement !== $('#wa-number')) $('#wa-number').value = q.number ? `+${q.number}` : '';

  $('#wa-qr').hidden = !q.image;
  $('#wa-steps').hidden = !q.image;
  if (q.image) $('#wa-qr').src = q.image;

  const progress = $('#wa-progress');
  progress.hidden = q.status !== 'syncing';
  progress.firstElementChild.style.width = `${q.percent || 8}%`;

  $('#wa-code-box').hidden = q.status !== 'code';
  if (q.status === 'code') $('#wa-code').textContent = q.code ? q.code.replace(/^(.{4})(.{4})$/, '$1-$2') : 'Génération…';
  $('#wa-pair-form').hidden = q.status !== 'qr';
  $('#wa-test').hidden = q.status !== 'ready';
  $('#wa-reset').hidden = !['ready', 'error', 'disconnected', 'syncing', 'code'].includes(q.status);
  $('#wa-reset').textContent = q.status === 'ready' ? 'Déconnecter / changer de compte' : 'Réinitialiser WhatsApp';

  if (q.status !== 'ready' && !$('[data-view="settings"]').hidden) qrTimer = setTimeout(loadWhatsApp, 3000);
}

$('#wa-number-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/api/settings', { whatsappNumber: $('#wa-number').value });
    toast('Numéro enregistré');
    loadWhatsApp();
  } catch (err) { toast(err.message); }
});

$('#wa-pair-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button');
  btn.disabled = true;
  try {
    const { code } = await api('/api/whatsapp/pair', { phone: $('#wa-phone').value });
    toast(`Code : ${code}`);
  } catch (err) { toast(err.message); }
  btn.disabled = false;
  loadWhatsApp();
});

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-notif-test]');
  if (!btn) return;
  btn.disabled = true;
  try {
    const r = await api('/api/notify-test', {});
    toast(`Notif envoyée ! Regarde ${r.channel} 📱`);
  } catch (err) { toast(err.message); }
  btn.disabled = false;
});

$('#wa-reset').addEventListener('click', async () => {
  if (!confirm('Oublier la connexion WhatsApp actuelle et afficher un nouveau QR code ?')) return;
  try {
    await api('/api/whatsapp/reset', {});
    toast('WhatsApp réinitialisé, un nouveau QR arrive');
  } catch (err) { toast(err.message); }
  setTimeout(loadWhatsApp, 1500);
});

// ── Messagerie : Telegram / WhatsApp ─────────────────────
let channel = 'telegram';
let tgTimer;
let tgEditing = false;

function setChannel(c) {
  channel = c;
  $$('#channel button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.channel === c)));
  $$('[data-channel-panel]').forEach((el) => (el.hidden = el.dataset.channelPanel !== c));
  clearTimeout(tgTimer);
  clearTimeout(qrTimer);
  if (c === 'telegram') loadTelegram();
  else loadWhatsApp();
}

$('#channel').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-channel]');
  if (!b || b.dataset.channel === channel) return;
  try {
    await api('/api/settings', { channel: b.dataset.channel });
    toast(b.dataset.channel === 'telegram' ? 'Messagerie : Telegram' : 'Messagerie : WhatsApp (démarrage…)');
    setChannel(b.dataset.channel);
    loadStatus();
  } catch (err) { toast(err.message); }
});

async function loadTelegram() {
  clearTimeout(tgTimer);
  let t;
  try { t = await api('/api/telegram'); } catch { return; }
  const text = {
    off: 'Crée ton bot Telegram en 2 minutes :',
    starting: '⏳ Connexion à Telegram…',
    waiting_link: `✅ Bot <b>@${esc(t.username)}</b> prêt.`,
    ready: `✅ Relié à <b>${esc(t.owner)}</b> via <b>@${esc(t.username)}</b>. Les rappels arrivent sur Telegram.`,
    error: `❌ ${esc(t.error || 'Erreur Telegram')}`,
  }[t.status] || '—';
  $('#tg-text').innerHTML = text;

  const setup = t.status === 'off' || t.status === 'error' || tgEditing;
  $('#tg-setup').hidden = !setup;
  $('#tg-link').hidden = t.status !== 'waiting_link' || setup;
  if (t.link) {
    $('#tg-link-btn').href = t.link;
    $('#tg-code').textContent = t.linkCode;
    $('#tg-username').textContent = `@${t.username}`;
  }
  $('#tg-qr').hidden = !t.qr;
  if (t.qr) $('#tg-qr').src = t.qr;
  $('#tg-test').hidden = t.status !== 'ready';
  $('#tg-unlink').hidden = t.status !== 'ready';
  $('#tg-change').hidden = setup || t.status === 'off';

  if (t.status !== 'ready' && channel === 'telegram' && !$('[data-view="settings"]').hidden) tgTimer = setTimeout(loadTelegram, 3000);
}

$('#tg-token-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const token = $('#tg-token').value.trim();
  if (!token) return toast('Colle le token donné par @BotFather');
  try {
    await api('/api/settings', { telegramToken: token, channel: 'telegram' });
    $('#tg-token').value = '';
    tgEditing = false;
    toast('Token enregistré');
    setTimeout(loadTelegram, 800);
  } catch (err) { toast(err.message); }
});

$('#tg-change').addEventListener('click', () => { tgEditing = true; loadTelegram(); });
$('#tg-unlink').addEventListener('click', async () => {
  if (!confirm('Délier ce compte Telegram ? Tu pourras relier un autre compte.')) return;
  await api('/api/telegram/unlink', {}).catch((err) => toast(err.message));
  loadTelegram();
});

async function loadSettings() {
  let s;
  try { s = await api('/api/settings'); } catch { return; }
  setChannel(s.channel || 'telegram');
  const f = $('#settings-form');
  f.institution.value = s.auth.institution || '';
  f.email.value = s.auth.email || '';
  f.id.value = s.auth.id || '';
  f.password.value = '';
  f.pin.value = '';
  f.password.placeholder = s.auth.hasPassword ? '•••••• (inchangé)' : 'Ton mot de passe SoWeSoft';
  f.pin.placeholder = s.auth.hasPin ? '•••• (inchangé)' : '4 chiffres';
  f.dryRun.checked = s.dryRun;
  $('#offsets-form').reminderOffsets.value = s.reminderOffsets.join(', ');
  setNotifyMode(s.notify?.mode || 'auto');
  f.keywords.value = s.keywords.join(', ');
  f.icsUrl.value = s.icsUrl || '';
  $('#relay-card').querySelector('[name=relayUrl]').value = s.relayUrl || '';
  const rsec = $('#relay-card').querySelector('[name=relaySecret]');
  rsec.value = '';
  rsec.placeholder = s.hasRelaySecret ? '•••••• (inchangée)' : 'Clé affichée par le script';
  setMethod(s.auth.method);
  setSignature(s.signature || { style: 'claude', name: 'Camille Redon' });
}

// ── Style de signature ────────────────────────────────────
let signatureStyle = 'claude';
function setSignature(sig) {
  signatureStyle = sig.style || 'claude';
  $$('#signature-style button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.style === signatureStyle)));
  const nameField = $('[data-for="signature-name"]');
  if (nameField) nameField.hidden = signatureStyle !== 'name';
  const nameInput = $('#signature-card [name=signatureName]');
  if (nameInput && document.activeElement !== nameInput) nameInput.value = sig.name || '';
}
async function saveSignature(patch) {
  try {
    const s = await api('/api/settings', { signature: { style: signatureStyle, ...patch } });
    setSignature(s.signature);
    toast('Signature enregistrée');
  } catch (err) { toast(err.message); }
}
$('#signature-style')?.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || b.dataset.style === signatureStyle) return;
  signatureStyle = b.dataset.style;
  saveSignature(b.dataset.style === 'name' ? { name: $('#signature-card [name=signatureName]').value || 'Camille Redon' } : {});
});
$('#signature-card [name=signatureName]')?.addEventListener('change', (e) => saveSignature({ name: e.target.value }));

$('#settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    await api('/api/settings', {
      dryRun: f.dryRun.checked,
      keywords: f.keywords.value,
      icsUrl: f.icsUrl.value,
      auth: { method, institution: f.institution.value, email: f.email.value, password: f.password.value, id: f.id.value, pin: f.pin.value },
    });
    toast('Réglages enregistrés');
    $('#settings-result').hidden = true;
    loadSettings();
    loadStatus();
  } catch (err) {
    const el = $('#settings-result');
    el.hidden = false;
    el.className = 'result is-error';
    el.textContent = err.message;
  }
});

$('#test-btn').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  btn.classList.add('is-loading');
  try {
    const r = await api('/api/test', {});
    renderResult($('#settings-result'), r, { okText: 'Connexion SoWeSoft OK', testText: '' });
    if (r.ok) $('#settings-result p').textContent = 'LinkeD accède bien à ton espace étudiant.';
  } catch (err) { toast(err.message); }
  btn.disabled = false;
  btn.classList.remove('is-loading');
  loadStatus();
});

$('#offsets-form').reminderOffsets.addEventListener('change', async (e) => {
  try {
    const s = await api('/api/settings', { reminderOffsets: e.target.value });
    e.target.value = s.reminderOffsets.join(', ');
    toast('Rappels enregistrés');
  } catch (err) { toast(err.message); }
});
$('#offsets-form').addEventListener('submit', (e) => { e.preventDefault(); e.target.reminderOffsets.dispatchEvent(new Event('change')); });

// ── Notifications : quels cours ───────────────────────────
let notifyMode = 'auto';
let courses = [];

function setNotifyMode(mode) {
  notifyMode = mode;
  $$('#notify-mode button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === mode)));
  $('#course-picker').hidden = mode !== 'custom';
  if (mode === 'custom') loadCourses();
}

$('#notify-mode').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-mode]');
  if (!b || b.dataset.mode === notifyMode) return;
  try {
    await api('/api/settings', { notify: { mode: b.dataset.mode } });
    setNotifyMode(b.dataset.mode);
    toast({ auto: 'Notifs : autonomie & e-learning', all: 'Notifs : tous les cours', custom: 'Notifs : ta sélection' }[b.dataset.mode]);
  } catch (err) { toast(err.message); }
});

function renderCourses() {
  const q = $('#course-search').value.trim().toLowerCase();
  const shown = courses.filter((c) => !q || c.subject.toLowerCase().includes(q));
  const selectedCount = courses.filter((c) => c.selected).length;
  $('#course-count').textContent = `${selectedCount}/${courses.length}`;
  $('#course-warning').hidden = selectedCount > 0 || !courses.length;
  if (!courses.length) {
    $('#course-list').innerHTML = '<li class="empty small">Aucun cours trouvé dans Hyperplanning sur les 60 prochains jours. Vérifie le lien iCal (section Agenda).</li>';
    return;
  }
  $('#course-list').innerHTML = shown.map((c) => `
    <li><label>
      <input type="checkbox" data-subject="${esc(c.subject)}" ${c.selected ? 'checked' : ''}>
      <span>
        <span class="course-name">${esc(c.subject)}</span>
        <span class="course-meta">
          ${c.types.map((t) => `<span class="tag ${/AUTONOMIE|ELEARNING/.test(t) ? 'tag-auto' : ''}">${esc(t)}</span>`).join('')}
          <span>${c.count} séance${c.count > 1 ? 's' : ''}${c.next ? ` · prochaine ${esc(fmtShort(c.next))}` : ''}</span>
        </span>
      </span>
    </label></li>`).join('');
}

async function loadCourses() {
  try {
    courses = (await api('/api/courses')).courses;
    renderCourses();
  } catch { /* hors ligne */ }
}

$('#course-search').addEventListener('input', renderCourses);
$('#course-list').addEventListener('change', async (e) => {
  const box = e.target.closest('[data-subject]');
  if (!box) return;
  courses.find((c) => c.subject === box.dataset.subject).selected = box.checked;
  renderCourses();
  try {
    await api('/api/settings', { notify: { mode: 'custom', subjects: courses.filter((c) => c.selected).map((c) => c.subject) } });
  } catch (err) { toast(err.message); }
});

// ── Application : version et mise à jour ──────────────────
async function loadVersion() {
  let v;
  try { v = await api('/api/version'); } catch { return; }
  const short = (sha) => (sha ? sha.slice(0, 7) : 'inconnue');
  $('#version-label').textContent = `LinkeD · ${short(v.current)}`;
  $('#update-version').textContent = short(v.current);
  $('#update-chip').hidden = !v.updateAvailable;
  const btn = $('#update-btn');
  btn.disabled = !v.canUpdate || v.updating;
  btn.textContent = v.updating ? 'Mise à jour…' : v.updateAvailable || !v.current ? 'Mettre à jour' : 'Réinstaller';
  $('#update-text').textContent = v.updating ? 'Installation en cours, LinkeD va redémarrer (1 à 3 min)…'
    : !v.canUpdate ? 'Mise à jour en un clic disponible quand LinkeD est installé sur Mac avec le script.'
    : v.error ? `Vérification impossible : ${v.error}`
    : v.updateAvailable ? `Nouvelle version ${short(v.latest)}${v.latestMessage ? ` : ${v.latestMessage}` : ''}`
    : 'Tu as la dernière version ✓';
}

$('#update-btn').addEventListener('click', async () => {
  if (!confirm('Installer la dernière version de LinkeD ? L’app redémarre (1 à 3 minutes). Tes réglages sont conservés.')) return;
  try {
    await api('/api/update', {});
    $('#update-btn').disabled = true;
    $('#update-text').textContent = 'Installation en cours, LinkeD va redémarrer (1 à 3 min)…';
    toast('Mise à jour lancée…');
    waitForRestart();
  } catch (err) { toast(err.message); }
});
$('#update-chip').addEventListener('click', () => { location.hash = '#settings'; });

function waitForRestart() {
  const startedAt = Date.now();
  let wentDown = false;
  const tick = async () => {
    const v = await fetch('/api/version').then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (!v) wentDown = true;
    else if (!v.updating && (wentDown || Date.now() - startedAt > 20e3)) {
      if (v.lastError) { toast(`Mise à jour échouée : ${v.lastError}`); return loadVersion(); }
      toast('LinkeD est à jour ✓');
      return setTimeout(() => location.reload(), 800);
    }
    if (Date.now() - startedAt < 10 * 60e3) setTimeout(tick, 3000);
  };
  setTimeout(tick, 3000);
}

// ── Classe ────────────────────────────────────────────────
let classData = null;
const MEMBER_STATUS = { invited: 'Invité·e', active: 'Actif', paused: 'En pause' };
const fmtPhone = (n) => (n.startsWith('33') && n.length === 11 ? `0${n.slice(2)}`.replace(/(\d{2})(?=\d)/g, '$1 ') : `+${n}`);

/** Aperçu façon Telegram : *gras*, _italique_, retours à la ligne. */
function telegramHtml(text) {
  return esc(text).replace(/\*([^*\n]+)\*/g, '<b>$1</b>').replace(/_([^_\n]+)_/g, '<i>$1</i>');
}

async function loadClass() {
  try { classData = await api('/api/members'); } catch { return; }
  const { telegram, members } = classData;
  const active = members.filter((m) => m.status === 'active').length;
  $('#class-count').textContent = `${active} actif${active > 1 ? 's' : ''} · ${members.length} membre${members.length > 1 ? 's' : ''}`;

  const alert = $('#class-alert');
  alert.hidden = Boolean(telegram.username);
  if (!telegram.username) alert.innerHTML = '<b>Le bot Telegram n’est pas encore configuré.</b> Crée-le dans <a href="#settings">Réglages → Messagerie</a> : il sert aussi aux rappels de la classe.';

  $('#share-text').textContent = telegram.botUrl
    ? `📣 Rappels SoWeSoft automatiques !\nOuvre ${telegram.botUrl} → Démarrer → « Partager mon numéro ».\nTu recevras un message à chaque fois qu'il faut signer.`
    : '—';

  if (document.activeElement !== $('#member-template')) $('#member-template').value = classData.template;
  $('#template-preview').innerHTML = telegramHtml(classData.preview);
  $('#template-vars').innerHTML = Object.entries(classData.vars)
    .map(([k, label]) => `<button type="button" class="chip" data-var="${k}" title="${esc(label)}">{${k}}</button>`).join('');
  renderMembers();
}

function renderMembers() {
  const q = $('#member-search').value.trim().toLowerCase();
  const list = classData.members.filter((m) => !q || m.name.toLowerCase().includes(q) || m.phone.includes(q.replace(/\D/g, '') || '§'));
  if (!classData.members.length) {
    $('#member-list').innerHTML = '<li class="empty" style="display:block">Personne pour l’instant. Ajoute le prénom et le numéro d’un·e camarade ci-dessus.</li>';
    return;
  }
  $('#member-list').innerHTML = list.map((m) => `
    <li data-id="${m.id}">
      <span class="avatar" aria-hidden="true">${esc(m.name.slice(0, 1).toUpperCase())}</span>
      <div style="min-width:0">
        <div class="member-name">${esc(m.name)}</div>
        <div class="member-sub">${esc(fmtPhone(m.phone))}</div>
      </div>
      <div>
        <span class="status status-${m.status}">${MEMBER_STATUS[m.status]}</span>
        <div class="member-sub">${m.linked ? `Telegram : ${esc(m.telegramName || '—')}` : 'pas encore rejoint'}</div>
      </div>
      <div class="member-actions">
        ${m.linked
          ? `<button class="chip-btn" data-member-action="test">Notif test</button>
             <button class="chip-btn" data-member-action="${m.status === 'paused' ? 'resume' : 'pause'}">${m.status === 'paused' ? 'Reprendre' : 'Pause'}</button>`
          : `<button class="chip-btn" data-member-action="copy" ${m.inviteUrl ? '' : 'disabled'}>Copier son lien</button>`}
        <button class="chip-btn danger" data-member-action="remove">Retirer</button>
      </div>
    </li>`).join('');
}

async function copy(text, done = 'Copié ✓') {
  try { await navigator.clipboard.writeText(text); toast(done); } catch { prompt('Copie ce texte :', text); }
}

$('#member-search').addEventListener('input', () => classData && renderMembers());
$('#member-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    const { member } = await api('/api/members', { name: f.name.value, phone: f.phone.value });
    f.reset();
    toast(`${member.name} ajouté·e : envoie-lui le lien du bot`);
    loadClass();
  } catch (err) { toast(err.message); }
});
$('#share-copy').addEventListener('click', () => copy($('#share-text').textContent, 'Message copié, colle-le dans le groupe de classe'));

$('#member-list').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-member-action]');
  if (!btn) return;
  const id = btn.closest('li').dataset.id;
  const member = classData.members.find((m) => m.id === id);
  const action = btn.dataset.memberAction;
  if (action === 'copy') {
    return copy(`Salut ${member.name} ! Pour recevoir les rappels de signature SoWeSoft, ouvre ce lien puis appuie sur Démarrer : ${member.inviteUrl}`, 'Lien perso copié');
  }
  if (action === 'remove' && !confirm(`Retirer ${member.name} ? Il·elle ne recevra plus de rappels.`)) return;
  try {
    await api('/api/members/action', { id, action });
    toast({ test: `Notif envoyée à ${member.name}`, pause: 'Rappels en pause', resume: 'Rappels réactivés', remove: `${member.name} retiré·e` }[action]);
    loadClass();
  } catch (err) { toast(err.message); }
});

// Modèle de message : variables cliquables + aperçu en direct
let previewTimer;
$('#member-template').addEventListener('input', () => {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(async () => {
    const { preview } = await api('/api/members/preview', { template: $('#member-template').value }).catch(() => ({ preview: '' }));
    $('#template-preview').innerHTML = telegramHtml(preview);
  }, 250);
});
$('#template-vars').addEventListener('click', (e) => {
  const chip = e.target.closest('[data-var]');
  if (!chip) return;
  const area = $('#member-template');
  const token = `{${chip.dataset.var}}`;
  const { selectionStart: a, selectionEnd: b, value } = area;
  area.value = value.slice(0, a) + token + value.slice(b);
  area.focus();
  area.selectionStart = area.selectionEnd = a + token.length;
  area.dispatchEvent(new Event('input'));
});
$('#template-save').addEventListener('click', async () => {
  try {
    await api('/api/settings', { memberTemplate: $('#member-template').value });
    toast('Message enregistré');
    loadClass();
  } catch (err) { toast(err.message); }
});
$('#template-reset').addEventListener('click', () => {
  $('#member-template').value = classData.defaultTemplate;
  $('#member-template').dispatchEvent(new Event('input'));
});

// ── Relais cloud ──────────────────────────────────────────
const relayInputs = () => ({
  url: $('#relay-card [name=relayUrl]').value.trim(),
  secret: $('#relay-card [name=relaySecret]').value.trim(),
});
function relayResult(ok, text) {
  const el = $('#relay-result');
  el.hidden = false;
  el.className = `result ${ok ? 'is-ok' : 'is-error'}`;
  el.textContent = text;
}
$('#relay-save').addEventListener('click', async () => {
  const { url, secret } = relayInputs();
  try {
    await api('/api/settings', secret ? { relayUrl: url, relaySecret: secret } : { relayUrl: url });
    const r = await api('/api/relay/test', { url, secret }).catch((e) => ({ error: e.message }));
    relayResult(!r.error, r.error ? `Enregistré, mais test échoué : ${r.error}` : 'Relais activé ✓ Les rappels partiront même Mac éteint.');
    loadSettings();
  } catch (err) { relayResult(false, err.message); }
});
$('#relay-test').addEventListener('click', async () => {
  const { url, secret } = relayInputs();
  try {
    await api('/api/relay/test', { url, secret });
    relayResult(true, 'Relais joignable ✓');
  } catch (err) { relayResult(false, err.message); }
});
$('#relay-test-reminder').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  try {
    const r = await api('/api/relay/test-reminder', {});
    relayResult(true, `Envoyé depuis le cloud à ${r.recipients} destinataire(s) ✓ Regarde Telegram 📱 (ce message vient du cloud, pas de ton Mac).`);
  } catch (err) { relayResult(false, err.message); }
  btn.disabled = false;
});

// ── App Mac (Electron) : diagnostic et réparation ─────────
const inDesktopApp = () => document.documentElement.dataset.shell === 'desktop';
let desktopTimer;

async function loadDesktop() {
  clearTimeout(desktopTimer);
  let d;
  try { d = await api('/api/desktop'); } catch { return; }
  if (!d.mac) return;
  $('#desktop-box').hidden = false;
  const state = d.repairing ? '⏳ Installation en cours…'
    : d.kind === 'native' ? '✅ App native installée'
    : d.kind === 'launcher' ? '⚠️ Ouverture dans une fenêtre de navigateur'
    : '⚠️ App absente du dossier Applications';
  $('#desktop-state').textContent = state;
  $('#desktop-text').textContent = d.repairing ? 'Téléchargement d’Electron (≈ 100 Mo) puis création de l’app, 1 à 5 min.'
    : d.chromeShortcuts.length ? 'Un raccourci Chrome « LinkeD » existe : la réparation le supprime.'
    : d.kind === 'native' ? (inDesktopApp() ? 'Tu utilises l’app native.' : 'Ferme cette fenêtre et ouvre LinkeD depuis le dossier Applications.')
    : 'Clique pour télécharger et créer la vraie app (fenêtre, Dock, menus).';
  $('#desktop-btn').disabled = d.repairing || !d.managed;
  if (d.last && !d.repairing) {
    $('#desktop-log').hidden = d.last.ok;
    $('#desktop-log').textContent = d.last.output || `Code de sortie ${d.last.code}`;
  }
  const banner = $('#alert-browser');
  banner.hidden = inDesktopApp() || !d.managed;
  if (!banner.hidden) {
    banner.innerHTML = d.kind === 'native'
      ? '<b>Tu es dans une fenêtre de navigateur.</b> L’app LinkeD est installée : ferme cette fenêtre et ouvre <b>LinkeD</b> depuis le dossier Applications (ou le Launchpad).'
      : '<b>Tu es dans une fenêtre de navigateur.</b> L’app Mac n’est pas encore installée. <button class="btn btn-primary btn-sm" type="button" data-desktop-repair>Installer l’app Mac</button>';
  }
  if (d.repairing) desktopTimer = setTimeout(loadDesktop, 3000);
}

async function repairDesktop() {
  try {
    await api('/api/desktop/repair', {});
    toast('Installation de l’app Mac lancée');
    setTimeout(loadDesktop, 800);
  } catch (err) { toast(err.message); }
}
$('#desktop-btn').addEventListener('click', repairDesktop);
document.addEventListener('click', (e) => { if (e.target.closest('[data-desktop-repair]')) repairDesktop(); });

// ── Démarrage ─────────────────────────────────────────────
let statusTimer;
function start() {
  $('#login').hidden = true;
  $('#shell').hidden = false;
  route();
  loadStatus();
  loadVersion();
  loadDesktop();
  clearInterval(statusTimer);
  statusTimer = setInterval(() => { if (!document.hidden) loadStatus(); }, 15000);
}

(async () => {
  const me = await api('/api/me').catch(() => ({ authed: false, passwordRequired: true }));
  if (me.authed) start();
  else showLogin();
})();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
