import { basename } from 'node:path';
import { parseCommand } from './commands.js';
import { dueReminders } from './reminders.js';
import { msg, renderTemplate } from './messages.js';
import { log } from './logger.js';

/**
 * Cerveau du bot, indépendant du canal :
 * `send(text, imagePath?)` est fourni par WhatsApp en prod (ou un faux canal en test),
 * et l'appli web appelle directement les mêmes méthodes (sign, markDone, skip…).
 */
export class Bot {
  constructor({ planning, store, signer, send, offsets, dryRun, members = null, sendToMember = null, memberTemplate = '' }) {
    this.members = members; // camarades de classe : rappels seulement
    this.sendToMember = sendToMember;
    this.memberTemplate = memberTemplate;
    this.planning = planning;
    this.store = store;
    this.signer = signer;
    this.send = send;
    this.offsets = offsets;
    this.dryRun = dryRun;
  }

  /** Appelé toutes les TICK_SECONDS : envoie les rappels dus. */
  async tick(now = new Date()) {
    if (this.store.paused) return;
    const sessions = await this.planning.between(new Date(now.getTime() - 12 * 3600e3), new Date(now.getTime() + 3600e3));
    for (const reminder of dueReminders(sessions, this.store, this.offsets, now)) {
      await this.send(msg.reminder(reminder));
      this.store.update(reminder.session.id, { reminderIndex: reminder.index });
      this.store.log('reminder', { title: reminder.session.title, offset: reminder.offset });
      log.info(`Rappel envoyé (${reminder.offset} min) pour ${reminder.session.title}`);
    }
    await this.tickMembers(sessions, now);
  }

  async tickMembers(sessions, now) {
    if (!this.members || !this.sendToMember) return;
    let sent = 0;
    for (const { member, reminder } of this.members.due(sessions, this.offsets, now)) {
      try {
        await this.sendToMember(member, renderTemplate(this.memberTemplate, { member, session: reminder.session, offset: reminder.offset }));
        this.members.markReminded(member, reminder.session.id, reminder.index);
        sent++;
      } catch (err) {
        log.warn(`Rappel à ${member.name} impossible : ${err.message}`);
      }
    }
    if (sent) this.store.log('members-reminder', { count: sent, title: sessions.find((x) => x.start <= now && x.end >= now)?.subject });
  }

  /** Message d'un membre de la classe (il ne peut que gérer ses rappels). */
  async handleMember(member, text, now = new Date()) {
    const reply = (t) => this.sendToMember(member, t);
    const cmd = parseCommand(text);
    switch (cmd.type) {
      case 'done': {
        const current = await this.planning.current(now);
        if (!current) return reply(msg.memberNoCurrent());
        this.members.markDone(member, current.id);
        return reply(msg.memberDone(current));
      }
      case 'pause': this.members.setPaused(member, true); return reply(msg.memberPaused());
      case 'resume': this.members.setPaused(member, false); return reply(msg.memberResumed());
      case 'today': case 'status':
        return reply(await this.fullDay(now, "Aujourd'hui", this.members.storeFor(member), msg.memberDay));
      case 'tomorrow': {
        const d = new Date(now); d.setDate(d.getDate() + 1);
        return reply(await this.fullDay(d, 'Demain', this.members.storeFor(member), msg.memberDay));
      }
      case 'sign': return reply(msg.memberNoSign());
      default: return reply(msg.memberHelp());
    }
  }

  async handle(text, now = new Date()) {
    const cmd = parseCommand(text);
    log.info(`Commande reçue : ${cmd.type}`);

    switch (cmd.type) {
      case 'sign': return this.sign(cmd.code, now);
      case 'help': return this.send(msg.help(this.dryRun));
      case 'today': return this.send(await this.fullDay(now, "Aujourd'hui"));
      case 'tomorrow': {
        const d = new Date(now); d.setDate(d.getDate() + 1);
        return this.send(await this.fullDay(d, 'Demain'));
      }
      case 'week':
        return this.send(msg.week(await this.planning.between(now, new Date(now.getTime() + 7 * 24 * 3600e3)), this.store));
      case 'status': return this.status(now);
      case 'done': {
        const current = await this.planning.current(now);
        if (!current) return this.send(msg.noCurrent());
        this.markDone(current);
        return this.send(msg.markedDone(current));
      }
      case 'skip': {
        const current = await this.planning.current(now);
        if (!current) return this.send(msg.noCurrent());
        this.skip(current);
        return this.send(msg.skipped(current));
      }
      case 'pause': this.setPaused(true); return this.send(msg.paused());
      case 'resume': this.setPaused(false); return this.send(msg.resumed());
      case 'signature': return this.changeSignature(cmd.style);
      case 'test': return this.test();
      default: return this.send(msg.unknown());
    }
  }

  /** Journée complète (tous les cours + salles) avec les cours à signer marqués. */
  async fullDay(date, label, store = this.store, render = msg.fullDay) {
    const [courses, toSign] = await Promise.all([this.planning.allDay(date), this.planning.day(date)]);
    const day = date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    return render(`${label} – ${day}`, courses, new Set(toSign.map((x) => x.id)), (id) => store.isDone(id));
  }

  markDone(session) {
    this.store.markSigned(session.id, 'manuel');
    this.store.log('done', { title: session.title });
  }

  skip(session) {
    this.store.markSkipped(session.id);
    this.store.log('skip', { title: session.title });
  }

  setPaused(value) {
    this.store.setPaused(value);
    this.store.log(value ? 'pause' : 'resume');
  }

  /** Signe et renvoie le résultat (utilisé par WhatsApp et par l'appli web). */
  async sign(code, now = new Date()) {
    if (this.signer.busy) {
      await this.send(msg.signBusy());
      return { ok: false, busy: true };
    }
    await this.send(msg.signing(code));

    const result = await this.signer.sign(code);
    if (result.busy) {
      await this.send(msg.signBusy());
      return result;
    }

    const current = await this.planning.current(now);
    const entry = {
      code: result.dryRun ? `${String(code).slice(0, -1)}•` : String(code),
      title: current?.title,
      ok: result.ok,
      dryRun: Boolean(result.dryRun),
      already: Boolean(result.already),
      reason: result.reason,
      screenshot: result.screenshot ? basename(result.screenshot) : undefined,
    };
    this.store.log('sign', entry);

    if (result.dryRun) await this.send(msg.dryRun(code), result.screenshot);
    else if (!result.ok) await this.send(msg.signFailed(result.reason), result.screenshot);
    else {
      // signature OK : on la rattache au créneau en cours, s'il y en a un
      if (current) this.store.markSigned(current.id, 'bot');
      await this.send(result.already ? msg.alreadySigned(current) : msg.signed(current), result.screenshot);
    }
    return { ...result, session: current };
  }

  /** Change le style de signature tracée (commande « signature … »). */
  async changeSignature(style) {
    const current = this.readSignature?.() || { style: 'claude' };
    if (!style) return this.send(msg.signatureMenu(current.style));
    const sig = this.setSignatureStyle ? this.setSignatureStyle(style) : { ...current, style };
    this.store.log('signature-style', { title: sig.style });
    return this.send(msg.signatureSet(sig));
  }

  async status(now) {
    const current = await this.planning.current(now, 0);
    const upcoming = await this.planning.between(now, new Date(now.getTime() + 14 * 24 * 3600e3));
    const next = upcoming.find((s) => s.start > now) || null;
    return this.send(msg.status({ paused: this.store.paused, current, next, dryRun: this.dryRun, store: this.store }));
  }

  /** Test de connexion SoWeSoft. Depuis l'app (notify: false), aucun message n'est envoyé sur la messagerie. */
  async test({ notify = true } = {}) {
    if (notify) await this.send(msg.testing());
    const result = await this.signer.check();
    this.store.log('test', { ok: result.ok, reason: result.reason, screenshot: result.screenshot ? basename(result.screenshot) : undefined });
    if (notify) {
      if (result.ok) await this.send(msg.testOk(), result.screenshot);
      else await this.send(msg.testFailed(result.reason), result.screenshot);
    }
    return result;
  }
}
