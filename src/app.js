import { Planning } from './planning/index.js';
import { Store } from './store.js';
import { Settings } from './settings.js';
import { SowesignSigner } from './sowesign/signer.js';
import { Bot } from './bot.js';

/**
 * Assemble les briques (planning, état, réglages, robot, bot) et applique les réglages
 * à chaud quand ils sont modifiés depuis l'appli web.
 */
export function createApp(config, { send, signer: customSigner, fetcher } = {}) {
  const store = new Store(config.dataDir);
  store.prune();

  const settings = new Settings(config.dataDir, {
    icsUrl: config.planning.icsUrl,
    keywords: config.planning.keywords,
    reminderOffsets: config.reminders.offsets,
    dryRun: config.sowesign.dryRun,
    auth: config.sowesign.auth,
  });
  const s = settings.get();

  const planning = new Planning({ icsUrl: s.icsUrl, keywords: s.keywords, manual: config.planning.manual }, fetcher ? { fetcher } : {});
  const signer = customSigner || new SowesignSigner({
    site: config.sowesign.site,
    auth: s.auth,
    dryRun: s.dryRun,
    browser: config.browser,
    dataDir: config.dataDir,
  });

  const channel = { send: send || (async () => {}) };
  const bot = new Bot({
    planning,
    store,
    signer,
    send: (...args) => channel.send(...args),
    offsets: s.reminderOffsets,
    dryRun: s.dryRun,
  });

  function updateSettings(patch) {
    const before = settings.get();
    const v = settings.update(patch);
    if (v.icsUrl !== before.icsUrl) { planning.icsUrl = v.icsUrl; planning.calendar = null; }
    planning.keywords = v.keywords;
    bot.offsets = v.reminderOffsets;
    bot.dryRun = signer.dryRun = v.dryRun;
    signer.auth = v.auth;
    signer.loginLocked = null; // nouveaux identifiants : on autorise un nouvel essai
    store.log('settings');
    return settings.public();
  }

  return { store, settings, planning, signer, bot, channel, updateSettings };
}
