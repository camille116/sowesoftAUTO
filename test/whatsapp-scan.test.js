import './helpers.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWhatsAppScanner, extractCode } from '../src/whatsapp-scan.js';

test('extractCode : repère un code de 5 chiffres, ignore le reste', () => {
  assert.equal(extractCode('le code c’est 48213 les amis'), '48213');
  assert.equal(extractCode('48213'), '48213');
  assert.equal(extractCode('Code : 48 213'), '48213');
  assert.equal(extractCode('salle 1042'), null); // 4 chiffres
  assert.equal(extractCode('matricule 123456'), null); // 6 chiffres
  assert.equal(extractCode('rdv a 14h'), null);
});

function scanner({ config } = {}) {
  const calls = [];
  const sc = createWhatsAppScanner({
    dataDir: '/tmp', browser: {},
    getConfig: () => config,
    onDetect: async (code, info) => calls.push({ code, info }),
    clientFactory: () => ({ on() {}, initialize() {} }),
  });
  return { sc, calls };
}

const groupMsg = (body, { isGroup = true, id = 'G1', name = 'Classe M1' } = {}) => ({
  type: 'chat', body, getChat: async () => ({ isGroup, id: { _serialized: id }, name }),
});
const dmMsg = (body, { id = 'D1' } = {}) => ({ type: 'chat', body, getChat: async () => ({ isGroup: false, id: { _serialized: id }, name: 'Pote' }) });

test('scan désactivé : ne signe pas', async () => {
  const { sc, calls } = scanner({ config: { enabled: false, groupId: 'G1' } });
  await sc.handleMessage(groupMsg('48213'));
  assert.equal(calls.length, 0);
});

test('sans filtre : message direct accepté (pratique pour tester)', async () => {
  const { sc, calls } = scanner({ config: { enabled: true, groupId: '' } });
  await sc.handleMessage(dmMsg('48213'));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].info.group, 'message direct');
});

test('filtre groupe actif : un message direct ou un autre groupe est ignoré', async () => {
  const { sc, calls } = scanner({ config: { enabled: true, groupId: 'G1' } });
  await sc.handleMessage(groupMsg('48213', { id: 'AUTRE' }));
  await sc.handleMessage(dmMsg('48213', { id: 'D1' }));
  assert.equal(calls.length, 0);
});

test('code dans le bon groupe : remonté une seule fois (dédup)', async () => {
  const { sc, calls } = scanner({ config: { enabled: true, groupId: 'G1' } });
  await sc.handleMessage(groupMsg('le code 48213'));
  await sc.handleMessage(groupMsg('48213 encore')); // même code → pas de 2e remontée
  assert.equal(calls.length, 1);
  assert.equal(calls[0].code, '48213');
  assert.equal(calls[0].info.group, 'Classe M1');
});

test('groupId vide : accepte n’importe quel groupe', async () => {
  const { sc, calls } = scanner({ config: { enabled: true, groupId: '' } });
  await sc.handleMessage(groupMsg('48213', { id: 'NIMPORTE' }));
  assert.equal(calls.length, 1);
});
