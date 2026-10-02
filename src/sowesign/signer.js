import puppeteer from 'puppeteer';
import { mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const normalize = (t) =>
  String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’`]/g, "'").toLowerCase();
const includesAny = (text, list = []) => list.some((t) => normalize(text).includes(normalize(t)));

// Le mascotte pixel-art Claude, décrit en coordonnées locales (largeur 1.0 × hauteur 0.68,
// bras compris : ils donnent au sprite sa forme plus large que haute). y vers le bas.
const SPRITE = {
  width: 1.0,
  height: 0.68,
  // zones pleines (corps + bras qui dépassent sur les côtés)
  fill: [
    { x0: 0.16, y0: 0.0, x1: 0.84, y1: 0.54 }, // tête + corps
    { x0: 0.0, y0: 0.25, x1: 1.0, y1: 0.38 }, // bras (pleine largeur)
    { x0: 0.22, y0: 0.54, x1: 0.29, y1: 0.68 }, // patte
    { x0: 0.35, y0: 0.54, x1: 0.42, y1: 0.68 }, // patte
    { x0: 0.58, y0: 0.54, x1: 0.65, y1: 0.68 }, // patte
    { x0: 0.71, y0: 0.54, x1: 0.78, y1: 0.68 }, // patte
  ],
  // yeux : rectangles vides à réserver dans la zone pleine
  holes: [
    { x0: 0.29, y0: 0.11, x1: 0.38, y1: 0.24 },
    { x0: 0.62, y0: 0.11, x1: 0.71, y1: 0.24 },
  ],
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Enlève le segment [a,b] de la liste d'intervalles (pour creuser les yeux). */
function cutInterval(intervals, a, b) {
  const out = [];
  for (const [s, e] of intervals) {
    if (b <= s || a >= e) { out.push([s, e]); continue; } // aucun recouvrement
    if (a > s) out.push([s, a]);
    if (b < e) out.push([b, e]);
  }
  return out;
}

/** Fusionne les intervalles qui se chevauchent. */
function mergeIntervals(list) {
  const sorted = [...list].sort((p, q) => p[0] - q[0]);
  const out = [];
  for (const [s, e] of sorted) {
    const last = out.at(-1);
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

/**
 * Trace le mascotte pixel-art Claude dans le cadre de signature : on balaie des traits
 * horizontaux pour « remplir » les zones pleines (corps, bras, pattes) en réservant les yeux.
 * Le sprite garde ses proportions et est centré ; les bras pleine largeur lui font occuper
 * tout le cadre, ce qui évite que SoWeSoft refuse une signature trop petite.
 */
export function signatureStrokes(width, height) {
  // échelle uniforme pour que le sprite tienne dans le cadre (ses proportions sont conservées)
  const scale = Math.min(width / SPRITE.width, height / SPRITE.height);
  const spriteW = SPRITE.width * scale;
  const spriteH = SPRITE.height * scale;
  const offX = (width - spriteW) / 2;
  const offY = (height - spriteH) / 2;
  const X = (sx) => offX + sx * scale;
  const Y = (sy) => offY + sy * scale;

  const lines = clamp(Math.round(spriteH / 5), 18, 42); // un trait tous les ~5 px (assez dense, pas trop long à tracer)
  const strokes = [];
  for (let i = 0; i <= lines; i++) {
    const sy = (i / lines) * SPRITE.height;
    let spans = SPRITE.fill.filter((r) => sy >= r.y0 && sy < r.y1).map((r) => [r.x0, r.x1]);
    if (!spans.length) continue;
    spans = mergeIntervals(spans);
    for (const hole of SPRITE.holes) {
      if (sy >= hole.y0 && sy < hole.y1) spans = cutInterval(spans, hole.x0, hole.x1);
    }
    for (const [a, b] of spans) {
      if (b - a < 0.01) continue;
      strokes.push([[X(a), Y(sy)], [X((a + b) / 2), Y(sy)], [X(b), Y(sy)]]);
    }
  }
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
    // durée maximale d'une tentative complète (ouverture + code + signature) avant coupure forcée
    this.maxRunMs = site.maxRunMs || 120000;
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
    // Garde-fou : si une étape se bloque (clic sur un canevas masqué, bouton introuvable…),
    // on ferme le navigateur après maxRunMs → les opérations en attente échouent et on répond
    // toujours quelque chose, au lieu de rester bloqué indéfiniment.
    const watchdog = setTimeout(() => { browser.close().catch(() => {}); }, this.maxRunMs);
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
      clearTimeout(watchdog);
      await browser.close().catch(() => {});
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

  /**
   * Après l'ouverture du portail : attend soit le vrai formulaire de connexion (bouton « Continuer »
   * ou champ e-mail), soit une redirection vers l'espace étudiant (session encore valable).
   * Renvoie 'student' si on est déjà connecté, sinon 'form'.
   */
  async waitForLoginForm(page, timeout = 10000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (page.url().includes('/student')) return 'student';
      if ((await page.$(this.sel.continue)) || (await page.$(this.sel.email))) return 'form';
      await sleep(300);
    }
    return 'form'; // on tente quand même le formulaire
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

    // La session peut être encore valable : le portail redirige alors directement vers l'espace
    // étudiant. Inutile (et impossible) de ressaisir les identifiants → on s'arrête là.
    const form = await this.waitForLoginForm(page);
    if (form === 'student') return;

    const cont = await page.$(this.sel.continue);
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
      const emailField = await page.waitForSelector(this.sel.email, { visible: true, timeout: 10000 }).catch(() => null);
      if (!emailField) {
        if (page.url().includes('/student')) return; // session redevenue valable entre-temps
        throw new Error('champ e-mail SoWeSoft introuvable (la page a peut-être changé — vérifie la capture)');
      }
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
    // La fenêtre « Informations légales » peut masquer la vraie page : on la ferme avant de décider.
    await this.closePopups(page, 1200);
    let state = await this.waitForState(page);
    if (state === 'login' || state === 'accessDenied') {
      await this.login(page);
      await this.closePopups(page, 1200);
      state = await this.waitForState(page, Object.keys(this.pages));
    }
    if (!state) throw new Error('page SoWeSoft non reconnue (vérifie la capture)');
    await this.closePopups(page);
    return state;
  }

  /**
   * Ferme les fenêtres d'information (mentions légales, aide…) qui s'affichent par-dessus le code
   * et, surtout, par-dessus le pavé de signature (sinon les clics tombent sur la popup).
   * On cherche le bouton « Fermer » dans TOUTE la page (le conteneur de la popup varie selon
   * les versions de SoWeSoft), en priorité le plus en avant-plan (z-index le plus haut).
   */
  async closePopups(page, waitMs = 3000) {
    const deadline = Date.now() + waitMs;
    let closed = false;
    while (Date.now() < deadline) {
      const clicked = await page.evaluate((labels) => {
        const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’`]/g, "'").toLowerCase().trim();
        const wanted = labels.map(norm);
        const visible = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
        const candidates = [...document.querySelectorAll('button, a, div, span, [role="button"], .cursor-pointer, .button, .btn')]
          .filter((e) => wanted.includes(norm(e.innerText || e.textContent)) && visible(e));
        if (!candidates.length) return false;
        const zOf = (e) => { let z = 0; for (let n = e; n; n = n.parentElement) { const v = parseInt(getComputedStyle(n).zIndex, 10); if (!Number.isNaN(v)) z = Math.max(z, v); } return z; };
        const depth = (e) => { let d = 0; for (let n = e; n; n = n.parentElement) d++; return d; };
        const pointer = (e) => getComputedStyle(e).cursor === 'pointer';
        // on vise le vrai bouton, pas son conteneur : curseur « main » d'abord, puis l'avant-plan
        // (popup la plus récente), puis l'élément le plus profond (le bouton lui-même).
        candidates.sort((a, b) => (pointer(b) - pointer(a)) || (zOf(b) - zOf(a)) || (depth(b) - depth(a)));
        candidates[0].click();
        return true;
      }, this.texts.closePopup).catch(() => false);
      if (clicked) { closed = true; await sleep(700); } // une popup fermée peut en révéler une autre
      else if (closed) break; // plus rien à fermer
      else await sleep(300); // la popup peut apparaître avec un léger retard
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
    // une popup (mentions légales…) peut recouvrir le canevas : on la ferme d'abord, sinon les
    // clics de souris tombent dessus et la signature ne se trace jamais.
    await this.closePopups(page, 1500);
    const canvas = await page.waitForSelector(this.sel.signatureCanvas, { visible: true });
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canevas de signature masqué (une fenêtre est peut-être ouverte par-dessus)');
    for (const stroke of signatureStrokes(box.width, box.height)) {
      await page.mouse.move(box.x + stroke[0][0], box.y + stroke[0][1]);
      await page.mouse.down();
      for (const [x, y] of stroke.slice(1)) await page.mouse.move(box.x + x, box.y + y, { steps: 2 });
      await page.mouse.up();
    }
    await sleep(300);
    // on vise le bouton « Valider » par son libellé (plus fiable que .cursor-pointer, qui peut
    // aussi désigner « Effacer »), avec repli sur le sélecteur configuré.
    if (!(await this.clickByText(page, `${this.sel.signatureValidate}, app-signature-component button, app-signature-component div`, this.texts.validate))) {
      const validate = await page.$(this.sel.signatureValidate);
      if (!validate) throw new Error('bouton « Valider » de la signature introuvable');
      await validate.click();
    }
  }

  /** Après la saisie du code : attend la suite (pad de signature, validation, erreur). */
  async finish(page) {
    let deadline = Date.now() + this.timeout;
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
        deadline = Date.now() + this.timeout; // le tracé du logo est long : on relance le délai pour la confirmation
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
