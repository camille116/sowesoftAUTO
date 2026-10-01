import { log } from './logger.js';

const PUSH_MS = 60e3;

/**
 * Côté Mac : pousse régulièrement l'état (planning, réglages, membres) vers le relais cloud,
 * pour qu'il prenne le relais des rappels quand le Mac est éteint. Récupère aussi ce que le relais
 * a déjà envoyé, pour ne pas envoyer de doublon au retour du Mac.
 */
export function createRelayClient({ settings, store, members, telegram, fetchImpl = fetch }) {
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
      members: (members?.all() || []).filter((m) => m.chatId).map((m) => ({
        id: m.id, name: m.name, chatId: m.chatId, status: m.status,
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
      const { sent } = await res.json();
      mergeSent(sent);
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

  return {
    snapshot,
    test,
    push,
    start() {
      clearInterval(timer);
      push();
      timer = setInterval(push, PUSH_MS);
      timer.unref?.();
    },
  };
}
