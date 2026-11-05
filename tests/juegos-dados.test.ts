import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waysToRoll, exactMultiplier, parseChoice, dicePayout } from '../src/plugins/game-dados.js';
import { multiplierFor } from '../src/plugins/game-adivina.js';
import { pickWinner } from '../src/plugins/game-carrera.js';

test('waysToRoll suma 36 combinaciones', () => {
  let total = 0;
  for (let n = 2; n <= 12; n++) total += waysToRoll(n);
  assert.equal(total, 36);
  assert.equal(waysToRoll(7), 6);
  assert.equal(waysToRoll(2), 1);
  assert.equal(waysToRoll(13), 0);
});

test('parseChoice', () => {
  assert.equal(parseChoice('alto'), 'alto');
  assert.equal(parseChoice('MENOR'), 'bajo');
  assert.equal(parseChoice('7'), 7);
  assert.equal(parseChoice('1'), null);
  assert.equal(parseChoice('13'), null);
  assert.equal(parseChoice('x'), null);
});

test('alto/bajo pagan 1:1 con RTP 30/36', () => {
  let paid = 0;
  for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) paid += dicePayout(100, 'alto', a + b);
  assert.equal(paid / 3600, 15 / 36 * 2);
  paid = 0;
  for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) paid += dicePayout(100, 'bajo', a + b);
  assert.equal(paid / 3600, 15 / 36 * 2);
  assert.equal(dicePayout(100, 'alto', 7), 0);
  assert.equal(dicePayout(100, 'bajo', 7), 0);
});

test('número exacto: RTP ~0.92 para todos los números', () => {
  for (let n = 2; n <= 12; n++) {
    const ways = waysToRoll(n);
    const rtp = (ways / 36) * exactMultiplier(n);
    assert.ok(Math.abs(rtp - 0.92) < 0.01, `n=${n} RTP ${rtp.toFixed(4)}`);
    assert.equal(dicePayout(100, n, n), Math.floor(100 * exactMultiplier(n)));
    assert.equal(dicePayout(100, n, n === 12 ? 2 : 12), 0);
  }
  assert.ok(exactMultiplier(2) > exactMultiplier(7));
});

test('adivina: la búsqueda binaria perfecta no supera RTP 1', () => {
  // Distribución de intentos de una búsqueda binaria sobre 100 números: 1, 2, 4, 8, 16, 32, 37.
  const counts = [1, 2, 4, 8, 16, 32, 37];
  let rtp = 0;
  counts.forEach((count, i) => { rtp += (count / 100) * multiplierFor(i + 1); });
  assert.ok(rtp < 1, `RTP óptimo ${rtp.toFixed(3)}`);
  assert.ok(rtp > 0.85, 'pero sigue siendo atractivo');
});

test('carrera: pickWinner desempata entre los mejores', () => {
  assert.equal(pickWinner([3, 9, 4, 9], () => 0), 1);
  assert.equal(pickWinner([3, 9, 4, 9], () => 1), 3);
  assert.equal(pickWinner([1, 2, 3, 10], () => 0), 3);
});
