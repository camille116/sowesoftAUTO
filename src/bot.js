import { parseCommand } from './commands.js';
import { dueReminders } from './reminders.js';
import { msg } from './messages.js';
import { log } from './logger.js';

/**
 * Cerveau du bot, indépendant de WhatsApp :
 * `send(text, imagePath?)` est fourni par le canal (WhatsApp en prod, faux canal en test).
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
        this.store.markSigned(current.id, 'manuel');
        return this.send(msg.markedDone(current));
      }
      case 'skip': {
        const current = await this.planning.current(now);
        if (!current) return this.send(msg.noCurrent());
        this.store.markSkipped(current.id);
        return this.send(msg.skipped(current));
      }
      case 'pause': this.store.setPaused(true); return this.send(msg.paused());
      case 'resume': this.store.setPaused(false); return this.send(msg.resumed());
      case 'test': return this.test();
      default: return this.send(msg.unknown());
    }
  }

  async sign(code, now) {
    if (this.signer.busy) return this.send(msg.signBusy());
    await this.send(msg.signing(code));

    const result = await this.signer.sign(code);
    if (result.busy) return this.send(msg.signBusy());

    if (result.dryRun) return this.send(msg.dryRun(code), result.screenshot);
    if (!result.ok) return this.send(msg.signFailed(result.reason), result.screenshot);

    // signature OK : on la rattache au créneau en cours, s'il y en a un
    const current = await this.planning.current(now);
    if (current) this.store.markSigned(current.id, 'bot');
    return this.send(msg.signed(current), result.screenshot);
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
    return result.ok
      ? this.send(msg.testOk(), result.screenshot)
      : this.send(msg.testFailed(result.reason), result.screenshot);
  }
}
