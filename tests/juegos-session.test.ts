import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setLogLevel } from '../src/lib/logger.js';
import { initDatabase, type Database } from '../src/lib/database.js';
import { GameSessionManager, listActiveTables, closeAllTables, activeGameOf } from '../src/lib/games/session.js';
import { holdBet } from '../src/lib/games/bets.js';
import { getCasino } from '../src/lib/games/state.js';

setLogLevel('error');

const G = 'grupo@g.us';
const A = '111@s.whatsapp.net';
const B = '222@s.whatsapp.net';

let db: Database;
let dir: string;

test.before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cyalbot-session-'));
  db = await initDatabase(join(dir, 'database.json'));
});

test.after(async () => {
  await db.stop();
  await rm(dir, { recursive: true, force: true });
});

test('create/get/join/leave y turnos', () => {
  const mgr = new GameSessionManager<{ n: number }, { x: number }, 'a' | 'b'>({ game: 't1', label: 'Test 1' });
  const s = mgr.create(G, { phase: 'a', state: { x: 1 } });
  assert.ok(s);
  assert.equal(mgr.create(G, { phase: 'a', state: { x: 2 } }), null, 'no se duplica la mesa');
  assert.equal(mgr.join(G, A, { n: 1 }), true);
  assert.equal(mgr.join(G, A, { n: 1 }), false);
  assert.equal(mgr.join(G, B, { n: 2 }), true);
  assert.equal(mgr.isPlayerIn(G, B), true);
  assert.equal(mgr.current(G), A);
  assert.equal(mgr.advance(G), B);
  assert.equal(mgr.advance(G), null, 'al dar la vuelta devuelve null');
  assert.equal(mgr.current(G), A);
  mgr.setPhase(G, 'b');
  assert.equal(mgr.get(G)?.phase, 'b');
  assert.equal(mgr.leave(G, A), true);
  assert.equal(mgr.current(G), B);
  assert.equal(mgr.findByPlayer(B)?.groupId, G);
  assert.equal(mgr.close(G), true);
  assert.equal(mgr.close(G), false);
});

test('límite de mesas', () => {
  const mgr = new GameSessionManager<never, null>({ game: 't2', label: 'Test 2', maxTables: 2 });
  assert.ok(mgr.create('g1@g.us', { phase: 'x', state: null }));
  assert.ok(mgr.create('g2@g.us', { phase: 'x', state: null }));
  assert.equal(mgr.create('g3@g.us', { phase: 'x', state: null }), null);
  assert.equal(mgr.size(), 2);
  mgr.close('g1@g.us');
  mgr.close('g2@g.us');
});

/** Los callbacks de setTimer corren en una microtarea: hay que drenarla tras tick(). */
const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

test('setTimer ejecuta, remainingSeconds cuenta y un error cierra con reembolso', async (t) => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  t.after(() => mock.timers.reset());

  const mgr = new GameSessionManager<never, null>({ game: 't3', label: 'Test 3' });
  mgr.create(G, { phase: 'x', state: null });
  db.updateUser(A, { money: 1_000 });
  assert.equal(holdBet(db, G, A, 400, 't3'), true);
  assert.equal(db.getUser(A).money, 600);

  let fired = 0;
  mgr.setTimer(G, 10_000, () => { fired++; });
  assert.equal(mgr.remainingSeconds(G), 10);
  mock.timers.tick(4_000);
  assert.equal(mgr.remainingSeconds(G), 6);
  mock.timers.tick(6_000);
  await flush();
  assert.equal(fired, 1);
  assert.equal(mgr.remainingSeconds(G), 0);

  // El reemplazo cancela el temporizador anterior.
  mgr.setTimer(G, 5_000, () => { fired += 10; });
  mgr.setTimer(G, 5_000, () => { fired += 100; });
  mock.timers.tick(5_000);
  await flush();
  assert.equal(fired, 101);

  mgr.setTimer(G, 1_000, () => { throw new Error('boom'); });
  mock.timers.tick(1_000);
  await flush();
  assert.equal(mgr.has(G), false, 'la mesa se cerró');
  assert.equal(db.getUser(A).money, 1_000, 'la custodia se reembolsó');
  assert.equal(getCasino(db).escrow.length, 0);
});

test('mesas inactivas se barren con reembolso', (t) => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  t.after(() => mock.timers.reset());

  const mgr = new GameSessionManager<never, null>({ game: 't4', label: 'Test 4', idleMs: 60_000 });
  mgr.create(G, { phase: 'x', state: null });
  db.updateUser(B, { money: 500 });
  holdBet(db, G, B, 200, 't4');
  mock.timers.tick(61_000);
  assert.equal(mgr.sweepIdle(), 1);
  assert.equal(mgr.has(G), false);
  assert.equal(db.getUser(B).money, 500);
});

test('get/has cierran con reembolso una mesa vencida aunque nadie cree otra', (t) => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  t.after(() => mock.timers.reset());

  const mgr = new GameSessionManager<never, null>({ game: 't5', label: 'Test 5', idleMs: 60_000 });
  const s = mgr.create(G, { phase: 'x', state: null });
  assert.ok(s);
  db.updateUser(A, { money: 500 });
  holdBet(db, G, A, 200, 't5');
  mock.timers.tick(30_000);
  assert.equal(mgr.has(G), true, 'aún no vence');
  assert.equal(mgr.isCurrent(s), true);
  mock.timers.tick(31_000);
  assert.equal(mgr.has(G), false, 'vencida: se cierra al consultarla');
  assert.equal(mgr.get(G), undefined);
  assert.equal(mgr.isCurrent(s), false);
  assert.equal(db.getUser(A).money, 500, 'la custodia se devolvió');
});

test('isCurrent distingue una mesa cerrada de otra nueva en el mismo grupo', () => {
  const mgr = new GameSessionManager<never, null>({ game: 't6', label: 'Test 6' });
  const first = mgr.create(G, { phase: 'x', state: null });
  assert.ok(first);
  mgr.close(G);
  const second = mgr.create(G, { phase: 'x', state: null });
  assert.ok(second);
  assert.notEqual(first.id, second.id);
  assert.equal(mgr.isCurrent(first), false);
  assert.equal(mgr.isCurrent(second), true);
  mgr.close(G);
});

test('registro global: listActiveTables, closeAllTables y activeGameOf', () => {
  const H = 'otro@g.us';
  const m1 = new GameSessionManager<never, null>({ game: 'trivia-test', label: 'Trivia T' });
  const m2 = new GameSessionManager<{ n: number }, null>({ game: 'bj-test', label: 'BJ T' });
  m1.create(H, { phase: 'pregunta', state: null });
  m2.create(H, { phase: 'turnos', state: null });
  m2.join(H, A, { n: 1 });
  const tables = listActiveTables(H);
  assert.deepEqual(tables.map((t) => t.label).sort(), ['BJ T', 'Trivia T']);
  assert.deepEqual(tables.find((t) => t.game === 'bj-test')?.players, [A]);
  assert.equal(activeGameOf(H, ['trivia-test']), 'Trivia T');
  assert.equal(activeGameOf(H, ['nada']), null);
  assert.deepEqual(closeAllTables(H).sort(), ['BJ T', 'Trivia T']);
  assert.equal(listActiveTables(H).length, 0);
});
