import { readFileSync, writeFileSync, existsSync, renameSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { dueReminders } from './reminders.js';

/** « 06 12 34 56 78 », « +33 6… », « 0033 6… » → « 33612345678 » (France par défaut). */
export function normalizePhone(raw) {
  let n = String(raw || '').replace(/[^\d+]/g, '');
  if (n.startsWith('+')) n = n.slice(1);
  else if (n.startsWith('00')) n = n.slice(2);
  else if (/^0\d{9}$/.test(n)) n = `33${n.slice(1)}`;
  return /^\d{8,15}$/.test(n) ? n : '';
}

const KEEP_SESSION_DAYS = 30;

/**
 * Membres de la classe qui reçoivent les rappels Telegram (sans signature automatique).
 * Stockés dans data/members.json : prénom, numéro, chat Telegram une fois relié, état des rappels.
 *
 * statut : invited (ajouté, pas encore relié) · active · paused (il a envoyé « stop » ou l'admin l'a mis en pause)
 */
export class Members {
  constructor(dataDir) {
    this.file = join(dataDir, 'members.json');
    this.list = existsSync(this.file) ? JSON.parse(readFileSync(this.file, 'utf8')) : [];
  }

  save() {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.list, null, 2));
    renameSync(tmp, this.file);
    try { chmodSync(this.file, 0o600); } catch { /* Windows */ }
  }

  all() { return this.list; }
  get(id) { return this.list.find((m) => m.id === id) || null; }
  byChat(chatId) { return this.list.find((m) => m.chatId === chatId) || null; }
  byInvite(code) { return code ? this.list.find((m) => m.inviteCode === String(code).toLowerCase()) || null : null; }
  byPhone(phone) {
    const n = normalizePhone(phone);
    return n ? this.list.find((m) => m.phone === n) || null : null;
  }

  add({ name, phone }) {
    const cleanName = String(name || '').trim().slice(0, 60);
    const n = normalizePhone(phone);
    if (!cleanName) throw new Error('Indique un prénom');
    if (!n) throw new Error('Numéro invalide (ex : 06 12 34 56 78)');
    if (this.byPhone(n)) throw new Error('Ce numéro est déjà dans la liste');
    const member = {
      id: randomBytes(5).toString('hex'),
      name: cleanName,
      phone: n,
      status: 'invited',
      inviteCode: randomBytes(5).toString('hex'),
      chatId: null,
      telegramName: null,
      addedAt: new Date().toISOString(),
      linkedAt: null,
      sessions: {},
    };
    this.list.push(member);
    this.save();
    return member;
  }

  link(member, chatId, telegramName) {
    // un compte Telegram = un seul membre
    for (const other of this.list) if (other !== member && other.chatId === chatId) Object.assign(other, { chatId: null, status: 'invited' });
    Object.assign(member, { chatId, telegramName, status: 'active', linkedAt: new Date().toISOString() });
    this.save();
    return member;
  }

  setPaused(member, paused) {
    if (!member.chatId) return member;
    member.status = paused ? 'paused' : 'active';
    this.save();
    return member;
  }

  remove(id) {
    this.list = this.list.filter((m) => m.id !== id);
    this.save();
  }

  newInvite(member) {
    member.inviteCode = randomBytes(5).toString('hex');
    this.save();
    return member;
  }

  /** Vue « store » d'un membre, pour réutiliser la logique des rappels. */
  storeFor(member) {
    return {
      session: (id) => member.sessions[id] || {},
      isDone: (id) => Boolean(member.sessions[id]?.done),
    };
  }

  markReminded(member, sessionId, index) {
    member.sessions[sessionId] = { ...member.sessions[sessionId], reminderIndex: index, at: new Date().toISOString() };
    this.save();
  }

  markDone(member, sessionId) {
    member.sessions[sessionId] = { ...member.sessions[sessionId], done: true, at: new Date().toISOString() };
    this.save();
  }

  /** Rappels dus pour chaque membre actif : [{ member, reminder }] */
  due(sessions, offsets, now = new Date()) {
    const out = [];
    for (const member of this.list) {
      if (member.status !== 'active' || !member.chatId) continue;
      for (const reminder of dueReminders(sessions, this.storeFor(member), offsets, now)) out.push({ member, reminder });
    }
    return out;
  }

  prune(now = new Date()) {
    const limit = now.getTime() - KEEP_SESSION_DAYS * 24 * 3600e3;
    for (const m of this.list) {
      for (const [id, s] of Object.entries(m.sessions)) if (new Date(s.at || 0).getTime() < limit) delete m.sessions[id];
    }
    this.save();
  }

  /** Infos pour l'admin (sans le chat Telegram). */
  view(member, inviteUrl) {
    const { sessions, chatId, ...rest } = member;
    return { ...rest, linked: Boolean(chatId), inviteUrl: inviteUrl ? inviteUrl(member) : null };
  }
}
