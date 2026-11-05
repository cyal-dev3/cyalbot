import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DownloadError } from '../src/errors.js';
import { Queue } from '../src/queue.js';

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('Queue', () => {
  it('no supera maxConcurrent y procesa en orden', async () => {
    const queue = new Queue(2, 10);
    const gates = [deferred(), deferred(), deferred(), deferred()];
    const started: number[] = [];
    const runs = gates.map((gate, i) =>
      queue.run(async () => {
        started.push(i);
        await gate.promise;
        return i;
      }),
    );
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(started, [0, 1]);
    assert.equal(queue.activeCount, 2);
    assert.equal(queue.waitingCount, 2);

    gates[0].resolve();
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(started, [0, 1, 2]);
    assert.equal(queue.activeCount, 2);

    gates[1].resolve();
    gates[2].resolve();
    gates[3].resolve();
    assert.deepEqual(await Promise.all(runs), [0, 1, 2, 3]);
    assert.equal(queue.activeCount, 0);
    assert.equal(queue.waitingCount, 0);
  });

  it('rechaza con RATE_LIMITED cuando la espera esta llena', async () => {
    const queue = new Queue(1, 1);
    const gate = deferred();
    const first = queue.run(() => gate.promise);
    const second = queue.run(() => gate.promise);
    await assert.rejects(
      queue.run(async () => 'tercera'),
      (err: unknown) => err instanceof DownloadError && err.code === 'RATE_LIMITED' && err.status === 429,
    );
    gate.resolve();
    await Promise.all([first, second]);
  });

  it('libera el hueco aunque la tarea falle', async () => {
    const queue = new Queue(1, 5);
    await assert.rejects(queue.run(async () => {
      throw new Error('fallo');
    }));
    assert.equal(queue.activeCount, 0);
    assert.equal(await queue.run(async () => 'ok'), 'ok');
  });

  it('valida parametros', () => {
    assert.throws(() => new Queue(0, 1));
    assert.throws(() => new Queue(1, -1));
  });
});
