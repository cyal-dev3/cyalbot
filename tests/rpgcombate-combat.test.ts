import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setLogLevel } from '../src/lib/logger.js';
import { Database } from '../src/lib/database.js';
import { xpRange } from '../src/lib/levelling.js';
import { SKILLS } from '../src/types/rpg.js';
import {
  applySkillEffect, clearBusy, consumeEvasion, createCombatState, effectiveAttack, effectiveDefense, getBusy,
  getDropLuck, getExpMultiplier, grantCombatRewards, handlePlayerDeath, PERMANENT_BUFF, rollDrops, setBusy,
  simulateFight, tickEffects, DROP_LUCK_BUFF, type Fighter
} from '../src/lib/rpg-combat.js';

setLogLevel('error');

/** Fija Math.random durante fn: randomInt(a, b) devuelve floor(value * (b - a + 1)) + a */
async function withRandom<T>(value: number, fn: () => T | Promise<T>): Promise<T> {
  const original = Math.random;
  Math.random = () => value;
  try {
    return await fn();
  } finally {
    Math.random = original;
  }
}

async function withDb(fn: (db: Database) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'cyalbot-combat-'));
  const db = new Database(join(dir, 'database.json'));
  try {
    await db.init();
    await fn(db);
  } finally {
    await db.stop();
    await rm(dir, { recursive: true, force: true });
  }
}

const fighter = (over: Partial<Fighter>): Fighter => ({ name: 'X', attack: 10, defense: 0, critChance: 0, health: 100, ...over });

test('simulateFight: gana el atacante, el daño y los turnos son deterministas', async () => {
  await withRandom(0.5, () => {
    const result = simulateFight(fighter({ name: 'Heroe', attack: 50, defense: 10 }), fighter({ name: 'Slime', attack: 5, health: 60 }));
    assert.equal(result.result, 'won');
    assert.equal(result.turns, 2);
    assert.equal(result.damageDealt, 100);
    // 5 de ataque contra 10 de defensa no baja del mínimo de 1
    assert.equal(result.damageTaken, 1);
    assert.equal(result.attackerHealth, 99);
    assert.equal(result.defenderHealth, 0);
    assert.ok(result.log.length > 0);
  });
});

test('simulateFight: pierde el atacante y el resultado es lost', async () => {
  await withRandom(0.5, () => {
    const result = simulateFight(fighter({ attack: 1, health: 20 }), fighter({ attack: 30, health: 500 }));
    assert.equal(result.result, 'lost');
    assert.equal(result.attackerHealth, 0);
    assert.ok(result.defenderHealth > 0);
  });
});

test('simulateFight: al agotar los turnos es empate y nadie muere', async () => {
  await withRandom(0.5, () => {
    const result = simulateFight(fighter({ attack: 2, health: 1000 }), fighter({ attack: 2, health: 1000 }), { maxTurns: 3 });
    assert.equal(result.result, 'draw');
    assert.equal(result.turns, 3);
    assert.equal(result.damageDealt, 6);
    assert.equal(result.damageTaken, 6);
  });
});

test('applySkillEffect: buffs de ataque/defensa, evasión y debuff al rival', () => {
  const me = createCombatState();
  const rival = createCombatState();

  const grito = applySkillEffect(SKILLS.grito_guerra, me, rival);
  assert.equal(grito.dealsDamage, false);
  assert.equal(effectiveAttack(100, me), 130);

  applySkillEffect(SKILLS.escudo_defensor, me, rival);
  assert.equal(effectiveDefense(100, me), 150);

  const trampa = applySkillEffect(SKILLS.trampa_cazador, me, rival);
  assert.ok(trampa.lines.some(l => l.includes('-30%')));
  assert.equal(effectiveDefense(100, rival), 70);

  applySkillEffect(SKILLS.evadir, me, rival);
  assert.equal(consumeEvasion(me), true);
  assert.equal(consumeEvasion(me), false, 'la evasión se gasta con un solo golpe');

  // Los buffs duran 3 acciones propias; la cuarta ya no aplica
  tickEffects(me);
  tickEffects(me);
  assert.equal(effectiveAttack(100, me), 130);
  const expired = tickEffects(me);
  assert.ok(expired.includes('attackUp'));
  assert.equal(effectiveAttack(100, me), 100);
  assert.equal(effectiveDefense(100, me), 100);

  const bola = applySkillEffect(SKILLS.bola_fuego, me, rival);
  assert.equal(bola.dealsDamage, true);
  assert.equal(bola.lines.length, 0);
});

test('registro de ocupados: no se puede estar en duelo y dungeon a la vez', () => {
  clearBusy('a@s.whatsapp.net');
  assert.equal(setBusy('a@s.whatsapp.net', 'duel'), true);
  assert.equal(setBusy('a@s.whatsapp.net', 'dungeon'), false);
  assert.equal(getBusy('a@s.whatsapp.net'), 'duel');
  clearBusy('a@s.whatsapp.net');
  assert.equal(getBusy('a@s.whatsapp.net'), null);
});

test('buffs: multiplicador de XP (incluido el permanente) y suerte de drops', () => {
  const user = { activeBuffs: [
    { type: 'expBoost', value: 2, expiresAt: Date.now() + 60_000 },
    { type: 'expBoost', value: 1.5, expiresAt: PERMANENT_BUFF },
    { type: 'expBoost', value: 3, expiresAt: Date.now() - 1 },
    { type: DROP_LUCK_BUFF, value: 20, expiresAt: Date.now() + 60_000 }
  ] } as unknown as Parameters<typeof getExpMultiplier>[0];
  assert.equal(getExpMultiplier(user), 3);
  assert.equal(getDropLuck(user), 20);

  const drops = [{ itemId: 'a', chance: 0.5 }, { itemId: 'b', chance: 0.1 }];
  assert.deepEqual(rollDrops(drops, { random: () => 0.55, luckBonus: 20 }), ['a']);
  assert.deepEqual(rollDrops(drops, { random: () => 0.55 }), []);
  assert.deepEqual(rollDrops(drops, { random: () => 0.2, chanceMultiplier: 0.5 }), ['a']);
});

test('handlePlayerDeath: cobra la cuota, crea deuda con fecha o la cubre el seguro', async () => {
  await withDb(async (db) => {
    const now = 1_700_000_000_000;
    const rich = 'rich@s.whatsapp.net';
    db.updateUser(rich, { registered: true, name: 'Rico', money: 10_000, health: 0 });
    // Con Math.random 0.5 la tirada es 51 (cuota baja) y el importe 1250
    const paid = await withRandom(0.5, () => handlePlayerDeath(db, rich, 'Rico', now));
    assert.equal(paid.fee, 1250);
    assert.equal(paid.paid, true);
    assert.equal(db.getUser(rich).money, 8750);
    assert.equal(db.getUser(rich).health, 1);
    assert.equal(db.getUser(rich).debt, 0);
    assert.ok(paid.message.includes('Cuota pagada'));

    const poor = 'poor@s.whatsapp.net';
    db.updateUser(poor, { registered: true, name: 'Pobre', money: 250, health: 0, debtCreatedAt: 0 });
    const owed = await withRandom(0.5, () => handlePlayerDeath(db, poor, 'Pobre', now));
    assert.equal(owed.paid, false);
    assert.equal(owed.debt, 1000);
    assert.equal(db.getUser(poor).money, 0);
    assert.equal(db.getUser(poor).debt, 1000);
    assert.equal(db.getUser(poor).debtCreatedAt, now, 'la deuda nueva fija debtCreatedAt para el interés');
    assert.equal(db.getUser(poor).health, 1);

    // Una deuda ya existente conserva su fecha original
    const again = await withRandom(0.5, () => handlePlayerDeath(db, poor, 'Pobre', now + 5000));
    assert.equal(again.debt, 2250);
    assert.equal(db.getUser(poor).debtCreatedAt, now);

    const insured = 'ins@s.whatsapp.net';
    db.updateUser(insured, { registered: true, name: 'Seguro', money: 5000, health: 0, seguroVida: now + 1000 });
    const covered = handlePlayerDeath(db, insured, 'Seguro', now);
    assert.equal(covered.insured, true);
    assert.equal(covered.fee, 0);
    assert.equal(db.getUser(insured).money, 5000);
    assert.equal(db.getUser(insured).health, 1);
    assert.ok(covered.message.includes('SEGURO'));
  });
});

test('grantCombatRewards: XP con buff, dinero, botín a inventario y materiales, misión', async () => {
  await withDb(async (db) => {
    const jid = 'hero@s.whatsapp.net';
    const now = Date.now();
    const user = db.getUser(jid);
    user.registered = true;
    user.name = 'Heroe';
    user.money = 100;
    // Nivel 5 con la XP justa: 100 XP más no suben de nivel (y no dan el bonus de dinero)
    user.level = 5;
    user.exp = xpRange(5).min;
    user.activeBuffs = [{ type: 'expBoost', value: 2, expiresAt: now + 60_000 }];
    user.dailyQuests = [{ questId: 'daily_combat_5', progress: 0, completed: false }];
    // Misiones recién asignadas: si no, el reset diario las sustituiría por otras al azar
    user.lastDailyReset = now;
    user.lastWeeklyReset = now;
    db.updateUser(jid, user);

    const result = grantCombatRewards(db, jid, {
      exp: 50, money: 30, items: ['pocion_salud', 'hierro', 'item_inexistente'], quest: { objective: 'combat', amount: 1 }
    }, now);

    assert.equal(result.exp, 100, 'el elixir duplica la XP');
    assert.equal(result.expMultiplier, 2);
    assert.equal(result.money, 30);
    const saved = db.getUser(jid);
    assert.equal(saved.exp, xpRange(5).min + 100);
    assert.equal(saved.level, 5);
    assert.equal(saved.money, 130);
    assert.equal(saved.totalEarned, 30);
    assert.equal(saved.inventory.find(i => i.itemId === 'pocion_salud')?.quantity, 1);
    assert.equal(saved.forgeMaterials.hierro, 1, 'los materiales van a forgeMaterials');
    assert.equal(result.items.length, 2);
    assert.deepEqual(result.lost, ['item_inexistente']);
    assert.ok(saved.dailyQuests[0].progress >= 1, 'la misión de combate avanza');
    assert.ok(result.lines.some(l => l.includes('Buff de XP')));
  });
});
