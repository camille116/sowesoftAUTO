/**
 * Outil de repérage : ouvre la plateforme dans un vrai navigateur (avec le même profil que le bot),
 * tu te connectes et navigues jusqu'à l'écran de signature, puis tu appuies sur Entrée :
 * le script liste les champs et boutons visibles avec un sélecteur CSS prêt à coller
 * dans config/sowesign.json.
 *
 *   npm run sowesign:inspect
 */
import puppeteer from 'puppeteer';
import readline from 'node:readline/promises';
import { join } from 'node:path';
import { config } from '../config.js';

const browser = await puppeteer.launch({
  headless: false,
  executablePath: config.browser.executablePath,
  userDataDir: join(config.dataDir, 'sowesign-profile'),
  defaultViewport: null,
  args: ['--lang=fr-FR'],
});
const [page] = await browser.pages();
await page.goto(config.sowesign.site.url || 'about:blank');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
console.log('\n👉 Connecte-toi et va jusqu’à l’écran où tu tapes le code de signature.');

for (;;) {
  const answer = await rl.question('\n[Entrée] = analyser la page · [q] = quitter : ');
  if (answer.trim().toLowerCase() === 'q') break;

  const elements = await page.evaluate(() => {
    const cssPath = (el) => {
      if (el.id) return `#${CSS.escape(el.id)}`;
      const name = el.getAttribute('name');
      if (name) return `${el.tagName.toLowerCase()}[name="${name}"]`;
      const parts = [];
      for (let n = el; n && n.nodeType === 1 && parts.length < 4; n = n.parentElement) {
        let part = n.tagName.toLowerCase();
        const cls = [...n.classList].filter((c) => !/\d{3,}|^ng-|^css-/.test(c)).slice(0, 2);
        if (cls.length) part += `.${cls.map((c) => CSS.escape(c)).join('.')}`;
        parts.unshift(part);
        if (n.id) { parts[0] = `#${CSS.escape(n.id)}`; break; }
      }
      return parts.join(' > ');
    };
    const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    return [...document.querySelectorAll('input, button, textarea, select, a[role=button], [role=button]')]
      .filter(visible)
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute('type') || '',
        text: (el.innerText || el.value || el.placeholder || el.getAttribute('aria-label') || '').trim().slice(0, 40),
        maxLength: el.maxLength > 0 ? el.maxLength : '',
        selector: cssPath(el),
      }));
  });

  console.log(`\n📍 ${page.url()}`);
  console.table(elements);
  console.log('Copie les sélecteurs utiles (codeInput, codeSubmit, openSignature, loggedIn…) dans config/sowesign.json');
  console.log('Astuce : l’URL ci-dessus peut aller dans "signUrl" si c’est la page de signature.');
}

rl.close();
await browser.close();
console.log('Profil enregistré : le bot réutilisera cette session.');
