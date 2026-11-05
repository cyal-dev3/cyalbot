import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setLogLevel } from '../src/lib/logger.js';
import { Database } from '../src/lib/database.js';
import { globalModes, checkExpiredModes } from '../src/lib/global-modes.js';
import { xpRange } from '../src/lib/levelling.js';
import { grantRewards, SLAVERY_CUT, GUILD_XP_BONUS_PER_LEVEL, isPassiveActive, clamp } from '../src/lib/rpg-actions.js';
import { DEFAULT_USER } from '../src/types/user.js';

setLogLevel('error');

async function withDb(fn: (db: Database) => Promise<void> | void): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'cyalbot-rpgprog-'));
  const db = new Database(join(dir, 'database.json'));
  try {
    await db.init();
    await fn(db);
  } finally {
    await db.stop();
    await rm(dir, { recursive: true, force: true });
    for (const key of ['bonusMode', 'chaosMode', 'eventMode'] as const) {
      globalModes[key].active = false;
    }
  }
}

function register(db: Database, jid: string, name: string) {
  db.updateUser(jid, { name, registered: true, regTime: 1, level: 0, exp: 0, money: 0, dailyQuests: [{ questId: 'daily_work_3', progress: 0, completed: false }], weeklyQuests: [{ questId: 'weekly_earn_10000', progress: 0, completed: false }], lastDailyReset: Date.now(), lastWeeklyReset: Date.now() });
  return db.getUser(jid);
}

test('grantRewards suma XP y dinero base sin modos ni rango (nivel 0)', async () => {
  await withDb((db) => {
    const user = register(db, 'a@s.whatsapp.net', 'A');
    const r = grantRewards(db, 'a@s.whatsapp.net', { exp: 10, money: 100, diamonds: 2, potions: 1 }, { source: 'test', now: Date.now() });

    assert.equal(r.exp, 10);
    assert.equal(r.money, 100);
    assert.equal(user.exp, 10);
    assert.equal(user.money, 100);
    assert.equal(user.totalEarned, 100);
    assert.equal(user.limit, DEFAULT_USER.limit + 2);
    assert.equal(user.potion, DEFAULT_USER.potion + 1);
    assert.equal(r.leveledUp, false);
  });
});

test('grantRewards aplica el modo bonus una sola vez y lo reporta en lines', async () => {
  await withDb((db) => {
    register(db, 'b@s.whatsapp.net', 'B');
    const now = Date.now();
    Object.assign(globalModes.bonusMode, { active: true, expMultiplier: 2, moneyMultiplier: 3, manaMultiplier: 1, expiresAt: now + 60000, activatedBy: 'test' });
    checkExpiredModes(now);

    const r = grantRewards(db, 'b@s.whatsapp.net', { exp: 100, money: 100 }, { source: 'test', now });
    assert.equal(r.exp, 200);
    assert.equal(r.money, 300);
    assert.equal(r.lines.filter(l => l.includes('Modo Bonus')).length, 1);
  });
});

test('grantRewards aplica el corte de esclavitud exactamente una vez y se lo da al amo', async () => {
  await withDb((db) => {
    const now = Date.now();
    const master = register(db, 'amo@s.whatsapp.net', 'Amo');
    const slave = register(db, 'esclavo@s.whatsapp.net', 'Esclavo');
    db.updateUser('esclavo@s.whatsapp.net', { slaveMaster: 'amo@s.whatsapp.net', slaveUntil: now + 3600000 });

    const r = grantRewards(db, 'esclavo@s.whatsapp.net', { exp: 100, money: 200 }, { source: 'test', now });

    const expCut = Math.floor(100 * SLAVERY_CUT / 100);
    const moneyCut = Math.floor(200 * SLAVERY_CUT / 100);
    assert.equal(r.exp, 100 - expCut);
    assert.equal(r.money, 200 - moneyCut);
    assert.equal(slave.exp, 100 - expCut);
    assert.equal(slave.money, 200 - moneyCut);
    assert.equal(master.exp, expCut);
    assert.equal(master.money, moneyCut);
    assert.equal(r.lines.filter(l => l.includes('amo')).length, 1);
    // Contabilidad cerrada: nada se crea ni se pierde al repartir
    assert.equal(slave.money + master.money, 200);
  });
});

test('grantRewards sube de nivel automáticamente con el bonus de nivel', async () => {
  await withDb((db) => {
    const user = register(db, 'c@s.whatsapp.net', 'C');
    const target = xpRange(2).min;
    const r = grantRewards(db, 'c@s.whatsapp.net', { exp: target }, { source: 'test', now: Date.now() });

    assert.equal(r.leveledUp, true);
    assert.equal(r.from, 0);
    assert.equal(r.to, 2);
    assert.equal(user.level, 2);
    assert.ok(r.lines.some(l => l.includes('nivel')));
  });
});

test('grantRewards añade el bonus de gremio por nivel', async () => {
  await withDb((db) => {
    const user = register(db, 'd@s.whatsapp.net', 'D');
    db.saveGuild({ id: 'g1', name: 'Gremio', tag: 'GRE', leader: 'd@s.whatsapp.net', members: ['d@s.whatsapp.net'], treasury: 0, level: 5, exp: 0, createdAt: 1, description: '' });
    db.updateUser('d@s.whatsapp.net', { guildId: 'g1' });

    const r = grantRewards(db, 'd@s.whatsapp.net', { exp: 100 }, { source: 'test', now: Date.now() });
    assert.equal(r.exp, 100 + Math.floor(100 * 5 * GUILD_XP_BONUS_PER_LEVEL / 100));
    assert.equal(user.exp, r.exp);
    assert.ok(r.lines.some(l => l.includes('[GRE]')));
  });
});

test('grantRewards hace avanzar las misiones: earn por el dinero y los questObjectives', async () => {
  await withDb((db) => {
    const user = register(db, 'e@s.whatsapp.net', 'E');
    grantRewards(db, 'e@s.whatsapp.net', { money: 500, questObjectives: [{ objective: 'work', amount: 1 }] }, { source: 'test', now: Date.now() });

    assert.equal(user.dailyQuests.find(q => q.questId === 'daily_work_3')?.progress, 1);
    assert.equal(user.weeklyQuests.find(q => q.questId === 'weekly_earn_10000')?.progress, 500);
  });
});

test('isPassiveActive solo mira passiveMode y clamp acota', () => {
  const user = structuredClone(DEFAULT_USER);
  assert.equal(isPassiveActive(user), false);
  user.passiveMode = true;
  user.passiveModeUntil = 0;
  assert.equal(isPassiveActive(user), true);

  assert.equal(clamp(5, 0, 3), 3);
  assert.equal(clamp(-1, 0, 3), 0);
  assert.equal(clamp(NaN, 0, 3), 0);
});
