import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setLogLevel } from '../src/lib/logger.js';
import { Database } from '../src/lib/database.js';
import {
  ensureQuestsFresh,
  updateQuestProgress,
  claimCompletedQuests,
  getQuestById,
  renderQuestList,
  DAILY_RESET,
  DAILY_QUEST_COUNT,
  WEEKLY_QUEST_COUNT,
  ALL_DAILY_QUESTS
} from '../src/lib/quests.js';
import { DEFAULT_USER } from '../src/types/user.js';

setLogLevel('error');

async function withDb(fn: (db: Database) => Promise<void> | void): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'cyalbot-rpgprog-quests-'));
  const db = new Database(join(dir, 'database.json'));
  try {
    await db.init();
    await fn(db);
  } finally {
    await db.stop();
    await rm(dir, { recursive: true, force: true });
  }
}

const JID = 'q@s.whatsapp.net';

function seed(db: Database, now: number) {
  db.updateUser(JID, {
    name: 'Q',
    registered: true,
    money: 0,
    exp: 0,
    dailyQuests: [
      { questId: 'daily_work_3', progress: 0, completed: false },
      { questId: 'daily_mine_3', progress: 0, completed: false }
    ],
    weeklyQuests: [{ questId: 'weekly_work_15', progress: 0, completed: false }],
    lastDailyReset: now,
    lastWeeklyReset: now
  });
  return db.getUser(JID);
}

test('ensureQuestsFresh asigna misiones cuando faltan y las ids existen en el índice', () => {
  const user = structuredClone(DEFAULT_USER);
  const now = 1_000_000;
  assert.equal(ensureQuestsFresh(user, now), true);
  assert.equal(user.dailyQuests.length, DAILY_QUEST_COUNT);
  assert.equal(user.weeklyQuests.length, WEEKLY_QUEST_COUNT);
  assert.equal(user.lastDailyReset, now);
  for (const q of [...user.dailyQuests, ...user.weeklyQuests]) {
    assert.ok(getQuestById(q.questId), `misión desconocida ${q.questId}`);
  }
  assert.equal(ensureQuestsFresh(user, now + 1000), false);
});

test('las misiones diarias se reasignan pasadas 24h', () => {
  const user = structuredClone(DEFAULT_USER);
  const now = 1_000_000;
  ensureQuestsFresh(user, now);
  const weekly = [...user.weeklyQuests];
  user.dailyQuests[0].progress = 2;

  assert.equal(ensureQuestsFresh(user, now + DAILY_RESET), true);
  assert.equal(user.lastDailyReset, now + DAILY_RESET);
  assert.ok(user.dailyQuests.every(q => q.progress === 0));
  assert.deepEqual(user.weeklyQuests, weekly);
});

test('updateQuestProgress avanza solo las misiones con ese objective', async () => {
  await withDb((db) => {
    const now = Date.now();
    const user = seed(db, now);
    const r = updateQuestProgress(db, JID, 'work', 1, now);

    assert.equal(r.completed.length, 0);
    assert.equal(user.dailyQuests[0].progress, 1);
    assert.equal(user.dailyQuests[1].progress, 0);
    assert.equal(user.weeklyQuests[0].progress, 1);
  });
});

test('al completar una misión se cobra sola: recompensa, línea y claimedAt', async () => {
  await withDb((db) => {
    const now = Date.now();
    const user = seed(db, now);
    const quest = getQuestById('daily_mine_3')!;

    updateQuestProgress(db, JID, 'mine', 2, now);
    assert.equal(user.money, 0);

    const r = updateQuestProgress(db, JID, 'mine', 1, now);
    assert.equal(r.completed.length, 1);
    assert.equal(r.completed[0].id, 'daily_mine_3');
    assert.ok(r.lines[0].startsWith('🎁 Misión completada'));

    const progress = user.dailyQuests.find(q => q.questId === 'daily_mine_3')!;
    assert.equal(progress.completed, true);
    assert.equal(progress.claimedAt, now);
    assert.equal(user.money, quest.rewards.money);
    assert.equal(user.exp, quest.rewards.exp);
    assert.equal(user.limit, DEFAULT_USER.limit + (quest.rewards.diamonds ?? 0));

    // Una misión cobrada no vuelve a avanzar ni a cobrarse
    const again = updateQuestProgress(db, JID, 'mine', 5, now);
    assert.equal(again.completed.length, 0);
    assert.equal(user.money, quest.rewards.money);
  });
});

test('claimCompletedQuests cobra las completadas sin reclamar (progreso heredado)', async () => {
  await withDb((db) => {
    const now = Date.now();
    const user = seed(db, now);
    user.dailyQuests[0].progress = 3;

    const r = claimCompletedQuests(db, JID, now);
    assert.equal(r.completed.length, 1);
    assert.equal(user.dailyQuests[0].claimedAt, now);
    assert.equal(user.money, getQuestById('daily_work_3')!.rewards.money);

    assert.equal(claimCompletedQuests(db, JID, now).completed.length, 0);
  });
});

test('renderQuestList cuenta las pendientes de cobrar y las nuevas diarias tienen objetivos nuevos', () => {
  const list = renderQuestList('Diarias', [
    { questId: 'daily_work_3', progress: 3, completed: false },
    { questId: 'daily_mine_3', progress: 1, completed: false },
    { questId: 'daily_fish_3', progress: 3, completed: true, claimedAt: 1 }
  ], '1 hora');
  assert.equal(list.pending, 1);
  assert.ok(list.text.includes('🎁'));
  assert.ok(list.text.includes('✅'));

  const objectives = new Set(ALL_DAILY_QUESTS.map(q => q.objective));
  for (const o of ['mine', 'daily', 'fumar', 'transfer', 'fish']) assert.ok(objectives.has(o as never), o);
});
