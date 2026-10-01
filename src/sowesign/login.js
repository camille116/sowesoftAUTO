/**
 * Connexion manuelle à SoWeSoft (utile pour la connexion Microsoft « Identifiants internes »,
 * ou pour vérifier visuellement que tout marche).
 * Ouvre un vrai navigateur avec le profil du bot : connecte-toi, la session (~25 jours)
 * est ensuite réutilisée par le bot.
 *
 *   npm run sowesign:login
 */
import puppeteer from 'puppeteer';
import { join } from 'node:path';
import { config } from '../config.js';

const { site } = config.sowesign;
const browser = await puppeteer.launch({
  headless: false,
  executablePath: config.browser.executablePath,
  userDataDir: join(config.dataDir, 'sowesign-profile'),
  defaultViewport: null,
  args: ['--lang=fr-FR'],
});
const [page] = await browser.pages();
await page.goto(site.studentUrl);

console.log(`\n👉 Connecte-toi dans la fenêtre (code établissement : ${config.sowesign.auth.institution}).`);
console.log('   J’attends que ton espace étudiant s’affiche…');

const deadline = Date.now() + 10 * 60e3;
while (Date.now() < deadline) {
  if (page.url().includes('/student') && (await page.$(Object.values(site.pages).join(', ')))) {
    console.log('✅ Connecté ! La session est enregistrée, le bot pourra signer.');
    break;
  }
  await new Promise((r) => setTimeout(r, 1000));
}
await browser.close();
