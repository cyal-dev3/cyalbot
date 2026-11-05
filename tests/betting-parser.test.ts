import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as parser from '../src/lib/betting-parser.js';

test('el parser de tipsters exporta las funciones que usa el bridge', () => {
  assert.equal(typeof parser.extractTipsterName, 'function');
  assert.equal(typeof parser.buildTipsterStatCard, 'function');
});

test('extractTipsterName tolera texto sin tipster', () => {
  const result = parser.extractTipsterName('hola, ¿cómo va todo?');
  assert.ok(result === null || result === undefined || typeof result === 'string');
});
