import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setLogLevel } from '../src/lib/logger.js';
import { Database } from '../src/lib/database.js';
import {
  parseBet, debitBet, creditWin, creditPrize, dailyPrizeLeft, holdBet, heldAmount, releaseEscrow, refundPlayer, refundAllEscrow, houseEdge,
} from '../src/lib/games/bets.js';
import { getCasino, CASINO_LIMITS } from '../src/lib/games/state.js';

setLogLevel('error');

async function withDb(fn: (db: Database) => Promise<void> | void): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'cyalbot-bets-'));
  const db = new Database(join(dir, 'database.json'));
  try {
    await db.init();
    await fn(db);
  } finally {
    await db.stop();
    await rm(dir, { recursive: true, force: true });
  }
}

const A = '111@s.whatsapp.net';
const B = '222@s.whatsapp.net';
const G = 'grupo@g.us';

test('parseBet acepta enteros, sufijos y palabras', () => {
  assert.deepEqual(parseBet('500', { balance: 10_000 }), { ok: true, amount: 500 });
  assert.deepEqual(parseBet('2k', { balance: 10_000 }), { ok: true, amount: 2_000 });
  assert.deepEqual(parseBet('todo', { balance: 3_000 }), { ok: true, amount: 3_000 });
  assert.deepEqual(parseBet('mitad', { balance: 3_000 }), { ok: true, amount: 1_500 });
  // "mitad" y los porcentajes van sobre el saldo, no sobre el máximo de la mesa.
  assert.deepEqual(parseBet('mitad', { balance: 40_000 }), { ok: true, amount: 20_000 });
  assert.deepEqual(parseBet('10%', { balance: 40_000 }), { ok: true, amount: 4_000 });
  // "todo" y "mitad" se acotan al máximo de la mesa en vez de rechazarse.
  assert.deepEqual(parseBet('all', { balance: 1_000_000 }), { ok: true, amount: CASINO_LIMITS.maxBet });
  assert.deepEqual(parseBet('mitad', { balance: 1_000_000 }), { ok: true, amount: CASINO_LIMITS.maxBet });
});

test('parseBet solo acepta enteros: los decimales se rechazan, no se truncan', () => {
  for (const text of ['100.5', '1.9k', '500.0', '2.5m']) {
    const r = parseBet(text, { balance: 10_000_000 });
    assert.equal(r.ok, false, `"${text}" debería fallar`);
    if (!r.ok) assert.match(r.reason, /enteros/);
  }
  // Un literal fuera de rango se rechaza (no se acota): solo las palabras relativas se acotan.
  assert.equal(parseBet('30000', { balance: 100_000 }).ok, false);
});

test('parseBet rechaza con razón legible', () => {
  const cases: [string | undefined, Partial<{ balance: number; fallback: number }>][] = [
    ['abc', { balance: 10_000 }],
    ['10', { balance: 10_000 }],
    ['99999999', { balance: 99_999_999 }],
    ['5000', { balance: 100 }],
    [undefined, { balance: 10_000 }],
    ['-50', { balance: 10_000 }],
    ['1.5', { balance: 10_000 }],
  ];
  for (const [text, opts] of cases) {
    const r = parseBet(text, { balance: 10_000, ...opts });
    assert.equal(r.ok, false, `"${text}" debería fallar`);
    if (!r.ok) assert.ok(r.reason.length > 10);
  }
  assert.deepEqual(parseBet('', { balance: 10_000, fallback: 100 }), { ok: true, amount: 100 });
});

test('debitBet y creditWin tocan el saldo y acumulan stats', async () => {
  await withDb((db) => {
    db.updateUser(A, { money: 1_000 });
    assert.equal(debitBet(db, A, 400, 'slot'), true);
    assert.equal(db.getUser(A).money, 600);
    assert.equal(debitBet(db, A, 5_000, 'slot'), false);
    assert.equal(db.getUser(A).money, 600);
    creditWin(db, A, 900, 'slot');
    assert.equal(db.getUser(A).money, 1_500);
    const stats = getCasino(db).stats.slot;
    assert.deepEqual(stats, { wagered: 400, paid: 900, rounds: 1 });
    assert.equal(houseEdge(db)[0].game, 'slot');
    assert.ok(houseEdge(db)[0].edge < 0);
  });
});

test('escrow: hold, pago a ganadores y reembolso', async () => {
  await withDb((db) => {
    db.updateUser(A, { money: 1_000 });
    db.updateUser(B, { money: 1_000 });
    assert.equal(holdBet(db, G, A, 300, 'bj'), true);
    assert.equal(holdBet(db, G, B, 200, 'bj'), true);
    assert.equal(holdBet(db, G, B, 100, 'bj', { round: false }), true);
    assert.equal(db.getUser(A).money, 700);
    assert.equal(db.getUser(B).money, 700);
    assert.equal(heldAmount(db, G, B, 'bj'), 300);
    assert.equal(getCasino(db).stats.bj.rounds, 2);

    const released = releaseEscrow(db, G, 'bj', { pay: new Map([[A, 600]]) });
    assert.equal(released, 3);
    assert.equal(db.getUser(A).money, 1_300);
    assert.equal(db.getUser(B).money, 700);
    assert.equal(getCasino(db).escrow.length, 0);
    assert.deepEqual(getCasino(db).stats.bj, { wagered: 600, paid: 600, rounds: 2 });

    holdBet(db, G, A, 500, 'ruleta');
    holdBet(db, 'otro@g.us', B, 500, 'ruleta');
    releaseEscrow(db, G, 'ruleta', { refund: true });
    assert.equal(db.getUser(A).money, 1_300);
    assert.equal(getCasino(db).escrow.length, 1, 'la custodia de otro grupo no se toca');
    assert.equal(getCasino(db).stats.ruleta.wagered, 500);
  });
});

test('refundPlayer devuelve solo lo del jugador y refundAllEscrow limpia todo', async () => {
  await withDb((db) => {
    db.updateUser(A, { money: 1_000 });
    db.updateUser(B, { money: 1_000 });
    holdBet(db, G, A, 300, 'bj');
    holdBet(db, G, B, 200, 'bj');
    assert.equal(refundPlayer(db, G, A, 'bj'), 300);
    assert.equal(db.getUser(A).money, 1_000);
    assert.equal(db.getUser(B).money, 800);
    assert.equal(getCasino(db).escrow.length, 1);

    holdBet(db, 'x@g.us', A, 100, 'dados');
    assert.equal(refundAllEscrow(db), 2);
    assert.equal(db.getUser(A).money, 1_000);
    assert.equal(db.getUser(B).money, 1_000);
    assert.equal(getCasino(db).escrow.length, 0);
    assert.equal(refundAllEscrow(db), 0);
  });
});

test('getCasino repara un estado corrupto en settings', async () => {
  await withDb((db) => {
    db.updateSettings({ casino: { escrow: 'x', stats: null, jackpot: 'no' } } as never);
    const casino = getCasino(db);
    assert.deepEqual(casino.escrow, []);
    assert.deepEqual(casino.stats, {});
    assert.equal(casino.jackpot, 0);
    assert.deepEqual(casino.prizes, {});
  });
});

test('creditPrize respeta el tope diario por jugador', async () => {
  await withDb((db) => {
    db.updateUser(A, { money: 0 });
    const cap = CASINO_LIMITS.dailyPrizeCap;
    assert.equal(dailyPrizeLeft(db, A), cap);
    assert.equal(creditPrize(db, A, 300, 'trivia'), 300);
    assert.equal(creditPrize(db, A, cap, 'ahorcado'), cap - 300, 'se acota a lo que queda del día');
    assert.equal(creditPrize(db, A, 100, 'memoria'), 0, 'tope alcanzado');
    assert.equal(db.getUser(A).money, cap);
    assert.equal(dailyPrizeLeft(db, A), 0);
    // Otro jugador tiene su propio tope.
    assert.equal(creditPrize(db, B, 200, 'trivia'), 200);
    // Una entrada de otro día se purga y el tope se reinicia.
    getCasino(db).prizes[A].day = 'ayer';
    assert.equal(dailyPrizeLeft(db, A), cap);
    assert.equal(creditPrize(db, A, 50, 'trivia'), 50);
    assert.equal(getCasino(db).stats.trivia.paid, 550);
  });
});
