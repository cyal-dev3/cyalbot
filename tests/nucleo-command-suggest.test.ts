import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestCommand, damerauLevenshtein, commandAliases, isSimpleCommand } from '../src/lib/command-suggest.js';
import type { PluginHandler } from '../src/types/message.js';

const ALIASES = ['atacar', 'attack', 'inventario', 'inv', 'menu', 'help', 'perfil', 'daily', 'work', 'minar', 'tienda', 'yo', 'ia', 's'];
const PRIMARY = new Set(['atacar', 'inventario', 'menu', 'perfil', 'daily', 'work', 'minar', 'tienda', 'ia', 's']);

test('suggestCommand corrige errores de una o dos letras', () => {
  assert.equal(suggestCommand('atakar', ALIASES, { primary: PRIMARY }), 'atacar');
  assert.equal(suggestCommand('invetario', ALIASES, { primary: PRIMARY }), 'inventario');
  assert.equal(suggestCommand('menú', ALIASES, { primary: PRIMARY }), 'menu');
  assert.equal(suggestCommand('MENU', ALIASES, { primary: PRIMARY }), 'menu');
});

test('suggestCommand devuelve null si nada se parece', () => {
  assert.equal(suggestCommand('xyz', ALIASES, { primary: PRIMARY }), null);
  assert.equal(suggestCommand('', ALIASES), null);
  assert.equal(suggestCommand('q', ALIASES), null);
  assert.equal(suggestCommand('zzzzzzzz', ALIASES), null);
});

test('suggestCommand acepta prefijo común largo y prefiere el alias principal y más corto', () => {
  assert.equal(suggestCommand('inventariooooo', ALIASES, { primary: PRIMARY }), 'inventario');
  // "atacaa" está a distancia 1 de "atacar"; "attack" queda más lejos.
  assert.equal(suggestCommand('atacaa', ALIASES, { primary: PRIMARY }), 'atacar');
  // Empate de distancia: gana el principal.
  assert.equal(suggestCommand('inva', ['inv', 'inventario', 'inva1'], { primary: new Set(['inventario', 'inva1']) }), 'inva1');
  assert.equal(suggestCommand('wokr', ['work', 'wokrr'], { primary: new Set(['work', 'wokrr']) }), 'work');
});

test('damerauLevenshtein cuenta transposiciones como un paso', () => {
  assert.equal(damerauLevenshtein('abcd', 'abdc'), 1);
  assert.equal(damerauLevenshtein('atacar', 'atakar'), 1);
  assert.equal(damerauLevenshtein('', 'abc'), 3);
  assert.equal(damerauLevenshtein('igual', 'igual'), 0);
});

test('commandAliases expande arrays y alternancias simples, no regex complejas', () => {
  const array: PluginHandler = { command: ['Menu', 'help'], handler: async () => {} };
  const simple: PluginHandler = { command: /^(verde|green|g)$/i, handler: async () => {} };
  const escaped: PluginHandler = { command: /^(dungeon\-rapido|dr)$/i, handler: async () => {} };
  const complex: PluginHandler = { command: /^(golpe.?brutal|bola.?fuego)$/i, handler: async () => {} };
  assert.deepEqual(commandAliases(array), ['menu', 'help']);
  assert.deepEqual(commandAliases(simple), ['verde', 'green', 'g']);
  assert.deepEqual(commandAliases(escaped), ['dungeon-rapido', 'dr']);
  assert.deepEqual(commandAliases(complex), []);
  assert.equal(isSimpleCommand(simple), true);
  assert.equal(isSimpleCommand(complex), false);
});
