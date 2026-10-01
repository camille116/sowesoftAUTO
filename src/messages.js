/**
 * Ton de marque d'Émile (cf. docs/CADRAGE.md §5) :
 * tutoiement, phrases courtes, une action claire par message, emoji comme repère visuel.
 */
const fmtTime = (d) => d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const fmtDay = (d) => d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

export const BOT_TAG = '🤖';

const slot = (s) => `${fmtTime(s.start)}–${fmtTime(s.end)} · ${s.title}`;

export const msg = {
  welcome: () =>
    `${BOT_TAG} *Émile est en ligne* ✍️\nJe te préviens quand tu dois signer pendant tes heures d'autonomie.\nEnvoie-moi le code de signature et je signe pour toi.\n\nTape *aide* pour voir ce que je sais faire.`,

  help: (dryRun) =>
    `${BOT_TAG} *Ce que je comprends :*\n` +
    `• *4821* ou *code 4821* → je signe avec ce code\n` +
    `• *fait* → tu as signé toi-même, j'arrête de te relancer\n` +
    `• *ignore* → pas besoin de signer ce créneau\n` +
    `• *planning* / *demain* / *semaine* → tes créneaux d'autonomie\n` +
    `• *statut* → où on en est\n` +
    `• *pause* / *reprendre* → couper / relancer les rappels\n` +
    `• *test* → je vérifie la connexion à Sowesoft` +
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
    `${BOT_TAG} 🧪 Mode test : j'ai saisi *${code}* sans valider. Regarde la capture. Passe SIGN_DRY_RUN=false quand tout est bon.`,
  signFailed: (reason) =>
    `${BOT_TAG} ❌ Je n'ai pas réussi à signer : ${reason}\n👉 Signe à la main sur l'appli, puis réponds *fait*. Tu peux aussi me renvoyer le code.`,
  signBusy: () => `${BOT_TAG} ⏳ Je suis déjà en train de signer, une seconde…`,

  markedDone: (session) => `${BOT_TAG} 👍 Noté, plus de rappel pour ${session ? slot(session) : 'ce créneau'}.`,
  skipped: (session) => `${BOT_TAG} 🙈 Ok, j'ignore ${slot(session)}.`,
  noCurrent: () => `${BOT_TAG} Aucun créneau d'autonomie en cours. Tape *planning* pour voir la journée.`,

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
  unknown: () => `${BOT_TAG} Je n'ai pas compris 🤔 Envoie un *code* (ex : 4821) ou tape *aide*.`,
};
