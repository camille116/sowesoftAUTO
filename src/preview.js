/**
 * Affiche dans le terminal les créneaux d'autonomie détectés pour les 7 prochains jours,
 * sans lancer WhatsApp. Pratique pour vérifier ICS_URL et AUTONOMY_KEYWORDS.
 *   npm run planning
 */
import { config } from './config.js';
import { Planning } from './planning/index.js';

const planning = new Planning(config.planning);
const now = new Date();
const sessions = await planning.between(now, new Date(now.getTime() + 7 * 24 * 3600e3));

if (!sessions.length) console.log('Aucun créneau d’autonomie trouvé sur 7 jours.');
for (const s of sessions) {
  console.log(`${s.start.toLocaleString('fr-FR')} → ${s.end.toLocaleTimeString('fr-FR')}  [${s.source}]  ${s.title}`);
}
