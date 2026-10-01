import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { BOT_TAG } from './messages.js';
import { log } from './logger.js';

const API = 'https://api.telegram.org';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const COMMANDS = [
  ['aide', 'Ce que je sais faire'],
  ['planning', 'Mes créneaux du jour'],
  ['demain', 'Mes créneaux de demain'],
  ['semaine', 'Les 7 prochains jours'],
  ['statut', 'Où on en est'],
  ['fait', "J'ai signé moi-même"],
  ['pause', 'Couper les rappels'],
  ['reprendre', 'Relancer les rappels'],
  ['test', 'Tester la connexion SoWeSoft'],
];

/**
 * Canal Telegram (bot officiel, API HTTP en « long polling » : pas besoin d'adresse publique).
 *
 * Sécurité : n'importe qui peut trouver un bot Telegram. Le bot ne répond donc qu'à la personne
 * qui l'a relié avec le code affiché dans l'appli (lien t.me/<bot>?start=<code>), mémorisée
 * dans data/telegram.json.
 *
 * state.status : off (pas de token) → starting → waiting_link (bot prêt, pas encore relié) → ready
 *                + error (token invalide, autre instance…)
 */
export function createTelegram({ dataDir, onMessage, onReady, members = null, onMemberMessage, onMemberLinked, fetchImpl = fetch, pollTimeout = 50 }) {
  const file = join(dataDir, 'telegram.json');
  const saved = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  const state = {
    status: 'off', username: null, error: null,
    owner: saved.owner || null, // { chatId, name }
    linkCode: randomBytes(4).toString('hex'),
  };
  let token = null;
  let generation = 0; // change à chaque (re)démarrage : arrête l'ancienne boucle
  let offset = 0;

  const persist = () => writeFileSync(file, JSON.stringify({ owner: state.owner }, null, 2));

  async function call(method, body, { timeoutMs = 20e3 } = {}) {
    const isForm = body instanceof FormData;
    const res = await fetchImpl(`${API}/bot${token}/${method}`, {
      method: 'POST',
      headers: isForm ? undefined : { 'content-type': 'application/json' },
      body: isForm ? body : JSON.stringify(body || {}),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await res.json().catch(() => ({}));
    if (!data.ok) {
      const err = new Error(data.description || `Telegram HTTP ${res.status}`);
      err.code = data.error_code || res.status;
      throw err;
    }
    return data.result;
  }

  /** Envoie un texte (Markdown, avec repli en texte brut si Telegram refuse la mise en forme). */
  async function sendText(chatId, text, extra = {}) {
    try {
      return await call('sendMessage', { chat_id: chatId, text, parse_mode: 'Markdown', disable_web_page_preview: true, ...extra });
    } catch (err) {
      if (err.code !== 400 || !/parse/i.test(err.message)) throw err;
      return call('sendMessage', { chat_id: chatId, text: text.replace(/[*_`]/g, ''), disable_web_page_preview: true, ...extra });
    }
  }

  const ASK_PHONE = { reply_markup: { keyboard: [[{ text: '📱 Partager mon numéro', request_contact: true }]], resize_keyboard: true, one_time_keyboard: true } };
  const NO_KEYBOARD = { reply_markup: { remove_keyboard: true } };

  /** Message vers un membre de la classe (par son chat Telegram). */
  async function sendTo(chatId, text) {
    const clean = text.startsWith(BOT_TAG) ? text.slice(BOT_TAG.length).trimStart() : text;
    return sendText(chatId, clean);
  }

  async function linkMember(member, chatId, name) {
    members.link(member, chatId, name);
    log.info(`Telegram : ${member.name} a rejoint les rappels`);
    await onMemberLinked?.(member);
  }

  async function sendPhoto(chatId, caption, imagePath) {
    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('caption', caption.slice(0, 1000));
    form.append('parse_mode', 'Markdown');
    form.append('photo', new Blob([await readFile(imagePath)], { type: 'image/png' }), basename(imagePath));
    try {
      return await call('sendPhoto', form, { timeoutMs: 60e3 });
    } catch (err) {
      if (err.code !== 400) throw err;
      await sendText(chatId, caption); // capture refusée : on envoie au moins le texte
    }
  }

  /** Message vers la personne reliée (même signature que le canal WhatsApp). */
  async function send(text, imagePath) {
    if (state.status !== 'ready' || !state.owner) {
      log.warn('Telegram pas encore relié, message non envoyé');
      return;
    }
    const clean = text.startsWith(BOT_TAG) ? text.slice(BOT_TAG.length).trimStart() : text;
    if (imagePath) await sendPhoto(state.owner.chatId, clean, imagePath);
    else await sendText(state.owner.chatId, clean);
  }

  async function handleUpdate(update) {
    const m = update.message;
    if (!m || m.chat?.type !== 'private') return;
    const chatId = m.chat.id;
    const name = [m.from?.first_name, m.from?.last_name].filter(Boolean).join(' ') || m.from?.username || 'toi';

    // Un camarade partage son numéro : on l'inscrit s'il est dans la liste de l'admin.
    // On vérifie que c'est bien SON numéro (Telegram indique à qui appartient le contact partagé).
    if (m.contact) {
      if (!members) return;
      if (m.contact.user_id !== m.from?.id) {
        return sendText(chatId, '🔒 Partage *ton* numéro avec le bouton ci-dessous, pas celui de quelqu’un d’autre.', ASK_PHONE).catch(() => {});
      }
      const member = members.byPhone(m.contact.phone_number);
      if (!member) {
        return sendText(chatId, '🙈 Ton numéro n’est pas dans la liste. Demande à la personne qui gère LinkeD de t’ajouter, puis réessaie.', ASK_PHONE).catch(() => {});
      }
      await sendText(chatId, '✅ Numéro vérifié !', NO_KEYBOARD).catch(() => {});
      return linkMember(member, chatId, name);
    }

    if (!m.text) return;
    const text = m.text.trim();

    // Liaison : /start <code> (lien de l'appli) ou le code collé tel quel
    const start = /^\/start(?:@\w+)?\s*(\S*)/i.exec(text);
    const given = start ? start[1] : text;
    if (given && given.toLowerCase() === state.linkCode) {
      state.owner = { chatId, name };
      state.linkCode = randomBytes(4).toString('hex');
      persist();
      setState({ status: 'ready', error: null });
      log.info(`Telegram relié à ${name}`);
      onReady?.();
      return;
    }

    // Lien d'invitation personnel d'un camarade
    const invited = members?.byInvite(given);
    if (invited) return linkMember(invited, chatId, name);

    if (!state.owner || state.owner.chatId !== chatId) {
      const member = members?.byChat(chatId);
      if (member) {
        const cmd = text.replace(/^\/([a-z]+)(?:@\w+)?/i, '$1');
        return onMemberMessage?.(member, start ? 'aide' : cmd);
      }
      if (members && state.owner) {
        return sendText(chatId, '👋 *LinkeD* rappelle à ta classe de signer sur SoWeSoft.\nPour recevoir les rappels, appuie sur le bouton : je vérifie que ton numéro est dans la liste.', ASK_PHONE).catch(() => {});
      }
      await sendText(chatId, state.owner
        ? '🔒 Ce bot est privé.'
        : '👋 Pour me relier, ouvre l’app LinkeD → Réglages → *Relier Telegram*.').catch(() => {});
      return;
    }

    if (start) return onReady?.(); // /start sans code : on renvoie juste le message d'accueil
    // « /planning » ou « /planning@LinkedBot » → « planning »
    await onMessage(text.replace(/^\/([a-z]+)(?:@\w+)?/i, '$1'));
  }

  function setState(patch) {
    Object.assign(state, patch);
  }

  async function loop(gen) {
    let backoff = 2000;
    while (gen === generation) {
      try {
        const updates = await call('getUpdates', { offset, timeout: pollTimeout, allowed_updates: ['message'] }, { timeoutMs: (pollTimeout + 15) * 1000 });
        backoff = 2000;
        for (const u of updates) {
          offset = u.update_id + 1;
          await handleUpdate(u).catch((e) => log.error('Telegram : erreur en traitant un message :', e));
        }
      } catch (err) {
        if (gen !== generation) return;
        if (err.code === 401 || err.code === 404) {
          setState({ status: 'error', error: 'Token refusé par Telegram : recopie-le depuis @BotFather' });
          return;
        }
        if (err.code === 409) setState({ error: 'Un autre programme utilise déjà ce bot (LinkeD tourne deux fois ?)' });
        log.warn(`Telegram : ${err.message}, nouvel essai dans ${backoff / 1000} s`);
        await sleep(backoff);
        backoff = Math.min(backoff * 2, 60e3);
      }
    }
  }

  /** (Re)démarre avec ce token. Sans token : canal éteint. */
  async function start(newToken) {
    generation++;
    token = newToken || null;
    if (!token) return setState({ status: 'off', username: null, error: null });
    const gen = generation;
    setState({ status: 'starting', error: null });
    try {
      const me = await call('getMe');
      await call('deleteWebhook', {}).catch(() => {});
      await call('setMyCommands', { commands: COMMANDS.map(([command, description]) => ({ command, description })) }).catch(() => {});
      if (gen !== generation) return;
      setState({ username: me.username, status: state.owner ? 'ready' : 'waiting_link' });
      log.info(`Telegram : bot @${me.username} ${state.owner ? `relié à ${state.owner.name}` : 'en attente de liaison'}`);
      if (state.owner) onReady?.();
      loop(gen);
    } catch (err) {
      if (gen !== generation) return;
      const bad = err.code === 401 || err.code === 404;
      setState({ status: 'error', error: bad ? 'Token refusé par Telegram : recopie-le depuis @BotFather' : `Telegram injoignable (${err.message})` });
      if (!bad) setTimeout(() => gen === generation && start(token), 30e3);
    }
  }

  function stop() {
    generation++;
  }

  /** Oublie la personne reliée (pour relier un autre compte Telegram). */
  function unlink() {
    state.owner = null;
    state.linkCode = randomBytes(4).toString('hex');
    persist();
    if (state.status === 'ready') setState({ status: 'waiting_link' });
  }

  const linkUrl = () => (state.username ? `https://t.me/${state.username}?start=${state.linkCode}` : null);

  const inviteUrl = (member) => (state.username ? `https://t.me/${state.username}?start=${member.inviteCode}` : null);
  const botUrl = () => (state.username ? `https://t.me/${state.username}` : null);

  return { state, send, sendTo, start, stop, unlink, linkUrl, inviteUrl, botUrl, handleUpdate };
}
