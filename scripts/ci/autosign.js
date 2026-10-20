// Signature des cours d'AUTONOMIE depuis GitHub Actions, quand le Mac est éteint.
//   node scripts/ci/autosign.js --check  → écrit sign=true|false dans $GITHUB_OUTPUT (rapide, sans navigateur)
//   node scripts/ci/autosign.js          → signe le cours d'autonomie en cours (si SoWeSoft ne demande pas de code)
// Seuls les cours marqués AUTONOMIE dans l'emploi du temps sont concernés. Un cours déjà signé
// (data/ci-state.json, gardé par le cache) n'est pas retenté.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../../src/config.js';
import { Planning } from '../../src/planning/index.js';
import { currentAutoSignCourse } from '../../src/autosign.js';

const stateFile = join(config.dataDir, 'ci-state.json');
const readState = () => { try { return JSON.parse(readFileSync(stateFile, 'utf8')); } catch { return { signed: {} }; } };

async function current() {
  if (!process.env.ICS_URL) { console.log('ICS_URL manquant : ajoute le secret ICS_URL.'); return null; }
  const planning = new Planning({ icsUrl: process.env.ICS_URL, keywords: [], notify: { mode: 'all' }, manual: { weekly: [], dates: [] } });
  return currentAutoSignCourse(planning, new Date());
}

async function notify(text) {
  const { TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: chat } = process.env;
  if (!token || !chat) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text }),
  }).catch(() => {});
}

async function check() {
  const course = await current();
  const sign = Boolean(course && !readState().signed[course.id]);
  console.log(course ? `Cours d'autonomie en cours : ${course.subject || course.title}${sign ? '' : ' (déjà signé)'}` : 'Aucun cours d’autonomie en ce moment.');
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `sign=${sign}\n`);
}

async function sign() {
  const course = await current();
  if (!course) return console.log('Plus de cours d’autonomie en cours.');
  if (!process.env.SOWESIGN_EMAIL || !process.env.SOWESIGN_PASSWORD) return console.log('Secrets SOWESIGN_EMAIL / SOWESIGN_PASSWORD manquants.');
  const { SowesignSigner } = await import('../../src/sowesign/signer.js');
  const signer = new SowesignSigner({
    site: config.sowesign.site,
    auth: { ...config.sowesign.auth, method: 'password' },
    dryRun: config.sowesign.dryRun,
    browser: config.browser,
    dataDir: config.dataDir,
    signature: { style: process.env.SIGNATURE_STYLE || 'claude', name: process.env.SIGNATURE_NAME || 'Camille Redon' },
  });
  await notify(`🤖 ⏳ Je m'apprête à signer ${course.subject || course.title} (cloud, Mac éteint)…`);
  const result = await signer.signCurrent();
  console.log('Résultat :', JSON.stringify({ ok: result.ok, already: result.already, needsCode: result.needsCode, reason: result.reason }));
  const name = course.subject || course.title;
  if (result.ok || result.already || result.needsCode) {
    const state = readState();
    state.signed[course.id] = new Date().toISOString(); // fait (ou code requis) : on ne retente pas ce cours
    writeFileSync(stateFile, JSON.stringify(state));
  }
  if (result.ok && !result.already && !result.dryRun) await notify(`🤖 ✍️ Signé automatiquement (cloud, Mac éteint) : ${name}`);
  else if (!result.ok && !result.needsCode) await notify(`🤖 ⚠️ Signature auto impossible pour ${name} : ${result.reason || 'erreur'}. Signe à la main.`);
}

if (!existsSync(config.dataDir)) (await import('node:fs')).mkdirSync(config.dataDir, { recursive: true });
(process.argv.includes('--check') ? check() : sign())
  .catch((err) => console.error('Erreur :', err?.message || err))
  .finally(() => process.exit(0)); // « aucun cours » n'est pas un échec
