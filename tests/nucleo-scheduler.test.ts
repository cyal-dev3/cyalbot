import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setLogLevel } from '../src/lib/logger.js';
import * as scheduler from '../src/lib/scheduler.js';

setLogLevel('error');

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

test('every repite y stop la detiene', async () => {
  let runs = 0;
  scheduler.every('t:every', 10, () => { runs++; });
  await sleep(60);
  assert.ok(runs >= 2, `esperaba al menos 2 ejecuciones, hubo ${runs}`);
  assert.ok(scheduler.has('t:every'));
  assert.equal(scheduler.stop('t:every'), true);
  const after = runs;
  await sleep(30);
  assert.equal(runs, after);
  assert.equal(scheduler.stop('t:every'), false);
});

test('after ejecuta una sola vez y desaparece de la lista', async () => {
  let runs = 0;
  scheduler.after('t:after', 5, () => { runs++; });
  assert.ok(scheduler.list().some((t) => t.name === 't:after' && t.kind === 'after'));
  await sleep(30);
  assert.equal(runs, 1);
  assert.equal(scheduler.has('t:after'), false);
});

test('los errores de la tarea se registran sin tumbar el proceso', async () => {
  scheduler.every('t:boom', 5, () => { throw new Error('boom'); });
  scheduler.every('t:boom-async', 5, async () => { throw new Error('boom async'); });
  await sleep(30);
  const boom = scheduler.list().find((t) => t.name === 't:boom');
  const boomAsync = scheduler.list().find((t) => t.name === 't:boom-async');
  assert.equal(boom?.lastError, 'boom');
  assert.equal(boomAsync?.lastError, 'boom async');
  assert.ok((boom?.runs ?? 0) >= 1);
});

test('registrar el mismo nombre reemplaza la tarea y stopAll limpia todo', async () => {
  let a = 0;
  let b = 0;
  scheduler.every('t:dup', 5, () => { a++; });
  scheduler.every('t:dup', 5, () => { b++; });
  await sleep(25);
  assert.equal(a, 0);
  assert.ok(b >= 1);
  const stopped = scheduler.stopAll();
  assert.ok(stopped >= 1);
  assert.deepEqual(scheduler.list(), []);
});
