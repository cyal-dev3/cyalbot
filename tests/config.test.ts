import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.BOT_OWNERS = '5213312345678, 174912593502302';
process.env.BOT_PREFIX = '!/.';
const { CONFIG, isOwnerId, normalizeNumber } = await import('../src/config.js');

test('normalizeNumber quita dominio y sufijo de dispositivo', () => {
  assert.equal(normalizeNumber('5213312345678:12@s.whatsapp.net'), '5213312345678');
  assert.equal(normalizeNumber('174912593502302@lid'), '174912593502302');
  assert.equal(normalizeNumber('+52 1 331 234 5678'), '5213312345678');
});

test('isOwnerId exige coincidencia exacta, no subcadena', () => {
  assert.equal(isOwnerId('5213312345678@s.whatsapp.net'), true);
  assert.equal(isOwnerId('174912593502302:3@lid'), true);
  // Un número que contiene al owner como subcadena NO es owner.
  assert.equal(isOwnerId('15213312345678@s.whatsapp.net'), false);
  // Un número más corto contenido en el owner tampoco.
  assert.equal(isOwnerId('331234@s.whatsapp.net'), false);
  assert.equal(isOwnerId('@g.us'), false);
});

test('el prefijo acepta los caracteres configurados', () => {
  assert.ok(CONFIG.prefix.test('/menu'));
  assert.ok(CONFIG.prefix.test('!menu'));
  assert.ok(CONFIG.prefix.test('.menu'));
  assert.ok(!CONFIG.prefix.test('menu'));
  assert.ok(!CONFIG.prefix.test('#menu'));
});
