// Relais LinkeD sur Cloudflare Workers : envoie les rappels même quand le Mac est éteint.
//
// - POST /push  (Mac → relais) : reçoit le « snapshot » (planning, réglages, membres) et sert de battement de cœur.
// - GET  /state (Mac → relais) : rappels déjà envoyés par le relais, pour éviter les doublons au retour du Mac.
// - cron (chaque minute) : si le Mac est hors ligne depuis > 3 min, télécharge l'agenda et envoie les rappels dus.
//
// Le relais n'ÉMET que des messages (aucun long polling), donc il ne gêne pas le bot qui tourne sur le Mac.
// Il ne signe jamais sur SoWeSoft : uniquement des rappels.
import { computeReminders } from '../src/relay/engine.js';
import { relayHandle, applyOverrides } from '../src/relay/handle.js';
import { coursesFromLite, parseIcsLite } from '../src/planning/ics-lite.js';
import { fetchIcsText } from '../src/relay/fetch-ics.js';

const TAKEOVER_MS = 3 * 60e3; // au-delà, le Mac est considéré hors ligne
const ICS_TTL_MS = 20 * 60e3; // on ne retélécharge l'agenda Hyperplanning qu'au plus toutes les 20 min

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

async function kvGet(env, key, fallback = null) {
  const row = await env.DB.prepare('SELECT v FROM kv WHERE k = ?').bind(key).first();
  return row ? JSON.parse(row.v) : fallback;
}
async function kvSet(env, key, value) {
  await env.DB.prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v')
    .bind(key, JSON.stringify(value)).run();
}

function authed(request, env) {
  const header = request.headers.get('authorization') || '';
  const token = header.replace(/^Bearer\s+/i, '');
  // comparaison à temps constant
  const a = new TextEncoder().encode(token);
  const b = new TextEncoder().encode(env.RELAY_SECRET || '');
  if (!env.RELAY_SECRET || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function sendTelegram(token, chatId, text) {
  const call = (body) => fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }).then((r) => r.json());
  let res = await call({ chat_id: chatId, text, parse_mode: 'Markdown', disable_web_page_preview: true });
  if (!res.ok && res.error_code === 400) res = await call({ chat_id: chatId, text: text.replace(/[*_`]/g, '') });
  return res.ok;
}

/**
 * Agenda ICS mis en cache côté relais (KV) : évite de télécharger Hyperplanning à chaque minute
 * quand le Mac est éteint (sinon ~1440 requêtes/jour vers l'école). On garde le texte au plus 20 min.
 */
async function getIcsText(env, url, fetchIcs, now) {
  const cached = await kvGet(env, 'ics');
  if (cached && cached.url === url && now.getTime() - cached.at < ICS_TTL_MS) return cached.text;
  try {
    const text = await fetchIcs(url);
    await kvSet(env, 'ics', { url, at: now.getTime(), text });
    return text;
  } catch (err) {
    if (cached && cached.url === url) return cached.text; // école injoignable : on garde l'ancien agenda
    throw err;
  }
}

/** Cœur du cron, isolé pour les tests : décide et envoie, met à jour l'état. now/deps injectables. */
export async function runOnce(env, now = new Date(), deps = {}) {
  const fetchIcs = deps.fetchIcs || fetchIcsText;
  const send = deps.send || sendTelegram;

  const snapshot = await kvGet(env, 'snapshot');
  if (!snapshot?.telegramToken || !snapshot.icsUrl) return { skipped: 'no-snapshot' };

  const lastSeen = await kvGet(env, 'lastSeen', 0);
  if (now.getTime() - new Date(lastSeen).getTime() < TAKEOVER_MS) return { skipped: 'mac-online' };

  let icsText;
  try { icsText = await getIcsText(env, snapshot.icsUrl, fetchIcs, now); } catch { return { skipped: 'ics-error' }; }

  const overrides = await kvGet(env, 'overrides', {});
  const sent = await kvGet(env, 'sent', {});
  const { actions, sentUpdates } = computeReminders(applyOverrides(snapshot, overrides), sent, icsText, now);
  let ok = 0;
  for (const action of actions) {
    if (await send(snapshot.telegramToken, action.chatId, action.text)) ok++;
    else delete sentUpdates[action.key]; // échec d'envoi : on réessaiera au prochain passage
  }
  if (Object.keys(sentUpdates).length) await kvSet(env, 'sent', { ...sent, ...sentUpdates });
  return { sent: ok, attempted: actions.length };
}

/** Traite un message entrant Telegram via le cloud (lecture de l'agenda en direct). */
export async function handleWebhook(env, update, deps = {}) {
  const fetchIcs = deps.fetchIcs || fetchIcsText;
  const send = deps.send || sendTelegram;
  const snapshot = await kvGet(env, 'snapshot');
  if (!snapshot?.telegramToken) return;

  const now = new Date();
  const dayWindow = (base) => [new Date(base.getFullYear(), base.getMonth(), base.getDate()), new Date(base.getFullYear(), base.getMonth(), base.getDate() + 1)];
  let coursesToday = [], coursesTomorrow = [];
  if (snapshot.icsUrl) {
    try {
      const parsed = parseIcsLite(await getIcsText(env, snapshot.icsUrl, fetchIcs, now));
      const t = dayWindow(now); coursesToday = coursesFromLite(parsed, t[0], t[1]);
      const tm = dayWindow(new Date(now.getTime() + 864e5)); coursesTomorrow = coursesFromLite(parsed, tm[0], tm[1]);
    } catch { /* agenda indisponible : on répond quand même aux commandes simples */ }
  }

  const lastSeen = await kvGet(env, 'lastSeen', 0);
  const macOnline = now.getTime() - new Date(lastSeen).getTime() < TAKEOVER_MS;
  const overrides = await kvGet(env, 'overrides', {});
  const result = relayHandle({ update, snapshot, overrides, coursesToday, coursesTomorrow, macOnline, now });

  for (const r of result.replies) await send(snapshot.telegramToken, r.chatId, r.text);
  await kvSet(env, 'overrides', result.overrides);
  if (result.signCode) {
    const queue = await kvGet(env, 'codeQueue', []);
    queue.push({ ...result.signCode, at: now.toISOString() });
    await kvSet(env, 'codeQueue', queue);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/health') return json({ ok: true, hasSnapshot: Boolean(await kvGet(env, 'snapshot')) });

    // Webhook Telegram : messages entrants (même Mac éteint). Vérifié par le secret d'en-tête.
    if (request.method === 'POST' && url.pathname === '/tg') {
      if (request.headers.get('x-telegram-bot-api-secret-token') !== env.RELAY_SECRET) return json({ error: 'non autorisé' }, 401);
      ctx.waitUntil(handleWebhook(env, await request.json().catch(() => ({}))));
      return json({ ok: true });
    }

    if (!authed(request, env)) return json({ error: 'non autorisé' }, 401);

    if (request.method === 'POST' && url.pathname === '/push') {
      const snapshot = await request.json().catch(() => null);
      if (!snapshot) return json({ error: 'json invalide' }, 400);
      await kvSet(env, 'snapshot', snapshot);
      await kvSet(env, 'lastSeen', new Date().toISOString());
      // le Mac indique où il en est : on fusionne pour ne jamais renvoyer ce qu'il a déjà envoyé
      const merged = { ...(await kvGet(env, 'sent', {})), ...(snapshot.reminded || {}) };
      await kvSet(env, 'sent', merged);
      // le Mac récupère ce que le cloud a changé (fait/stop/liaisons) + les codes à signer, puis on vide la file
      const overrides = await kvGet(env, 'overrides', {});
      const codeQueue = await kvGet(env, 'codeQueue', []);
      if (codeQueue.length) await kvSet(env, 'codeQueue', []);
      return json({ ok: true, sent: merged, overrides, codeQueue });
    }
    if (url.pathname === '/state') return json({ sent: await kvGet(env, 'sent', {}), lastSeen: await kvGet(env, 'lastSeen', 0) });
    if (request.method === 'POST' && url.pathname === '/test-reminder') {
      const snap = await kvGet(env, 'snapshot');
      if (!snap?.telegramToken) return json({ error: 'le Mac n’a pas encore envoyé sa configuration' }, 409);
      const recipients = [];
      if (snap.owner?.chatId) recipients.push(snap.owner.chatId);
      for (const m of snap.members || []) if (m.status === 'active' && m.chatId) recipients.push(m.chatId);
      let ok = 0;
      for (const chat of recipients) {
        if (await sendTelegram(snap.telegramToken, chat, '🔔 *Test du relais cloud LinkeD*\nCe message vient du cloud, pas de ton Mac. Les rappels arriveront donc même quand ton Mac est éteint. ✅')) ok++;
      }
      return json({ ok: true, sent: ok, recipients: recipients.length });
    }
    if (request.method === 'POST' && url.pathname === '/clear-sent') { await kvSet(env, 'sent', {}); return json({ ok: true }); }

    // Enregistre le webhook Telegram côté relais (appelé par le Mac quand le relais est activé)
    if (request.method === 'POST' && url.pathname === '/setup') {
      const snap = await kvGet(env, 'snapshot');
      if (!snap?.telegramToken) return json({ error: 'pas de configuration' }, 409);
      const hook = `${url.origin}/tg`;
      const res = await fetch(`https://api.telegram.org/bot${snap.telegramToken}/setWebhook`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: hook, secret_token: env.RELAY_SECRET, allowed_updates: ['message'], drop_pending_updates: false }),
      }).then((r) => r.json()).catch(() => ({}));
      return json({ ok: Boolean(res.ok), webhook: hook, telegram: res.description || res.result });
    }
    return json({ error: 'introuvable' }, 404);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runOnce(env).catch(() => {}));
  },
};
