import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { loadConfig } from '../src/config.js';
import { createApp, listen, type App } from '../src/server.js';

let app: App;
let base: string;
let tmp: string;

before(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'dl-test-'));
  // Carpeta huerfana que debe borrarse al arrancar.
  await mkdir(path.join(tmp, 'downloads', 'huerfana'), { recursive: true });
  const config = loadConfig({
    PORT: '0',
    HOST: '127.0.0.1',
    PUBLIC_URL: 'http://public.test',
    DOWNLOAD_DIR: path.join(tmp, 'downloads'),
    YTDLP_PATH: path.join(tmp, 'no-existe-yt-dlp'),
    DOWNLOADER_API_KEY: 'secreto',
    LOG_LEVEL: 'error',
  });
  app = await createApp(config);
  const port = await listen(app, 0, '127.0.0.1');
  base = `http://127.0.0.1:${port}`;
});

after(async () => {
  await app.close();
  await rm(tmp, { recursive: true, force: true });
});

describe('servidor HTTP', () => {
  it('GET /health responde el contrato sin exigir api key', async () => {
    const res = await fetch(`${base}/health`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.status, 'ok');
    assert.equal(typeof body.version, 'string');
    assert.equal(body.ytdlp, null);
    assert.equal(typeof body.uptimeSeconds, 'number');
  });

  it('borra carpetas huerfanas al arrancar', async () => {
    const { readdir } = await import('node:fs/promises');
    assert.deepEqual(await readdir(path.join(tmp, 'downloads')), []);
  });

  it('exige x-api-key en /v1/*', async () => {
    const res = await fetch(`${base}/v1/search?q=lofi`);
    assert.equal(res.status, 401);
    const body = (await res.json()) as { success: boolean; error: { code: string } };
    assert.equal(body.success, false);
    assert.equal(body.error.code, 'UNAUTHORIZED');
  });

  it('POST /v1/download valida la URL antes de llamar a yt-dlp', async () => {
    const res = await fetch(`${base}/v1/download`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'secreto' },
      body: JSON.stringify({ url: 'http://127.0.0.1/secret' }),
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { success: boolean; error: { code: string; message: string }; meta: { requestId: string; durationMs: number } };
    assert.equal(body.success, false);
    assert.equal(body.error.code, 'INVALID_URL');
    assert.equal(typeof body.meta.requestId, 'string');
    assert.equal(typeof body.meta.durationMs, 'number');
  });

  it('rechaza JSON invalido y bodies grandes', async () => {
    const bad = await fetch(`${base}/v1/info`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'secreto' },
      body: '{no json',
    });
    assert.equal(bad.status, 400);
    const big = await fetch(`${base}/v1/info`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'secreto' },
      body: JSON.stringify({ url: 'https://example.com/' + 'a'.repeat(70 * 1024) }),
    }).catch(() => null);
    // El servidor puede cortar la conexion al pasar el limite; si responde, debe ser 413.
    if (big) assert.equal(big.status, 413);
  });

  it('responde INTERNAL cuando el binario de yt-dlp no existe', async () => {
    const res = await fetch(`${base}/v1/search?q=lofi&limit=1`, { headers: { 'x-api-key': 'secreto' } });
    assert.equal(res.status, 500);
    const body = (await res.json()) as { error: { code: string; message: string } };
    assert.equal(body.error.code, 'INTERNAL');
    assert.match(body.error.message, /No se encontro el binario/);
  });

  it('GET /files rechaza tokens invalidos, desconocidos y path traversal', async () => {
    for (const p of ['/files/abc', '/files/' + 'f'.repeat(32), '/files/..%2F..%2Fetc%2Fpasswd', '/files/' + 'f'.repeat(32) + '/../x']) {
      const res = await fetch(`${base}${p}`);
      assert.equal(res.status, 404, p);
    }
  });

  it('GET /files sirve archivos registrados con Range y cabeceras', async () => {
    const token = 'c'.repeat(32);
    const dir = await app.context.store.createDir(token);
    await writeFile(path.join(dir, 'clip.mp4'), Buffer.from('0123456789'));
    const files = await app.context.store.collect(token, dir);
    app.context.store.register(token, dir, files);

    const full = await fetch(`${base}/files/${token}`);
    assert.equal(full.status, 200);
    assert.equal(full.headers.get('content-type'), 'video/mp4');
    assert.equal(full.headers.get('content-length'), '10');
    assert.match(full.headers.get('content-disposition') ?? '', /filename="clip.mp4"/);
    assert.equal(await full.text(), '0123456789');

    const part = await fetch(`${base}/files/${token}`, { headers: { range: 'bytes=2-5' } });
    assert.equal(part.status, 206);
    assert.equal(part.headers.get('content-range'), 'bytes 2-5/10');
    assert.equal(await part.text(), '2345');

    const tail = await fetch(`${base}/files/${token}`, { headers: { range: 'bytes=-3' } });
    assert.equal(tail.status, 206);
    assert.equal(await tail.text(), '789');

    const bad = await fetch(`${base}/files/${token}`, { headers: { range: 'bytes=50-60' } });
    assert.equal(bad.status, 416);

    const missingIndex = await fetch(`${base}/files/${token}/1`);
    assert.equal(missingIndex.status, 404);
  });

  it('la limpieza elimina entradas vencidas', async () => {
    const token = 'd'.repeat(32);
    const dir = await app.context.store.createDir(token);
    await writeFile(path.join(dir, 'a.mp3'), 'x');
    app.context.store.register(token, dir, await app.context.store.collect(token, dir), 'clave');
    assert.ok(app.context.store.fromCache('clave'));
    const removed = await app.context.store.cleanup(Date.now() + 31 * 60_000);
    assert.ok(removed >= 1);
    assert.equal(app.context.store.get(token), null);
    assert.equal(app.context.store.fromCache('clave'), null);
  });

  it('rutas desconocidas devuelven 404 y metodos incorrectos 400', async () => {
    assert.equal((await fetch(`${base}/nada`, { headers: { 'x-api-key': 'secreto' } })).status, 404);
    assert.equal((await fetch(`${base}/v1/download`, { headers: { 'x-api-key': 'secreto' } })).status, 400);
  });
});
