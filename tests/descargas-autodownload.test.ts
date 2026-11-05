import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

// CONFIG lee DOWNLOADER_API_URL al importar: el servidor falso se levanta antes del import dinámico.
let server: Server;
let baseUrl = '';
const hits: string[] = [];
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c: Buffer) => { data += c.toString(); });
    req.on('end', () => resolve(data));
  });
}

before(async () => {
  server = createServer(async (req, res) => {
    const body = await readBody(req);
    hits.push(req.url ?? '');
    if (req.url === '/v1/info') {
      const { url } = JSON.parse(body) as { url: string };
      // Un pequeño retraso abre la ventana en la que dos enlaces podían colarse a la vez.
      await new Promise((r) => setTimeout(r, 50));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: { title: 'v', author: 'a', duration: url.includes('largo') ? 900 : 60, thumbnail: null, platform: 'youtube', isPlaylist: false, entries: 1 } }));
      return;
    }
    if (req.url === '/v1/download') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: { url: `${baseUrl}/files/x`, type: 'image', filename: 'x.jpg', size: JPEG.length, duration: null, thumbnail: null, title: 'Foto', author: 'alguien', medias: [{ url: `${baseUrl}/files/x`, type: 'image', filename: 'x.jpg', size: JPEG.length }] } }));
      return;
    }
    if (req.url === '/files/x') {
      res.writeHead(200, { 'content-type': 'image/jpeg' });
      res.end(JPEG);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.DOWNLOADER_API_URL = baseUrl;
});

after(() => new Promise<void>((resolve) => server.close(() => resolve())));

function fakeChat(chat: string) {
  const sent: Record<string, unknown>[] = [];
  const conn = {
    sendMessage: async (_chat: string, content: Record<string, unknown>) => {
      sent.push(content);
      return { key: { id: `m${sent.length}` } };
    },
  };
  const m = { chat, rawMessage: { key: { id: 'orig' } } };
  return { conn: conn as never, m: m as never, sent };
}

test('shouldAutoDownload: plataforma conocida, dedupe por URL y reserva del chat', async () => {
  const auto = await import('../src/lib/autodownload.js');
  assert.equal(await auto.shouldAutoDownload('c1@g.us', 'https://vimeo.com/1'), false);
  assert.equal(await auto.shouldAutoDownload('c1@g.us', 'https://vm.tiktok.com/ZMa/'), true);
  // Mientras está reservado, otro enlace del mismo chat no pasa; otro chat sí.
  assert.equal(await auto.shouldAutoDownload('c1@g.us', 'https://vm.tiktok.com/ZMb/'), false);
  assert.equal(await auto.shouldAutoDownload('c2@g.us', 'https://vm.tiktok.com/ZMb/'), true);
  auto.releaseAutoDownload('c1@g.us');
  auto.releaseAutoDownload('c2@g.us');
  // El mismo enlace se ignora 10 min aunque el chat esté libre; uno nuevo pasa.
  assert.equal(await auto.shouldAutoDownload('c1@g.us', 'https://vm.tiktok.com/ZMa/'), false);
  assert.equal(await auto.shouldAutoDownload('c1@g.us', 'https://vm.tiktok.com/ZMc/'), true);
  auto.releaseAutoDownload('c1@g.us');
  // YouTube consulta /v1/info y rechaza los largos liberando el chat.
  hits.length = 0;
  assert.equal(await auto.shouldAutoDownload('c3@g.us', 'https://youtu.be/largo1'), false);
  assert.deepEqual(hits, ['/v1/info']);
  assert.equal(await auto.shouldAutoDownload('c3@g.us', 'https://youtu.be/corto1'), true);
  auto.releaseAutoDownload('c3@g.us');
});

test('handleAutoDownload: dos enlaces de YouTube a la vez en el mismo chat solo bajan uno', async () => {
  const { handleAutoDownload } = await import('../src/lib/autodownload.js');
  const chat = fakeChat('c4@g.us');
  hits.length = 0;
  await Promise.all([
    handleAutoDownload(chat.conn, chat.m, 'mira https://youtu.be/corto2'),
    handleAutoDownload(chat.conn, chat.m, 'y esto https://youtu.be/corto3'),
  ]);
  assert.equal(hits.filter((h) => h === '/v1/info').length, 1, 'solo una consulta a /v1/info');
  assert.equal(hits.filter((h) => h === '/v1/download').length, 1, 'solo una descarga');
  assert.equal(chat.sent.length, 1);
  assert.equal(chat.sent[0].mimetype, 'image/jpeg');
  assert.match(String(chat.sent[0].caption), /YouTube \| alguien\nFoto/);

  // Al terminar, el chat queda libre para el siguiente enlace.
  await handleAutoDownload(chat.conn, chat.m, 'https://vm.tiktok.com/ZMd/');
  assert.equal(chat.sent.length, 2);
});
