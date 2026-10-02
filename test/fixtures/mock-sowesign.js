import { createServer } from 'node:http';

/**
 * Fausse appli SoWeSoft qui reproduit la structure de la vraie (relevée sur app.sowesign.com) :
 *  /login    : « Continuer » → code établissement au clavier → choix de méthode (div.mode)
 *              → e-mail + mot de passe → redirection vers /student/
 *  /student/ : popup « FERMER » → app-code-detection (5 cases, écoute keyup) → pad de signature
 *              → « Votre présence a bien été enregistrée »
 */
const html = (body, script = '') =>
  `<!doctype html><html lang="fr"><meta charset="utf-8"><body>${body}<script>${script}</script></body></html>`;

const portal = (institution) => html(
  `<div id="root"><app-button class="button-continue"><div style="cursor:pointer">Continuer</div></app-button></div>`,
  `
  const root = document.getElementById('root');
  let digits = '';
  document.querySelector('app-button').addEventListener('click', () => {
    root.innerHTML = '<p>Saisissez votre code d’établissement</p><app-input-boxes></app-input-boxes>';
    window.addEventListener('keyup', onKey);
  });
  function onKey(e) {
    if (!/^[0-9]$/.test(e.key)) return;
    digits += e.key;
    if (digits.length < 4) return;
    window.removeEventListener('keyup', onKey);
    if (digits !== '${institution}') { location.href = '/error?m=institution'; return; }
    root.innerHTML = '<p>Choisissez une méthode d’authentification</p>' +
      ['Code d’identification', 'Identifiants internes', 'Mot de passe'].map((t, i) =>
        '<div class="mode"><div class="text-l" style="cursor:pointer" data-i="' + i + '">' + t + '</div></div>').join('');
    root.querySelectorAll('[data-i="2"]').forEach((el) => el.addEventListener('click', passwordForm));
  }
  function passwordForm() {
    root.innerHTML = '<input id="email" type="text"><input id="password" type="password">' +
      '<app-button><div id="go" style="cursor:pointer">Valider</div></app-button>';
    document.getElementById('go').addEventListener('click', async () => {
      const res = await fetch('/api/login', { method: 'POST', body: JSON.stringify({
        email: document.getElementById('email').value, password: document.getElementById('password').value }) });
      location.href = res.ok ? '/student/' : '/error?m=password';
    });
  }`,
);

const student = html(
  // La vraie popup « Informations légales » n'utilise pas forcément un conteneur app-popup : ici
  // un conteneur « inconnu » (legal-modal) qui RECOUVRE toute la page (pointer-events) → tant qu'on
  // ne clique pas FERMER, les clics de souris (donc la signature) tombent sur la popup.
  `<app-root>
    <div class="legal-modal" id="popup" style="position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.4)">
      <div class="card"><div>INFORMATIONS LÉGALES ET CONFIDENTIALITÉ</div>
      <div class="footer"><span id="close" style="cursor:pointer">FERMER</span></div></div></div>
    <app-detection><p>Saisissez le code à 5 chiffres</p>
      <app-code-detection id="zone"><div id="boxes">${'<div class="box"><span>0</span></div>'.repeat(5)}</div><div id="err"></div></app-code-detection>
    </app-detection>
  </app-root>`,
  `
  document.getElementById('close')?.addEventListener('click', () => { document.getElementById('popup').remove(); });
  let code = '';
  const zone = document.getElementById('zone');
  const render = () => zone.querySelectorAll('.box span').forEach((s, i) => (s.textContent = code[i] || '0'));
  zone.addEventListener('keyup', async (e) => {
    if (e.key === 'Backspace') { code = code.slice(0, -1); return render(); }
    if (!/^[0-9]$/.test(e.key) || code.length >= 5) return;
    code += e.key; render();
    if (code.length < 5) return;
    const res = await fetch('/api/checkcode', { method: 'POST', body: code });
    if (!res.ok) { document.getElementById('err').innerHTML = '<div class="red">Code invalide</div>'; code = ''; return; }
    showPad();
  });
  function showPad() {
    document.querySelector('app-detection').outerHTML =
      '<app-signature><app-signature-component><signature-pad><canvas width="360" height="200" style="width:360px;height:200px;border:1px solid #ccc"></canvas></signature-pad>' +
      '<div class="text cursor-pointer" id="validate" style="cursor:pointer">Valider</div></app-signature-component></app-signature>';
    const canvas = document.querySelector('canvas');
    const ctx = canvas.getContext('2d');
    let drawing = false, minX = 1e9, maxX = -1;
    canvas.addEventListener('mousedown', (e) => { drawing = true; ctx.beginPath(); ctx.moveTo(e.offsetX, e.offsetY); });
    canvas.addEventListener('mousemove', (e) => { if (!drawing) return; ctx.lineTo(e.offsetX, e.offsetY); ctx.stroke(); minX = Math.min(minX, e.offsetX); maxX = Math.max(maxX, e.offsetX); });
    window.addEventListener('mouseup', () => (drawing = false));
    document.getElementById('validate').addEventListener('click', async () => {
      if (maxX - minX < canvas.width * 0.5) {
        document.body.insertAdjacentHTML('beforeend', '<app-toast>Erreur : votre signature est trop petite</app-toast>');
        return;
      }
      await fetch('/api/sign', { method: 'POST', body: code });
      document.querySelector('app-signature').outerHTML = '<app-validated>Votre présence a bien été enregistrée à 14:02</app-validated>';
    });
  }`,
);

export function startMockSowesign({ institution = '7705', validCode = '48213', email = 'eleve@ecole.fr', password = 'secret' } = {}) {
  const signatures = [];
  const logins = [];
  const server = createServer((req, res) => {
    const logged = (req.headers.cookie || '').includes('sid=ok');
    const url = new URL(req.url, 'http://x');
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const send = (status, content, headers = {}) => { res.writeHead(status, { 'content-type': 'text/html', ...headers }); res.end(content); };
      if (url.pathname === '/api/login') {
        const creds = JSON.parse(body);
        logins.push(creds.email);
        return creds.email === email && creds.password === password
          ? send(200, '{}', { 'set-cookie': 'sid=ok; Path=/; Max-Age=3600' })
          : send(400, '{}');
      }
      if (url.pathname === '/api/checkcode') return send(body === validCode ? 200 : 400, '{}');
      if (url.pathname === '/api/sign') { signatures.push(body); return send(200, '{}'); }
      if (url.pathname === '/login') return send(200, portal(institution));
      if (url.pathname === '/error') return send(200, html('<h1>Erreur d’authentification</h1><p>L’adresse e-mail et/ou le mot de passe sont incorrects</p>'));
      if (url.pathname.startsWith('/student')) return logged ? send(200, student) : send(302, '', { location: '/login' });
      send(404, 'not found');
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const base = `http://127.0.0.1:${server.address().port}`;
      resolve({ base, signatures, logins, close: () => server.close() });
    });
  });
}
