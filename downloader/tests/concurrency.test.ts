import assert from 'node:assert/strict';
import { chmod, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { loadConfig } from '../src/config.js';
import { createApp, listen, type App } from '../src/server.js';
import { activeProcessCount } from '../src/ytdlp.js';

// Un yt-dlp falso que tarda ~1,5 s y responde metadata vacia: sirve para medir la concurrencia
// sin red. Con "--version" responde al instante para que /health y la sonda de capacidades funcionen.
const FAKE = `#!/bin/sh
for a in "$@"; do
  if [ "$a" = "--version" ]; then echo 2026.01.01; exit 0; fi
done
sleep 1.5
echo '{"id":"x","title":"fake","entries":[]}'
`;

const isUnix = process.platform !== 'win32';
let app: App;
let base: string;
let tmp: string;

before(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'dl-conc-'));
  const fake = path.join(tmp, 'yt-dlp');
  await writeFile(fake, FAKE);
  await chmod(fake, 0o755);
  app = await createApp(
    loadConfig({
      PORT: '0',
      HOST: '127.0.0.1',
      DOWNLOAD_DIR: path.join(tmp, 'downloads'),
      YTDLP_PATH: fake,
      LOG_LEVEL: 'error',
      MAX_CONCURRENT: '1',
      META_CONCURRENT: '1',
      QUEUE_MAX: '1',
    }),
  );
  base = `http://127.0.0.1:${await listen(app, 0, '127.0.0.1')}`;
});

after(async () => {
  await app.close();
  await rm(tmp, { recursive: true, force: true });
});

async function settle(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

describe('limites de concurrencia y cancelacion', { skip: !isUnix && 'solo en unix' }, () => {
  it('/v1/search y /v1/info pasan por la cola de metadata (META_CONCURRENT) y devuelven 429 si se llena', { timeout: 20_000 }, async () => {
    const requests = [
      fetch(`${base}/v1/search?q=a`),
      fetch(`${base}/v1/search?q=b`),
      fetch(`${base}/v1/info`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: 'https://example.com/v' }) }),
    ];
    await settle(400);
    // Solo un yt-dlp vivo aunque haya tres peticiones de metadata en vuelo.
    assert.equal(activeProcessCount(), 1);
    assert.equal(app.context.metaQueue.activeCount, 1);
    const statuses = (await Promise.all(requests)).map((r) => r.status).sort();
    // Dos se atienden (una tras otra) y la tercera encuentra la espera llena.
    assert.deepEqual(statuses, [200, 200, 429]);
  });

  it('/v1/download libera la cola y mata yt-dlp si el cliente se desconecta', { timeout: 20_000 }, async () => {
    const aborter = new AbortController();
    const pending = fetch(`${base}/v1/download`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/video' }),
      signal: aborter.signal,
    }).catch((err: Error) => err);
    await settle(600);
    assert.equal(app.context.queue.activeCount, 1);
    assert.equal(activeProcessCount(), 1);
    aborter.abort();
    assert.ok((await pending) instanceof Error);
    await settle(500);
    assert.equal(activeProcessCount(), 0, 'el proceso deberia haberse matado');
    assert.equal(app.context.queue.activeCount, 0);
    // La carpeta de la descarga cancelada se descarta.
    assert.deepEqual(await readdir(path.join(tmp, 'downloads')), []);
  });

  it('una peticion que espera en cola y se cancela no llega a ejecutarse', { timeout: 20_000 }, async () => {
    const first = fetch(`${base}/v1/search?q=first`);
    await settle(300);
    const aborter = new AbortController();
    const second = fetch(`${base}/v1/search?q=second`, { signal: aborter.signal }).catch((err: Error) => err);
    await settle(200);
    assert.equal(app.context.metaQueue.waitingCount, 1);
    aborter.abort();
    assert.ok((await second) instanceof Error);
    await settle(100);
    assert.equal(app.context.metaQueue.waitingCount, 0);
    assert.equal((await first).status, 200);
    await settle(200);
    // Solo se ejecuto el primero: ningun proceso para el segundo.
    assert.equal(activeProcessCount(), 0);
  });

  it('/health informa de ambas colas y de los procesos vivos', async () => {
    const body = (await (await fetch(`${base}/health`)).json()) as Record<string, unknown>;
    assert.deepEqual(body.queue, { active: 0, waiting: 0 });
    assert.deepEqual(body.metaQueue, { active: 0, waiting: 0 });
    assert.equal(body.processes, 0);
  });
});
