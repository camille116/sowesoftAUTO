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

export const config = {
  root: ROOT,
  dataDir: resolve(ROOT, env.DATA_DIR || 'data'),

  ownerNumber: (env.OWNER_NUMBER || '').replace(/\D/g, ''),

  planning: {
    icsUrl: env.ICS_URL || '',
    keywords: list(env.AUTONOMY_KEYWORDS, ['autonomie', 'autonome']),
    manual: readJson(env.PLANNING_FILE || 'config/planning.json', { weekly: [], dates: [] }),
  },

  reminders: {
    offsets: list(env.REMINDER_OFFSETS, ['-5', '0', '15', '45']).map(Number).sort((a, b) => a - b),
    tickSeconds: Number(env.TICK_SECONDS || 30),
  },

  sowesign: {
    login: env.SOWESIGN_LOGIN || '',
    password: env.SOWESIGN_PASSWORD || '',
    dryRun: bool(env.SIGN_DRY_RUN, true),
    site: readJson(env.SOWESIGN_CONFIG || 'config/sowesign.json', {}),
  },

  browser: {
    headless: bool(env.HEADLESS, true),
    executablePath: env.CHROME_PATH || undefined,
  },
};
