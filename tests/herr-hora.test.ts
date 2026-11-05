import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveZone, getTimeIn, listZoneAliases } from '../src/plugins/tools-hora.js';

test('resuelve alias de países y ciudades', () => {
  assert.equal(resolveZone('mx'), 'America/Mexico_City');
  assert.equal(resolveZone('CDMX'), 'America/Mexico_City');
  assert.equal(resolveZone('es'), 'Europe/Madrid');
  assert.equal(resolveZone('España'), 'Europe/Madrid');
  assert.equal(resolveZone('ar'), 'America/Argentina/Buenos_Aires');
  assert.equal(resolveZone('ny'), 'America/New_York');
  assert.equal(resolveZone('la'), 'America/Los_Angeles');
  assert.equal(resolveZone('jp'), 'Asia/Tokyo');
  assert.equal(resolveZone('in'), 'Asia/Kolkata');
});

test('acepta nombres IANA sin distinguir mayúsculas y por ciudad final', () => {
  assert.equal(resolveZone('Europe/Madrid'), 'Europe/Madrid');
  assert.equal(resolveZone('europe/madrid'), 'Europe/Madrid');
  assert.equal(resolveZone('Asia/Tokyo'), 'Asia/Tokyo');
  assert.equal(resolveZone('mexico_city'), 'America/Mexico_City');
  assert.equal(resolveZone('Lisbon'), 'Europe/Lisbon');
});

test('devuelve null para zonas desconocidas', () => {
  assert.equal(resolveZone(''), null);
  assert.equal(resolveZone('Narnia/Centro'), null);
  assert.equal(resolveZone('xx'), null);
});

test('todos los alias apuntan a zonas que Intl acepta', () => {
  for (const alias of listZoneAliases()) {
    const zone = resolveZone(alias);
    assert.ok(zone, `alias ${alias} sin zona`);
    assert.doesNotThrow(() => new Intl.DateTimeFormat('en-US', { timeZone: zone }), `alias ${alias} -> ${zone}`);
  }
});

test('getTimeIn formatea hora, fecha y desfase', () => {
  // 5 de noviembre de 2026, 16:00 UTC.
  const now = new Date(Date.UTC(2026, 10, 5, 16, 0));
  const mx = getTimeIn('mx', now);
  assert.ok(mx);
  assert.equal(mx.zone, 'America/Mexico_City');
  assert.equal(mx.label, 'México');
  assert.match(mx.time, /10:00/);
  assert.match(mx.date, /5 de noviembre/);
  assert.equal(mx.offset, 'UTC-6');

  const tokyo = getTimeIn('Asia/Tokyo', now);
  assert.ok(tokyo);
  assert.match(tokyo.time, /01:00/);
  assert.equal(tokyo.offset, 'UTC+9');

  assert.equal(getTimeIn('nada', now), null);
});
