import { test } from 'node:test';
import assert from 'node:assert/strict';
import { regenUser, msUntilNextPoint, regenConfig } from '../src/lib/auto-regen.js';
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
  assert.equal(result.updates.lastStaminaRegen, undefined);
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
