// Google Drive : connexion (Google Identity Services) et envoi des fichiers.
// Portée « drive.file » : l'app ne voit que les fichiers qu'elle a créés elle-même.
// Pas de serveur : le jeton vit en mémoire, une heure. Google n'en redonne un que depuis un geste
// de l'utilisateur (clic) : connect() doit donc être appelé directement dans un gestionnaire de clic.

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const GIS_SRC = 'https://accounts.google.com/gsi/client';
const API = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const IDS_KEY = 'revenus.drive.files';
const FOLDER = { name: 'Revenus', mime: 'application/vnd.google-apps.folder' };

export const FILES = {
  xlsx: { name: 'Revenus.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  data: { name: 'revenus-donnees.json', mime: 'application/json' },
};

let token = null; // { value, expiresAt }
let tokenClient = null;
let clientIdInUse = '';
let gisLoading = null;

const fail = (message, code) => Object.assign(new Error(message), { code });
const authError = () => fail('Session Google expirée.', 'auth');

// ---------- Connexion ----------

/** Charge le script Google à l'avance, pour que le clic de connexion ouvre la fenêtre sans délai. */
export function preload() {
  if (globalThis.google?.accounts?.oauth2) return Promise.resolve();
  gisLoading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    s.onload = resolve;
    s.onerror = () => { gisLoading = null; reject(fail('Impossible de joindre Google.', 'network')); };
    document.head.append(s);
  });
  return gisLoading;
}

export const isConnected = () => Boolean(token && token.expiresAt > Date.now() + 30_000);
export const expiresAt = () => (token ? token.expiresAt : 0);

function requestToken(clientId) {
  if (!tokenClient || clientIdInUse !== clientId) {
    tokenClient = google.accounts.oauth2.initTokenClient({ client_id: clientId, scope: SCOPE, callback: () => {} });
    clientIdInUse = clientId;
  }
  return new Promise((resolve, reject) => {
    // Fenêtre Google laissée ouverte sans réponse : on n'attend pas indéfiniment.
    const timer = setTimeout(() => reject(fail('Connexion Google sans réponse.', 'auth')), 120_000);
    tokenClient.callback = (res) => {
      clearTimeout(timer);
      if (res.error) return reject(fail(res.error_description || res.error, 'auth'));
      token = { value: res.access_token, expiresAt: Date.now() + Number(res.expires_in || 3600) * 1000 };
      resolve(token);
    };
    tokenClient.error_callback = (err) => {
      clearTimeout(timer);
      const message = { popup_closed: 'Connexion annulée.', popup_failed_to_open: 'Le navigateur a bloqué la fenêtre Google.' }[err?.type];
      reject(fail(message || 'Connexion Google impossible.', 'auth'));
    };
    // prompt '' : pas d'écran de consentement si l'accès a déjà été accordé.
    tokenClient.requestAccessToken({ prompt: '' });
  });
}

/**
 * Demande un jeton. À appeler depuis un clic : si le script Google est déjà chargé (preload),
 * la fenêtre s'ouvre immédiatement, sinon après son chargement (certains navigateurs la bloquent alors).
 */
export function connect(clientId) {
  if (!clientId) return Promise.reject(fail('Identifiant client Google manquant.', 'auth'));
  if (globalThis.google?.accounts?.oauth2) return requestToken(clientId);
  return preload().then(() => requestToken(clientId));
}

export function disconnect() {
  if (token && globalThis.google?.accounts?.oauth2) google.accounts.oauth2.revoke(token.value, () => {});
  token = null;
}

// ---------- Appels à l'API ----------

function ids() {
  try { return JSON.parse(localStorage.getItem(IDS_KEY) || '{}') || {}; } catch { return {}; }
}
function rememberId(kind, id) {
  try { localStorage.setItem(IDS_KEY, JSON.stringify({ ...ids(), [kind]: id })); } catch { /* stockage bloqué */ }
}

/** Appel JSON à Drive, avec délai maximal. Renvoie le corps décodé (ou null s'il est vide). */
async function request(url, init = {}, { timeout = 30_000 } = {}) {
  if (!isConnected()) throw authError();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal, headers: { ...(init.headers || {}), Authorization: `Bearer ${token.value}` } });
    if (res.status === 401) { token = null; throw authError(); }
    if (!res.ok) throw fail(`Drive a répondu ${res.status}.`, res.status);
    const body = await res.text();
    if (!body) return null;
    try { return JSON.parse(body); } catch { throw fail('Réponse de Drive illisible.', 'parse'); }
  } catch (err) {
    if (err.name === 'AbortError') throw fail('Google Drive ne répond pas.', 'timeout');
    if (err instanceof TypeError) throw fail('Pas de connexion à Google Drive.', 'network');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

const query = (q) => `${API}?q=${encodeURIComponent(q)}&fields=files(id)&orderBy=modifiedTime desc&pageSize=1`;

/** Dossier « Revenus » du Drive : retrouvé, sinon créé. Un dossier mis à la corbeille est remplacé. */
async function folderId() {
  const known = ids().folder;
  if (known) {
    try {
      const meta = await request(`${API}/${known}?fields=id,trashed`);
      if (meta && !meta.trashed) return known;
    } catch (err) {
      if (err.code !== 404) throw err;
    }
  }
  const found = (await request(query(`name = '${FOLDER.name}' and mimeType = '${FOLDER.mime}' and trashed = false`)))?.files?.[0]?.id;
  const id = found || (await request(`${API}?fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: FOLDER.name, mimeType: FOLDER.mime }),
  })).id;
  rememberId('folder', id);
  return id;
}

/** Retrouve un fichier de l'app : id mémorisé, sinon recherche par nom parmi ses propres fichiers. */
async function findFile(kind) {
  const known = ids()[kind];
  if (known) return known;
  const id = (await request(query(`name = '${FILES[kind].name}' and trashed = false`)))?.files?.[0]?.id || null;
  if (id) rememberId(kind, id);
  return id;
}

/** Crée ou remplace le fichier. Un fichier supprimé ou mis à la corbeille dans Drive est recréé. */
export async function upload(kind, body) {
  const { name, mime } = FILES[kind];
  const id = await findFile(kind);
  if (id) {
    try {
      const res = await request(`${UPLOAD}/${id}?uploadType=media&fields=id,trashed`, { method: 'PATCH', headers: { 'Content-Type': mime }, body });
      if (!res?.trashed) return id;
    } catch (err) {
      if (err.code !== 404) throw err;
    }
    rememberId(kind, null);
  }
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify({ name, mimeType: mime, parents: [await folderId()] })], { type: 'application/json' }));
  form.append('file', new Blob([body], { type: mime }));
  const created = (await request(`${UPLOAD}?uploadType=multipart&fields=id`, { method: 'POST', body: form })).id;
  rememberId(kind, created);
  return created;
}

/** Lit les données synchronisées. Renvoie null s'il n'y a pas de fichier ou s'il est illisible (il sera réécrit). */
export async function readData() {
  const id = await findFile('data');
  if (!id) return null;
  try {
    return await request(`${API}/${id}?alt=media`);
  } catch (err) {
    if (err.code === 404) { rememberId('data', null); return null; }
    if (err.code === 'parse') return null;
    throw err;
  }
}

export const fileLink = (kind) => (ids()[kind] ? `https://drive.google.com/file/d/${ids()[kind]}/view` : null);

// ---------- Envoi d'une vidéo (fichier lourd) ----------

function xhr(method, url, { headers = {}, body = null, onProgress = null, signal = null, timeout = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const req = new XMLHttpRequest();
    req.open(method, url);
    for (const [k, v] of Object.entries(headers)) req.setRequestHeader(k, v);
    if (onProgress) req.upload.onprogress = (ev) => onProgress(ev.loaded);
    req.timeout = timeout;
    req.onload = () => resolve(req);
    req.onerror = () => reject(fail('Connexion interrompue.', 'network'));
    req.ontimeout = () => reject(fail('Google Drive ne répond pas.', 'timeout'));
    req.onabort = () => reject(fail('Envoi annulé.', 'abort'));
    if (signal) {
      if (signal.aborted) return reject(fail('Envoi annulé.', 'abort'));
      signal.addEventListener('abort', () => req.abort(), { once: true });
    }
    req.send(body);
  });
}

const pause = (ms, signal) => new Promise((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(timer); reject(fail('Envoi annulé.', 'abort')); }, { once: true });
});

function finished(req) {
  let info = {};
  try { info = JSON.parse(req.responseText) || {}; } catch { /* corps vide */ }
  if (!info.id) throw fail('Drive n’a pas confirmé l’envoi.', 'fatal');
  return { id: info.id, url: /^https:\/\//.test(info.webViewLink || '') ? info.webViewLink : `https://drive.google.com/file/d/${info.id}/view` };
}

/**
 * Envoie un fichier dans le dossier « Revenus » par envoi reprenable : après une coupure réseau,
 * on demande à Drive où il en est et on repart de là, au lieu de tout renvoyer.
 * onProgress(octetsEnvoyés, total). Renvoie { id, url }.
 */
export async function uploadVideo(file, { name = file.name, onProgress = null, signal = null, retryDelay = 2000 } = {}) {
  if (!isConnected()) throw authError();
  const parent = await folderId();
  const type = file.type || 'application/octet-stream';
  const bearer = () => (isConnected() ? { Authorization: `Bearer ${token.value}` } : {});
  const refusal = (status) => (status === 403 ? 'Drive a refusé l’envoi : espace insuffisant ou accès retiré.' : `Drive a refusé l’envoi (${status}).`);

  const start = await xhr('POST', `${UPLOAD}?uploadType=resumable&fields=id,webViewLink`, {
    headers: {
      ...bearer(),
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': type,
      'X-Upload-Content-Length': String(file.size),
    },
    body: JSON.stringify({ name, parents: [parent] }),
    signal,
    timeout: 30_000,
  });
  if (start.status === 401) { token = null; throw authError(); }
  const session = start.status === 200 ? start.getResponseHeader('Location') : null;
  if (!session) throw fail(refusal(start.status), start.status);

  let offset = 0;
  let failures = 0;
  let probe = false;
  for (;;) {
    try {
      if (probe) {
        // Après une coupure : on demande à Drive ce qu'il a déjà reçu avant de renvoyer quoi que ce soit.
        const state = await xhr('PUT', session, { headers: { ...bearer(), 'Content-Range': `bytes */${file.size}` }, signal, timeout: 30_000 });
        if (state.status === 200 || state.status === 201) return finished(state);
        if (state.status !== 308) throw fail(state.status < 500 ? 'La session d’envoi a expiré. Relance l’envoi.' : 'Drive indisponible.', state.status < 500 ? 'fatal' : 'retry');
        const received = /-(\d+)$/.exec(state.getResponseHeader('Range') || '');
        const next = received ? Number(received[1]) + 1 : 0;
        if (next > offset) failures = 0; // l'envoi progresse : on repart avec un compteur d'échecs neuf
        offset = next;
        probe = false;
      }
      const req = await xhr('PUT', session, {
        headers: { ...bearer(), 'Content-Type': type, ...(offset ? { 'Content-Range': `bytes ${offset}-${file.size - 1}/${file.size}` } : {}) },
        body: offset ? file.slice(offset) : file,
        onProgress: (loaded) => onProgress?.(Math.min(file.size, offset + loaded), file.size),
        signal,
      });
      if (req.status === 200 || req.status === 201) return finished(req);
      if (req.status !== 308 && req.status < 500) throw fail(refusal(req.status), 'fatal');
      throw fail('Envoi interrompu.', 'retry');
    } catch (err) {
      if (err.code === 'abort' || err.code === 'fatal' || ++failures > 5) throw err;
      probe = true;
      await pause(retryDelay * 2 ** Math.min(failures - 1, 4), signal);
    }
  }
}
