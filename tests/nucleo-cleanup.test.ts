import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { setLogLevel } = await import('../src/lib/logger.js');
setLogLevel('error');
const { sweepDirectory } = await import('../src/lib/cleanup-scheduler.js');

const HOUR = 60 * 60 * 1000;

async function age(path: string, ms: number): Promise<void> {
  const t = new Date(Date.now() - ms);
  await utimes(path, t, t);
}

test('el barrido de temporales borra archivos y carpetas frames_* viejos y respeta los recientes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nucleo-cleanup-'));
  try {
    await writeFile(join(dir, 'viejo.mp4'), Buffer.alloc(2048));
    await age(join(dir, 'viejo.mp4'), 2 * HOUR);
    await writeFile(join(dir, 'reciente.webp'), Buffer.alloc(10));
    await mkdir(join(dir, 'frames_abc'));
    await writeFile(join(dir, 'frames_abc', '0.webp'), Buffer.alloc(100));
    await writeFile(join(dir, 'frames_abc', '1.webp'), Buffer.alloc(100));
    await age(join(dir, 'frames_abc'), 2 * HOUR);
    await mkdir(join(dir, 'frames_nuevo'));
    await writeFile(join(dir, 'frames_nuevo', '0.webp'), Buffer.alloc(5));

    const result = await sweepDirectory(dir, HOUR, { directories: true });
    assert.equal(result.files, 2);
    assert.equal(result.bytes, 2048 + 200);
    assert.deepEqual((await readdir(dir)).sort(), ['frames_nuevo', 'reciente.webp']);

    // Sin `directories` las carpetas no se tocan aunque sean viejas.
    await age(join(dir, 'frames_nuevo'), 2 * HOUR);
    const onlyFiles = await sweepDirectory(dir, HOUR);
    assert.equal(onlyFiles.files, 0);
    assert.deepEqual((await readdir(dir)).sort(), ['frames_nuevo', 'reciente.webp']);

    const missing = await sweepDirectory(join(dir, 'no-existe'), HOUR);
    assert.deepEqual(missing, { files: 0, bytes: 0 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
