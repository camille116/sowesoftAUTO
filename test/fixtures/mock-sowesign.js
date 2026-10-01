import { createServer } from 'node:http';

/**
 * Fausse plateforme d'émargement pour tester le robot de signature de bout en bout :
 * page de login → page avec un code en 4 cases → message de succès / d'erreur.
 */
const page = (body) => `<!doctype html><html lang="fr"><meta charset="utf-8"><body>${body}</body></html>`;

export function startMockSowesign({ validCode = '4821', login = 'eleve@ecole.fr', password = 'secret' } = {}) {
  const signatures = [];
  const server = createServer((req, res) => {
    const logged = (req.headers.cookie || '').includes('sid=ok');
    const url = new URL(req.url, 'http://x');
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      const form = new URLSearchParams(data);
      if (req.method === 'POST' && url.pathname === '/login') {
        if (form.get('email') === login && form.get('password') === password) {
          res.writeHead(302, { 'set-cookie': 'sid=ok; Path=/', location: '/' });
        } else {
          res.writeHead(302, { location: '/?bad=1' });
        }
        return res.end();
      }
      if (!logged) {
        res.writeHead(200, { 'content-type': 'text/html' });
        return res.end(page(`<form method="post" action="/login">
          ${url.searchParams.has('bad') ? '<p>Identifiants invalides</p>' : ''}
          <input type="email" name="email"><input type="password" name="password">
          <button type="submit">Connexion</button></form>`));
      }
      if (req.method === 'POST' && url.pathname === '/sign') {
        const code = ['d1', 'd2', 'd3', 'd4'].map((k) => form.get(k) || '').join('');
        signatures.push(code);
        res.writeHead(200, { 'content-type': 'text/html' });
        return res.end(page(code === validCode
          ? '<h1>Signature enregistrée ✅</h1>'
          : '<h1>Code incorrect</h1>'));
      }
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(page(`<h2 id="hello">Bonjour Camille</h2><p>Mes émargements : 3 signés</p>
        <form method="post" action="/sign">
          ${[1, 2, 3, 4].map((i) => `<input name="d${i}" maxlength="1" inputmode="numeric">`).join('')}
          <button type="submit">Valider</button></form>`));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ url: `http://127.0.0.1:${server.address().port}/`, signatures, close: () => server.close() });
    });
  });
}
