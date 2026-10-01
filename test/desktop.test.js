import './helpers.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDesktop } from '../src/desktop.js';

function fakeMac({ script = 'exit 0' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'desk-root-'));
  const home = mkdtempSync(join(tmpdir(), 'desk-home-'));
  mkdirSync(join(root, 'scripts', 'mac'), { recursive: true });
  mkdirSync(join(root, 'data'));
  writeFileSync(join(root, 'scripts', 'mac', 'make-app.sh'), script);
  const desktop = createDesktop({ root, dataDir: join(root, 'data'), managed: true, platform: 'darwin', home });
  return { root, home, desktop };
}

test('détecte l’absence de l’app et un raccourci Chrome', () => {
  const { home, desktop } = fakeMac();
  mkdirSync(join(home, 'Applications', 'Chrome Apps.localized', 'LinkeD.app'), { recursive: true });
  const s = desktop.status();
  assert.equal(s.mac, true);
  assert.equal(s.electronInstalled, false);
  assert.equal(s.chromeShortcuts.length, 1);
});

test('réparation : lance make-app.sh, supprime le raccourci Chrome, détecte l’app native', async () => {
  const { home, desktop } = fakeMac({
    script: `mkdir -p "${'$HOME_TEST'}/Applications/LinkeD.app/Contents/Resources/app" && touch "${'$HOME_TEST'}/Applications/LinkeD.app/Contents/Resources/app/main.js"; echo construit`,
  });
  process.env.HOME_TEST = home;
  const shortcut = join(home, 'Applications', 'Chrome Apps.localized', 'LinkeD.app');
  mkdirSync(shortcut, { recursive: true });
  desktop.repair();
  assert.equal(existsSync(shortcut), false);
  await new Promise((r) => setTimeout(r, 400));
  const s = desktop.status();
  assert.equal(s.kind, 'native');
  assert.equal(s.last.ok, true);
  assert.match(s.last.output, /construit/);
});

test('hors Mac : pas de réparation', () => {
  const desktop = createDesktop({ root: '/tmp', dataDir: '/tmp', managed: true, platform: 'linux' });
  assert.throws(() => desktop.repair(), /Mac/);
});
