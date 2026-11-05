import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SLOT_SYMBOLS, spinReel, evaluate, simulateRtp } from '../src/plugins/game-slot.js';

const TOTAL = SLOT_SYMBOLS.reduce((s, x) => s + x.weight, 0);

/** xorshift32 determinista para que el test no dependa de la suerte. */
function seeded(seed: number): () => number {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    return x % TOTAL;
  };
}

test('spinReel respeta los pesos', () => {
  assert.equal(spinReel(() => 0), 0);
  assert.equal(spinReel(() => SLOT_SYMBOLS[0].weight - 1), 0);
  assert.equal(spinReel(() => SLOT_SYMBOLS[0].weight), 1);
  assert.equal(spinReel(() => TOTAL - 1), SLOT_SYMBOLS.length - 1);
});

test('evaluate: triple paga mult, par paga mitad, nada paga 0', () => {
  assert.deepEqual(evaluate(100, [7, 7, 7]).payout, 100 * SLOT_SYMBOLS[7].mult);
  assert.equal(evaluate(100, [0, 0, 0]).kind, 'triple');
  assert.equal(evaluate(100, [2, 2, 5]).payout, Math.floor((100 * SLOT_SYMBOLS[2].mult) / 2));
  assert.equal(evaluate(100, [5, 2, 2]).symbol?.emoji, SLOT_SYMBOLS[2].emoji);
  assert.equal(evaluate(100, [2, 5, 2]).kind, 'par');
  assert.deepEqual(evaluate(100, [0, 1, 2]), { kind: 'nada', payout: 0, symbol: null });
});

test('RTP teórico en 0.85-0.92', () => {
  let rtp = 0;
  for (const s of SLOT_SYMBOLS) {
    const p = s.weight / TOTAL;
    rtp += p ** 3 * s.mult + 3 * p * p * (1 - p) * (s.mult / 2);
  }
  assert.ok(rtp >= 0.85 && rtp <= 0.92, `RTP teórico ${rtp.toFixed(4)}`);
});

test('RTP simulado con 1e6 giros entre 0.80 y 0.95', () => {
  const rtp = simulateRtp(1_000_000, 100, seeded(123456789));
  assert.ok(rtp >= 0.8 && rtp <= 0.95, `RTP simulado ${rtp.toFixed(4)}`);
});
