/**
 * Ton de marque de LinkeD (cf. docs/CADRAGE.md §5) :
 * tutoiement, phrases courtes, une action claire par message, emoji comme repère visuel.
 */
const fmtTime = (d) => d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const fmtDay = (d) => d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

export const BOT_TAG = '🤖';

/** Message de rappel envoyé aux membres de la classe (modifiable dans l'app → Classe). */
export const DEFAULT_MEMBER_TEMPLATE =
  '⏰ {prenom}, pense à signer sur SoWeSoft !\n📚 {cours} · {debut}–{fin}\n\nRéponds *fait* quand c\'est signé.';

export const TEMPLATE_VARS = {
  prenom: 'Prénom du membre',
  cours: 'Matière',
  type: 'Type (AUTONOMIE, CRS…)',
  debut: 'Heure de début',
  fin: 'Heure de fin',
  date: 'Jour',
  moment: '« dans 5 min », « maintenant »…',
};

/** Remplace {prenom}, {cours}… dans un modèle de message. */
export function renderTemplate(template, { member, session, offset }) {
  const fmt = (d) => d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const vars = {
    prenom: member?.name || '',
    cours: session?.subject || session?.title || '',
    type: session?.type || '',
    debut: session ? fmt(session.start) : '',
    fin: session ? fmt(session.end) : '',
    date: session ? session.start.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) : '',
    moment: offset == null ? '' : offset < 0 ? `dans ${-offset} min` : offset === 0 ? 'maintenant' : `depuis ${offset} min`,
  };
  return String(template || DEFAULT_MEMBER_TEMPLATE).replace(/\{(\w+)\}/g, (all, key) => (key in vars ? vars[key] : all));
}

const slot = (s) => `${fmtTime(s.start)}–${fmtTime(s.end)} · ${s.subject || s.title}`;

/** « 📍 G006 · Eiffel 4 » (+ autres salles), ou « 🏠 À distance » pour l'autonomie / l'e-learning sans salle. */
export function roomLine(s) {
  if (s.rooms?.length) {
    const [first, ...rest] = s.rooms;
    return `📍 ${first.label}${first.kind ? ` (${first.kind})` : ''}${rest.length ? ` +${rest.length} salle${rest.length > 1 ? 's' : ''}` : ''}`;
  }
  return /AUTONOMIE|ELEARNING|DISTANCIEL/i.test(s.type || s.title) ? '🏠 À distance / pas de salle' : '';
}

/**
 * Journée complète : tous les cours avec salle et campus ; ⬜/✅ sur ceux à signer.
 * `toSign` = ids des cours notifiés, `isDone(id)` = déjà signé.
 */
function fullDay(label, courses, toSign, isDone) {
  if (!courses.length) return `📅 *${label}* : aucun cours. Profite ! 🌿`;
  const campuses = [...new Set(courses.map((c) => c.campus).filter(Boolean))];
  const lines = courses.map((c) => {
    const icon = toSign.has(c.id) ? (isDone(c.id) ? '✅' : '⬜') : '▫️';
    const type = c.type ? ` _${c.type.toLowerCase()}_` : '';
    const room = roomLine(c);
    return `${icon} *${fmtTime(c.start)}–${fmtTime(c.end)}* ${c.subject || c.title}${type}${room ? `\n      ${room}` : ''}`;
  });
  const legend = toSign.size ? '\n\n⬜ à signer · ✅ signé · ▫️ pas de rappel' : '';
  return `📅 *${label}*${campuses.length ? ` · campus ${campuses.join(', ')}` : ''}\n\n${lines.join('\n')}${legend}`;
}

export const msg = {
  welcome: () =>
    `${BOT_TAG} *LinkeD est en ligne* ⚡\nJe te préviens quand tu dois signer pendant tes heures d'autonomie.\nEnvoie-moi le code à 5 chiffres et je signe pour toi.\n\nTape *aide* pour voir ce que je sais faire.`,

  help: (dryRun) =>
    `${BOT_TAG} *Ce que je comprends :*\n` +
    `• *48213* ou *code 48213* → je signe avec ce code\n` +
    `• *fait* → tu as signé toi-même, j'arrête de te relancer\n` +
    `• *ignore* → pas besoin de signer ce créneau\n` +
    `• *planning* / *demain* / *semaine* → tes créneaux d'autonomie\n` +
    `• *statut* → où on en est\n` +
    `• *pause* / *reprendre* → couper / relancer les rappels\n` +
    `• *test* → je vérifie la connexion à SoWeSoft (et je la débloque après une erreur)` +
    (dryRun ? `\n\n🧪 _Mode test actif : je remplis le code mais je ne valide pas._` : ''),

  reminder: ({ session, offset, isLast }) => {
    const head =
      offset < 0 ? `⏰ Dans ${-offset} min : autonomie` :
      offset === 0 ? `✍️ *C'est l'heure de signer !*` :
      isLast ? `🚨 *Dernier rappel* – tu n'as toujours pas signé` :
      `🔔 Petit rappel : signature en attente`;
    return `${BOT_TAG} ${head}\n${slot(session)}\n\n👉 Envoie-moi le *code* et je signe, ou réponds *fait* si c'est déjà fait.`;
  },

  signing: (code) => `${BOT_TAG} Je signe avec le code *${code}*… ⏳`,
  signed: (session) => `${BOT_TAG} ✅ *Signé !*${session ? `\n${slot(session)}` : ''}`,
  dryRun: (code) =>
    `${BOT_TAG} 🧪 Mode test : j'ai tapé *${code.slice(0, -1)}* et je me suis arrêté avant le dernier chiffre. Regarde la capture, puis passe SIGN_DRY_RUN=false quand tout est bon.`,
  alreadySigned: (session) => `${BOT_TAG} ✅ SoWeSoft indique que c'est *déjà signé*.${session ? `\n${slot(session)}` : ''}`,
  signFailed: (reason) =>
    `${BOT_TAG} ❌ Je n'ai pas réussi à signer : ${reason}\n👉 Signe à la main sur l'appli, puis réponds *fait*. Tu peux aussi me renvoyer le code.`,
  signBusy: () => `${BOT_TAG} ⏳ Je suis déjà en train de signer, une seconde…`,

  markedDone: (session) => `${BOT_TAG} 👍 Noté, plus de rappel pour ${session ? slot(session) : 'ce créneau'}.`,
  skipped: (session) => `${BOT_TAG} 🙈 Ok, j'ignore ${slot(session)}.`,
  noCurrent: () => `${BOT_TAG} Aucun créneau d'autonomie en cours. Tape *planning* pour voir la journée.`,

  fullDay: (label, courses, toSign, isDone) => `${BOT_TAG} ${fullDay(label, courses, toSign, isDone)}`,

  day: (label, sessions, store) => {
    if (!sessions.length) return `${BOT_TAG} 📅 ${label} : aucune autonomie. Profite ! 🌿`;
    const lines = sessions.map((s) => {
      const st = store.session(s.id);
      const icon = st.signedAt ? '✅' : st.skipped ? '🙈' : '⬜';
      return `${icon} ${slot(s)}`;
    });
    return `${BOT_TAG} 📅 *${label}*\n${lines.join('\n')}`;
  },

  week: (sessions, store) => {
    if (!sessions.length) return `${BOT_TAG} 📅 Aucune autonomie dans les 7 prochains jours.`;
    const byDay = new Map();
    for (const s of sessions) {
      const key = fmtDay(s.start);
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push(s);
    }
    const blocks = [...byDay].map(([day, list]) =>
      `*${day}*\n${list.map((s) => `${store.isDone(s.id) ? '✅' : '⬜'} ${slot(s)}`).join('\n')}`);
    return `${BOT_TAG} 📅 *Tes 7 prochains jours*\n\n${blocks.join('\n\n')}`;
  },

  status: ({ paused, current, next, dryRun, store }) =>
    `${BOT_TAG} *Statut*\n` +
    `Rappels : ${paused ? '⏸️ en pause' : '▶️ actifs'}\n` +
    `Signature auto : ${dryRun ? '🧪 mode test' : '✅ active'}\n` +
    `En cours : ${current ? `${slot(current)} ${store.isDone(current.id) ? '✅' : '⬜ à signer'}` : '—'}\n` +
    `Prochain : ${next ? `${fmtDay(next.start)} ${slot(next)}` : '—'}`,

  paused: () => `${BOT_TAG} ⏸️ Rappels en pause. Tape *reprendre* pour les relancer.`,
  resumed: () => `${BOT_TAG} ▶️ C'est reparti, je veille sur tes signatures.`,
  testing: () => `${BOT_TAG} 🔌 Je teste la connexion à Sowesoft…`,
  testOk: () => `${BOT_TAG} ✅ Connexion à Sowesoft OK (capture ci-jointe).`,
  testFailed: (reason) => `${BOT_TAG} ❌ Connexion à Sowesoft impossible : ${reason}`,
  testNotification: () =>
    `${BOT_TAG} 🔔 *Notification de test*\nSi tu lis ce message, les rappels de signature arriveront bien ici. 👌\n\nRéponds *aide* pour voir ce que je sais faire.`,
  // ── Membres de la classe (rappels seulement) ──
  memberWelcome: (member) =>
    `👋 Salut ${member.name} ! Tu es inscrit·e aux rappels *LinkeD*.\nJe t'écris quand il faut signer sur SoWeSoft.\n\n• *fait* : tu as signé, j'arrête de te relancer\n• *planning* : les cours du jour\n• *stop* / *reprendre* : couper / relancer les rappels`,
  memberHelp: () =>
    `*LinkeD* t'envoie un rappel quand il faut signer sur SoWeSoft.\n\n• *fait* : tu as signé, j'arrête de te relancer\n• *planning* : les cours du jour\n• *stop* / *reprendre* : couper / relancer les rappels`,
  memberDone: (session) => `👍 Noté${session ? ` pour ${session.subject || session.title}` : ''}, plus de relance.`,
  memberNoCurrent: () => `Aucun cours à signer en ce moment. Tape *planning* pour voir la journée.`,
  memberPaused: () => `⏸️ Rappels coupés. Réponds *reprendre* pour les relancer.`,
  memberResumed: () => `▶️ C'est reparti, je te préviens au prochain cours.`,
  memberNoSign: () => `✍️ Je ne signe pas à ta place : signe sur l'appli SoWeSoft, puis réponds *fait*.`,
  memberTest: (member) => `🔔 Test LinkeD : ${member.name}, tu recevras bien les rappels ici.`,
  memberDay: (label, courses, toSign, isDone) => fullDay(label, courses, toSign, isDone),

  unknown: () => `${BOT_TAG} Je n'ai pas compris 🤔 Envoie un *code* (ex : 48213) ou tape *aide*.`,
};
