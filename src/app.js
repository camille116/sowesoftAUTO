import { Planning } from './planning/index.js';
import { Store } from './store.js';
import { Settings } from './settings.js';
import { SowesignSigner } from './sowesign/signer.js';
import { Bot } from './bot.js';
import { Members } from './members.js';
import { DEFAULT_MEMBER_TEMPLATE } from './messages.js';

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
    notify: { mode: 'auto', subjects: [] },
    channel: config.channel || 'telegram',
    whatsappNumber: config.ownerNumber || '',
    memberTemplate: DEFAULT_MEMBER_TEMPLATE,
    relayUrl: '', relaySecret: '',
    telegramToken: config.telegram?.token || '',
  });
  const s = settings.get();

  const planning = new Planning({ icsUrl: s.icsUrl, keywords: s.keywords, notify: s.notify, manual: config.planning.manual }, fetcher ? { fetcher } : {});
  const signer = customSigner || new SowesignSigner({
    site: config.sowesign.site,
    auth: s.auth,
    dryRun: s.dryRun,
    browser: config.browser,
    dataDir: config.dataDir,
  });

  const members = new Members(config.dataDir);
  members.prune();

  const channel = { send: send || (async () => {}), sendToMember: async () => {} };
  const bot = new Bot({
    planning,
    store,
    signer,
    send: (...args) => channel.send(...args),
    offsets: s.reminderOffsets,
    dryRun: s.dryRun,
    members,
    sendToMember: (...args) => channel.sendToMember(...args),
    memberTemplate: s.memberTemplate,
  });

  function updateSettings(patch) {
    const before = settings.get();
    const v = settings.update(patch);
    if (v.icsUrl !== before.icsUrl) { planning.icsUrl = v.icsUrl; planning.calendar = null; }
    planning.keywords = v.keywords;
    planning.notify = v.notify;
    bot.memberTemplate = v.memberTemplate;
    bot.offsets = v.reminderOffsets;
    bot.dryRun = signer.dryRun = v.dryRun;
    signer.auth = v.auth;
    signer.loginLocked = null; // nouveaux identifiants : on autorise un nouvel essai
    store.log('settings');
    if (v.channel !== before.channel || v.telegramToken !== before.telegramToken || v.whatsappNumber !== before.whatsappNumber) app.onChannelSettings?.(v);
    return settings.public();
  }

  const app = { store, settings, planning, signer, bot, channel, members, updateSettings, onChannelSettings: null };
  return app;
}
