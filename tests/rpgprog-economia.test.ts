import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setLogLevel } from '../src/lib/logger.js';
import { Database } from '../src/lib/database.js';
import {
  ensureDebtTimestamps,
  applyDebtInterest,
  resolveDepositAmount,
  resolveWithdrawAmount,
  resolveTransferAmount,
  getActiveSlaves,
  BANK_MAX_AMOUNT,
  DEBT_INTEREST_INTERVAL,
  DEBT_INTEREST_RATE,
  DEBT_SEIZURE_THRESHOLD
} from '../src/plugins/rpg-economia.js';
import { DEFAULT_USER, type UserRPG } from '../src/types/user.js';

setLogLevel('error');

async function withDb(fn: (db: Database) => Promise<void> | void): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'cyalbot-rpgprog-eco-'));
  const db = new Database(join(dir, 'database.json'));
  try {
    await db.init();
    await fn(db);
  } finally {
    await db.stop();
    await rm(dir, { recursive: true, force: true });
  }
}

function user(overrides: Partial<UserRPG> = {}): UserRPG {
  return { ...structuredClone(DEFAULT_USER), ...overrides };
}

test('resolveDepositAmount entiende 1k, 50%, todo y respeta efectivo y tope', () => {
  const u = user({ money: 10000, bank: 0 });
  assert.deepEqual(resolveDepositAmount(u, '1k'), { amount: 1000 });
  assert.deepEqual(resolveDepositAmount(u, '50%'), { amount: 5000 });
  assert.deepEqual(resolveDepositAmount(u, 'todo'), { amount: 10000 });
  assert.ok('error' in resolveDepositAmount(u, '20000'));
  assert.ok('error' in resolveDepositAmount(u, 'abc'));
  assert.ok('error' in resolveDepositAmount(u, undefined));

  const rich = user({ money: 500000, bank: BANK_MAX_AMOUNT - 1000 });
  assert.deepEqual(resolveDepositAmount(rich, 'todo'), { amount: 1000 });
  assert.ok('error' in resolveDepositAmount(rich, '5000'));
  assert.ok('error' in resolveDepositAmount(user({ money: 1, bank: BANK_MAX_AMOUNT }), '1'));
});

test('resolveWithdrawAmount retira todo por defecto y acota al saldo', () => {
  const u = user({ bank: 3000 });
  assert.deepEqual(resolveWithdrawAmount(u, undefined), { amount: 3000 });
  assert.deepEqual(resolveWithdrawAmount(u, 'mitad'), { amount: 1500 });
  assert.ok('error' in resolveWithdrawAmount(u, '5000'));
  assert.ok('error' in resolveWithdrawAmount(user({ bank: 0 }), undefined));
});

test('resolveTransferAmount usa parseAmount sobre el efectivo', () => {
  const u = user({ money: 2000, bank: 99999 });
  assert.deepEqual(resolveTransferAmount(u, '1.5k'), { amount: 1500 });
  assert.deepEqual(resolveTransferAmount(u, 'todo'), { amount: 2000 });
  assert.ok('error' in resolveTransferAmount(u, '2001'));
  assert.ok('error' in resolveTransferAmount(u, '0'));
});

test('ensureDebtTimestamps fija los timestamps al haber deuda y los limpia sin deuda', () => {
  const now = 5_000_000;
  const indebted = user({ debt: 1000 });
  assert.equal(ensureDebtTimestamps(indebted, now), true);
  assert.equal(indebted.debtCreatedAt, now);
  assert.equal(indebted.debtInterestApplied, now);
  assert.equal(ensureDebtTimestamps(indebted, now + 10), false);

  const paid = user({ debt: 0, debtCreatedAt: 1, debtInterestApplied: 2 });
  assert.equal(ensureDebtTimestamps(paid, now), true);
  assert.equal(paid.debtCreatedAt, 0);
  assert.equal(paid.debtInterestApplied, 0);
});

test('applyDebtInterest cobra un periodo por día completo y avanza el timestamp solo lo cobrado', async () => {
  await withDb((db) => {
    const jid = 'deuda@s.whatsapp.net';
    const created = 1_000_000_000;
    db.updateUser(jid, { registered: true, debt: 1000, debtCreatedAt: created, debtInterestApplied: created });

    const half = applyDebtInterest(db, jid, db.getUser(jid), created + DEBT_INTEREST_INTERVAL / 2);
    assert.equal(half.interestApplied, false);
    assert.equal(db.getUser(jid).debt, 1000);

    const now = created + DEBT_INTEREST_INTERVAL * 2.5;
    const r = applyDebtInterest(db, jid, db.getUser(jid), now);
    assert.equal(r.interestApplied, true);
    assert.equal(r.interestAmount, Math.floor(1000 * DEBT_INTEREST_RATE * 2));
    assert.equal(db.getUser(jid).debt, 1000 + r.interestAmount);
    assert.equal(db.getUser(jid).debtInterestApplied, created + DEBT_INTEREST_INTERVAL * 2);
  });
});

test('applyDebtInterest sin timestamps los inicializa y no cobra intereses retroactivos', async () => {
  await withDb((db) => {
    const jid = 'nueva@s.whatsapp.net';
    const now = 2_000_000_000;
    db.updateUser(jid, { registered: true, debt: 500, debtCreatedAt: 0, debtInterestApplied: 0 });

    const r = applyDebtInterest(db, jid, db.getUser(jid), now);
    assert.equal(r.interestApplied, false);
    assert.equal(db.getUser(jid).debtCreatedAt, now);
    assert.equal(db.getUser(jid).debtInterestApplied, now);
  });
});

test('applyDebtInterest confisca un item cuando la deuda supera el umbral', async () => {
  await withDb((db) => {
    const jid = 'moroso@s.whatsapp.net';
    const created = 1_000_000_000;
    db.updateUser(jid, {
      registered: true,
      debt: DEBT_SEIZURE_THRESHOLD,
      debtCreatedAt: created,
      debtInterestApplied: created,
      inventory: [{ itemId: 'palo_madera', quantity: 1 }]
    });

    const r = applyDebtInterest(db, jid, db.getUser(jid), created + DEBT_INTEREST_INTERVAL);
    assert.deepEqual(r.itemsSeized, ['palo_madera']);
    assert.equal(db.getUser(jid).inventory.length, 0);
  });
});

test('getActiveSlaves cuenta solo esclavos vigentes que siguen reconociendo al amo', async () => {
  await withDb((db) => {
    const now = Date.now();
    const master = 'amo@s.whatsapp.net';
    db.updateUser(master, { registered: true, slaves: ['s1@s.whatsapp.net', 's2@s.whatsapp.net', 's3@s.whatsapp.net'] });
    db.updateUser('s1@s.whatsapp.net', { slaveMaster: master, slaveUntil: now + 1000 });
    db.updateUser('s2@s.whatsapp.net', { slaveMaster: master, slaveUntil: now - 1000 });
    db.updateUser('s3@s.whatsapp.net', { slaveMaster: 'otro@s.whatsapp.net', slaveUntil: now + 1000 });

    assert.deepEqual(getActiveSlaves(db, master, now), ['s1@s.whatsapp.net']);
  });
});
