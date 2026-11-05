import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setLogLevel } from '../src/lib/logger.js';
import { Database } from '../src/lib/database.js';
import { PVP } from '../src/constants/rpg.js';
import { SKILLS } from '../src/types/rpg.js';
import { clearBusy, getBusy, setBusy } from '../src/lib/rpg-combat.js';
import { createDuel, performDuelAction, resolveTimeout, settleDuel, findSkill, activeDuels, canFight } from '../src/plugins/rpg-duelo.js';

setLogLevel('error');

const GROUP = 'grupo@g.us';
const A = 'a@s.whatsapp.net';
const B = 'b@s.whatsapp.net';

async function withDb(fn: (db: Database) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'cyalbot-duel-'));
  const db = new Database(join(dir, 'database.json'));
  try {
    await db.init();
    await fn(db);
  } finally {
    await db.stop();
    await rm(dir, { recursive: true, force: true });
  }
}

async function withRandom<T>(value: number, fn: () => T | Promise<T>): Promise<T> {
  const original = Math.random;
  Math.random = () => value;
  try {
    return await fn();
  } finally {
    Math.random = original;
  }
}

function seed(db: Database, jid: string, over: Record<string, unknown> = {}) {
  const user = db.getUser(jid);
  Object.assign(user, { registered: true, name: jid.split('@')[0], level: 10, money: 5000, health: 100, maxHealth: 100, mana: 50, maxMana: 50, stamina: 100, maxStamina: 100, attack: 40, defense: 10, critChance: 0 }, over);
  db.updateUser(jid, user);
  return user;
}

/** Simula lo que hace /aceptar: descuenta la apuesta a ambos y crea el duelo */
function startDuel(db: Database, bet: number, now: number) {
  const a = db.getUser(A);
  const b = db.getUser(B);
  if (bet > 0) {
    db.updateUser(A, { money: a.money - bet });
    db.updateUser(B, { money: b.money - bet });
  }
  const duel = createDuel({ jid: A, user: a }, { jid: B, user: b }, GROUP, bet, now);
  activeDuels.set(GROUP, duel);
  setBusy(A, 'duel');
  setBusy(B, 'duel');
  return duel;
}

test('createDuel multiplica la vida y guarda el grupo y el pot', async () => {
  await withDb(async (db) => {
    seed(db, A);
    seed(db, B, { health: 50 });
    const duel = createDuel({ jid: A, user: db.getUser(A) }, { jid: B, user: db.getUser(B) }, GROUP, 500, 1000);
    assert.equal(duel.groupJid, GROUP);
    assert.equal(duel.pot, 1000);
    assert.equal(duel.players.challenger.health, Math.floor(100 * PVP.HEALTH_MULTIPLIER));
    assert.equal(duel.players.target.health, Math.floor(50 * PVP.HEALTH_MULTIPLIER));
    assert.equal(duel.players.target.maxHealth, Math.floor(100 * PVP.HEALTH_MULTIPLIER));
  });
});

test('performDuelAction: ataque, cooldown entre acciones, bloqueo a la mitad y combo', async () => {
  await withDb(async (db) => {
    seed(db, A);
    seed(db, B);
    const now = 10_000;
    const duel = createDuel({ jid: A, user: db.getUser(A) }, { jid: B, user: db.getUser(B) }, GROUP, 0, now);
    const target = duel.players.target;
    const before = target.health;

    await withRandom(0.5, () => {
      const first = performDuelAction(duel, 'challenger', { kind: 'attack' }, now);
      assert.equal(first.ok, true);
      const dealt = before - target.health;
      assert.ok(dealt >= 1);
      assert.equal(duel.totalActions, 1);
      assert.equal(duel.players.challenger.stamina, 100 - PVP.DUEL_COSTS.ATTACK_STAMINA);

      const tooFast = performDuelAction(duel, 'challenger', { kind: 'attack' }, now + 100);
      assert.equal(tooFast.ok, false);
      assert.ok(tooFast.error?.includes('Espera'));

      // El objetivo bloquea: el siguiente golpe hace la mitad
      const block = performDuelAction(duel, 'target', { kind: 'block' }, now + 100);
      assert.equal(block.ok, true);
      assert.equal(target.state.blocking, true);
      const mid = target.health;
      performDuelAction(duel, 'challenger', { kind: 'attack' }, now + PVP.DUEL_ACTION_COOLDOWN);
      const blockedDealt = mid - target.health;
      assert.equal(blockedDealt, Math.max(1, Math.floor(dealt * PVP.BLOCK_REDUCTION)));
      assert.equal(target.state.blocking, false);
      assert.equal(performDuelAction(duel, 'target', { kind: 'block' }, now + 100).ok, false, 'no se puede bloquear dos veces seguidas');
    });
  });
});

test('performDuelAction: habilidades de buff, evasión y trampa funcionan', async () => {
  await withDb(async (db) => {
    seed(db, A, { playerClass: 'ladron', mana: 100, maxMana: 100 });
    seed(db, B, { playerClass: 'arquero', mana: 100, maxMana: 100 });
    const now = 50_000;
    const duel = createDuel({ jid: A, user: db.getUser(A) }, { jid: B, user: db.getUser(B) }, GROUP, 0, now);

    await withRandom(0.5, () => {
      const wrongClass = performDuelAction(duel, 'challenger', { kind: 'skill', skill: SKILLS.bola_fuego }, now);
      assert.equal(wrongClass.ok, false);

      const evade = performDuelAction(duel, 'challenger', { kind: 'skill', skill: SKILLS.evadir }, now);
      assert.equal(evade.ok, true);
      assert.ok(duel.players.challenger.state.effects.some(e => e.type === 'evading'));

      const health = duel.players.challenger.health;
      const shot = performDuelAction(duel, 'target', { kind: 'attack' }, now);
      assert.equal(shot.ok, true);
      assert.equal(duel.players.challenger.health, health, 'el golpe fue esquivado');
      assert.ok(shot.line?.includes('esquivó'));

      const trap = performDuelAction(duel, 'target', { kind: 'skill', skill: SKILLS.trampa_cazador }, now + PVP.DUEL_ACTION_COOLDOWN);
      assert.equal(trap.ok, true);
      assert.ok(duel.players.challenger.state.effects.some(e => e.type === 'defenseDown'));

      const onCooldown = performDuelAction(duel, 'target', { kind: 'skill', skill: SKILLS.trampa_cazador }, now + PVP.DUEL_ACTION_COOLDOWN * 2);
      assert.equal(onCooldown.ok, false);
      assert.ok(onCooldown.error?.includes('cooldown'));
    });

    assert.equal(findSkill('gb', 'guerrero')?.id, 'golpe_brutal');
    assert.equal(findSkill('bola de fuego', 'mago')?.id, 'bola_fuego');
    assert.equal(findSkill('bola', 'guerrero'), null);
  });
});

test('settleDuel: el ganador cobra el pot (escrow) y ambos quedan con vida proporcional', async () => {
  await withDb(async (db) => {
    seed(db, A, { money: 5000, health: 100 });
    seed(db, B, { money: 5000, health: 100 });
    const now = 100_000;
    const duel = startDuel(db, 1000, now);
    assert.equal(db.getUser(A).money, 4000);
    assert.equal(db.getUser(B).money, 4000);

    duel.players.challenger.health = Math.floor(duel.players.challenger.maxHealth / 2);
    duel.players.target.health = 0;
    duel.totalActions = 5;

    const result = await withRandom(0.5, () => settleDuel(db, duel, 'challenger', 'victory', now + 20_000));
    assert.equal(result.winner, 'challenger');
    assert.equal(db.getUser(A).money, 4000 + 2000, 'el ganador recibe las dos apuestas');
    assert.equal(db.getUser(A).health, Math.floor((duel.players.challenger.maxHealth / 2) / PVP.HEALTH_MULTIPLIER));
    assert.equal(db.getUser(A).combatStats.pvpWins, 1);
    assert.equal(db.getUser(B).combatStats.pvpLosses, 1);
    assert.equal(db.getUser(B).health, 1, 'el que llegó a 0 revive con 1 tras el IMSS');
    assert.ok(db.getUser(B).money < 4000, 'solo el que murió paga la cuota');
    assert.ok(result.message.includes('CUOTA DEL IMSS'));
    assert.ok(db.getUser(A).exp > 0);
    assert.equal(db.getUser(A).lastDuel, now + 20_000);
    assert.equal(activeDuels.has(GROUP), false);
    assert.equal(getBusy(A), null);
    assert.equal(getBusy(B), null);
  });
});

test('settleDuel: rendirse no cobra IMSS al perdedor', async () => {
  await withDb(async (db) => {
    seed(db, A);
    seed(db, B);
    const now = 200_000;
    const duel = startDuel(db, 0, now);
    duel.players.target.health = Math.floor(duel.players.target.maxHealth * 0.8);
    const result = await withRandom(0.5, () => settleDuel(db, duel, 'challenger', 'surrender', now));
    assert.equal(db.getUser(B).health, 80);
    assert.equal(db.getUser(B).money, 5000);
    assert.ok(!result.message.includes('CUOTA DEL IMSS'));
    clearBusy(A);
    clearBusy(B);
  });
});

test('timeout: sin acciones se devuelve la apuesta; con la misma vida es empate y también se devuelve', async () => {
  await withDb(async (db) => {
    seed(db, A, { money: 3000 });
    seed(db, B, { money: 3000 });
    const now = 300_000;

    let duel = startDuel(db, 500, now);
    assert.deepEqual(resolveTimeout(duel), { winner: null, reason: 'refund' });
    let result = settleDuel(db, duel, null, 'refund', now);
    assert.equal(result.winner, null);
    assert.equal(db.getUser(A).money, 3000);
    assert.equal(db.getUser(B).money, 3000);
    assert.ok(result.message.includes('Nadie actuó'));
    assert.equal(db.getUser(A).combatStats.pvpWins + db.getUser(A).combatStats.pvpLosses, 0);

    duel = startDuel(db, 500, now);
    duel.totalActions = 4;
    duel.players.challenger.health -= 10;
    duel.players.target.health -= 10;
    assert.deepEqual(resolveTimeout(duel), { winner: null, reason: 'draw' });
    result = settleDuel(db, duel, null, 'draw', now);
    assert.ok(result.message.includes('EMPATE'));
    assert.equal(db.getUser(A).money, 3000);
    assert.equal(db.getUser(B).money, 3000);

    duel = startDuel(db, 500, now);
    duel.totalActions = 2;
    duel.players.target.health -= 50;
    assert.equal(resolveTimeout(duel).winner, 'challenger');
    result = await withRandom(0.5, () => settleDuel(db, duel, 'challenger', 'timeout', now));
    assert.equal(db.getUser(A).money, 3500);
    assert.equal(db.getUser(B).money, 2500);
  });
});

test('canFight aplica el cooldown de duelo tanto al retador como al retado', async () => {
  await withDb(async (db) => {
    const now = 1_000_000_000;
    seed(db, A, { lastDuel: 0 });
    seed(db, B, { lastDuel: now - 1000 });
    assert.equal(canFight(db.getUser(A), A, now, true), null);
    const rival = canFight(db.getUser(B), B, now, false);
    assert.ok(rival && rival.includes('acaba de pelear'), 'el retado con lastDuel reciente no puede aceptar');
    const self = canFight(db.getUser(B), B, now, true);
    assert.ok(self && self.includes('Espera'));
    assert.equal(canFight(db.getUser(B), B, now + PVP.DUEL_COOLDOWN, false), null);

    seed(db, A, { passiveMode: true, passiveModeUntil: Number.MAX_SAFE_INTEGER });
    assert.match(canFight(db.getUser(A), A, now, true) ?? '', /pasivo/);
  });
});

test('un buff "por 3 acciones" cubre los 3 golpes siguientes, no el de lanzarlo', async () => {
  await withDb(async (db) => {
    seed(db, A, { playerClass: 'guerrero', mana: 100, maxMana: 100 });
    seed(db, B, { health: 100_000, maxHealth: 100_000 });
    let now = 50_000;
    const duel = createDuel({ jid: A, user: db.getUser(A) }, { jid: B, user: db.getUser(B) }, GROUP, 0, now);
    const challenger = duel.players.challenger;

    await withRandom(0.5, () => {
      const grito = performDuelAction(duel, 'challenger', { kind: 'skill', skill: SKILLS.grito_guerra }, now);
      assert.equal(grito.ok, true);
      const buff = challenger.state.effects.find(e => e.type === 'attackUp');
      assert.equal(buff?.remaining, SKILLS.grito_guerra.effect.buff?.duration);

      const duration = SKILLS.grito_guerra.effect.buff?.duration ?? 0;
      const damages: number[] = [];
      for (let i = 0; i < duration + 1; i++) {
        now += PVP.DUEL_ACTION_COOLDOWN;
        const before = duel.players.target.health;
        const hit = performDuelAction(duel, 'challenger', { kind: 'attack' }, now);
        assert.equal(hit.ok, true);
        damages.push(before - duel.players.target.health);
        // el combo sube con los golpes seguidos; se rompe a mano para comparar solo el buff
        duel.consecutiveHits = 0;
        duel.lastAttacker = null;
      }
      for (let i = 0; i < duration; i++) assert.ok(damages[i] > damages[duration], `golpe ${i + 1} con +30% (${damages[i]} vs ${damages[duration]})`);
      assert.equal(challenger.state.effects.length, 0);
    });
  });
});
