import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

// La API local de descargas es la única excepción al bloqueo de hosts privados,
// así que el servidor de pruebas se registra como tal antes de cargar la config.
let server: Server;
let base = '';
let fetchMedia: typeof import('../src/lib/fetch-media.js').fetchMedia;
let rejectReason: typeof import('../src/lib/fetch-media.js').rejectReason;
let isPrivateHost: typeof import('../src/lib/fetch-media.js').isPrivateHost;
let isPrivateAddress: typeof import('../src/lib/fetch-media.js').isPrivateAddress;

before(async () => {
  server = createServer((req, res) => {
    if (req.url === '/ok.jpg') {
      res.writeHead(200, { 'content-type': 'image/jpeg; charset=binary', 'content-length': '5' });
      res.end(Buffer.from('12345'));
    } else if (req.url === '/page') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html></html>');
    } else if (req.url === '/big-declared') {
      res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': '1000000' });
      res.end(Buffer.alloc(16));
    } else if (req.url === '/big-stream') {
      res.writeHead(200, { 'content-type': 'video/mp4' });
      res.write(Buffer.alloc(600));
      res.write(Buffer.alloc(600));
      res.end();
    } else if (req.url === '/to-localhost') {
      res.writeHead(302, { location: `http://localhost:${(server.address() as AddressInfo).port}/ok.jpg` });
      res.end();
    } else if (req.url === '/to-ok') {
      res.writeHead(302, { location: '/ok.jpg' });
      res.end();
    } else if (req.url?.startsWith('/loop')) {
      res.writeHead(302, { location: `/loop${(req.url.length % 7)}` });
      res.end();
    } else if (req.url === '/to-mapped') {
      res.writeHead(301, { location: 'http://[::ffff:127.0.0.1]:1/x.jpg' });
      res.end();
    } else if (req.url === '/slow') {
      setTimeout(() => { res.writeHead(200); res.end('tarde'); }, 500).unref();
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.DOWNLOADER_API_URL = base;
  const { setLogLevel } = await import('../src/lib/logger.js');
  setLogLevel('error');
  ({ fetchMedia, rejectReason, isPrivateHost, isPrivateAddress } = await import('../src/lib/fetch-media.js'));
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test('isPrivateAddress / isPrivateHost reconocen rangos internos', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.10', '172.16.5.5', '172.31.255.1', '169.254.1.1', '0.0.0.0', '::1', 'fe80::1', 'fd00::1', '::ffff:10.0.0.1']) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '172.32.0.1', '1.1.1.1', '2606:4700::1111']) {
    assert.equal(isPrivateAddress(ip), false, ip);
  }
  assert.equal(isPrivateHost('localhost'), true);
  assert.equal(isPrivateHost('db.internal'), true);
  assert.equal(isPrivateHost('[::1]'), true);
  assert.equal(isPrivateHost('example.com'), false);
});

test('rejectReason bloquea hosts privados salvo el de DOWNLOADER_API_URL', async () => {
  assert.equal(await rejectReason('http://localhost/x.mp4'), 'host privado');
  assert.equal(await rejectReason('http://10.0.0.5/x.mp4'), 'host privado');
  assert.equal(await rejectReason('ftp://example.com/x'), 'protocolo no permitido (ftp:)');
  assert.equal(await rejectReason('no es url'), 'URL inválida');
  assert.equal(await rejectReason(`${base}/ok.jpg`), null);
  assert.equal(await fetchMedia('http://localhost:1/x.mp4'), null);
});

test('fetchMedia devuelve buffer y mimetype limpio', async () => {
  const media = await fetchMedia(`${base}/ok.jpg`);
  assert.ok(media);
  assert.equal(media.mimetype, 'image/jpeg');
  assert.equal(media.buffer.toString(), '12345');
});

test('fetchMedia rechaza HTML, 404, content-length excesivo y streams que exceden maxBytes', async () => {
  assert.equal(await fetchMedia(`${base}/page`), null);
  assert.equal(await fetchMedia(`${base}/nada`), null);
  assert.equal(await fetchMedia(`${base}/big-declared`, { maxBytes: 1000 }), null);
  assert.equal(await fetchMedia(`${base}/big-stream`, { maxBytes: 1000 }), null);
  const fits = await fetchMedia(`${base}/big-stream`, { maxBytes: 2000 });
  assert.equal(fits?.buffer.length, 1200);
});

test('fetchMedia corta por timeout', async () => {
  assert.equal(await fetchMedia(`${base}/slow`, { timeoutMs: 50 }), null);
});

test('isPrivateAddress reconoce la forma hexadecimal de las IPv4 mapeadas', () => {
  assert.equal(new URL('http://[::ffff:127.0.0.1]/').hostname, '[::ffff:7f00:1]');
  for (const ip of ['::ffff:7f00:1', '::ffff:a9fe:a9fe', '::ffff:a00:1', '::ffff:c0a8:101']) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  assert.equal(isPrivateAddress('::ffff:808:808'), false);
  assert.equal(isPrivateHost('[::ffff:7f00:1]'), true);
});

test('rejectReason bloquea URLs con IPv6 mapeadas a rangos privados', async () => {
  assert.equal(await rejectReason('http://[::ffff:127.0.0.1]:3000/x'), 'host privado');
  assert.equal(await rejectReason('http://[::ffff:a9fe:a9fe]/'), 'host privado');
});

test('las redirecciones se validan salto a salto', async () => {
  assert.equal(await fetchMedia(`${base}/to-localhost`), null, 'redirección a un host privado distinto');
  assert.equal(await fetchMedia(`${base}/to-mapped`), null, 'redirección a IPv6 mapeada a loopback');
  assert.equal(await fetchMedia(`${base}/loop`), null, 'bucle de redirecciones');
  const followed = await fetchMedia(`${base}/to-ok`);
  assert.equal(followed?.buffer.toString(), '12345', 'redirección relativa al mismo host permitido');
});
