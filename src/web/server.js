import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import QRCode from 'qrcode';
import { log } from '../logger.js';
import { msg, renderTemplate, TEMPLATE_VARS, DEFAULT_MEMBER_TEMPLATE } from '../messages.js';

const PUBLIC = join(import.meta.dirname, 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
};

const SESSION_DAYS = 30;
const MAX_FAILURES = 5; // essais de mot de passe ratés avant blocage temporaire
const LOCK_MS = 15 * 60e3;

// En-têtes de sécurité : pas d'iframe (clickjacking), scripts/requêtes uniquement depuis l'appli elle-même
const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'content-security-policy': [
    "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data:",
    "connect-src 'self'", "frame-ancestors 'none'", "base-uri 'none'", "form-action 'self'", "object-src 'none'",
  ].join('; '),
};

/**
 * Bloque les requêtes venues d'un autre site (CSRF) et le « DNS rebinding » :
 * l'appli ne répond qu'aux noms d'hôte locaux, et les POST doivent venir de l'appli elle-même.
 */
export function isTrustedRequest(req) {
  const host = String(req.headers.host || '').toLowerCase().replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  const localHost = host === 'localhost' || host === '::1' || /^127\./.test(host) || host.endsWith('.local')
    || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(host) || host.endsWith('.ts.net');
  if (!localHost) return false;
  if (req.method === 'GET' || req.method === 'HEAD') return true;
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) return false;
  const origin = req.headers.origin;
  if (!origin) return true; // clients non navigateurs (curl, tests)
  try {
    return new URL(origin).host.toLowerCase() === String(req.headers.host || '').toLowerCase();
  } catch {
    return false;
  }
}

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
    subject: s.subject,
    type: s.type,
    rooms: (s.rooms || []).map((r) => r.label),
    campus: s.campus || '',
    status: st.signedAt ? 'signed' : st.skipped ? 'skipped' : s.end < now ? 'missed' : 'pending',
    signedBy: st.signedBy,
    current: s.start <= now && s.end >= now,
  };
}

/**
 * Appli web LinkeD : API JSON + interface (src/web/public).
 * Protégée par WEB_PASSWORD ; sans mot de passe, elle n'écoute que sur la machine locale.
 */
export function createWebServer({ app, channels, updater, desktop, password, dataDir }) {
  const wa = () => channels?.whatsapp || null;
  const tg = () => channels?.telegram || null;
  const { bot, store, planning, signer, settings, members } = app;
  const tokens = new Map(); // jeton de session → date d'expiration
  const failures = new Map(); // adresse IP → { count, until }

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
    const token = /(?:^|;\s*)linked=([a-f0-9]+)/.exec(req.headers.cookie || '')?.[1];
    const expires = token && tokens.get(token);
    if (!expires) return false;
    if (expires < Date.now()) { tokens.delete(token); return false; }
    return true;
  };

  async function findSession(id) {
    const now = new Date();
    const sessions = await planning.between(new Date(now.getTime() - 14 * 24 * 3600e3), new Date(now.getTime() + 14 * 24 * 3600e3));
    return sessions.find((s) => s.id === id);
  }

  const routes = {
    'GET /api/me': async (req, res) => json(res, 200, { authed: isAuthed(req), passwordRequired: Boolean(password) }),

    'POST /api/login': async (req, res) => {
      const ip = req.socket.remoteAddress || '?';
      const f = failures.get(ip);
      if (f && f.until > Date.now()) {
        return json(res, 429, { error: `Trop d'essais. Réessaie dans ${Math.ceil((f.until - Date.now()) / 60e3)} min.` });
      }
      const { password: given = '' } = await readBody(req);
      if (!password || !sameSecret(String(given), password)) {
        const count = (f?.count || 0) + 1;
        failures.set(ip, { count, until: count >= MAX_FAILURES ? Date.now() + LOCK_MS : 0 });
        if (count >= MAX_FAILURES) log.warn(`Connexion à l'appli bloquée 15 min pour ${ip} (${count} essais ratés)`);
        await sleep(1000); // freine les essais en rafale
        return json(res, 401, { error: 'Mot de passe incorrect' });
      }
      failures.delete(ip);
      const token = randomBytes(32).toString('hex');
      tokens.set(token, Date.now() + SESSION_DAYS * 24 * 3600e3);
      res.setHeader('set-cookie', `linked=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_DAYS * 24 * 3600}`);
      return json(res, 200, { ok: true });
    },

    'GET /api/status': async (req, res) => {
      const now = new Date();
      const current = await planning.current(now, 0);
      const upcoming = await planning.between(now, new Date(now.getTime() + 14 * 24 * 3600e3));
      const next = upcoming.find((s) => s.start > now);
      const s = settings.get();
      const today = await planning.day(now);
      const since = now.getTime() - 30 * 24 * 3600e3;
      const signed = Object.values(store.state.sessions).filter((x) => x.signedAt && new Date(x.signedAt).getTime() >= since);
      json(res, 200, {
        today: { total: today.length, pending: today.filter((x) => !store.isDone(x.id) && x.end >= now).length },
        stats: { signed: signed.length, byBot: signed.filter((x) => x.signedBy === 'bot').length },
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
      if (!wa()) return json(res, 200, { status: 'off', number: settings.get().whatsappNumber || '' });
      const { status, qr, code, percent, error } = wa().state;
      json(res, 200, {
        status, code, percent, error, number: settings.get().whatsappNumber || '',
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

    'GET /api/courses': async (req, res) => {
      const now = new Date();
      const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const list = await planning.subjects(from, new Date(from.getTime() + 60 * 24 * 3600e3));
      const { mode, subjects } = settings.get().notify;
      const selected = new Set(subjects);
      json(res, 200, {
        mode,
        icsConfigured: Boolean(planning.icsUrl),
        courses: list.map((c) => ({ ...c, next: c.next?.toISOString() || null, selected: selected.has(c.subject) })),
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
      const result = await bot.test({ notify: false }); // le résultat s'affiche dans l'app, pas sur Telegram
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

    'GET /api/desktop': async (req, res) => json(res, 200, desktop ? desktop.status() : { mac: false }),

    'POST /api/desktop/repair': async (req, res) => {
      if (!desktop) return json(res, 400, { error: 'Indisponible' });
      try {
        json(res, 200, desktop.repair());
      } catch (err) {
        json(res, 400, { error: err.message });
      }
    },

    'POST /api/relay/test': async (req, res) => {
      if (!app.relay) return json(res, 400, { error: 'Relais indisponible' });
      try {
        const { url, secret } = await readBody(req);
        await app.relay.test(url, secret || settings.get().relaySecret);
        json(res, 200, { ok: true });
      } catch (err) {
        json(res, 400, { error: err.message });
      }
    },

    'POST /api/relay/test-reminder': async (req, res) => {
      if (!app.relay) return json(res, 400, { error: 'Relais indisponible' });
      try {
        const r = await app.relay.testReminder();
        json(res, 200, r);
      } catch (err) {
        json(res, 400, { error: err.message });
      }
    },

    // ── Scan WhatsApp (lecture seule) ──
    'GET /api/whatsapp-scan': async (req, res) => {
      const sc = app.scanner;
      const cfg = settings.get().whatsappScan || {};
      const status = sc?.state?.status || 'off';
      json(res, 200, { enabled: Boolean(cfg.enabled), groupId: cfg.groupId || '', groupName: cfg.groupName || '',
        status, error: sc?.state?.error || null,
        image: status === 'qr' && sc?.state?.qr ? await QRCode.toDataURL(sc.state.qr, { margin: 1, width: 260 }) : null });
    },
    'GET /api/whatsapp-scan/groups': async (req, res) => {
      if (!app.scanner) return json(res, 200, { groups: [] });
      json(res, 200, { groups: await app.scanner.listGroups().catch(() => []) });
    },
    'POST /api/whatsapp-scan/reset': async (req, res) => {
      if (!app.scanner) return json(res, 400, { error: 'Scan indisponible' });
      await app.scanner.reset().catch(() => {});
      json(res, 200, { ok: true });
    },

    'GET /api/version': async (req, res) => {
      if (!updater) return json(res, 200, { current: null, canUpdate: false, updateAvailable: false });
      json(res, 200, await updater.info());
    },

    'POST /api/update': async (req, res) => {
      if (!updater) return json(res, 400, { error: 'Mise à jour indisponible' });
      try {
        json(res, 200, await updater.update());
      } catch (err) {
        json(res, 400, { error: err.message });
      }
    },

    // ── Classe : membres qui reçoivent les rappels Telegram ──
    'GET /api/members': async (req, res) => {
      const t = tg();
      const sample = {
        member: { name: 'Léa' },
        session: (await planning.current(new Date(), 60 * 24)) || {
          subject: 'Marketplaces', type: 'AUTONOMIE', start: new Date(new Date().setHours(17, 30, 0, 0)), end: new Date(new Date().setHours(19, 30, 0, 0)),
        },
        offset: 0,
      };
      json(res, 200, {
        telegram: { status: t?.state.status || 'off', username: t?.state.username || null, botUrl: t?.botUrl?.() || null },
        members: members.all().map((m) => members.view(m, (x) => t?.inviteUrl?.(x))),
        template: settings.get().memberTemplate,
        defaultTemplate: DEFAULT_MEMBER_TEMPLATE,
        vars: TEMPLATE_VARS,
        preview: renderTemplate(settings.get().memberTemplate, sample),
      });
    },

    'POST /api/members': async (req, res) => {
      try {
        const member = members.add(await readBody(req));
        store.log('member-added', { title: member.name });
        json(res, 200, { member: members.view(member, (x) => tg()?.inviteUrl?.(x)) });
      } catch (err) {
        json(res, 400, { error: err.message });
      }
    },

    'POST /api/members/action': async (req, res) => {
      const { id, action } = await readBody(req);
      const member = members.get(id);
      if (!member) return json(res, 404, { error: 'Membre introuvable' });
      try {
        if (action === 'remove') { members.remove(id); store.log('member-removed', { title: member.name }); return json(res, 200, { ok: true }); }
        if (action === 'pause') members.setPaused(member, true);
        else if (action === 'resume') members.setPaused(member, false);
        else if (action === 'invite') members.newInvite(member);
        else if (action === 'test') {
          if (!member.chatId) return json(res, 409, { error: `${member.name} n’a pas encore rejoint le bot` });
          if (tg()?.state.status !== 'ready' && tg()?.state.status !== 'waiting_link') return json(res, 409, { error: 'Le bot Telegram n’est pas prêt' });
          await tg().sendTo(member.chatId, msg.memberTest(member));
        } else return json(res, 400, { error: 'Action inconnue' });
        json(res, 200, { member: members.view(member, (x) => tg()?.inviteUrl?.(x)) });
      } catch (err) {
        json(res, 500, { error: err.message });
      }
    },

    'POST /api/members/preview': async (req, res) => {
      const { template } = await readBody(req);
      const session = { subject: 'Marketplaces', type: 'AUTONOMIE', start: new Date(new Date().setHours(17, 30, 0, 0)), end: new Date(new Date().setHours(19, 30, 0, 0)) };
      json(res, 200, { preview: renderTemplate(String(template || '').slice(0, 1000), { member: { name: 'Léa' }, session, offset: 0 }) });
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
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
    if (!isTrustedRequest(req)) return json(res, 403, { error: 'Requête refusée (origine non autorisée)' });
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
