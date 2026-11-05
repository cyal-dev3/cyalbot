import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

// La URL del servicio se lee de CONFIG al importar: hay que fijarla antes del import dinámico.
let server: Server;
let baseUrl = '';
const requests: { method: string; url: string; headers: IncomingMessage['headers']; body: string }[] = [];

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c: Buffer) => { data += c.toString(); });
    req.on('end', () => resolve(data));
  });
}

function json(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(payload));
}

const SUCCESS_MEDIAS = {
  success: true,
  data: {
    url: 'http://files.test/files/abc',
    type: 'image',
    filename: 'post_1.jpg',
    size: 1200,
    duration: null,
    thumbnail: null,
    title: 'Carrusel',
    author: 'alguien',
    medias: [
      { url: 'http://files.test/files/abc', type: 'image', filename: 'post_1.jpg', size: 1200 },
      { url: 'http://files.test/files/abc/1', type: 'image', filename: 'post_2.jpg', size: 1300 },
      { url: 'http://files.test/files/abc/2', type: 'image', filename: 'post_3.jpg', size: 1400 },
    ],
  },
  meta: { engine: 'yt-dlp', requestId: 'x', durationMs: 10, cached: false },
};

before(async () => {
  server = createServer(async (req, res) => {
    const body = await readBody(req);
    requests.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body });
    const parsed = body ? (JSON.parse(body) as { url?: string }) : {};
    if (req.url === '/v1/download') {
      if (parsed.url?.includes('private')) {
        json(res, 422, { success: false, error: { code: 'LOGIN_REQUIRED', message: 'This post is private' } });
      } else if (parsed.url?.includes('nokey')) {
        json(res, 401, { success: false, error: { code: 'UNAUTHORIZED', message: 'Cabecera x-api-key invalida o ausente' } });
      } else if (parsed.url?.includes('gateway')) {
        res.writeHead(502, { 'content-type': 'text/html' });
        res.end('<html><body>502 Bad Gateway</body></html>');
      } else if (parsed.url?.includes('big')) {
        json(res, 413, { success: false, error: { code: 'TOO_LARGE', message: 'El archivo pesa 95 MB y el maximo es 60 MB' } });
      } else if (parsed.url?.includes('audio')) {
        json(res, 200, { success: true, data: { url: 'http://files.test/files/a', type: 'audio', filename: 'song.mp3', size: 5000, duration: 213, thumbnail: 't', title: 'Song', author: 'Band', medias: [{ url: 'http://files.test/files/a', type: 'audio', filename: 'song.mp3', size: 5000 }] } });
      } else {
        json(res, 200, SUCCESS_MEDIAS);
      }
      return;
    }
    if (req.url === '/v1/info') {
      json(res, 200, { success: true, data: { title: 'Video', author: 'Autor', duration: 90, thumbnail: null, platform: 'youtube', isPlaylist: false, entries: 1 } });
      return;
    }
    if (req.url?.startsWith('/v1/search')) {
      json(res, 200, { success: true, data: { results: [{ id: 'id1', title: 'Resultado', url: 'https://www.youtube.com/watch?v=id1', duration: 120, author: 'Canal', thumbnail: null }] } });
      return;
    }
    if (req.url === '/health') {
      json(res, 200, { status: 'ok', version: '1.0.0', ytdlp: '2026.10.26', uptimeSeconds: 42, queue: { active: 1, waiting: 2 } });
      return;
    }
    json(res, 404, { success: false, error: { code: 'NOT_FOUND', message: 'Ruta no encontrada' } });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.DOWNLOADER_API_URL = baseUrl;
  process.env.DOWNLOADER_API_KEY = 'secreto';
});

after(() => new Promise<void>((resolve) => server.close(() => resolve())));

test('downloadMedia mapea una respuesta con tres imágenes y envía la api key', async () => {
  const client = await import('../src/lib/downloader-client.js');
  assert.equal(client.isDownloaderConfigured(), true);
  requests.length = 0;
  const result = await client.downloadMedia('https://www.instagram.com/p/abc/', { quality: 'low' });
  assert.ok(result.success);
  assert.equal(result.data.type, 'image');
  assert.equal(result.data.medias.length, 3);
  assert.deepEqual(result.data.medias.map((m) => m.size), [1200, 1300, 1400]);
  assert.equal(result.data.title, 'Carrusel');
  assert.equal(result.data.author, 'alguien');
  assert.equal(result.data.duration, null);

  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, 'POST');
  assert.equal(requests[0].headers['x-api-key'], 'secreto');
  assert.deepEqual(JSON.parse(requests[0].body), { url: 'https://www.instagram.com/p/abc/', quality: 'low', audioOnly: false });
});

test('downloadMedia conserva type audio, duración y tamaño', async () => {
  const client = await import('../src/lib/downloader-client.js');
  const result = await client.downloadMedia('https://youtu.be/audio', { audioOnly: true });
  assert.ok(result.success);
  assert.equal(result.data.type, 'audio');
  assert.equal(result.data.duration, 213);
  assert.equal(result.data.size, 5000);
  assert.equal(result.data.medias[0].filename, 'song.mp3');
  const last = requests[requests.length - 1];
  assert.deepEqual(JSON.parse(last.body), { url: 'https://youtu.be/audio', quality: 'medium', audioOnly: true });
});

test('422 LOGIN_REQUIRED se propaga con código y texto humano', async () => {
  const client = await import('../src/lib/downloader-client.js');
  const result = await client.downloadMedia('https://www.instagram.com/p/private/');
  assert.equal(result.success, false);
  if (result.success) return;
  assert.equal(result.code, 'LOGIN_REQUIRED');
  assert.equal(result.status, 422);
  assert.match(client.describeFailure(result), /privado o requiere inicio de sesión/);
});

test('401 UNAUTHORIZED y 413 TOO_LARGE', async () => {
  const client = await import('../src/lib/downloader-client.js');
  const unauthorized = await client.downloadMedia('https://x.com/nokey/status/1');
  assert.equal(unauthorized.success, false);
  if (!unauthorized.success) {
    assert.equal(unauthorized.code, 'UNAUTHORIZED');
    assert.match(client.describeFailure(unauthorized), /DOWNLOADER_API_KEY/);
  }
  const big = await client.downloadMedia('https://x.com/big/status/1');
  assert.equal(big.success, false);
  if (!big.success) {
    assert.equal(big.code, 'TOO_LARGE');
    assert.equal(client.describeFailure(big), 'El archivo pesa 95 MB, el máximo es 60 MB.');
  }
  assert.equal(client.describeDownloadError('TOO_LARGE', { sizeBytes: 70 * 1024 * 1024 }), 'El archivo pesa 70 MB, el máximo es 60 MB.');
});

test('502 con HTML no rompe: INTERNAL con el status', async () => {
  const client = await import('../src/lib/downloader-client.js');
  const result = await client.downloadMedia('https://x.com/gateway/status/1');
  assert.equal(result.success, false);
  if (result.success) return;
  assert.equal(result.code, 'INTERNAL');
  assert.equal(result.status, 502);
  assert.match(result.message, /HTTP 502/);
});

test('getInfo, search y health mapean sus respuestas', async () => {
  const client = await import('../src/lib/downloader-client.js');
  const info = await client.getInfo('https://youtu.be/x');
  assert.ok(info.success);
  assert.equal(info.data.duration, 90);
  assert.equal(info.data.platform, 'youtube');

  requests.length = 0;
  const found = await client.search('lofi girl', { limit: 3 });
  assert.ok(found.success);
  assert.equal(found.data[0].title, 'Resultado');
  assert.equal(found.data[0].duration, 120);
  assert.match(requests[0].url, /\/v1\/search\?q=lofi\+girl&limit=3$/);
  assert.equal(requests[0].headers['x-api-key'], 'secreto');

  const sc = await client.search('algo', { source: 'soundcloud' });
  assert.equal(sc.success, false);
  if (!sc.success) assert.equal(sc.code, 'UNSUPPORTED');

  const h = await client.health();
  assert.ok(h.success);
  assert.equal(h.data.ytdlp, '2026.10.26');
  assert.deepEqual(h.data.queue, { active: 1, waiting: 2 });
});

test('downloadAuto traduce el fallo a texto y detecta la plataforma', async () => {
  const { downloadAuto } = await import('../src/lib/downloaders.js');
  const ok = await downloadAuto('https://www.instagram.com/p/abc/');
  assert.equal(ok.platform, 'instagram');
  assert.ok(ok.success);
  assert.equal(ok.medias?.length, 3);
  assert.equal(ok.medias?.[2].size, 1400);

  const fail = await downloadAuto('https://www.instagram.com/p/private/');
  assert.equal(fail.success, false);
  assert.equal(fail.code, 'LOGIN_REQUIRED');
  assert.match(fail.error ?? '', /privado/);
});
