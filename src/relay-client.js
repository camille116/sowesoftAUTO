import { log } from './logger.js';

const PUSH_MS = 15e3; // toutes les 15 s : récupère vite les codes à signer mis en file par le cloud

/**
 * Côté Mac : pousse régulièrement l'état (planning, réglages, membres) vers le relais cloud,
 * pour qu'il prenne le relais des rappels quand le Mac est éteint. Récupère aussi ce que le relais
 * a déjà envoyé, pour ne pas envoyer de doublon au retour du Mac.
 */
export function createRelayClient({ settings, store, members, telegram, onCode = null, fetchImpl = fetch }) {
  let timer = null;

  const config = () => {
    const s = settings.get();
    return { url: (s.relayUrl || '').replace(/\/+$/, ''), secret: s.relaySecret || '' };
  };

  /** Rappels déjà envoyés par le Mac : { 'chatId:sessionId': index }. */
  function reminded() {
    const out = {};
    const owner = telegram?.state?.owner?.chatId;
    if (owner) for (const [id, st] of Object.entries(store.state.sessions)) {
      if (st.reminderIndex != null) out[`${owner}:${id}`] = st.reminderIndex;
    }
    for (const m of members?.all() || []) {
      if (!m.chatId) continue;
      for (const [id, st] of Object.entries(m.sessions || {})) {
        if (st.reminderIndex != null) out[`${m.chatId}:${id}`] = st.reminderIndex;
      }
    }
    return out;
  }

  function snapshot() {
    const s = settings.get();
    const owner = telegram?.state?.owner?.chatId || null;
    const done = {};
    for (const [id, st] of Object.entries(store.state.sessions)) if (st.signedAt || st.skipped) done[id] = true;
    return {
      icsUrl: s.icsUrl,
      keywords: s.keywords,
      notify: s.notify,
      offsets: s.reminderOffsets,
      memberTemplate: s.memberTemplate,
      telegramToken: s.telegramToken || null,
      paused: store.paused,
      owner: owner ? { chatId: owner, done } : null,
      members: (members?.all() || []).map((m) => ({
        id: m.id, name: m.name, phone: m.phone, chatId: m.chatId, status: m.status, inviteCode: m.inviteCode,
        done: Object.fromEntries(Object.entries(m.sessions || {}).filter(([, st]) => st.done).map(([id]) => [id, true])),
      })),
      reminded: reminded(),
    };
  }

  /** Applique les index « déjà envoyé » du relais sur l'état du Mac (anti-doublon au redémarrage). */
  function mergeSent(sent) {
    const owner = telegram?.state?.owner?.chatId;
    for (const [key, index] of Object.entries(sent || {})) {
      const [chat, sessionId] = key.split(':');
      if (owner && String(owner) === chat) {
        const cur = store.session(sessionId).reminderIndex ?? -1;
        if (index > cur) store.update(sessionId, { reminderIndex: index });
      } else {
        const member = members?.all().find((m) => String(m.chatId) === chat);
        if (member) {
          const cur = member.sessions?.[sessionId]?.reminderIndex ?? -1;
          if (index > cur) members.markReminded(member, sessionId, index);
        }
      }
    }
  }

  /** Applique ce que le cloud a changé (commandes reçues Mac éteint). */
  function applyOverrides(ov) {
    if (!ov) return;
    if (ov.paused != null && ov.paused !== store.paused) store.setPaused(ov.paused);
    for (const [id] of Object.entries(ov.ownerDone || {})) if (!store.isDone(id)) store.markSigned(id, 'cloud');
    for (const [mid, patch] of Object.entries(ov.members || {})) {
      const m = members?.get?.(mid) || members?.all().find((x) => x.id === mid);
      if (!m) continue;
      if (patch.chatId && m.chatId !== patch.chatId) members.link(m, patch.chatId, patch.telegramName || m.name);
      if (patch.status && patch.status !== m.status) members.setPaused(m, patch.status === 'paused');
      for (const [sid] of Object.entries(patch.done || {})) if (!m.sessions?.[sid]?.done) members.markDone(m, sid);
    }
  }

  /** Signe les codes mis en file par le cloud (envoyés par toi Mac allumé). */
  async function processCodes(queue) {
    for (const item of queue || []) {
      try { await onCode?.(item.code); } catch (err) { log.warn(`Code ${item.code} : ${err.message}`); }
    }
  }

  async function push() {
    const { url, secret } = config();
    if (!url || !secret) return;
    try {
      const res = await fetchImpl(`${url}/push`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
        body: JSON.stringify(snapshot()),
        signal: AbortSignal.timeout(15e3),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { sent, overrides, codeQueue } = await res.json();
      mergeSent(sent);
      applyOverrides(overrides);
      await processCodes(codeQueue);
    } catch (err) {
      log.warn(`Relais cloud injoignable : ${err.message}`);
    }
  }

  /** Vérifie l'URL/secret saisis dans l'app (bouton « Tester »). */
  async function test(url, secret) {
    const base = (url || '').replace(/\/+$/, '');
    const res = await fetchImpl(`${base}/push`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
      body: JSON.stringify(snapshot()),
      signal: AbortSignal.timeout(15e3),
    });
    if (res.status === 401) throw new Error('Clé du relais incorrecte');
    if (!res.ok) throw new Error(`Relais injoignable (HTTP ${res.status})`);
    return true;
  }

  async function testReminder() {
    const { url, secret } = config();
    if (!url || !secret) throw new Error('Configure d’abord l’URL et la clé du relais');
    await push(); // s'assure que le relais a la config la plus récente
    const res = await fetchImpl(`${url}/test-reminder`, {
      method: 'POST', headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(20e3),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) throw new Error('Clé du relais incorrecte');
    if (res.status === 409) throw new Error(data.error || 'Clique d’abord sur Activer');
    if (!res.ok) throw new Error(`Relais injoignable (HTTP ${res.status})`);
    return data;
  }

  /** Demande au relais d'enregistrer le webhook Telegram (le cloud reçoit les messages). */
  async function setupWebhook() {
    const { url, secret } = config();
    if (!url || !secret) return { ok: false };
    await push(); // le relais a besoin du token avant d'enregistrer le webhook
    const res = await fetchImpl(`${url}/setup`, { method: 'POST', headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(20e3) });
    return res.json().catch(() => ({ ok: false }));
  }

  const isConfigured = () => { const { url, secret } = config(); return Boolean(url && secret); };

  return {
    snapshot,
    test,
    testReminder,
    setupWebhook,
    isConfigured,
    push,
    start() {
      clearInterval(timer);
      push();
      timer = setInterval(push, PUSH_MS);
      timer.unref?.();
    },
  };
}
