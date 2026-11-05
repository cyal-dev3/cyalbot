import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

// fetchMedia solo acepta hosts privados si son el del servicio configurado; el servidor
// de prueba escucha en 127.0.0.1, así que se declara como DOWNLOADER_API_URL antes de importar.
process.env.DOWNLOADER_API_URL = 'http://127.0.0.1:9';

let server: Server;
let baseUrl = '';

before(async () => {
  server = createServer((req, res) => {
    if (req.url === '/big') {
      res.writeHead(200, { 'content-type': 'video/mp4' });
      const chunk = Buffer.alloc(64 * 1024, 1);
      let sent = 0;
      const push = () => {
        while (sent < 8 * 1024 * 1024) {
          sent += chunk.length;
          if (!res.write(chunk)) {
            res.once('drain', push);
            return;
          }
        }
        res.end();
      };
      push();
      return;
    }
    if (req.url === '/html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<html>login</html>');
      return;
    }
    if (req.url === '/declared') {
      res.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': String(10 * 1024 * 1024) });
      res.end(Buffer.alloc(16));
      return;
    }
    if (req.url === '/ok.jpg') {
      res.writeHead(200, { 'content-type': 'image/jpeg' });
      res.end(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => new Promise<void>((resolve) => server.close(() => resolve())));

test('fetchMedia devuelve el contenido y el mimetype', async () => {
  const { fetchMedia } = await import('../src/lib/media-send.js');
  const media = await fetchMedia(`${baseUrl}/ok.jpg`, { maxBytes: 1024, timeoutMs: 5000 });
  assert.ok(media);
  assert.equal(media.mimetype, 'image/jpeg');
  assert.equal(media.buffer.length, 8);
});

test('fetchMedia aborta cuando el cuerpo supera maxBytes', async () => {
  const { fetchMedia } = await import('../src/lib/media-send.js');
  const media = await fetchMedia(`${baseUrl}/big`, { maxBytes: 1024 * 1024, timeoutMs: 10_000 });
  assert.equal(media, null);
});

test('fetchMedia rechaza un content-length declarado por encima del límite', async () => {
  const { fetchMedia } = await import('../src/lib/media-send.js');
  assert.equal(await fetchMedia(`${baseUrl}/declared`, { maxBytes: 1024 }), null);
});

test('fetchMedia rechaza HTML (páginas de login o error en lugar del archivo)', async () => {
  const { fetchMedia } = await import('../src/lib/media-send.js');
  assert.equal(await fetchMedia(`${baseUrl}/html`, { maxBytes: 1024 * 1024 }), null);
});

test('fetchMedia rechaza destinos internos que no son el servicio (SSRF)', async () => {
  const { fetchMedia } = await import('../src/lib/media-send.js');
  const { isPrivateHost } = await import('../src/lib/http.js');
  assert.equal(await fetchMedia('http://localhost:9/x', { maxBytes: 1024 }), null);
  assert.equal(await fetchMedia('http://10.0.0.5/x', { maxBytes: 1024 }), null);
  assert.equal(await fetchMedia('http://[::1]/x', { maxBytes: 1024 }), null);
  assert.equal(await fetchMedia('http://169.254.169.254/latest/meta-data', { maxBytes: 1024 }), null);
  assert.equal(await fetchMedia('ftp://example.com/x', { maxBytes: 1024 }), null);
  assert.equal(isPrivateHost('192.168.1.1'), true);
  assert.equal(isPrivateHost('metadata.internal'), true);
  assert.equal(isPrivateHost('example.com'), false);
});

test('mimetypeFor y LIMITS', async () => {
  const { mimetypeFor, LIMITS, formatMb } = await import('../src/lib/media-send.js');
  assert.equal(mimetypeFor('audio', 'song.mp3'), 'audio/mpeg');
  assert.equal(mimetypeFor('audio', 'song.m4a'), 'audio/mp4');
  assert.equal(mimetypeFor('audio', 'raro.bin', 'audio/ogg'), 'audio/ogg');
  assert.equal(mimetypeFor('video', 'clip.mp4'), 'video/mp4');
  assert.equal(mimetypeFor('image', 'foto.png', 'image/png'), 'image/png');
  assert.equal(mimetypeFor('image', 'foto', 'application/octet-stream'), 'image/jpeg');
  assert.equal(LIMITS.video, 64 * 1024 * 1024);
  assert.equal(LIMITS.audio, 16 * 1024 * 1024);
  assert.equal(formatMb(1.5 * 1024 * 1024), '1.5 MB');
});

test('sendMedias salta los archivos que declaran más tamaño del permitido y pone caption solo en el primero', async () => {
  const { sendMedias } = await import('../src/lib/media-send.js');
  const sent: { chat: string; content: Record<string, unknown> }[] = [];
  const tracked: unknown[] = [];
  const conn = {
    sendMessage: async (chat: string, content: Record<string, unknown>) => {
      sent.push({ chat, content });
      return { key: { id: `msg${sent.length}` } };
    },
  };
  const m = { chat: 'grupo@g.us', rawMessage: { key: { id: 'orig' } } };
  const result = await sendMedias(conn as never, m as never, [
    { url: `${baseUrl}/ok.jpg`, type: 'image', size: 8, filename: 'a.jpg' },
    { url: `${baseUrl}/ok.jpg`, type: 'video', size: 100 * 1024 * 1024, filename: 'huge.mp4' },
    { url: `${baseUrl}/ok.jpg`, type: 'image', size: 8, filename: 'b.jpg' },
    { url: `${baseUrl}/ok.jpg`, type: 'image', size: 8, filename: 'c.jpg' },
  ], { caption: 'hola', limit: 3, trackMessage: (key) => tracked.push(key) });

  assert.equal(result.total, 3);
  assert.equal(result.sent, 2);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /100\.0 MB, el máximo es 64\.0 MB/);
  assert.equal(sent.length, 2);
  assert.equal(sent[0].content.caption, 'hola');
  assert.equal(sent[1].content.caption, undefined);
  assert.equal(sent[0].content.mimetype, 'image/jpeg');
  assert.equal(tracked.length, 2);
});
