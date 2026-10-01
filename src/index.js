import { config } from './config.js';
import { createApp } from './app.js';
import { createTelegram } from './telegram.js';
import { createWhatsApp } from './whatsapp.js';
import { createWebServer } from './web/server.js';
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
  if (whatsapp) return whatsapp;
  if (!config.ownerNumber) {
    log.warn('WhatsApp choisi mais OWNER_NUMBER est vide dans .env (ex : 33612345678)');
  }
  whatsapp = createWhatsApp({
    ownerNumber: config.ownerNumber,
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
const { port, password } = config.web;
const host = config.web.host || (password ? '0.0.0.0' : '127.0.0.1');
if (!password) log.warn('WEB_PASSWORD vide : l’appli n’est accessible que depuis cette machine (http://localhost).');
createWebServer({ app, channels, password, dataDir: config.dataDir }).listen(port, host, () => {
  log.info(`Appli Émile : http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
});

const s = app.settings.get();
log.info(`Démarrage d'Émile – messagerie : ${s.channel}, rappels à ${s.reminderOffsets.join(', ')} min, mode test : ${s.dryRun}`);
