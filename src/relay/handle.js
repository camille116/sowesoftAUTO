/**
 * Cerveau du relais pour les messages ENTRANTS (webhook Telegram), pur et testable.
 * Permet à /demain, /planning, /statut, fait, stop, ignore… de marcher même Mac éteint.
 *
 * Il NE signe pas (pas d'accès SoWeSoft) : un code à 5 chiffres est mis en file pour le Mac
 * s'il est en ligne, sinon on répond d'aller signer soi-même sur l'appli SoWeSoft.
 *
 * Entrées :
 *  - snapshot   : envoyé par le Mac (réglages, owner {chatId}, members [{id,name,phone,chatId,status,inviteCode}])
 *  - overrides  : état accumulé par le relais ({ paused, ownerDone:{}, members:{id:{status,done,chatId,telegramName}} })
 *  - coursesToday / coursesTomorrow : tous les cours du jour / de demain (lus depuis l'agenda par le worker)
 *  - macOnline  : le Mac a-t-il donné signe de vie récemment (pour la signature)
 * Sortie : { replies:[{chatId,text}], overrides, signCode:{code}|null }
 */
import { parseCommand } from '../commands.js';
import { msg } from '../messages.js';
import { selectCourses } from '../planning/course.js';

const clone = (o) => JSON.parse(JSON.stringify(o || {}));

function mergedMembers(snapshot, overrides) {
  return (snapshot.members || []).map((base) => {
    const o = overrides.members?.[base.id] || {};
    return { ...base, ...o, done: { ...(base.done || {}), ...(o.done || {}) } };
  });
}

const toSign = (snapshot, courses) => selectCourses(courses, snapshot.notify || { mode: 'auto' }, snapshot.keywords || []);
const currentOf = (list, now) => list.find((c) => c.start <= now && c.end >= now) || null;
const fullDay = (label, all, signSet, isDone) => msg.fullDay(label, all, new Set(all.filter((c) => signSet.has(c.id)).map((c) => c.id)), isDone);

export function relayHandle({ update, snapshot, overrides = {}, coursesToday = [], coursesTomorrow = [], macOnline = false, now = new Date() }) {
  const next = clone(overrides);
  next.members ||= {};
  next.ownerDone ||= {};
  const replies = [];
  let signCode = null;
  const reply = (chatId, text) => replies.push({ chatId, text });

  const message = { chat: {}, from: {}, ...(update?.message || {}) };
  const chatId = message.chat?.id;
  if (!chatId) return { replies, overrides: next, signCode };
  const name = [message.from?.first_name, message.from?.last_name].filter(Boolean).join(' ') || 'toi';

  const dayLabel = (d) => d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: globalThis.process?.env?.TZ || 'Europe/Paris' });
  const signToday = toSign(snapshot, coursesToday);
  const signTomorrow = toSign(snapshot, coursesTomorrow);

  // ── Un camarade partage son numéro ──
  if (message.contact) {
    const list = mergedMembers(snapshot, next);
    if (message.contact.user_id && message.contact.user_id !== message.from?.id) {
      reply(chatId, '🔒 Partage *ton* numéro avec le bouton, pas celui de quelqu’un d’autre.');
      return { replies, overrides: next, signCode };
    }
    const digits = String(message.contact.phone_number || '').replace(/\D/g, '').replace(/^0(\d{9})$/, '33$1');
    const member = list.find((x) => x.phone && x.phone.replace(/\D/g, '') === digits);
    if (!member) { reply(chatId, '🙈 Ton numéro n’est pas dans la liste. Demande à la personne qui gère LinkeD de t’ajouter.'); return { replies, overrides: next, signCode }; }
    next.members[member.id] = { ...next.members[member.id], chatId, telegramName: name, status: 'active' };
    reply(chatId, msg.memberWelcome(member).replace(/^🤖\s*/, ''));
    return { replies, overrides: next, signCode };
  }

  const raw = String(message.text || '').trim();
  if (!raw) return { replies, overrides: next, signCode };
  const start = /^\/start(?:@\w+)?\s*(\S*)/i.exec(raw);
  const given = start ? start[1] : '';

  // Liaison par lien d'invitation
  if (given) {
    const member = mergedMembers(snapshot, next).find((x) => x.inviteCode && x.inviteCode === given.toLowerCase());
    if (member) {
      next.members[member.id] = { ...next.members[member.id], chatId, telegramName: name, status: 'active' };
      reply(chatId, msg.memberWelcome(member).replace(/^🤖\s*/, ''));
      return { replies, overrides: next, signCode };
    }
  }

  const cmd = parseCommand(raw.replace(/^\/([a-z]+)(?:@\w+)?/i, '$1'));
  const isOwner = snapshot.owner?.chatId && chatId === snapshot.owner.chatId;
  const member = mergedMembers(snapshot, next).find((x) => x.chatId === chatId);

  // ── Inconnu ──
  if (!isOwner && !member) {
    reply(chatId, snapshot.members?.length
      ? '👋 *LinkeD* rappelle à ta classe de signer. Pour recevoir les rappels, partage ton numéro (bouton) ou ouvre ton lien d’invitation.'
      : '🔒 Ce bot est privé.');
    return { replies, overrides: next, signCode };
  }

  // ── Propriétaire (admin) ──
  if (isOwner) {
    const paused = next.paused ?? snapshot.paused ?? false;
    const isDone = (id) => Boolean(next.ownerDone[id] || snapshot.owner?.done?.[id]);
    switch (cmd.type) {
      case 'sign':
        if (!macOnline) { reply(chatId, '💤 Ton Mac est éteint, je ne peux pas signer à distance. Signe sur l’appli SoWeSoft, puis réponds *fait*.'); break; }
        signCode = { code: cmd.code };
        reply(chatId, `✍️ Code *${cmd.code}* transmis à ton Mac, je signe… (quelques secondes)`);
        break;
      case 'today': reply(chatId, fullDay(`Aujourd'hui – ${dayLabel(now)}`, coursesToday, new Set(signToday.map((c) => c.id)), isDone).replace(/^🤖\s*/, '')); break;
      case 'tomorrow': { const d = new Date(now.getTime() + 864e5); reply(chatId, fullDay(`Demain – ${dayLabel(d)}`, coursesTomorrow, new Set(signTomorrow.map((c) => c.id)), isDone).replace(/^🤖\s*/, '')); break; }
      case 'done': { const c = currentOf(signToday, now); if (!c) { reply(chatId, 'Aucun créneau à signer en ce moment.'); break; } next.ownerDone[c.id] = true; reply(chatId, `👍 Noté pour ${c.subject || c.title}, plus de rappel.`); break; }
      case 'pause': next.paused = true; reply(chatId, '⏸️ Rappels en pause. Tape *reprendre* pour les relancer.'); break;
      case 'resume': next.paused = false; reply(chatId, '▶️ C’est reparti.'); break;
      case 'status': { const c = currentOf(signToday, now); reply(chatId, `*Statut* (via le cloud)\nRappels : ${(next.paused ?? paused) ? '⏸️ en pause' : '▶️ actifs'}\nEn cours : ${c ? `${c.subject || c.title} ${isDone(c.id) ? '✅' : '⬜ à signer'}` : '—'}`); break; }
      case 'help': reply(chatId, 'Je réponds même Mac éteint :\n• *planning* / *demain* : tes cours (salle, campus)\n• *fait* : tu as signé\n• *pause* / *reprendre*\n• un *code* à 5 chiffres : je signe si ton Mac est allumé'); break;
      default: reply(chatId, 'Je n’ai pas compris 🤔 Tape *aide*, *planning*, *demain*, ou envoie un *code*.');
    }
    return { replies, overrides: next, signCode };
  }

  // ── Membre de la classe (rappels seulement) ──
  const isDoneM = (id) => Boolean(next.members[member.id]?.done?.[id] || member.done?.[id]);
  const setMember = (patch) => { next.members[member.id] = { ...next.members[member.id], ...patch }; };
  switch (cmd.type) {
    case 'today': reply(chatId, fullDay(`Aujourd'hui – ${dayLabel(now)}`, coursesToday, new Set(signToday.map((c) => c.id)), isDoneM)); break;
    case 'tomorrow': { const d = new Date(now.getTime() + 864e5); reply(chatId, fullDay(`Demain – ${dayLabel(d)}`, coursesTomorrow, new Set(signTomorrow.map((c) => c.id)), isDoneM)); break; }
    case 'done': { const c = currentOf(signToday, now); if (!c) { reply(chatId, msg.memberNoCurrent()); break; } setMember({ done: { ...next.members[member.id]?.done, [c.id]: true } }); reply(chatId, msg.memberDone(c)); break; }
    case 'pause': setMember({ status: 'paused' }); reply(chatId, msg.memberPaused()); break;
    case 'resume': setMember({ status: 'active' }); reply(chatId, msg.memberResumed()); break;
    case 'sign': reply(chatId, msg.memberNoSign()); break;
    default: reply(chatId, msg.memberHelp());
  }
  return { replies, overrides: next, signCode };
}

/** Fusionne les overrides du relais dans le snapshot (pour les rappels : pause, créneaux signés, liaisons). */
export function applyOverrides(snapshot, overrides = {}) {
  const s = clone(snapshot);
  if (overrides.paused != null) s.paused = overrides.paused;
  s.owner = s.owner && { ...s.owner, done: { ...(s.owner.done || {}), ...(overrides.ownerDone || {}) } };
  s.members = (s.members || []).map((base) => {
    const o = overrides.members?.[base.id] || {};
    return { ...base, ...o, done: { ...(base.done || {}), ...(o.done || {}) } };
  });
  return s;
}
