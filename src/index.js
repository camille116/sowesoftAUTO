import { config } from './config.js';
import { Planning } from './planning/index.js';
import { Store } from './store.js';
import { SowesignSigner } from './sowesign/signer.js';
import { createWhatsApp } from './whatsapp.js';
import { Bot } from './bot.js';
import { msg } from './messages.js';
import { log } from './logger.js';

if (!config.ownerNumber) {
  log.error('OWNER_NUMBER manquant : copie .env.example en .env et remplis-le.');
  process.exit(1);
}

const store = new Store(config.dataDir);
store.prune();

const planning = new Planning(config.planning);
const signer = new SowesignSigner({ ...config.sowesign, browser: config.browser, dataDir: config.dataDir });

let bot;
const whatsapp = createWhatsApp({
  ownerNumber: config.ownerNumber,
  dataDir: config.dataDir,
  browser: config.browser,
  onMessage: (text) => bot.handle(text),
  onReady: async () => {
    await whatsapp.send(msg.welcome());
    const loop = () => bot.tick().catch((e) => log.error('Erreur tick :', e));
    loop();
    setInterval(loop, config.reminders.tickSeconds * 1000);
  },
});

bot = new Bot({
  planning,
  store,
  signer,
  send: whatsapp.send,
  offsets: config.reminders.offsets,
  dryRun: config.sowesign.dryRun,
});

log.info(`Démarrage d'Émile – rappels à ${config.reminders.offsets.join(', ')} min, mode test : ${config.sowesign.dryRun}`);
await whatsapp.start();
