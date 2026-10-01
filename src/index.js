import { config } from './config.js';
import { createApp } from './app.js';
import { createWhatsApp } from './whatsapp.js';
import { createWebServer } from './web/server.js';
import { msg } from './messages.js';
import { log } from './logger.js';

if (!config.ownerNumber) {
  log.error('OWNER_NUMBER manquant : copie .env.example en .env et remplis-le.');
  process.exit(1);
}

const app = createApp(config);

const whatsapp = createWhatsApp({
  ownerNumber: config.ownerNumber,
  dataDir: config.dataDir,
  browser: config.browser,
  onMessage: (text) => app.bot.handle(text),
  onReady: () => whatsapp.send(msg.welcome()).catch((e) => log.error(e)),
});
app.channel.send = whatsapp.send;

// Rappels : tournent même si WhatsApp n'est pas encore connecté (visible dans l'appli)
const loop = () => app.bot.tick().catch((e) => log.error('Erreur tick :', e));
setInterval(loop, config.reminders.tickSeconds * 1000);

// Appli web
const { port, password } = config.web;
const host = config.web.host || (password ? '0.0.0.0' : '127.0.0.1');
if (!password) log.warn('WEB_PASSWORD vide : l’appli n’est accessible que depuis cette machine (http://localhost).');
createWebServer({ app, whatsapp, password, dataDir: config.dataDir }).listen(port, host, () => {
  log.info(`Appli Émile : http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
});

const s = app.settings.get();
log.info(`Démarrage d'Émile – rappels à ${s.reminderOffsets.join(', ')} min, mode test : ${s.dryRun}`);
whatsapp.start().catch((e) => log.error('WhatsApp :', e));
