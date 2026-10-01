import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import QRCode from 'qrcode';
import { log } from '../logger.js';
import { msg } from '../messages.js';

const PUBLIC = join(import.meta.dirname, 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
};

const sha = (s) => createHash('sha256').update(String(s)).digest();
const sameSecret = (a, b) => timingSafeEqual(sha(a), sha(b));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function sessionView(s, store, now) {
  const st = store.session(s.id);
  return {
    id: s.id,
    title: s.title,
    start: s.start.toISOString(),
    end: s.end.toISOString(),
    source: s.source,
    status: st.signedAt ? 'signed' : st.skipped ? 'skipped' : s.end < now ? 'missed' : 'pending',
    signedBy: st.signedBy,
    current: s.start <= now && s.end >= now,
  };
}

/**
 * Appli web d'Émile : API JSON + interface (src/web/public).
 * Protégée par WEB_PASSWORD ; sans mot de passe, elle n'écoute que sur la machine locale.
 */
export function createWebServer({ app, channels, password, dataDir }) {
  const wa = () => channels?.whatsapp || null;
  const tg = () => channels?.telegram || null;
  const { bot, store, planning, signer, settings } = app;
  const tokens = new Set();

  const json = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };

  const readBody = (req) => new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e5) req.destroy(); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error('JSON invalide')); } });
  });

  const isAuthed = (req) => {
    if (!password) return true;
    const token = /(?:^|;\s*)emile=([a-f0-9]+)/.exec(req.headers.cookie || '')?.[1];
    return Boolean(token && tokens.has(token));
  };

  async function findSession(id) {
    const now = new Date();
    const sessions = await planning.between(new Date(now.getTime() - 14 * 24 * 3600e3), new Date(now.getTime() + 14 * 24 * 3600e3));
    return sessions.find((s) => s.id === id);
  }

  const routes = {
    'GET /api/me': async (req, res) => json(res, 200, { authed: isAuthed(req), passwordRequired: Boolean(password) }),

    'POST /api/login': async (req, res) => {
      const { password: given = '' } = await readBody(req);
      if (!password || !sameSecret(given, password)) {
        await sleep(1000); // freine les essais en rafale
        return json(res, 401, { error: 'Mot de passe incorrect' });
      }
      const token = randomBytes(24).toString('hex');
      tokens.add(token);
      res.setHeader('set-cookie', `emile=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${60 * 60 * 24 * 30}`);
      return json(res, 200, { ok: true });
    },

    'GET /api/status': async (req, res) => {
      const now = new Date();
      const current = await planning.current(now, 0);
      const upcoming = await planning.between(now, new Date(now.getTime() + 14 * 24 * 3600e3));
      const next = upcoming.find((s) => s.start > now);
      const s = settings.get();
      json(res, 200, {
        messaging: { channel: s.channel, status: channels?.active?.state.status || 'off' },
        paused: store.paused,
        dryRun: s.dryRun,
        loginMethod: s.auth.method,
        loginLocked: signer.loginLocked,
        signing: signer.busy,
        current: current && sessionView(current, store, now),
        next: next && sessionView(next, store, now),
        lastSign: store.history.find((h) => h.type === 'sign') || null,
      });
    },

    'GET /api/qr': async (req, res) => {
      if (!wa()) return json(res, 200, { status: 'off' });
      const { status, qr, code, percent, error } = wa().state;
      json(res, 200, {
        status, code, percent, error,
        image: status === 'qr' && qr ? await QRCode.toDataURL(qr, { margin: 1, width: 280 }) : null,
      });
    },

    'POST /api/whatsapp/pair': async (req, res) => {
      if (!wa()?.pair) return json(res, 400, { error: 'WhatsApp n’est pas lancé' });
      try {
        const { phone } = await readBody(req);
        json(res, 200, { code: await wa().pair(phone) });
      } catch (err) {
        json(res, 400, { error: err.message || String(err) });
      }
    },

    'GET /api/telegram': async (req, res) => {
      const t = tg();
      if (!t) return json(res, 200, { status: 'off' });
      const link = t.linkUrl();
      json(res, 200, {
        status: t.state.status, username: t.state.username, error: t.state.error,
        owner: t.state.owner?.name || null, link, linkCode: t.state.linkCode,
        qr: link && t.state.status === 'waiting_link' ? await QRCode.toDataURL(link, { margin: 1, width: 220 }) : null,
      });
    },

    'POST /api/telegram/unlink': async (req, res) => {
      tg()?.unlink();
      json(res, 200, { ok: true });
    },

    'POST /api/notify-test': async (req, res) => {
      const ch = channels?.active;
      const name = settings.get().channel === 'whatsapp' ? 'WhatsApp' : 'Telegram';
      if (!ch || ch.state.status !== 'ready') return json(res, 409, { error: `${name} n’est pas encore relié (onglet Réglages)` });
      try {
        await ch.send(msg.testNotification());
        store.log('notif-test', { channel: name });
        json(res, 200, { ok: true, channel: name });
      } catch (err) {
        json(res, 500, { error: `Envoi impossible : ${err.message || err}` });
      }
    },

    'POST /api/whatsapp/reset': async (req, res) => {
      if (!wa()?.reset) return json(res, 400, { error: 'WhatsApp n’est pas lancé' });
      wa().reset().catch((e) => log.error('Reset WhatsApp :', e));
      json(res, 200, { ok: true });
    },

    'GET /api/planning': async (req, res, url) => {
      const now = new Date();
      const days = Math.min(Number(url.searchParams.get('days') || 7), 31);
      const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const sessions = await planning.between(from, new Date(from.getTime() + days * 24 * 3600e3));
      json(res, 200, {
        sessions: sessions.map((s) => sessionView(s, store, now)),
        ics: { configured: Boolean(planning.icsUrl), error: planning.lastError, loaded: Boolean(planning.calendar) },
      });
    },

    'GET /api/history': async (req, res) => json(res, 200, { history: store.history.slice(0, 100) }),

    'POST /api/sign': async (req, res) => {
      const { code = '' } = await readBody(req);
      if (!/^\d{5}$/.test(String(code).replace(/\s/g, ''))) return json(res, 400, { error: 'Le code fait 5 chiffres' });
      const result = await bot.sign(String(code).replace(/\s/g, ''));
      json(res, 200, {
        ok: result.ok, dryRun: result.dryRun, already: result.already, busy: result.busy,
        reason: result.reason, screenshot: result.screenshot ? result.screenshot.split(/[\\/]/).pop() : null,
      });
    },

    'POST /api/test': async (req, res) => {
      const result = await bot.test();
      json(res, 200, { ok: result.ok, reason: result.reason, screenshot: result.screenshot ? result.screenshot.split(/[\\/]/).pop() : null });
    },

    'POST /api/pause': async (req, res) => {
      const { paused } = await readBody(req);
      bot.setPaused(Boolean(paused));
      json(res, 200, { paused: store.paused });
    },

    'POST /api/session': async (req, res) => {
      const { id, action } = await readBody(req);
      const session = await findSession(id);
      if (!session) return json(res, 404, { error: 'Créneau introuvable' });
      if (action === 'done') bot.markDone(session);
      else if (action === 'skip') bot.skip(session);
      else if (action === 'reset') store.update(session.id, { signedAt: null, signedBy: null, skipped: false });
      else return json(res, 400, { error: 'Action inconnue' });
      json(res, 200, { session: sessionView(session, store, new Date()) });
    },

    'GET /api/settings': async (req, res) => json(res, 200, settings.public()),

    'POST /api/settings': async (req, res) => {
      try {
        json(res, 200, app.updateSettings(await readBody(req)));
      } catch (err) {
        json(res, 400, { error: err.message });
      }
    },
  };

  async function serveStatic(res, pathname) {
    const file = pathname === '/' ? 'index.html' : pathname.slice(1);
    if (!/^[\w.-]+$/.test(file)) return false;
    const full = join(PUBLIC, file);
    if (!existsSync(full)) return false;
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(await readFile(full));
    return true;
  }

  return createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'no-referrer');
    try {
      const route = routes[`${req.method} ${url.pathname}`];
      if (route) {
        const open = ['GET /api/me', 'POST /api/login'].includes(`${req.method} ${url.pathname}`);
        if (!open && !isAuthed(req)) return json(res, 401, { error: 'Connexion requise' });
        return await route(req, res, url);
      }
      const shot = /^\/api\/screenshots\/([\w.-]+\.png)$/.exec(url.pathname);
      if (shot && req.method === 'GET') {
        if (!isAuthed(req)) return json(res, 401, { error: 'Connexion requise' });
        const full = join(dataDir, 'screenshots', shot[1]);
        if (!existsSync(full)) return json(res, 404, { error: 'Capture introuvable' });
        res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'private, max-age=86400' });
        return res.end(await readFile(full));
      }
      if (req.method === 'GET' && (await serveStatic(res, url.pathname))) return;
      json(res, 404, { error: 'Introuvable' });
    } catch (err) {
      log.error('Erreur web :', err);
      json(res, 500, { error: err.message });
    }
  });
}
