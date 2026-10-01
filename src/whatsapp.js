import pkg from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import { join } from 'node:path';
import { BOT_TAG } from './messages.js';
import { log } from './logger.js';

const { Client, LocalAuth, MessageMedia } = pkg;

/**
 * Canal WhatsApp (via WhatsApp Web, connexion par QR code).
 * Deux façons de l'utiliser :
 *  - le bot tourne sur un 2e numéro (ex : carte SIM dédiée) et tu lui écris ;
 *  - le bot tourne sur TON numéro et tu lui parles dans « Moi (Vous) » (discussion avec toi-même).
 * Dans les deux cas, seuls les messages de OWNER_NUMBER sont traités.
 */
export function createWhatsApp({ ownerNumber, dataDir, browser, onMessage, onReady }) {
  const client = new Client({
    authStrategy: new LocalAuth({ dataPath: join(dataDir, 'whatsapp-session') }),
    puppeteer: {
      headless: browser.headless,
      executablePath: browser.executablePath,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    },
  });

  const ownerJid = `${ownerNumber}@c.us`;
  const sentIds = new Set(); // évite que le bot se réponde à lui-même dans la discussion « Moi »

  async function send(text, imagePath) {
    const sent = imagePath
      ? await client.sendMessage(ownerJid, MessageMedia.fromFilePath(imagePath), { caption: text })
      : await client.sendMessage(ownerJid, text);
    sentIds.add(sent.id._serialized);
    if (sentIds.size > 500) sentIds.delete(sentIds.values().next().value);
  }

  async function isFromOwner(message) {
    if (message.fromMe) {
      // bot sur ton propre numéro : on n'écoute que la discussion avec toi-même
      const me = client.info?.wid;
      return me?.user === ownerNumber && message.to === me._serialized;
    }
    const contact = await message.getContact();
    return contact.number === ownerNumber;
  }

  client.on('qr', (qr) => {
    log.info('Scanne ce QR code avec WhatsApp → Appareils connectés → Connecter un appareil');
    qrcode.generate(qr, { small: true });
  });
  client.on('authenticated', () => log.info('WhatsApp authentifié'));
  client.on('auth_failure', (m) => log.error(`Échec d'authentification WhatsApp : ${m}`));
  client.on('disconnected', (reason) => {
    log.warn(`WhatsApp déconnecté (${reason}), reconnexion…`);
    client.initialize().catch((e) => log.error(e));
  });
  client.on('ready', () => {
    log.info('WhatsApp prêt');
    onReady?.();
  });

  client.on('message_create', async (message) => {
    try {
      if (sentIds.has(message.id._serialized)) return;
      if (message.type !== 'chat' || message.body.startsWith(BOT_TAG)) return;
      if (!(await isFromOwner(message))) return;
      await onMessage(message.body);
    } catch (err) {
      log.error('Erreur en traitant un message :', err);
    }
  });

  return { client, send, start: () => client.initialize() };
}
