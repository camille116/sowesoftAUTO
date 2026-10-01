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

const pad = (n) => String(n).padStart(2, '0');
const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const now = new Date();
const at = (minutes) => new Date(now.getTime() + minutes * 60e3);
const tomorrow = new Date(now.getTime() + 24 * 3600e3);

const demoConfig = {
  ...config,
  dataDir: mkdtempSync(join(tmpdir(), 'emile-demo-')),
  planning: {
    icsUrl: '',
    keywords: ['autonomie', 'elearning'],
    manual: {
      weekly: [],
      dates: [
        { date: ymd(now), start: hhmm(at(-200)), end: hhmm(at(-90)), title: 'Marketplaces – AUTONOMIE' },
        { date: ymd(now), start: hhmm(at(-25)), end: hhmm(at(95)), title: 'Management de projets digitaux – AUTONOMIE' },
        { date: ymd(tomorrow), start: '09:00', end: '11:00', title: "Outil d'analyse – ELEARNING" },
        { date: ymd(tomorrow), start: '17:30', end: '19:30', title: 'Marketplaces – AUTONOMIE' },
      ],
    },
  },
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

const app = createApp(demoConfig, { signer: fakeSigner });
app.store.log('reminder', { title: 'Management de projets digitaux – AUTONOMIE', offset: -5 });
app.store.log('reminder', { title: 'Management de projets digitaux – AUTONOMIE', offset: 0 });

const whatsapp = { state: { status: process.env.DEMO_WA || 'ready', qr: 'demo-qr-code-emile' } };
const port = Number(process.env.WEB_PORT || 3000);
createWebServer({ app, whatsapp, password: 'demo', dataDir: demoConfig.dataDir }).listen(port, '127.0.0.1', () => {
  console.log(`Démo Émile : http://localhost:${port}  (mot de passe : demo · code 00000 = échec simulé)`);
});
