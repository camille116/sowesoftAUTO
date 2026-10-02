import { config } from './config.js';
import { createApp } from './app.js';
import { createTelegram } from './telegram.js';
import { createWhatsApp } from './whatsapp.js';
import { createWebServer } from './web/server.js';
import { createUpdater } from './updater.js';
import { createDesktop } from './desktop.js';
import { createRelayClient } from './relay-client.js';
import { createWhatsAppScanner } from './whatsapp-scan.js';
import { msg } from './messages.js';
import { log } from './logger.js';

const app = createApp(config);
const welcome = (channel) => () => channel.send(msg.welcome()).catch((e) => log.error(e));

// ── Messageries ─────────────────────────────────────────────
// Telegram : léger, toujours prêt à démarrer dès qu'un token est saisi.
const telegram = createTelegram({
  dataDir: config.dataDir,
  onMessage: (text) => app.bot.handle(text),
  // message d'accueil seulement quand tu relies le bot (pas à chaque démarrage)
  onOwnerLinked: () => welcome(telegram)(),
  // camarades de classe : rappels seulement
  members: app.members,
  onMemberMessage: (member, text) => app.bot.handleMember(member, text),
  onMemberLinked: (member) => {
    app.store.log('member-joined', { title: member.name });
    return telegram.sendTo(member.chatId, msg.memberWelcome(member)).catch((e) => log.error(e));
  },
});
app.channel.sendToMember = (member, text) => telegram.sendTo(member.chatId, text);

// WhatsApp : lance un Chromium, donc seulement s'il est choisi.
let whatsapp = null;
function ensureWhatsApp() {
  const number = app.settings.get().whatsappNumber;
  if (whatsapp) {
    whatsapp.setOwner(number);
    return whatsapp;
  }
  if (!number) log.warn('WhatsApp choisi : indique ton numéro dans l’app (Réglages → Messagerie)');
  whatsapp = createWhatsApp({
    ownerNumber: number,
    dataDir: config.dataDir,
    browser: config.browser,
    onMessage: (text) => app.bot.handle(text),
    onReady: () => log.info('WhatsApp prêt'),
  });
  whatsapp.start();
  return whatsapp;
}

const channels = {
  get active() {
    return app.settings.get().channel === 'whatsapp' ? ensureWhatsApp() : telegram;
  },
  telegram,
  get whatsapp() { return whatsapp; },
};

// Relais cloud : pousse l'état vers Cloudflare pour les rappels (et commandes) quand le Mac est éteint
const relay = createRelayClient({
  settings: app.settings, store: app.store, members: app.members, telegram,
  onCode: (code) => app.bot.handle(code), // un code mis en file par le cloud → le Mac signe
});
app.relay = relay;

// Le bot Telegram : par défaut le Mac écoute (long polling). Si le relais est configuré ET
// que son webhook s'enregistre, c'est le cloud qui écoute et le Mac ne fait qu'envoyer.
// SÉCURITÉ : si le webhook échoue (relais pas à jour), le Mac continue d'écouter → les commandes marchent toujours.
let telegramKey = null;
async function applyChannel(s) {
  const key = `${s.telegramToken || ''}|${relay.isConfigured()}|${app.settings.get().relayUrl}`;
  if (key !== telegramKey) {
    telegramKey = key;
    let sendOnly = false;
    if (relay.isConfigured() && s.telegramToken) {
      const r = await relay.setupWebhook().catch(() => ({ ok: false }));
      sendOnly = Boolean(r.ok);
      log.info(sendOnly ? 'Relais : webhook activé → le cloud reçoit les commandes' : 'Relais : webhook indisponible → le Mac écoute les commandes');
    }
    telegram.start(s.telegramToken, { sendOnly });
  }
  if (s.channel === 'whatsapp') ensureWhatsApp();
}

app.channel.send = (...args) => channels.active.send(...args);
app.onChannelSettings = (s) => applyChannel(s).catch((e) => log.error(e));
applyChannel(app.settings.get()).catch((e) => log.error(e));
relay.start();

// ── Scan WhatsApp (lecture seule) ────────────────────────────
// Surveille un groupe WhatsApp ; dès qu'un camarade poste un code SoWeSoft ET qu'il y a un cours
// à signer en ce moment, on signe. N'envoie JAMAIS de message WhatsApp ; les retours vont sur Telegram.
const scanner = createWhatsAppScanner({
  dataDir: config.dataDir,
  browser: config.browser,
  getConfig: () => app.settings.get().whatsappScan,
  shouldSign: () => app.signableNow(),
  onCode: async (code, { group } = {}) => {
    await app.channel.send(msg.scanDetected(code, group)).catch((e) => log.error(e));
    await app.bot.handle(code); // signe + prévient du résultat sur Telegram
  },
});
app.scanner = scanner;
app.onScanSettings = () => scanner.apply();
scanner.apply(); // démarre seulement si activé dans les réglages

// ── Rappels ─────────────────────────────────────────────────
const loop = () => app.bot.tick().catch((e) => log.error('Erreur tick :', e));
setInterval(loop, config.reminders.tickSeconds * 1000);

// ── Appli web ───────────────────────────────────────────────
// Par défaut l'appli n'écoute QUE sur ce Mac. WEB_HOST=0.0.0.0 l'ouvre au réseau local (Wi-Fi) : déconseillé
// sur un réseau partagé (école), et refusé sans WEB_PASSWORD.
const { port, password } = config.web;
let host = config.web.host || '127.0.0.1';
if (!['127.0.0.1', 'localhost', '::1'].includes(host) && !password) {
  log.warn('WEB_HOST ouvre l’appli au réseau mais WEB_PASSWORD est vide : accès limité à cette machine.');
  host = '127.0.0.1';
}
const updater = createUpdater({
  root: config.root,
  dataDir: config.dataDir,
  repo: process.env.UPDATE_REPO || 'camille116/sowesoftAUTO',
  branch: process.env.UPDATE_BRANCH || 'claude/whatsapp-signature-bot-q8m9ha',
  managed: process.env.LINKED_MANAGED === '1',
});
const desktop = createDesktop({ root: config.root, dataDir: config.dataDir, managed: process.env.LINKED_MANAGED === '1' });
createWebServer({ app, channels, updater, desktop, password, dataDir: config.dataDir }).listen(port, host, () => {
  log.info(`LinkeD : http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
});

const s = app.settings.get();
log.info(`Démarrage de LinkeD – messagerie : ${s.channel}, rappels à ${s.reminderOffsets.join(', ')} min, mode test : ${s.dryRun}`);
