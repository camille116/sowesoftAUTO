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
    signature: { style: 'claude', name: 'Camille Redon' },
    whatsappScan: { enabled: false, groupId: '', groupName: '' },
  });
  const s = settings.get();

  const planning = new Planning({ icsUrl: s.icsUrl, keywords: s.keywords, notify: s.notify, manual: config.planning.manual }, fetcher ? { fetcher } : {});
  const signer = customSigner || new SowesignSigner({
    site: config.sowesign.site,
    auth: s.auth,
    dryRun: s.dryRun,
    browser: config.browser,
    dataDir: config.dataDir,
    signature: s.signature,
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
    signer.signature = v.signature;
    signer.loginLocked = null; // nouveaux identifiants : on autorise un nouvel essai
    store.log('settings');
    if (v.channel !== before.channel || v.telegramToken !== before.telegramToken || v.whatsappNumber !== before.whatsappNumber
        || v.relayUrl !== before.relayUrl || v.relaySecret !== before.relaySecret) app.onChannelSettings?.(v);
    if (JSON.stringify(v.whatsappScan) !== JSON.stringify(before.whatsappScan)) app.onScanSettings?.(v);
    return settings.public();
  }

  // la commande « signature » du bot lit / change le style via les réglages
  bot.readSignature = () => settings.get().signature;
  bot.setSignatureStyle = (style) => updateSettings({ signature: { style } }).signature;

  // Y a-t-il un cours à signer MAINTENANT ? (cours notifié, en cours, pas encore signé, pas en pause)
  // Sert au scan WhatsApp : on ne signe sur un code repéré que pendant un vrai créneau à signer.
  async function signableNow(now = new Date()) {
    if (store.paused) return null;
    const current = await planning.current(now, 0);
    if (!current) return null;
    const toSign = await planning.day(now);
    const match = toSign.find((c) => c.id === current.id);
    return match && !store.isDone(match.id) ? match : null;
  }

  const app = { store, settings, planning, signer, bot, channel, members, updateSettings, signableNow, onChannelSettings: null, onScanSettings: null };
  return app;
}
