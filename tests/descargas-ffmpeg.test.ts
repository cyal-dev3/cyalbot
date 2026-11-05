import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Estas pruebas usan ffmpeg real; si no está instalado se omiten.
const run = promisify(execFile);
let hasFfmpeg = false;
let oddMp4: Buffer;
let shortMp4: Buffer;
let dir = '';

async function make(name: string, args: string[]): Promise<Buffer> {
  const out = join(dir, name);
  await run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args, out]);
  return readFile(out);
}

before(async () => {
  try {
    await run('ffmpeg', ['-version']);
    hasFfmpeg = true;
  } catch {
    return;
  }
  dir = await mkdtemp(join(tmpdir(), 'descargas-ffmpeg-'));
  process.env.TMP_DIR = join(dir, 'bot-tmp');
  oddMp4 = await make('odd.mp4', ['-f', 'lavfi', '-i', 'testsrc=size=640x361:rate=10', '-t', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv444p']);
  shortMp4 = await make('short.mp4', ['-f', 'lavfi', '-i', 'testsrc=size=96x64:rate=10', '-t', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p']);
});

test('compressVideo acepta videos de alto impar (dimensiones forzadas a par)', async (t) => {
  if (!hasFfmpeg) return t.skip('ffmpeg no instalado');
  const { compressVideo, needsConversion, probeVideo } = await import('../src/lib/video-converter.js');
  assert.equal(await needsConversion(oddMp4), true, 'yuv444p no es compatible con WhatsApp');
  const out = await compressVideo(oddMp4);
  assert.ok(out.length > 0);
  const path = join(dir, 'compressed.mp4');
  await writeFile(path, out);
  const probe = await probeVideo(path);
  assert.equal(probe.pixFmt, 'yuv420p');
  assert.equal(probe.height % 2, 0);
  assert.equal(probe.width % 2, 0);
  assert.ok(probe.height <= 480);
});

test('videoToSticker produce un WebP animado bajo 500 KB y createSticker lo acepta como entrada', async (t) => {
  if (!hasFfmpeg) return t.skip('ffmpeg no instalado');
  const { createSticker, isAnimatedWebp, MAX_ANIMATED_BYTES, videoToSticker } = await import('../src/lib/sticker.js');
  const webp = await videoToSticker(shortMp4, { packname: 'p', author: 'a' });
  assert.ok(isAnimatedWebp(webp), 'debe ser WebP animado');
  assert.ok(webp.length <= MAX_ANIMATED_BYTES);
  // Un WebP animado que llega como imagen o por URL vuelve a pasar por el pipeline (ffmpeg no lo decodifica solo).
  const again = await createSticker(webp, { packname: 'q', author: 'b' });
  assert.ok(isAnimatedWebp(again));
  assert.ok(again.length <= MAX_ANIMATED_BYTES);
});

test('stickerToVideo e imageToSticker funcionan con la salida animada', async (t) => {
  if (!hasFfmpeg) return t.skip('ffmpeg no instalado');
  const { imageToSticker, isAnimatedWebp, MAX_STATIC_BYTES, stickerToImage, stickerToVideo, videoToSticker } = await import('../src/lib/sticker.js');
  const webp = await videoToSticker(shortMp4);
  const mp4 = await stickerToVideo(webp);
  assert.equal(mp4.toString('latin1', 4, 8), 'ftyp');
  const png = await stickerToImage(webp);
  assert.equal(png.toString('latin1', 1, 4), 'PNG');
  const still = await imageToSticker(png);
  assert.equal(isAnimatedWebp(still), false);
  assert.ok(still.length <= MAX_STATIC_BYTES);
  await rm(dir, { recursive: true, force: true });
});
