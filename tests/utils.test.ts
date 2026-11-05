import { test } from 'node:test';
import assert from 'node:assert/strict';
import { msToTime, formatNumber, createProgressBar, checkCooldown, normalizeText } from '../src/lib/utils.js';

test('msToTime formatea horas y minutos', () => {
  assert.equal(msToTime(0), '0 segundos');
  assert.equal(msToTime(90_000), '1 minuto 30 segundos');
  assert.equal(msToTime(2 * 3_600_000 + 5 * 60_000), '2 horas 5 minutos');
});

test('formatNumber compacto', () => {
  assert.equal(formatNumber(999, 'compact'), '999');
  assert.equal(formatNumber(1500, 'compact'), '1.5K');
  assert.equal(formatNumber(2_300_000, 'compact'), '2.3M');
});

test('createProgressBar no se sale del rango', () => {
  assert.equal(createProgressBar(5, 10, 10), '█████░░░░░');
  assert.equal(createProgressBar(50, 10, 10), '██████████');
  assert.equal(createProgressBar(-3, 10, 10), '░░░░░░░░░░');
});

test('checkCooldown aplica la reducción por rango', () => {
  const now = Date.now();
  const r = checkCooldown(now - 5_000, 10_000, 50);
  assert.equal(r.effectiveCooldown, 5_000);
  assert.equal(r.onCooldown, false);
  const r2 = checkCooldown(now - 1_000, 10_000, 0);
  assert.equal(r2.onCooldown, true);
  assert.ok(r2.remaining > 8_000 && r2.remaining <= 9_000);
});

test('normalizeText quita acentos', () => {
  assert.equal(normalizeText('Poción de Salud'), 'pocion de salud');
});
