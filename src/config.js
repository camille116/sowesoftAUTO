import 'dotenv/config';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

function list(value, fallback = []) {
  if (!value) return fallback;
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

function bool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'oui'].includes(value.toLowerCase());
}

function readJson(path, fallback) {
  const full = resolve(ROOT, path);
  if (!existsSync(full)) return fallback;
  return JSON.parse(readFileSync(full, 'utf8'));
}

const env = process.env;
const site = readJson(env.SOWESIGN_CONFIG || 'config/sowesign.json', {});

export const config = {
  root: ROOT,
  dataDir: resolve(ROOT, env.DATA_DIR || 'data'),

  ownerNumber: (env.OWNER_NUMBER || '').replace(/\D/g, ''),

  planning: {
    icsUrl: env.ICS_URL || '',
    keywords: list(env.AUTONOMY_KEYWORDS, ['autonomie', 'autonome', 'elearning', 'e-learning']),
    manual: readJson(env.PLANNING_FILE || 'config/planning.json', { weekly: [], dates: [] }),
  },

  reminders: {
    offsets: list(env.REMINDER_OFFSETS, ['-5', '0', '15', '45']).map(Number).sort((a, b) => a - b),
    tickSeconds: Number(env.TICK_SECONDS || 30),
  },

  sowesign: {
    site,
    auth: {
      // code = identifiant 8 chiffres + PIN · password = e-mail + mot de passe · sso = connexion manuelle
      method: (env.SOWESIGN_LOGIN_METHOD || 'password').toLowerCase(),
      institution: env.SOWESIGN_INSTITUTION || site.institutionCode || '',
      id: env.SOWESIGN_ID || '',
      pin: env.SOWESIGN_PIN || '',
      email: env.SOWESIGN_EMAIL || '',
      password: env.SOWESIGN_PASSWORD || '',
    },
    dryRun: bool(env.SIGN_DRY_RUN, true),
  },

  web: {
    port: Number(env.WEB_PORT || 3000),
    host: env.WEB_HOST || '',
    password: env.WEB_PASSWORD || '',
  },

  browser: {
    headless: bool(env.HEADLESS, true),
    executablePath: env.CHROME_PATH || undefined,
  },
};
