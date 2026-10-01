import { config } from './config.js';
import { createApp } from './app.js';
import { createTelegram } from './telegram.js';
import { createWhatsApp } from './whatsapp.js';
import { createWebServer } from './web/server.js';
import { createUpdater } from './updater.js';
import { msg } from './messages.js';
import { log } from './logger.js';

const app = createApp(config);
const welcome = (channel) => () => channel.send(msg.welcome()).catch((e) => log.error(e));

// ── Messageries ─────────────────────────────────────────────
// Telegram : léger, toujours prêt à démarrer dès qu'un token est saisi.
const telegram = createTelegram({
  dataDir: config.dataDir,
  onMessage: (text) => app.bot.handle(text),
  onReady: () => welcome(telegram)(),
});

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
    onReady: () => welcome(whatsapp)(),
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

function applyChannel(s) {
  if (s.channel === 'telegram') telegram.start(s.telegramToken);
  else {
    telegram.stop();
    ensureWhatsApp();
  }
}

app.channel.send = (...args) => channels.active.send(...args);
app.onChannelSettings = applyChannel;
applyChannel(app.settings.get());

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
createWebServer({ app, channels, updater, password, dataDir: config.dataDir }).listen(port, host, () => {
  log.info(`LinkeD : http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
});

const s = app.settings.get();
log.info(`Démarrage de LinkeD – messagerie : ${s.channel}, rappels à ${s.reminderOffsets.join(', ')} min, mode test : ${s.dryRun}`);
