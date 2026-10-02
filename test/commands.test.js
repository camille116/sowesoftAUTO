import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand } from '../src/commands.js';

test('un code seul déclenche la signature', () => {
  assert.deepEqual(parseCommand('4821'), { type: 'sign', code: '4821' });
  assert.deepEqual(parseCommand(' 48 21 '), { type: 'sign', code: '4821' });
});

test('code avec préfixe', () => {
  assert.deepEqual(parseCommand('code 4821'), { type: 'sign', code: '4821' });
  assert.deepEqual(parseCommand('Signe: ab12c'), { type: 'sign', code: 'AB12C' });
  assert.deepEqual(parseCommand('CODE = 991'), { type: 'sign', code: '991' });
});

test('mots-clés', () => {
  assert.equal(parseCommand('Fait !').type, 'done');
  assert.equal(parseCommand('signé').type, 'done');
  assert.equal(parseCommand("C’est fait").type, 'done');
  assert.equal(parseCommand('planning').type, 'today');
  assert.equal(parseCommand('Demain').type, 'tomorrow');
  assert.equal(parseCommand('pause').type, 'pause');
  assert.equal(parseCommand('reprendre').type, 'resume');
  assert.equal(parseCommand('aide').type, 'help');
});

test('commande signature : menu et choix du style', () => {
  assert.deepEqual(parseCommand('signature'), { type: 'signature' });
  assert.deepEqual(parseCommand('signature psg'), { type: 'signature', style: 'psg' });
  assert.deepEqual(parseCommand('signature robot'), { type: 'signature', style: 'claude' });
  assert.deepEqual(parseCommand('signature nom'), { type: 'signature', style: 'name' });
  assert.deepEqual(parseCommand('signature bidule'), { type: 'signature', style: null });
});

test('le reste est inconnu', () => {
  assert.equal(parseCommand('salut ça va ?').type, 'unknown');
  assert.equal(parseCommand('').type, 'unknown');
  assert.equal(parseCommand('12').type, 'unknown');
});
