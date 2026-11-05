import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RateLimiter } from '../src/lib/rate-limit.js';

test('permite max intentos por ventana y luego bloquea con retryInMs', () => {
  const limiter = new RateLimiter(3, 1000);
  const t0 = 1_000_000;
  assert.deepEqual(limiter.try('a', t0), { ok: true, retryInMs: 0, remaining: 2 });
  assert.equal(limiter.try('a', t0 + 10).ok, true);
  assert.equal(limiter.try('a', t0 + 20).remaining, 0);
  const blocked = limiter.try('a', t0 + 30);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.retryInMs, 970);
  assert.equal(limiter.count('a', t0 + 30), 3);
});

test('las claves son independientes y la ventana se desliza', () => {
  const limiter = new RateLimiter(1, 1000);
  assert.equal(limiter.try('a', 0).ok, true);
  assert.equal(limiter.try('b', 0).ok, true);
  assert.equal(limiter.try('a', 999).ok, false);
  assert.equal(limiter.try('a', 1000).ok, true);
});

test('borra las claves sin marcas vigentes para no crecer sin límite', () => {
  const limiter = new RateLimiter(2, 100);
  limiter.try('x', 0);
  limiter.try('y', 0);
  assert.equal(limiter.size, 2);
  assert.equal(limiter.count('x', 500), 0);
  assert.equal(limiter.size, 1);
  limiter.try('y', 500);
  assert.equal(limiter.size, 1);
  limiter.reset('y');
  assert.equal(limiter.size, 0);
});

test('rechaza parámetros inválidos', () => {
  assert.throws(() => new RateLimiter(0, 1000));
  assert.throws(() => new RateLimiter(1, 0));
});
