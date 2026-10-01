import puppeteer from 'puppeteer';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const normalize = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

async function firstVisible(page, selector) {
  if (!selector) return null;
  for (const el of await page.$$(selector)) {
    if (await el.isVisible()) return el;
  }
  return null;
}

async function allVisible(page, selector) {
  const out = [];
  for (const el of await page.$$(selector)) {
    if (await el.isVisible()) out.push(el);
  }
  return out;
}

const bodyText = async (page) =>
  normalize(await page.evaluate(() => document.body?.innerText || '').catch(() => ''));

/**
 * Attend qu'un des textes APPARAISSE dans la page (absent de `baseline`, le texte avant validation).
 * Renvoie { outcome: 'success' | 'error' | null }.
 */
async function waitForOutcome(page, baseline, successTexts, errorTexts, timeoutMs) {
  const appeared = (body, t) => body.includes(normalize(t)) && !baseline.includes(normalize(t));
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const body = await bodyText(page);
    const err = errorTexts.find((t) => appeared(body, t));
    if (err) return { outcome: 'error', text: err };
    const ok = successTexts.find((t) => appeared(body, t));
    if (ok) return { outcome: 'success', text: ok };
    await new Promise((r) => setTimeout(r, 500));
  }
  return { outcome: null };
}

/**
 * Pilote un navigateur headless pour signer sur la plateforme d'émargement.
 * Les URLs / sélecteurs viennent de config/sowesign.json : la plateforme peut changer
 * son interface, on l'ajuste sans toucher au code.
 */
export class SowesignSigner {
  constructor({ site, login, password, dryRun, browser, dataDir }) {
    this.site = site;
    this.sel = site.selectors || {};
    this.login = login;
    this.password = password;
    this.dryRun = dryRun;
    this.browserOpts = browser;
    this.profileDir = join(dataDir, 'sowesign-profile'); // garde la session (cookies) entre deux signatures
    this.shotsDir = join(dataDir, 'screenshots');
    this.timeout = site.timeoutMs || 20000;
    this.busy = false;
    mkdirSync(this.shotsDir, { recursive: true });
  }

  async withPage(fn) {
    const browser = await puppeteer.launch({
      headless: this.browserOpts.headless,
      executablePath: this.browserOpts.executablePath,
      userDataDir: this.profileDir,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--lang=fr-FR'],
    });
    try {
      const page = await browser.newPage();
      page.setDefaultTimeout(this.timeout);
      await page.setViewport({ width: 420, height: 860, isMobile: true });
      return await fn(page);
    } finally {
      await browser.close();
    }
  }

  async screenshot(page, name) {
    const path = join(this.shotsDir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${name}.png`);
    await page.screenshot({ path, fullPage: true }).catch(() => {});
    return path;
  }

  async ensureLoggedIn(page) {
    const target = this.site.signUrl || this.site.url;
    await page.goto(target, { waitUntil: 'networkidle2' });

    const passwordField = await firstVisible(page, this.sel.password);
    if (passwordField) {
      if (!this.login || !this.password) throw new Error('identifiants SOWESIGN_LOGIN / SOWESIGN_PASSWORD manquants');
      const userField = await firstVisible(page, this.sel.username);
      if (!userField) throw new Error('champ identifiant introuvable (sélecteur "username")');
      await userField.click({ count: 3 });
      await userField.type(this.login, { delay: 30 });
      await passwordField.click({ count: 3 });
      await passwordField.type(this.password, { delay: 30 });

      const submit = await firstVisible(page, this.sel.loginSubmit);
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}),
        submit ? submit.click() : passwordField.press('Enter'),
      ]);
      if (await firstVisible(page, this.sel.password)) throw new Error('connexion refusée (identifiants ?)');
      if (this.site.signUrl && page.url() !== this.site.signUrl) {
        await page.goto(this.site.signUrl, { waitUntil: 'networkidle2' });
      }
    }

    if (this.sel.loggedIn) {
      await page.waitForSelector(this.sel.loggedIn, { visible: true }).catch(() => {
        throw new Error('pas connecté (sélecteur "loggedIn" absent)');
      });
    }
  }

  async typeCode(page, code) {
    if (this.sel.openSignature) {
      const open = await firstVisible(page, this.sel.openSignature);
      if (open) await open.click();
    }
    await page.waitForSelector(this.sel.codeInput, { visible: true }).catch(() => {
      throw new Error('champ du code introuvable (sélecteur "codeInput") – la session est-elle ouverte ?');
    });

    const inputs = await allVisible(page, this.sel.codeInput);
    const oneCharEach = inputs.length > 1 &&
      (await Promise.all(inputs.map((el) => el.evaluate((n) => n.maxLength)))).every((m) => m === 1);

    if (oneCharEach) {
      // code découpé en cases (une par chiffre)
      for (let i = 0; i < code.length && i < inputs.length; i++) await inputs[i].type(code[i], { delay: 40 });
    } else {
      await inputs[0].click({ count: 3 });
      await inputs[0].type(code, { delay: 40 });
    }
    return inputs[inputs.length - 1];
  }

  /** Signe avec le code. Renvoie { ok, dryRun?, reason?, screenshot }. */
  async sign(code) {
    if (this.busy) return { ok: false, busy: true };
    this.busy = true;
    try {
      return await this.withPage(async (page) => {
        try {
          await this.ensureLoggedIn(page);
          const lastInput = await this.typeCode(page, code);

          if (this.dryRun) return { ok: true, dryRun: true, screenshot: await this.screenshot(page, 'dry-run') };

          const baseline = await bodyText(page);
          const submit = await firstVisible(page, this.sel.codeSubmit);
          if (submit) await submit.click();
          else await lastInput.press('Enter');

          const { outcome, text } = await waitForOutcome(
            page, baseline, this.site.successTexts || [], this.site.errorTexts || [], this.timeout,
          );
          const screenshot = await this.screenshot(page, outcome || 'unknown');
          if (outcome === 'success') return { ok: true, screenshot };
          if (outcome === 'error') return { ok: false, reason: `la plateforme répond « ${text} »`, screenshot };
          return { ok: false, reason: 'pas de confirmation reçue (vérifie la capture)', screenshot };
        } catch (err) {
          return { ok: false, reason: err.message, screenshot: await this.screenshot(page, 'error') };
        }
      });
    } catch (err) {
      return { ok: false, reason: `navigateur : ${err.message}` };
    } finally {
      this.busy = false;
    }
  }

  /** Vérifie juste qu'on arrive à se connecter. */
  async check() {
    try {
      return await this.withPage(async (page) => {
        try {
          await this.ensureLoggedIn(page);
          return { ok: true, screenshot: await this.screenshot(page, 'check') };
        } catch (err) {
          return { ok: false, reason: err.message, screenshot: await this.screenshot(page, 'check-error') };
        }
      });
    } catch (err) {
      return { ok: false, reason: `navigateur : ${err.message}` };
    }
  }
}
