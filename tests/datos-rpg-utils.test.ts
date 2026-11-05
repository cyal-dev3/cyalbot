import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateDamage, calculateTotalStats, getEnhanceMultiplier } from '../src/lib/rpg-utils.js';
import { calculateTotalStats as legacyCalculateTotalStats, DEFAULT_USER } from '../src/types/user.js';
import { ITEMS, CLASSES } from '../src/types/rpg.js';
import { FORGE } from '../src/constants/rpg.js';

test('calculateTotalStats suma clase y equipo con el bonus de forja', () => {
  const user = structuredClone(DEFAULT_USER);
  const base = calculateTotalStats(user);
  assert.deepEqual(base, {
    attack: 10, defense: 5, maxHealth: 100, maxMana: 20, maxStamina: 100, critChance: 5
  });

  user.playerClass = 'mago';
  user.equipment.weapon = 'daga_oxidada';
  user.inventory.push({ itemId: 'daga_oxidada', quantity: 1, enhanceLevel: 4 });

  const stats = calculateTotalStats(user);
  const factor = getEnhanceMultiplier(4);
  assert.equal(factor, 1 + (4 * FORGE.ENHANCE_BONUS_PER_LEVEL) / 100);
  assert.equal(stats.attack, 10 + CLASSES.mago.baseStats.attackBonus + Math.round(5 * factor));
  assert.equal(stats.critChance, 5 + Math.round(2 * factor));
  assert.equal(stats.maxMana, 20 + CLASSES.mago.baseStats.manaBonus);
  assert.equal(stats.maxHealth, 100 + CLASSES.mago.baseStats.healthBonus);
});

test('getEnhanceMultiplier acota el nivel de forja', () => {
  assert.equal(getEnhanceMultiplier(0), 1);
  assert.equal(getEnhanceMultiplier(-3), 1);
  assert.equal(getEnhanceMultiplier(99), 1 + (FORGE.MAX_ENHANCE_LEVEL * FORGE.ENHANCE_BONUS_PER_LEVEL) / 100);
  assert.equal(getEnhanceMultiplier(NaN), 1);
});

test('el wrapper deprecado de types/user delega en rpg-utils', () => {
  const user = structuredClone(DEFAULT_USER);
  user.playerClass = 'guerrero';
  user.equipment.armor = 'armadura_cuero';
  assert.deepEqual(legacyCalculateTotalStats(user, ITEMS), calculateTotalStats(user));
  assert.deepEqual(legacyCalculateTotalStats(user, ITEMS, CLASSES), calculateTotalStats(user));
});

test('calculateDamage nunca devuelve menos de 1 y respeta el multiplicador', () => {
  for (let i = 0; i < 200; i++) {
    assert.ok(calculateDamage(1, 1000, 0).damage >= 1);
    assert.ok(calculateDamage(0, 0, 50).damage >= 1);
  }

  for (let i = 0; i < 100; i++) {
    const sin = calculateDamage(100, 0, 0);
    assert.equal(sin.isCrit, false);
    assert.ok(sin.damage >= 90 && sin.damage <= 110, `daño fuera de rango: ${sin.damage}`);

    const doble = calculateDamage(100, 0, 0, 2);
    assert.ok(doble.damage >= 180 && doble.damage <= 220, `daño x2 fuera de rango: ${doble.damage}`);

    const crit = calculateDamage(100, 0, 100);
    assert.equal(crit.isCrit, true);
    assert.ok(crit.damage >= 135 && crit.damage <= 165, `crítico fuera de rango: ${crit.damage}`);
  }

  assert.ok(calculateDamage(100, 0, 0, NaN).damage >= 90);
  assert.ok(calculateDamage(100, 0, 0, -1).damage >= 90);
});
