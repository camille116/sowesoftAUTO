/**
 * Transforme un message WhatsApp libre en commande.
 * Le bot doit comprendre un message tapé vite, entre deux cours :
 * « 48213 », « code 48213 », « signe 48213 », « c'est fait », « planning »…
 */
const CODE = /^[a-z0-9]{3,8}$/i;

const ALIASES = [
  { type: 'help', words: ['aide', 'help', '?', 'menu', 'commandes'] },
  { type: 'today', words: ['planning', "aujourd'hui", 'aujourdhui', 'auj', 'today', 'programme'] },
  { type: 'tomorrow', words: ['demain', 'tomorrow'] },
  { type: 'week', words: ['semaine', 'week'] },
  { type: 'status', words: ['statut', 'status', 'etat', 'état'] },
  { type: 'done', words: ['fait', "c'est fait", 'cest fait', 'signé', 'signe', 'ok signé', 'deja signe', 'déjà signé', 'done'] },
  { type: 'skip', words: ['ignore', 'ignorer', 'absent', 'pas cours', 'annulé', 'annule', 'skip'] },
  { type: 'pause', words: ['pause', 'stop', 'vacances'] },
  { type: 'resume', words: ['reprendre', 'reprise', 'start', 'resume', 'go'] },
  { type: 'test', words: ['test', 'tester', 'check'] },
];

function clean(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[!.]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const SIGN_STYLES = [
  { style: 'claude', words: ['claude', 'robot', 'logo', 'mascotte'] },
  { style: 'name', words: ['nom', 'name', 'camille', 'redon', 'prenom', 'prénom', 'manuscrit', 'manuscrite'] },
  { style: 'psg', words: ['psg', 'paris', 'foot', 'eiffel'] },
];

/**
 * Cherche un lien SoWeSoft dans un texte et le renvoie nettoyé, sinon null.
 * SÉCURITÉ : on n'accepte que https + le domaine sowesign.com (et ses sous-domaines) : ce lien sera
 * ouvert avec ta session SoWeSoft connectée, on ne doit jamais ouvrir n'importe quelle adresse.
 */
export function sowesignUrl(raw) {
  const m = /https:\/\/[^\s<>"'`]+/i.exec(String(raw || ''));
  if (!m) return null;
  try {
    const url = new URL(m[0].replace(/[.,;:!?)\]]+$/, ''));
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    if (host !== 'sowesign.com' && !host.endsWith('.sowesign.com')) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function parseCommand(raw) {
  // Un lien SoWeSoft (ex. celui d'un QR code) : à vérifier avant tout (le texte nettoyé est en minuscules,
  // or un lien est sensible à la casse).
  const link = sowesignUrl(raw);
  if (link) return { type: 'link', url: link };

  const text = clean(raw);
  if (!text) return { type: 'unknown' };

  // « signature », « signature psg », « signature nom »… : choisir le style de signature tracée
  const sig = text.match(/^signatures?(?:\s+(.*))?$/);
  if (sig) {
    const arg = (sig[1] || '').trim();
    if (!arg) return { type: 'signature' };
    const found = SIGN_STYLES.find((s) => s.words.some((w) => arg.includes(w)));
    return { type: 'signature', style: found ? found.style : null };
  }

  // « code 48213 », « signe 48213 », « signer : 48213 », « sign 48213 »
  const withPrefix = text.match(/^(?:code|signe|signer|sign|emarge|émarge)\s*[:=-]?\s*([a-z0-9 ]{3,12})$/i);
  if (withPrefix) {
    const code = withPrefix[1].replace(/\s/g, '');
    if (CODE.test(code)) return { type: 'sign', code: code.toUpperCase() };
  }

  // Un code seul : 4 à 8 chiffres (on accepte « 48 21 »)
  const digits = text.replace(/\s/g, '');
  if (/^\d{3,8}$/.test(digits)) return { type: 'sign', code: digits };

  for (const { type, words } of ALIASES) {
    if (words.includes(text)) return { type };
  }
  return { type: 'unknown', text };
}
