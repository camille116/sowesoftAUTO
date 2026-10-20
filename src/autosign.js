import { normalize } from './planning/course.js';

/**
 * Cours signés automatiquement (sans code) : l'autonomie (pas de salle, travail en autonomie).
 * Les cours en présentiel (ex. projet pro for good) ne sont pas signés tout seuls : ce serait
 * déclarer une présence en salle sans aucune vérification.
 */
export const DEFAULT_AUTOSIGN_KEYWORDS = ['autonomie'];

/** Le cours fait-il partie de ceux qu'on signe tout seul ? (type, matière ou titre) */
export function isAutoSignCourse(course, keywords = DEFAULT_AUTOSIGN_KEYWORDS) {
  const hay = normalize([course?.type, course?.subject, course?.title].filter(Boolean).join(' '));
  return keywords.some((k) => hay.includes(normalize(k)));
}

/** Le cours à signer automatiquement en ce moment, parmi TOUS les cours du jour (pas seulement les notifiés). */
export async function currentAutoSignCourse(planning, now = new Date(), keywords = DEFAULT_AUTOSIGN_KEYWORDS) {
  const all = await planning.allDay(now);
  return all.find((c) => c.start <= now && c.end > now && isAutoSignCourse(c, keywords)) || null;
}
