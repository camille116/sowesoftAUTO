/**
 * Démo de l'appli sans WhatsApp ni SoWeSoft : faux planning autour de maintenant et faux robot.
 *   npm run demo  →  http://localhost:3000  (mot de passe : demo)
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config } from '../config.js';
import { createApp } from '../app.js';
import { createWebServer } from './server.js';
import { parseIcs } from '../planning/ics.js';

const now = new Date();
const at = (minutes) => new Date(now.getTime() + minutes * 60e3);

// Faux agenda Hyperplanning autour de maintenant (format OMNES)
const ics = (() => {
  const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const ev = (startMin, durMin, subject, type) => {
    const start = at(startMin);
    const end = at(startMin + durMin);
    return ['BEGIN:VEVENT', `UID:${subject}-${startMin}`, `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`,
      `SUMMARY:${subject} - SP5 Marketing digital - ${type}`, `DESCRIPTION:Matière : ${subject}\\nType : ${type}\\n`, 'END:VEVENT'].join('\r\n');
  };
  const day = 24 * 60;
  return ['BEGIN:VCALENDAR', 'VERSION:2.0',
    ev(-200, 110, 'Marketplaces', 'AUTONOMIE'),
    ev(-25, 120, 'Management de projets digitaux', 'AUTONOMIE'),
    ev(day - 300, 120, "Outil d'analyse", 'ELEARNING'),
    ev(day - 120, 120, 'Anglais professionnel', 'CRS'),
    ev(day + 60, 120, 'Marketplaces', 'CRS'),
    ev(2 * day - 200, 180, 'Brand content', 'CRS'),
    ev(3 * day - 100, 120, 'Marketplaces', 'AUTONOMIE'),
    ev(4 * day - 300, 120, 'Mesure et analyse de la performance', 'CRS'),
    'END:VCALENDAR'].join('\r\n');
})();

const demoConfig = {
  ...config,
  dataDir: mkdtempSync(join(tmpdir(), 'linked-demo-')),
  planning: { icsUrl: 'https://demo.invalid/Edt.ics', keywords: ['autonomie', 'elearning'], manual: { weekly: [], dates: [] } },
  sowesign: { ...config.sowesign, dryRun: false, auth: { ...config.sowesign.auth, method: 'password', email: 'prenom.nom@ecole.fr' } },
};

const fakeSigner = {
  busy: false, dryRun: false, auth: {}, loginLocked: null,
  async sign(code) {
    await new Promise((r) => setTimeout(r, 1800));
    if (code === '00000') return { ok: false, reason: 'code refusé : Code invalide' };
    return this.dryRun ? { ok: true, dryRun: true } : { ok: true };
  },
  async check() { await new Promise((r) => setTimeout(r, 1200)); return { ok: true }; },
};

const app = createApp(demoConfig, { signer: fakeSigner, fetcher: async () => parseIcs(ics) });
for (const [name, phone, chat] of [['Léa', '0612345678', 101], ['Tom', '0623456789', 102], ['Inès', '0634567890', null], ['Hugo', '0645678901', 104]]) {
  const m = app.members.add({ name, phone });
  if (chat) app.members.link(m, chat, `${name} (Telegram)`);
}
app.members.setPaused(app.members.all()[3], true);
app.store.log('reminder', { title: 'Management de projets digitaux – AUTONOMIE', offset: -5 });
app.store.log('reminder', { title: 'Management de projets digitaux – AUTONOMIE', offset: 0 });

// fausses messageries : DEMO_CHANNEL=telegram|whatsapp, DEMO_TG=off|waiting_link|ready, DEMO_WA=qr|code|syncing|ready|error
const whatsapp = {
  state: { status: process.env.DEMO_WA || 'ready', qr: 'demo-qr-code-emile', code: 'K7QX2M9D', percent: 42, error: 'Échec d’authentification (démo)' },
  async pair() { Object.assign(this.state, { status: 'code', code: 'K7QX2M9D' }); return 'K7QX2M9D'; },
  async reset() { Object.assign(this.state, { status: 'qr' }); },
  async send(text) { console.log('[démo WhatsApp]', text); },
};
const telegram = {
  state: { status: process.env.DEMO_TG || 'waiting_link', username: 'LinkedSignature_bot', owner: { name: 'Camille' }, linkCode: '3f9a1c2e', error: null },
  linkUrl() { return `https://t.me/${this.state.username}?start=${this.state.linkCode}`; },
  inviteUrl(m) { return `https://t.me/${this.state.username}?start=${m.inviteCode}`; },
  botUrl() { return `https://t.me/${this.state.username}`; },
  async sendTo(chatId, text) { console.log('[démo Telegram →', chatId, ']', text); },
  unlink() { this.state.status = 'waiting_link'; },
  async start(token) { if (token && this.state.status === 'off') this.state.status = 'waiting_link'; },
  stop() {},
  async send(text) { console.log('[démo Telegram]', text); },
};
const channels = {
  telegram,
  whatsapp,
  get active() { return app.settings.get().channel === 'whatsapp' ? whatsapp : telegram; },
};
app.settings.update({ channel: process.env.DEMO_CHANNEL || 'telegram' });
app.onChannelSettings = (v) => v.channel === 'telegram' && telegram.start(v.telegramToken);
const updater = {
  updating: false,
  async info() {
    return { current: 'a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0', latest: 'f9e8d7c6b5a4f9e8d7c6b5a4f9e8d7c6b5a4f9e8', latestMessage: 'Nouvelle interface LinkeD',
      updateAvailable: true, canUpdate: true, updating: this.updating, error: null, lastError: null };
  },
  async update() { this.updating = true; setTimeout(() => { this.updating = false; }, 4000); return { started: true }; },
};
const port = Number(process.env.WEB_PORT || 3000);
createWebServer({ app, channels, updater, password: 'demo', dataDir: demoConfig.dataDir }).listen(port, '127.0.0.1', () => {
  console.log(`Démo LinkeD : http://localhost:${port}  (mot de passe : demo · code 00000 = échec simulé)`);
});
