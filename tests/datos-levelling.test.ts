import { test } from 'node:test';
import assert from 'node:assert/strict';
import { xpRange, findLevel, getLevelProgress, grantExp, setLevel, loseExp } from '../src/lib/levelling.js';
import { CONFIG } from '../src/config.js';
import { DEFAULT_USER, type UserRPG } from '../src/types/user.js';

function newUser(): UserRPG {
  return structuredClone(DEFAULT_USER);
}

const bonus = CONFIG.rpg.levelUpBonus;

test('getLevelProgress queda acotado a [0,100] y current >= 0', () => {
  const low = getLevelProgress(3, 0);
  assert.equal(low.current, 0);
  assert.equal(low.percent, 0);

  const high = getLevelProgress(3, xpRange(3).max * 5);
  assert.equal(high.percent, 100);
  assert.equal(high.remaining, 0);

  const nan = getLevelProgress(2, NaN);
  assert.equal(nan.current, 0);
  assert.equal(nan.percent, 0);
});

test('grantExp suma XP, sube niveles y aplica el bonus por cada nivel', () => {
  const user = newUser();
  const target = xpRange(3).min;
  const result = grantExp(user, target);

  assert.deepEqual(result, { gained: target, leveledUp: true, from: 0, to: 3 });
  assert.equal(user.level, 3);
  assert.equal(user.exp, target);
  assert.equal(user.maxHealth, DEFAULT_USER.maxHealth + 3 * bonus.healthPerLevel);
  assert.equal(user.maxStamina, DEFAULT_USER.maxStamina + 3 * bonus.staminaPerLevel);
  assert.equal(user.maxMana, DEFAULT_USER.maxMana + 3 * bonus.manaPerLevel);
  assert.equal(user.money, DEFAULT_USER.money + 3 * bonus.moneyPerLevel);
  assert.equal(user.health, user.maxHealth);
});

test('grantExp aplica multiplicador, ignora cantidades inválidas y no baja de nivel', () => {
  const user = newUser();
  assert.equal(grantExp(user, 10, { multiplier: 2.5 }).gained, 25);
  assert.equal(user.exp, 25);

  assert.deepEqual(grantExp(user, -50), { gained: 0, leveledUp: false, from: 0, to: 0 });
  assert.deepEqual(grantExp(user, NaN), { gained: 0, leveledUp: false, from: 0, to: 0 });
  assert.equal(user.exp, 25);

  const boosted = newUser();
  boosted.level = 10;
  boosted.exp = 0;
  const r = grantExp(boosted, 5);
  assert.equal(r.leveledUp, false);
  assert.equal(boosted.level, 10);
  assert.equal(findLevel(boosted.exp), 0);
});

test('setLevel fija exp al mínimo del nivel y aplica/retira el bonus de forma coherente', () => {
  const user = newUser();
  setLevel(user, 5);
  assert.equal(user.level, 5);
  assert.equal(user.exp, xpRange(5).min);
  assert.equal(user.maxHealth, DEFAULT_USER.maxHealth + 5 * bonus.healthPerLevel);
  assert.equal(user.money, DEFAULT_USER.money + 5 * bonus.moneyPerLevel);

  user.health = user.maxHealth;
  const down = setLevel(user, 2);
  assert.deepEqual(down, { from: 5, to: 2 });
  assert.equal(user.exp, xpRange(2).min);
  assert.equal(user.maxHealth, DEFAULT_USER.maxHealth + 2 * bonus.healthPerLevel);
  assert.equal(user.health, user.maxHealth);
  // Bajar de nivel no confisca el dinero ya concedido
  assert.equal(user.money, DEFAULT_USER.money + 5 * bonus.moneyPerLevel);

  setLevel(user, -3);
  assert.equal(user.level, 0);
  assert.equal(user.exp, 0);
  assert.equal(user.maxHealth, DEFAULT_USER.maxHealth);
});

test('setLevel hacia abajo no deja los máximos por debajo de DEFAULT_USER ni toca el dinero', () => {
  // Usuario subido con el setnivel antiguo (level*level*100): nunca recibió el bonus por nivel
  const user = newUser();
  user.level = 3;
  user.exp = xpRange(3).min;
  user.money = 250;

  setLevel(user, 0);
  assert.equal(user.level, 0);
  assert.equal(user.maxHealth, DEFAULT_USER.maxHealth);
  assert.equal(user.maxStamina, DEFAULT_USER.maxStamina);
  assert.equal(user.maxMana, DEFAULT_USER.maxMana);
  assert.equal(user.money, 250);
  assert.ok(user.health <= user.maxHealth);
});

test('loseExp nunca baja del mínimo del nivel actual', () => {
  const user = newUser();
  setLevel(user, 4);
  user.exp = xpRange(4).min + 100;

  assert.equal(loseExp(user, 30), 30);
  assert.equal(user.exp, xpRange(4).min + 70);
  assert.equal(loseExp(user, 10_000), 70);
  assert.equal(user.exp, xpRange(4).min);
  assert.equal(loseExp(user, 5), 0);
  assert.equal(loseExp(user, -5), 0);
  assert.equal(findLevel(user.exp), 4);
});
