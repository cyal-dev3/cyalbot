import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { loadConfig } from '../src/config.js';
import { Deadline, downloadImages, streamToFile } from '../src/ytdlp.js';

let server: Server;
let port: number;
let tmp: string;
let hits = 0;

before(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'dl-img-'));
  server = createServer((req, res) => {
    hits += 1;
    if (req.url === '/big-declared.png') {
      res.writeHead(200, { 'content-type': 'image/png', 'content-length': String(3 * 1024 * 1024) });
      res.end(Buffer.alloc(3 * 1024 * 1024, 7));
      return;
    }
    if (req.url === '/big-chunked.png') {
      res.writeHead(200, { 'content-type': 'image/png' });
      for (let i = 0; i < 6; i += 1) res.write(Buffer.alloc(512 * 1024, 1));
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': 'image/png' });
    res.end(Buffer.from('pequena'));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const address = server.address();
  port = typeof address === 'object' && address ? address.port : 0;
});

after(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await rm(tmp, { recursive: true, force: true });
});

describe('descarga de imagenes', () => {
  it('nunca pide URLs de imagen que apunten a hosts privados o locales (SSRF)', async () => {
    const config = loadConfig({ MAX_FILE_MB: '1' });
    const before = hits;
    const saved = await downloadImages(
      config,
      [
        `http://127.0.0.1:${port}/a.png`,
        `http://localhost:${port}/b.png`,
        'http://169.254.169.254/latest/meta-data/',
        'http://10.0.0.1/c.jpg',
        `http://[::1]:${port}/d.png`,
        'file:///etc/passwd',
      ],
      tmp,
      new Deadline(10_000),
    );
    assert.equal(saved, 0);
    assert.equal(hits, before, 'el servidor local no debe recibir ninguna peticion');
    assert.deepEqual(await readdir(tmp), []);
  });

  it('streamToFile rechaza por Content-Length y por tamano real sin cargar todo en memoria', async () => {
    const limit = 1024 * 1024;
    const declared = await fetch(`http://127.0.0.1:${port}/big-declared.png`);
    const target1 = path.join(tmp, 'declared.png');
    assert.equal(await streamToFile(declared, target1, limit), -1);
    await assert.rejects(stat(target1));

    const chunked = await fetch(`http://127.0.0.1:${port}/big-chunked.png`);
    const target2 = path.join(tmp, 'chunked.png');
    assert.equal(await streamToFile(chunked, target2, limit), -1);
    await assert.rejects(stat(target2));

    const small = await fetch(`http://127.0.0.1:${port}/small.png`);
    const target3 = path.join(tmp, 'small.png');
    assert.equal(await streamToFile(small, target3, limit), 7);
    assert.equal((await stat(target3)).size, 7);
  });
});
