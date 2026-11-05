import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { DownloadError } from '../src/errors.js';
import { Deadline, activeProcessCount, killAllProcesses, runProcess } from '../src/ytdlp.js';

const isUnix = process.platform !== 'win32';

let tmp: string;
let script: string;

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(check: () => boolean, ms = 3000): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (check()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return check();
}

before(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'dl-proc-'));
  // Imita a yt-dlp lanzando un hijo (como hace con ffmpeg) y esperandolo; escribe el PID del hijo.
  script = path.join(tmp, 'fake-ytdlp.sh');
  await writeFile(script, '#!/bin/sh\nsleep 30 &\necho $! > "$1"\nwait\n');
  await chmod(script, 0o755);
});

after(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe('runProcess', { skip: !isUnix && 'solo en unix' }, () => {
  it('al vencer el timeout mata tambien a los hijos del proceso (grupo)', async () => {
    const marker = path.join(tmp, 'child1.pid');
    await assert.rejects(runProcess(script, [marker], 500, 'fake'), (e: unknown) => e instanceof DownloadError && e.code === 'TIMEOUT');
    const childPid = Number((await readFile(marker, 'utf8')).trim());
    assert.ok(childPid > 0);
    assert.equal(await waitFor(() => !alive(childPid)), true, 'el hijo (sleep) deberia haber muerto con el grupo');
    assert.equal(activeProcessCount(), 0);
  });

  it('al abortar la senal del cliente mata el grupo y rechaza con CLIENT_CLOSED', async () => {
    const marker = path.join(tmp, 'child2.pid');
    const aborter = new AbortController();
    const run = runProcess(script, [marker], 30_000, 'fake', aborter.signal);
    await waitFor(() => activeProcessCount() === 1);
    setTimeout(() => aborter.abort(), 200);
    await assert.rejects(run, (e: unknown) => e instanceof DownloadError && e.code === 'CLIENT_CLOSED');
    const childPid = Number((await readFile(marker, 'utf8')).trim());
    assert.equal(await waitFor(() => !alive(childPid)), true);
    assert.equal(activeProcessCount(), 0);
  });

  it('killAllProcesses termina todo lo vivo (apagado del servicio)', async () => {
    const marker = path.join(tmp, 'child3.pid');
    const run = runProcess(script, [marker], 30_000, 'fake');
    await waitFor(() => activeProcessCount() === 1);
    await waitFor(() => false, 150);
    const killed = await killAllProcesses(200);
    assert.equal(killed, 1);
    const result = await run;
    assert.notEqual(result.code, 0);
    const childPid = Number((await readFile(marker, 'utf8')).trim());
    assert.equal(await waitFor(() => !alive(childPid)), true);
    assert.equal(activeProcessCount(), 0);
  });

  it('un binario inexistente responde INTERNAL y una senal ya abortada no lanza nada', async () => {
    await assert.rejects(runProcess(path.join(tmp, 'no-existe'), [], 1000), (e: unknown) => e instanceof DownloadError && e.code === 'INTERNAL');
    const aborter = new AbortController();
    aborter.abort();
    await assert.rejects(runProcess(script, [path.join(tmp, 'x.pid')], 1000, 'fake', aborter.signal), (e: unknown) => e instanceof DownloadError && e.code === 'CLIENT_CLOSED');
    assert.equal(activeProcessCount(), 0);
  });

  it('Deadline.assertAlive lanza CLIENT_CLOSED si la senal esta abortada', () => {
    const aborter = new AbortController();
    const deadline = new Deadline(60_000, aborter.signal);
    deadline.assertAlive();
    aborter.abort();
    assert.throws(() => deadline.assertAlive(), (e: unknown) => e instanceof DownloadError && e.code === 'CLIENT_CLOSED');
    assert.throws(() => new Deadline(0).assertAlive(), (e: unknown) => e instanceof DownloadError && e.code === 'TIMEOUT');
  });
});
