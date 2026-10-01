import { createHash } from 'node:crypto';

/**
 * Un créneau d'autonomie : { id, title, start: Date, end: Date, source }
 * L'id est stable (dérivé des horaires) pour que l'état « signé » survive aux redémarrages.
 */
export function makeSession({ title, start, end, source }) {
  const id = createHash('sha1')
    .update(`${start.toISOString()}|${end.toISOString()}`)
    .digest('hex')
    .slice(0, 10);
  return { id, title: title || 'Autonomie', start, end, source };
}

/** Fusionne plusieurs listes, supprime les doublons (mêmes horaires) et trie par date. */
export function mergeSessions(...lists) {
  const byId = new Map();
  for (const session of lists.flat()) {
    if (!byId.has(session.id)) byId.set(session.id, session);
  }
  return [...byId.values()].sort((a, b) => a.start - b.start);
}
