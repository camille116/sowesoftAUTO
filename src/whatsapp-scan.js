import pkg from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { log } from './logger.js';

const { Client, LocalAuth } = pkg;

const TRIED_TTL_MS = 10 * 60e3; // on ne retente pas le même code pendant 10 min
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Repère un code SoWeSoft (5 chiffres isolés) dans un message libre.
 * « le code c'est 48213 », « 48213 », « Code : 48 213 »… → "48213". Évite les nombres plus longs.
 */
export function extractCode(text) {
  const t = String(text || '').replace(/(\d)\s+(\d)/g, '$1$2'); // « 48 213 » → « 48213 »
  const m = t.match(/(?<!\d)(\d{5})(?!\d)/);
  return m ? m[1] : null;
}

/**
 * Scanner WhatsApp **en lecture seule** : surveille UN groupe et, dès qu'un camarade poste un code
 * SoWeSoft, le fait signer — mais UNIQUEMENT s'il y a un cours à signer en ce moment (heures de cours).
 *
 * SÉCURITÉ : ce module n'a AUCUNE fonction d'envoi. Il ne peut techniquement jamais écrire un
 * message avec ton compte WhatsApp. Les retours (code repéré, signé/échoué) partent sur Telegram.
 * Session dédiée (dossier séparé) → à utiliser de préférence avec un compte WhatsApp secondaire.
 */
export function createWhatsAppScanner({ dataDir, browser, onDetect, getConfig, clientFactory }) {
  const sessionDir = join(dataDir, 'whatsapp-scan-session');
  const state = { status: 'off', qr: null, error: null, group: null, since: Date.now() };
  const tried = new Map(); // code → timestamp
  let client = null;
  let running = false;
  let restarting = false;

  const setState = (patch) => { if (patch.status && patch.status !== state.status) state.since = Date.now(); Object.assign(state, patch); };

  const recentlyTried = (code) => {
    const now = Date.now();
    for (const [c, ts] of tried) if (now - ts > TRIED_TTL_MS) tried.delete(c);
    return tried.has(code);
  };

  /**
   * Décide à partir d'un message (isolé pour les tests : pas besoin de vrai Chromium).
   * Repère un code dans le bon groupe et le remonte toujours à l'app (onDetect), qui prévient
   * sur Telegram et décide de signer ou non selon les heures de cours.
   */
  async function handleMessage(message) {
    try {
      const cfg = getConfig();
      if (!cfg?.enabled) return;
      if (!message || message.type !== 'chat' || !message.body) return;
      const chat = await message.getChat();
      if (!chat?.isGroup) return; // on ne lit QUE des groupes
      const id = chat.id?._serialized || chat.id;
      if (cfg.groupId && id !== cfg.groupId) return; // pas le groupe choisi
      const code = extractCode(message.body);
      if (!code || recentlyTried(code)) return;
      tried.set(code, Date.now());
      log.info(`WhatsApp scan : code ${code} repéré dans « ${chat.name} »`);
      await onDetect(code, { group: chat.name });
    } catch (err) {
      log.warn(`WhatsApp scan : message ignoré (${err.message})`);
    }
  }

  function makeClient() {
    const c = clientFactory ? clientFactory() : new Client({
      authStrategy: new LocalAuth({ dataPath: sessionDir, clientId: 'scan' }),
      puppeteer: {
        headless: browser.headless,
        executablePath: browser.executablePath,
        args: ['--no-sandbox', '--disable-dev-shm-usage', ...(browser.extraArgs || [])],
      },
    });
    c.on('qr', (qr) => { setState({ status: 'qr', qr, error: null }); log.info('WhatsApp scan : QR prêt (compte à surveiller)'); qrcode.generate(qr, { small: true }); });
    c.on('loading_screen', () => setState({ status: 'syncing', qr: null }));
    c.on('authenticated', () => setState({ status: 'syncing', qr: null }));
    c.on('auth_failure', (m) => setState({ status: 'error', error: `Authentification refusée : ${m}` }));
    c.on('disconnected', (reason) => { setState({ status: 'disconnected', error: `Déconnecté (${reason})` }); if (running) setTimeout(() => restart('déconnexion'), 5000); });
    c.on('ready', () => { setState({ status: 'ready', qr: null, error: null }); log.info(`WhatsApp scan prêt (lecture seule) : ${c.info?.wid?.user || '?'}`); });
    // lecture seule : on écoute les messages (reçus ET créés, pour capter aussi tes propres tests) ;
    // on n'envoie jamais rien. Le dédoublonnage évite de traiter deux fois le même code.
    c.on('message', (message) => handleMessage(message));
    c.on('message_create', (message) => handleMessage(message));
    return c;
  }

  async function start() {
    if (running) return;
    running = true;
    setState({ status: 'starting', qr: null, error: null });
    client = makeClient();
    try {
      await client.initialize();
    } catch (err) {
      setState({ status: 'error', error: `Démarrage impossible : ${err.message || err}` });
      if (running) setTimeout(() => restart('erreur au démarrage'), 30e3);
    }
  }

  async function stop() {
    running = false;
    try { await client?.destroy().catch(() => {}); } finally { client = null; setState({ status: 'off', qr: null }); }
  }

  async function restart(reason) {
    if (restarting || !running) return;
    restarting = true;
    log.warn(`WhatsApp scan : redémarrage (${reason})`);
    try { await client?.destroy().catch(() => {}); } finally { restarting = false; }
    if (running) { running = false; start(); }
  }

  /** Oublie la session (changer de compte WhatsApp à surveiller). */
  async function reset() {
    const wasRunning = running;
    running = false;
    try { await client?.logout().catch(() => {}); await client?.destroy().catch(() => {}); await rm(sessionDir, { recursive: true, force: true }); }
    finally { client = null; setState({ status: 'off', qr: null }); }
    if (wasRunning) start();
  }

  /** Liste les groupes WhatsApp du compte (pour choisir lequel surveiller). */
  async function listGroups() {
    if (!client || state.status !== 'ready') return [];
    // WhatsApp charge les conversations en différé : on réessaie quelques fois.
    for (let attempt = 0; attempt < 3; attempt++) {
      const chats = await client.getChats().catch((e) => { log.warn(`WhatsApp scan : liste des groupes impossible (${e.message})`); return []; });
      const groups = chats.filter((c) => c.isGroup).map((c) => ({ id: c.id?._serialized || String(c.id), name: c.name || c.formattedTitle || '(sans nom)' }));
      if (groups.length) { log.info(`WhatsApp scan : ${groups.length} groupe(s) visible(s)`); return groups; }
      if (attempt < 2) await sleep(1500);
    }
    log.info('WhatsApp scan : aucun groupe visible pour le moment (chats pas encore synchronisés ?)');
    return [];
  }

  /** Applique la config : démarre/arrête selon « enabled ». */
  function apply() {
    const cfg = getConfig();
    if (cfg?.enabled && !running) start();
    else if (!cfg?.enabled && running) stop();
    setState({ group: cfg?.groupName || null });
  }

  return { state, start, stop, reset, apply, listGroups, handleMessage, get client() { return client; } };
}
