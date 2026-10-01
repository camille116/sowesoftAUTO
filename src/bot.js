import { basename } from 'node:path';
import { parseCommand } from './commands.js';
import { dueReminders } from './reminders.js';
import { msg } from './messages.js';
import { log } from './logger.js';

/**
 * Cerveau du bot, indépendant du canal :
 * `send(text, imagePath?)` est fourni par WhatsApp en prod (ou un faux canal en test),
 * et l'appli web appelle directement les mêmes méthodes (sign, markDone, skip…).
 */
export class Bot {
  constructor({ planning, store, signer, send, offsets, dryRun }) {
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
  }

  async handle(text, now = new Date()) {
    const cmd = parseCommand(text);
    log.info(`Commande reçue : ${cmd.type}`);

    switch (cmd.type) {
      case 'sign': return this.sign(cmd.code, now);
      case 'help': return this.send(msg.help(this.dryRun));
      case 'today': return this.send(msg.day("Aujourd'hui", await this.planning.day(now), this.store));
      case 'tomorrow': {
        const d = new Date(now); d.setDate(d.getDate() + 1);
        return this.send(msg.day('Demain', await this.planning.day(d), this.store));
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
      case 'test': return this.test();
      default: return this.send(msg.unknown());
    }
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

  async status(now) {
    const current = await this.planning.current(now, 0);
    const upcoming = await this.planning.between(now, new Date(now.getTime() + 14 * 24 * 3600e3));
    const next = upcoming.find((s) => s.start > now) || null;
    return this.send(msg.status({ paused: this.store.paused, current, next, dryRun: this.dryRun, store: this.store }));
  }

  async test() {
    await this.send(msg.testing());
    const result = await this.signer.check();
    this.store.log('test', { ok: result.ok, reason: result.reason, screenshot: result.screenshot ? basename(result.screenshot) : undefined });
    if (result.ok) await this.send(msg.testOk(), result.screenshot);
    else await this.send(msg.testFailed(result.reason), result.screenshot);
    return result;
  }
}
