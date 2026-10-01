// LinkeD pour Mac : une vraie app (fenêtre, Dock, menus) autour du service LinkeD qui tourne en arrière-plan.
// Le service (launchd) envoie les rappels même quand cette fenêtre est fermée.
const { app, BrowserWindow, Menu, shell, dialog } = require('electron');
const { execFile } = require('node:child_process');
const path = require('node:path');

const BASE = 'http://localhost:3000';
const SERVICE = 'com.linked.app';
app.setName('LinkeD');

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let win = null;
let quitting = false;

async function serviceUp() {
  try {
    const res = await fetch(`${BASE}/api/me`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Relance le service en arrière-plan s'il ne répond pas, puis attend qu'il soit prêt. */
async function ensureService() {
  if (await serviceUp()) return true;
  const uid = process.getuid();
  const plist = path.join(app.getPath('home'), 'Library', 'LaunchAgents', `${SERVICE}.plist`);
  await new Promise((r) => execFile('launchctl', ['bootstrap', `gui/${uid}`, plist], () => r()));
  await new Promise((r) => execFile('launchctl', ['kickstart', `gui/${uid}/${SERVICE}`], () => r()));
  for (let i = 0; i < 40; i++) {
    if (await serviceUp()) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function load() {
  win.loadFile(path.join(__dirname, 'loading.html'));
  if (await ensureService()) win.loadURL(BASE);
  else win.loadFile(path.join(__dirname, 'loading.html'), { query: { error: '1' } });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 380,
    minHeight: 560,
    title: 'LinkeD',
    backgroundColor: '#0b0c10',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  win.once('ready-to-show', () => win.show());
  // Service injoignable (redémarrage, mise à jour…) : écran d'attente qui réessaie tout seul
  win.webContents.on('did-fail-load', (event, code, description, url, isMainFrame) => {
    if (isMainFrame && url.startsWith(BASE)) win.loadFile(path.join(__dirname, 'loading.html'), { query: { error: '1' } });
  });

  // Liens externes (Telegram, GitHub…) : dans le navigateur, jamais dans l'app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(BASE)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(BASE) && !url.startsWith('file:')) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  // Comme Spotify : fermer la fenêtre la cache, LinkeD continue en arrière-plan
  win.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      win.hide();
    }
  });
  load();

  // Test automatique : LINKED_SCREENSHOT=fichier.png → capture de la fenêtre puis fermeture
  if (process.env.LINKED_SCREENSHOT) {
    win.webContents.on('did-finish-load', () => {
      if (!win.webContents.getURL().startsWith(BASE)) return;
      setTimeout(async () => {
        const image = await win.webContents.capturePage();
        require('node:fs').writeFileSync(process.env.LINKED_SCREENSHOT, image.toPNG());
        quitting = true;
        app.quit();
      }, 2500);
    });
  }
}

function show(hash) {
  if (!win) return createWindow();
  if (hash) win.webContents.executeJavaScript(`location.hash = ${JSON.stringify(hash)}`).catch(() => {});
  win.show();
  win.focus();
}

function buildMenu() {
  const go = (hash) => () => show(hash);
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'LinkeD',
      submenu: [
        { role: 'about', label: 'À propos de LinkeD' },
        { type: 'separator' },
        { label: 'Réglages…', accelerator: 'Cmd+,', click: go('#settings') },
        { label: 'Rechercher une mise à jour', click: go('#settings') },
        { type: 'separator' },
        { role: 'hide', label: 'Masquer LinkeD' },
        { role: 'hideOthers', label: 'Masquer les autres' },
        { type: 'separator' },
        {
          label: 'Quitter la fenêtre (les rappels continuent)',
          accelerator: 'Cmd+Q',
          click: () => { quitting = true; app.quit(); },
        },
      ],
    },
    {
      label: 'Édition',
      submenu: [
        { role: 'undo', label: 'Annuler' }, { role: 'redo', label: 'Rétablir' }, { type: 'separator' },
        { role: 'cut', label: 'Couper' }, { role: 'copy', label: 'Copier' }, { role: 'paste', label: 'Coller' },
        { role: 'selectAll', label: 'Tout sélectionner' },
      ],
    },
    {
      label: 'Aller',
      submenu: [
        { label: 'Tableau de bord', accelerator: 'Cmd+1', click: go('#home') },
        { label: 'Planning', accelerator: 'Cmd+2', click: go('#planning') },
        { label: 'Classe', accelerator: 'Cmd+3', click: go('#class') },
        { label: 'Activité', accelerator: 'Cmd+4', click: go('#history') },
        { label: 'Réglages', accelerator: 'Cmd+5', click: go('#settings') },
        { type: 'separator' },
        { label: 'Actualiser', accelerator: 'Cmd+R', click: () => win && load() },
      ],
    },
    { role: 'windowMenu', label: 'Fenêtre' },
    {
      role: 'help',
      label: 'Aide',
      submenu: [
        { label: 'Ouvrir dans le navigateur', click: () => shell.openExternal(BASE) },
        { label: 'Afficher le journal', click: () => shell.openPath(path.join(app.getPath('home'), 'LinkeD', 'data', 'linked.log')) },
      ],
    },
  ]));
}

app.on('second-instance', () => show());
app.on('activate', () => show()); // clic sur l'icône du Dock
app.on('before-quit', () => { quitting = true; });
app.whenReady().then(() => {
  app.setAboutPanelOptions({ applicationName: 'LinkeD', applicationVersion: '', copyright: 'Rappels et signature SoWeSoft' });
  buildMenu();
  createWindow();
});

process.on('uncaughtException', (err) => {
  dialog.showErrorBox('LinkeD', String(err?.message || err));
});
