import puppeteer from 'puppeteer';
import { mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const normalize = (t) =>
  String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’`]/g, "'").toLowerCase();
const includesAny = (text, list = []) => list.some((t) => normalize(text).includes(normalize(t)));

/** Trace une signature manuscrite (boucles façon écriture cursive) qui occupe le cadre. */
export function signatureStrokes(width, height) {
  const strokes = [];
  const left = width * 0.1;
  const span = width * 0.8;
  const mid = height * 0.5;
  const amp = height * 0.3;

  const main = [];
  for (let i = 0; i <= 120; i++) {
    const t = i / 120;
    const loops = Math.sin(t * Math.PI * 7);
    main.push([left + t * span + Math.cos(t * Math.PI * 7) * width * 0.025, mid - loops * amp * (0.6 + 0.4 * Math.sin(t * Math.PI))]);
  }
  strokes.push(main);

  // trait de soulignement
  strokes.push([[left + span * 0.05, mid + amp * 1.05], [left + span * 0.5, mid + amp * 0.95], [left + span * 0.95, mid + amp * 1.1]]);
  return strokes;
}

/**
 * Robot de signature pour SoWeSoft (app.sowesign.com).
 *
 * Parcours réel :
 *  portail /login → code établissement → identifiant + PIN (ou e-mail + mot de passe)
 *  → appli étudiant /student → pavé « code à 5 chiffres » → (pad de signature) → « présence enregistrée ».
 *
 * La session de l'appli étudiant dure ~25 jours : elle est gardée dans un profil Chromium,
 * on ne se reconnecte que si elle a expiré.
 */
export class SowesignSigner {
  constructor({ site, auth, dryRun, browser, dataDir }) {
    this.site = site;
    this.sel = site.selectors;
    this.pages = site.pages;
    this.texts = site.texts;
    this.auth = auth; // { method: 'code'|'password'|'sso', institution, id, pin, email, password }
    this.dryRun = dryRun;
    this.browserOpts = browser;
    this.profileDir = join(dataDir, 'sowesign-profile');
    this.shotsDir = join(dataDir, 'screenshots');
    this.timeout = site.timeoutMs || 25000;
    this.busy = false;
    // Après un échec de connexion on ne réessaie plus tout seul : SoWeSoft bloque le compte après 3 essais.
    this.loginLocked = null;
    mkdirSync(this.shotsDir, { recursive: true });
    this.pruneScreenshots();
  }

  /** Les captures contiennent ton nom et tes cours : on ne garde que les 30 derniers jours. */
  pruneScreenshots(days = 30) {
    const limit = Date.now() - days * 24 * 3600e3;
    for (const name of readdirSync(this.shotsDir)) {
      const file = join(this.shotsDir, name);
      try { if (statSync(file).mtimeMs < limit) unlinkSync(file); } catch { /* déjà supprimé */ }
    }
  }

  async withPage(fn) {
    const browser = await puppeteer.launch({
      headless: this.browserOpts.headless,
      executablePath: this.browserOpts.executablePath,
      userDataDir: this.profileDir,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--lang=fr-FR', ...(this.browserOpts.extraArgs || [])],
    });
    try {
      const page = await browser.newPage();
      page.setDefaultTimeout(this.timeout);
      // l'appli choisit sa langue d'après le navigateur : on force le français
      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'language', { get: () => 'fr-FR' });
        Object.defineProperty(navigator, 'languages', { get: () => ['fr-FR', 'fr'] });
      });
      await page.emulateTimezone(process.env.TZ || 'Europe/Paris').catch(() => {});
      await page.setViewport({ width: 420, height: 860, isMobile: true });
      return await fn(page);
    } finally {
      await browser.close();
    }
  }

  async screenshot(page, name) {
    const path = join(this.shotsDir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${name}.png`);
    await page.screenshot({ path }).catch(() => {});
    return path;
  }

  bodyText(page) {
    return page.evaluate(() => document.body?.innerText || '').catch(() => '');
  }

  /** Où en est l'appli ? 'login' | 'detection' | 'signature' | 'validated' | 'noCourse' | … | null */
  async state(page) {
    if (page.url().includes('/login') || page.url().includes('/error')) return 'login';
    for (const [name, selector] of Object.entries(this.pages)) {
      if (await page.$(selector)) return name;
    }
    return null;
  }

  async waitForState(page, accepted, timeout = this.timeout) {
    const deadline = Date.now() + timeout;
    let current = null;
    while (Date.now() < deadline) {
      current = await this.state(page);
      if (current && (!accepted || accepted.includes(current))) return current;
      await sleep(400);
    }
    return current;
  }

  async clickByText(page, selector, labels) {
    return page.evaluate((selector, labels) => {
      const norm = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’`]/g, "'").toLowerCase().trim();
      const wanted = labels.map(norm);
      const matches = [...document.querySelectorAll(selector)].filter((e) => wanted.some((w) => norm(e.innerText || '').startsWith(w)));
      // on vise l'élément cliquable le plus précis, pas son conteneur
      const el = matches.findLast((e) => getComputedStyle(e).cursor === 'pointer') || matches.at(-1);
      if (!el) return false;
      el.click();
      return true;
    }, selector, labels);
  }

  async login(page) {
    const { method, institution, id, pin, email, password } = this.auth;
    if (this.loginLocked) {
      throw new Error(`connexion suspendue après un échec (${this.loginLocked}). Vérifie tes identifiants puis envoie *test*`);
    }
    if (method === 'sso') {
      throw new Error('session SoWeSoft expirée : relance `npm run sowesign:login` sur ta machine pour te reconnecter');
    }
    if (method === 'code' && !(id && pin)) throw new Error('SOWESIGN_ID / SOWESIGN_PIN manquants dans .env');
    if (method === 'password' && !(email && password)) throw new Error('SOWESIGN_EMAIL / SOWESIGN_PASSWORD manquants dans .env');

    if (!page.url().includes('/login')) await page.goto(this.site.portalUrl, { waitUntil: 'networkidle2' });
    const cont = await page.waitForSelector(this.sel.continue, { visible: true, timeout: 8000 }).catch(() => null);
    if (cont) await cont.click();
    await sleep(800);
    await page.keyboard.type(String(institution), { delay: 80 });

    // l'établissement peut proposer plusieurs méthodes de connexion
    const modes = await page.waitForSelector(this.sel.loginMode, { visible: true, timeout: 6000 }).catch(() => null);
    if (modes) {
      const labels = method === 'password' ? this.texts.modePassword : this.texts.modeCode;
      if (!(await this.clickByText(page, `${this.sel.loginMode} *`, labels))) throw new Error('méthode de connexion introuvable');
      await sleep(800);
    }

    if (method === 'password') {
      const emailField = await page.waitForSelector(this.sel.email, { visible: true });
      await emailField.type(email, { delay: 30 });
      await (await page.$(this.sel.password)).type(password, { delay: 30 });
      await this.clickByText(page, 'app-button, button, div', this.texts.validate);
    } else {
      await page.keyboard.type(String(id), { delay: 80 });
      await sleep(1000);
      await page.keyboard.type(String(pin), { delay: 80 });
    }

    // succès = redirection vers l'appli étudiant
    const deadline = Date.now() + this.timeout;
    while (Date.now() < deadline) {
      if (page.url().includes('/student')) return;
      const text = await this.bodyText(page);
      if (page.url().includes('/error') || includesAny(text, this.texts.loginErrors)) {
        const reason = text.split('\n').map((l) => l.trim()).filter(Boolean).slice(1, 4).join(' – ');
        this.loginLocked = reason || 'identifiants refusés';
        throw new Error(`connexion refusée par SoWeSoft : ${this.loginLocked}`);
      }
      await sleep(500);
    }
    this.loginLocked = 'pas de redirection après connexion';
    throw new Error('connexion SoWeSoft : pas de redirection vers l’espace étudiant');
  }

  /** Ouvre l'espace étudiant (en se reconnectant si besoin) et renvoie l'état de la page. */
  async open(page) {
    await page.goto(this.site.studentUrl, { waitUntil: 'networkidle2' });
    let state = await this.waitForState(page);
    if (state === 'login' || state === 'accessDenied') {
      await this.login(page);
      state = await this.waitForState(page, Object.keys(this.pages));
    }
    if (!state) throw new Error('page SoWeSoft non reconnue (vérifie la capture)');
    await this.closePopups(page);
    return state;
  }

  /** Ferme les fenêtres d'information (mentions légales, aide…) qui s'affichent par-dessus le code. */
  async closePopups(page, waitMs = 2500) {
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      if (await this.clickByText(page, `${this.sel.popup} *`, this.texts.closePopup)) await sleep(600);
      else await sleep(300);
    }
  }

  /** Tape le code : pavé à l'écran (mobile) ou touches clavier envoyées à la zone du code (ordinateur). */
  async pressKeys(page, digits) {
    for (const digit of digits) {
      const ok = await page.evaluate((keySel, zoneSel, d) => {
        const key = [...document.querySelectorAll(keySel)].find((k) => k.innerText.trim() === d);
        if (key) { key.click(); return true; }
        const zone = document.querySelector(zoneSel);
        if (!zone) return false;
        zone.dispatchEvent(new KeyboardEvent('keydown', { key: d, bubbles: true }));
        zone.dispatchEvent(new KeyboardEvent('keyup', { key: d, bubbles: true }));
        return true;
      }, this.sel.keypadKey, this.sel.codeZone, digit);
      if (!ok) throw new Error('zone de saisie du code introuvable');
      await sleep(150);
    }
  }

  /** Chiffres actuellement affichés dans les cases du code. */
  async typedCode(page) {
    return page.$$eval(this.sel.codeBoxes, (boxes) => boxes.map((b) => b.innerText.trim()).join('')).catch(() => '');
  }

  async drawSignature(page) {
    const canvas = await page.waitForSelector(this.sel.signatureCanvas, { visible: true });
    const box = await canvas.boundingBox();
    for (const stroke of signatureStrokes(box.width, box.height)) {
      await page.mouse.move(box.x + stroke[0][0], box.y + stroke[0][1]);
      await page.mouse.down();
      for (const [x, y] of stroke.slice(1)) await page.mouse.move(box.x + x, box.y + y, { steps: 2 });
      await page.mouse.up();
    }
    await sleep(300);
    const validate = await page.$(this.sel.signatureValidate);
    if (!validate) throw new Error('bouton « Valider » de la signature introuvable');
    await validate.click();
  }

  /** Après la saisie du code : attend la suite (pad de signature, validation, erreur). */
  async finish(page) {
    const deadline = Date.now() + this.timeout;
    let signed = false;
    while (Date.now() < deadline) {
      const text = await this.bodyText(page);
      if (includesAny(text, this.texts.presenceRegistered)) return { ok: true };
      if (includesAny(text, this.texts.signatureExpired)) return { ok: false, reason: 'la période de signature est terminée' };

      const codeError = await page.$eval(this.sel.codeError, (e) => e.innerText.trim()).catch(() => null);
      if (codeError) return { ok: false, reason: `code refusé : ${codeError}` };

      if (!signed && (await page.$(this.pages.signature))) {
        await this.drawSignature(page);
        signed = true;
      }
      const toast = await page.$eval(this.sel.toast, (e) => e.innerText.trim()).catch(() => '');
      if (toast && /erreur|error/i.test(toast)) return { ok: false, reason: toast.replace(/\s+/g, ' ') };
      await sleep(500);
    }
    return { ok: false, reason: 'pas de confirmation de SoWeSoft (vérifie la capture)' };
  }

  /** Signe avec le code. Renvoie { ok, dryRun?, already?, reason?, screenshot }. */
  async sign(code) {
    if (this.busy) return { ok: false, busy: true };
    const digits = String(code).replace(/\D/g, '');
    if (digits.length !== this.site.codeLength) {
      return { ok: false, reason: `le code SoWeSoft fait ${this.site.codeLength} chiffres (reçu : ${digits.length})` };
    }
    this.busy = true;
    try {
      return await this.withPage(async (page) => {
        try {
          const state = await this.open(page);
          const shot = (name) => this.screenshot(page, name);

          if (state === 'validated' && includesAny(await this.bodyText(page), this.texts.presenceRegistered)) {
            return { ok: true, already: true, screenshot: await shot('deja-signe') };
          }
          const blocked = {
            noCourse: 'SoWeSoft n’affiche aucun cours en ce moment',
            nextCourse: 'la signature n’est pas encore ouverte sur SoWeSoft',
            wrongTime: 'SoWeSoft signale une heure d’appareil incorrecte',
            accessDenied: 'accès refusé par SoWeSoft',
          }[state];
          if (blocked) return { ok: false, reason: blocked, screenshot: await shot(state) };

          if (state === 'detection') {
            // le dernier chiffre déclenche la vérification par SoWeSoft : on contrôle les premiers avant
            const head = digits.slice(0, -1);
            await this.pressKeys(page, head);
            if (!(await this.typedCode(page)).startsWith(head)) {
              return { ok: false, reason: 'la saisie du code n’a pas pris (vérifie la capture)', screenshot: await shot('saisie') };
            }
            if (this.dryRun) return { ok: true, dryRun: true, screenshot: await shot('dry-run') };
            await this.pressKeys(page, digits.slice(-1));
          }
          const result = await this.finish(page);
          return { ...result, screenshot: await shot(result.ok ? 'signe' : 'echec') };
        } catch (err) {
          return { ok: false, reason: err.message, screenshot: await this.screenshot(page, 'erreur') };
        }
      });
    } catch (err) {
      return { ok: false, reason: `navigateur : ${err.message}` };
    } finally {
      this.busy = false;
    }
  }

  /** Vérifie la connexion (et débloque la reconnexion après un échec). */
  async check() {
    this.loginLocked = null;
    try {
      return await this.withPage(async (page) => {
        try {
          const state = await this.open(page);
          return { ok: true, state, screenshot: await this.screenshot(page, 'test') };
        } catch (err) {
          return { ok: false, reason: err.message, screenshot: await this.screenshot(page, 'test-erreur') };
        }
      });
    } catch (err) {
      return { ok: false, reason: `navigateur : ${err.message}` };
    }
  }
}
