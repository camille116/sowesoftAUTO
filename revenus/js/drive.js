// Google Drive : connexion (Google Identity Services) et envoi des fichiers.
// Portée « drive.file » : l'app ne voit que les fichiers qu'elle a créés elle-même.
// Pas de serveur : le jeton vit en mémoire (1 h) puis est redemandé à Google.

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const GIS_SRC = 'https://accounts.google.com/gsi/client';
const API = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const IDS_KEY = 'revenus.drive.files';

export const FILES = {
  xlsx: { name: 'Revenus.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  data: { name: 'revenus-donnees.json', mime: 'application/json' },
};

let token = null; // { value, expiresAt }
let tokenClient = null;
let clientIdInUse = '';

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (globalThis.google?.accounts?.oauth2) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Impossible de joindre Google.'));
    document.head.append(s);
  });
}

export const isConnected = () => Boolean(token && token.expiresAt > Date.now() + 30_000);

/**
 * Demande un jeton. interactive=true : à appeler depuis un clic (ouvre la fenêtre Google).
 * interactive=false : renouvellement silencieux, échoue sans rien afficher si Google veut un clic.
 */
export async function connect(clientId, { interactive = true } = {}) {
  if (!clientId) throw new Error('Identifiant client Google manquant.');
  await loadScript(GIS_SRC);
  if (!tokenClient || clientIdInUse !== clientId) {
    tokenClient = google.accounts.oauth2.initTokenClient({ client_id: clientId, scope: SCOPE, callback: () => {} });
    clientIdInUse = clientId;
  }
  return new Promise((resolve, reject) => {
    tokenClient.callback = (res) => {
      if (res.error) return reject(new Error(res.error_description || res.error));
      token = { value: res.access_token, expiresAt: Date.now() + Number(res.expires_in || 3600) * 1000 };
      resolve(token);
    };
    tokenClient.error_callback = (err) => reject(new Error(err?.type === 'popup_closed' ? 'Connexion annulée.' : 'Connexion Google impossible.'));
    tokenClient.requestAccessToken({ prompt: interactive ? '' : 'none' });
  });
}

export function disconnect() {
  if (token && globalThis.google?.accounts?.oauth2) google.accounts.oauth2.revoke(token.value, () => {});
  token = null;
}

function ids() {
  try { return JSON.parse(localStorage.getItem(IDS_KEY) || '{}'); } catch { return {}; }
}
function rememberId(kind, id) {
  try { localStorage.setItem(IDS_KEY, JSON.stringify({ ...ids(), [kind]: id })); } catch { /* stockage bloqué */ }
}

async function call(url, init = {}) {
  if (!isConnected()) throw Object.assign(new Error('Session Google expirée.'), { code: 'auth' });
  const res = await fetch(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token.value}` } });
  if (res.status === 401) {
    token = null;
    throw Object.assign(new Error('Session Google expirée.'), { code: 'auth' });
  }
  if (!res.ok) throw Object.assign(new Error(`Drive a répondu ${res.status}.`), { code: res.status });
  return res;
}

/** Retrouve le fichier de l'app (id mémorisé, sinon recherche par nom parmi ses propres fichiers). */
async function findFile(kind) {
  const known = ids()[kind];
  if (known) return known;
  const q = encodeURIComponent(`name = '${FILES[kind].name}' and trashed = false`);
  const res = await call(`${API}?q=${q}&fields=files(id,modifiedTime)&orderBy=modifiedTime desc&pageSize=1`);
  const id = (await res.json()).files?.[0]?.id || null;
  if (id) rememberId(kind, id);
  return id;
}

/** Crée ou remplace le fichier. Renvoie son id. */
export async function upload(kind, body) {
  const { name, mime } = FILES[kind];
  const put = async (id) => {
    if (id) {
      await call(`${UPLOAD}/${id}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': mime }, body });
      return id;
    }
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify({ name, mimeType: mime })], { type: 'application/json' }));
    form.append('file', new Blob([body], { type: mime }));
    const res = await call(`${UPLOAD}?uploadType=multipart&fields=id`, { method: 'POST', body: form });
    const created = (await res.json()).id;
    rememberId(kind, created);
    return created;
  };
  const id = await findFile(kind);
  try {
    return await put(id);
  } catch (err) {
    if (id && err.code === 404) { // fichier supprimé dans Drive : on le recrée
      rememberId(kind, null);
      return put(null);
    }
    throw err;
  }
}

/** Lit les données synchronisées, ou null si aucun fichier. */
export async function readData() {
  const id = await findFile('data');
  if (!id) return null;
  try {
    const res = await call(`${API}/${id}?alt=media`);
    return await res.json();
  } catch (err) {
    if (err.code === 404) { rememberId('data', null); return null; }
    throw err;
  }
}

export const fileLink = (kind) => (ids()[kind] ? `https://drive.google.com/file/d/${ids()[kind]}/view` : null);
