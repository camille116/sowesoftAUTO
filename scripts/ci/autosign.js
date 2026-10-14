// Auto-signature « dans le cloud » via GitHub Actions : à chaque passage (cron), on ouvre SoWeSoft
// et on signe le cours en cours S'IL NE DEMANDE PAS DE CODE (autonomie, projet…). Aucun Mac requis.
//
// SoWeSoft lui-même nous dit quoi faire : aucun cours → on ne fait rien ; code demandé → on laisse
// (les rappels / le scan s'en chargent) ; pavé de signature → on signe. La session SoWeSoft est
// gardée entre les passages par le cache GitHub Actions (data/sowesign-profile).
import { config } from '../../src/config.js';
import { SowesignSigner } from '../../src/sowesign/signer.js';

async function notify(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return; // notification optionnelle
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
  }).catch(() => {});
}

async function main() {
  if (!config.sowesign.auth.email || !config.sowesign.auth.password) {
    console.error('❌ Identifiants manquants : ajoute les secrets SOWESIGN_EMAIL et SOWESIGN_PASSWORD au dépôt.');
    return; // on sort proprement (exit 0) : pas la peine de faire échouer le workflow
  }

  const signer = new SowesignSigner({
    site: config.sowesign.site,
    auth: { ...config.sowesign.auth, method: 'password' }, // SSO impossible sans humain
    dryRun: config.sowesign.dryRun,
    browser: config.browser,
    dataDir: config.dataDir,
    signature: { style: process.env.SIGNATURE_STYLE || 'claude', name: process.env.SIGNATURE_NAME || 'Camille Redon' },
  });

  const result = await signer.signCurrent();
  console.log('Résultat auto-signature :', JSON.stringify(result));

  if (result.ok && !result.already && !result.dryRun) {
    await notify('🤖 ✍️ Signé automatiquement (cours sans code) — via le cloud, sans ton Mac.');
  } else if (result.ok && result.dryRun) {
    console.log('🧪 Mode test : cours signable sans code, mais SIGN_DRY_RUN=true → rien validé.');
  } else if (result.already) {
    console.log('✅ Déjà signé.');
  } else if (result.needsCode) {
    console.log('🔢 Ce cours demande un code : rien à faire côté cloud.');
  } else {
    console.log(`ℹ️ Pas de signature : ${result.reason || 'rien à signer en ce moment'}`);
  }
}

main().catch((err) => {
  console.error('Erreur auto-signature :', err?.message || err);
}).finally(() => process.exit(0)); // toujours « vert » : « aucun cours » n'est pas un échec
