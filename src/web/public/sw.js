// Service worker minimal : rend l'appli installable sur l'écran d'accueil.
// Aucune mise en cache : l'appli affiche toujours l'état réel du bot.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
