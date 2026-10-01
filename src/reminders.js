/**
 * Logique pure des rappels (testable sans WhatsApp).
 *
 * Pour chaque créneau non signé, on regarde le dernier palier (offset) atteint.
 * S'il est plus récent que le dernier rappel envoyé, on envoie UN message
 * (même si le bot a redémarré et a « raté » plusieurs paliers : pas de spam).
 */
export function dueReminders(sessions, store, offsets, now = new Date()) {
  const due = [];
  for (const session of sessions) {
    if (store.isDone(session.id)) continue;
    if (now > session.end) continue;

    let reached = -1;
    offsets.forEach((offset, index) => {
      if (now.getTime() >= session.start.getTime() + offset * 60e3) reached = index;
    });
    if (reached < 0) continue;

    const lastSent = store.session(session.id).reminderIndex ?? -1;
    if (reached > lastSent) {
      due.push({ session, index: reached, offset: offsets[reached], isLast: reached === offsets.length - 1 });
    }
  }
  return due;
}
