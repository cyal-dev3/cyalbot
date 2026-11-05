import { test } from 'node:test';
import assert from 'node:assert/strict';
import { regenUser, msUntilNextPoint, regenConfig, applyRegenToAllUsers } from '../src/lib/auto-regen.js';
import { initDatabase } from '../src/lib/database.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_USER } from '../src/types/user.js';

const HOUR = 60 * 60 * 1000;
const pointMs = HOUR / regenConfig.healthPerHour;

test('regenUser inicializa timestamps en 0 aunque el stat esté al máximo', () => {
  const user = structuredClone(DEFAULT_USER);
  const now = 1_700_000_000_000;
  const result = regenUser(user, now);
  assert.deepEqual(result.updates, { lastHealthRegen: now, lastStaminaRegen: now });
  assert.equal(result.healthRegen, 0);
  assert.equal(user.lastHealthRegen, 0);
});

test('regenUser regenera puntos completos y conserva el resto del tiempo', () => {
  const user = structuredClone(DEFAULT_USER);
  const now = 1_700_000_000_000;
  user.health = 10;
  user.stamina = user.maxStamina;
  user.lastHealthRegen = now - 2.5 * HOUR;
  user.lastStaminaRegen = now - 3 * HOUR;

  const result = regenUser(user, now);
  assert.equal(result.healthRegen, 2.5 * regenConfig.healthPerHour);
  assert.equal(result.updates.health, 10 + result.healthRegen);
  assert.equal(result.updates.lastHealthRegen, user.lastHealthRegen + result.healthRegen * pointMs);
  assert.equal(result.staminaRegen, 0);
  assert.equal(result.updates.stamina, undefined);
  // Al máximo no regenera, pero el timestamp avanza los intervalos completos (3 h exactas)
  assert.equal(result.updates.lastStaminaRegen, now);
});

test('regenUser no supera el máximo real ni regenera antes de un punto completo', () => {
  const user = structuredClone(DEFAULT_USER);
  const now = 1_700_000_000_000;
  user.health = user.maxHealth - 3;
  user.lastHealthRegen = now - 10 * HOUR;
  user.stamina = 50;
  user.lastStaminaRegen = now - pointMs + 1;

  const result = regenUser(user, now);
  assert.equal(result.healthRegen, 3);
  assert.equal(result.updates.health, user.maxHealth);
  assert.equal(result.staminaRegen, 0);
  assert.equal(Object.hasOwn(result.updates, 'stamina'), false);
});

test('msUntilNextPoint usa el resto del intervalo por punto', () => {
  const now = 1_700_000_000_000;
  assert.equal(msUntilNextPoint(now - pointMs / 2, regenConfig.healthPerHour, now), pointMs / 2);
  assert.equal(msUntilNextPoint(now - pointMs * 3 - 1000, regenConfig.healthPerHour, now), pointMs - 1000);
  assert.equal(msUntilNextPoint(0, regenConfig.healthPerHour, now), pointMs);
  assert.equal(msUntilNextPoint(now, 0, now), 0);
});

test('regenUser avanza el timestamp con el stat al máximo para no acumular regeneración', () => {
  const user = structuredClone(DEFAULT_USER);
  const now = 1_700_000_000_000;
  user.lastHealthRegen = now - 10 * HOUR;
  user.lastStaminaRegen = now - 1000;

  const full = regenUser(user, now);
  assert.equal(full.healthRegen, 0);
  assert.equal(full.updates.health, undefined);
  assert.equal(full.updates.lastHealthRegen, now - 10 * HOUR + 10 * regenConfig.healthPerHour * pointMs);
  // Antes de completar un intervalo no hay nada que cambiar (no marca dirty cada minuto)
  assert.equal(Object.hasOwn(full.updates, 'lastStaminaRegen'), false);

  user.lastHealthRegen = full.updates.lastHealthRegen as number;
  user.health = 1;
  const hurt = regenUser(user, now + 1000);
  assert.equal(hurt.healthRegen, 0);
});

test('el barrido inicializa los timestamps de los usuarios al máximo', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cyalbot-regen-'));
  const db = await initDatabase(join(dir, 'database.json'));
  try {
    const jid = 'full@s.whatsapp.net';
    db.updateUser(jid, { registered: true, lastHealthRegen: 0, lastStaminaRegen: 0 });
    // Un usuario corrupto en la lista no debe impedir que se procese al resto
    db.data.users['roto@s.whatsapp.net'] = { registered: true } as never;
    const before = Date.now();
    applyRegenToAllUsers();
    assert.ok(db.getUser(jid).lastHealthRegen >= before);
    assert.ok(db.getUser(jid).lastStaminaRegen >= before);
  } finally {
    await db.stop();
    await rm(dir, { recursive: true, force: true });
  }
});
