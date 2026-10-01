/**
 * Cœur du relais cloud, pur et testable : à partir d'un « snapshot » envoyé par le Mac
 * (planning, réglages, membres) et de l'état déjà envoyé, calcule les rappels à envoyer.
 * Aucune dépendance à Cloudflare, Telegram ou au réseau : le worker branche tout autour.
 */
import { coursesFromLite, parseIcsLite } from '../planning/ics-lite.js';
import { selectCourses } from '../planning/course.js';
import { dueReminders } from '../reminders.js';
import { msg, renderTemplate } from '../messages.js';

const store = (done, indices, key) => ({
  isDone: (id) => Boolean(done[id]),
  session: (id) => ({ reminderIndex: indices[`${key}:${id}`] ?? -1 }),
});

/**
 * @param snapshot état poussé par le Mac
 * @param sent     { 'chatId:sessionId': reminderIndex } déjà envoyés par le relais
 * @param icsText  contenu iCal (téléchargé par le worker)
 * @param now      instant courant
 * @returns { actions: [{ chatId, text, key }], sentUpdates: { key: index } }
 */
export function computeReminders(snapshot, sent, icsText, now = new Date()) {
  const offsets = (snapshot.offsets || [-5, 0, 15, 45]).slice().sort((a, b) => a - b);
  const from = new Date(now.getTime() - 12 * 3600e3);
  const to = new Date(now.getTime() + 3600e3);

  let courses = [];
  try {
    courses = coursesFromLite(parseIcsLite(icsText), from, to);
  } catch {
    return { actions: [], sentUpdates: {} };
  }
  const toSign = selectCourses(courses, snapshot.notify || { mode: 'auto' }, snapshot.keywords || []);
  if (!toSign.length) return { actions: [], sentUpdates: {} };

  const actions = [];
  const sentUpdates = {};

  const add = (chatId, done, text) => {
    const key = String(chatId);
    for (const r of dueReminders(toSign, store(done, sent, key), offsets, now)) {
      actions.push({ chatId, key: `${key}:${r.session.id}`, text: text(r) });
      sentUpdates[`${key}:${r.session.id}`] = r.index;
    }
  };

  if (snapshot.owner?.chatId && !snapshot.paused) {
    add(snapshot.owner.chatId, snapshot.owner.done || {}, (r) =>
      msg.reminder({ session: r.session, offset: r.offset, isLast: r.isLast }).replace(/^🤖\s*/, ''));
  }
  for (const m of snapshot.members || []) {
    if (m.status !== 'active' || !m.chatId) continue;
    add(m.chatId, m.done || {}, (r) =>
      renderTemplate(snapshot.memberTemplate, { member: m, session: r.session, offset: r.offset }));
  }
  return { actions, sentUpdates };
}
