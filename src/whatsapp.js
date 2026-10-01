import pkg from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { BOT_TAG } from './messages.js';
import { log } from './logger.js';

const { Client, LocalAuth, MessageMedia } = pkg;

const SYNC_TIMEOUT_MS = 5 * 60e3; // synchronisation bloquée au-delà → on relance
const START_TIMEOUT_MS = 3 * 60e3;

/**
 * Canal WhatsApp (via WhatsApp Web, connexion par QR code ou code d'appairage).
 * Deux façons de l'utiliser :
 *  - le bot tourne sur un 2e numéro (ex : carte SIM dédiée) et tu lui écris ;
 *  - le bot tourne sur TON numéro et tu lui parles dans « Moi (Vous) » (discussion avec toi-même).
 * Dans les deux cas, seuls les messages de OWNER_NUMBER sont traités.
 *
 * Étapes visibles dans l'appli (state.status) :
 *   starting → qr | code → syncing (après le scan, WhatsApp synchronise : 1 à 3 min) → ready
 *   + error / disconnected, avec relance automatique.
 */
export function createWhatsApp({ ownerNumber, dataDir, browser, onMessage, onReady }) {
  const sessionDir = join(dataDir, 'whatsapp-session');
  const ownerJid = `${ownerNumber}@c.us`;
  const sentIds = new Set(); // évite que le bot se réponde à lui-même dans la discussion « Moi »
  const state = { status: 'starting', qr: null, code: null, percent: null, error: null, since: Date.now() };
  let client = null;
  let restarting = false;

  const setState = (patch) => {
    if (patch.status && patch.status !== state.status) state.since = Date.now();
    Object.assign(state, patch);
  };

  async function send(text, imagePath) {
    if (state.status !== 'ready') {
      log.warn('WhatsApp pas encore connecté, message non envoyé');
      return;
    }
    const sent = imagePath
      ? await client.sendMessage(ownerJid, MessageMedia.fromFilePath(imagePath), { caption: text })
      : await client.sendMessage(ownerJid, text);
    sentIds.add(sent.id._serialized);
    if (sentIds.size > 500) sentIds.delete(sentIds.values().next().value);
  }

  async function isFromOwner(message) {
    if (message.fromMe) {
      // bot sur ton propre numéro : on n'écoute que la discussion avec toi-même
      const me = client.info?.wid;
      return me?.user === ownerNumber && message.to === me._serialized;
    }
    const contact = await message.getContact();
    return contact.number === ownerNumber;
  }

  function makeClient() {
    const c = new Client({
      authStrategy: new LocalAuth({ dataPath: sessionDir }),
      puppeteer: {
        headless: browser.headless,
        executablePath: browser.executablePath,
        args: ['--no-sandbox', '--disable-dev-shm-usage', ...(browser.extraArgs || [])],
      },
    });

    c.on('qr', (qr) => {
      if (state.status === 'code') return; // appairage par code en cours : on garde le code affiché
      setState({ status: 'qr', qr, error: null });
      log.info('QR WhatsApp prêt : scanne-le dans l’appli (Réglages) ou ici ↓');
      qrcode.generate(qr, { small: true });
    });
    c.on('code', (code) => {
      setState({ status: 'code', code, error: null });
      log.info(`Code d'appairage WhatsApp : ${code}`);
    });
    c.on('loading_screen', (percent) => {
      setState({ status: 'syncing', percent: Number(percent) || 0, qr: null, code: null });
      log.info(`WhatsApp : synchronisation ${percent} %`);
    });
    c.on('authenticated', () => {
      setState({ status: 'syncing', qr: null, code: null });
      log.info('WhatsApp authentifié, finalisation…');
    });
    c.on('auth_failure', (m) => {
      setState({ status: 'error', error: `Échec d'authentification : ${m}. Réinitialise WhatsApp et rescanne.` });
      log.error(`Échec d'authentification WhatsApp : ${m}`);
    });
    c.on('change_state', (s) => log.info(`WhatsApp état : ${s}`));
    c.on('disconnected', (reason) => {
      setState({ status: 'disconnected', qr: null, code: null, error: `Déconnecté (${reason})` });
      log.warn(`WhatsApp déconnecté (${reason}), relance dans 5 s…`);
      setTimeout(() => restart('déconnexion'), 5000);
    });
    c.on('ready', () => {
      setState({ status: 'ready', qr: null, code: null, percent: 100, error: null });
      log.info(`WhatsApp prêt (${c.info?.wid?.user || '?'})`);
      onReady?.();
    });

    c.on('message_create', async (message) => {
      try {
        if (sentIds.has(message.id._serialized)) return;
        if (message.type !== 'chat' || message.body.startsWith(BOT_TAG)) return;
        if (!(await isFromOwner(message))) return;
        await onMessage(message.body);
      } catch (err) {
        log.error('Erreur en traitant un message :', err);
      }
    });
    return c;
  }

  async function start() {
    setState({ status: 'starting', qr: null, code: null, percent: null });
    client = makeClient();
    try {
      await client.initialize();
    } catch (err) {
      const message = err?.message || String(err);
      setState({ status: 'error', error: `Démarrage impossible : ${message}` });
      log.error('WhatsApp : démarrage impossible :', message);
      setTimeout(() => restart('erreur au démarrage'), 30e3);
    }
  }

  async function restart(reason) {
    if (restarting) return;
    restarting = true;
    log.warn(`WhatsApp : redémarrage (${reason})`);
    try {
      await client?.destroy().catch(() => {});
    } finally {
      restarting = false;
    }
    start();
  }

  // Filet de sécurité : synchronisation ou démarrage bloqués → on relance
  setInterval(() => {
    const age = Date.now() - state.since;
    if (state.status === 'syncing' && age > SYNC_TIMEOUT_MS) restart('synchronisation bloquée');
    if (state.status === 'starting' && age > START_TIMEOUT_MS) restart('démarrage trop long');
  }, 15e3).unref();

  /** Connexion par code à 8 caractères (à taper dans WhatsApp au lieu de scanner le QR). */
  async function pair(phone) {
    const number = String(phone || '').replace(/\D/g, '').replace(/^0(\d{9})$/, '33$1');
    if (number.length < 10) throw new Error('Numéro invalide (ex : 0612345678)');
    if (!['qr', 'code'].includes(state.status)) throw new Error('Attends que le QR code s’affiche, puis réessaie');
    setState({ status: 'code', code: null });
    const code = await client.requestPairingCode(number, true);
    setState({ code });
    return code;
  }

  /** Oublie la session WhatsApp (changement de compte ou session cassée) et repart sur un QR neuf. */
  async function reset() {
    log.warn('WhatsApp : réinitialisation de la session');
    restarting = true;
    try {
      await client?.logout().catch(() => {});
      await client?.destroy().catch(() => {});
      await rm(sessionDir, { recursive: true, force: true });
    } finally {
      restarting = false;
    }
    start();
  }

  return {
    state,
    send,
    pair,
    reset,
    start,
    get client() { return client; },
  };
}
