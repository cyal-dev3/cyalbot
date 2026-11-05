import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectMedia, isAnimatedWebp, MAX_ANIMATED_BYTES, MAX_STATIC_BYTES } from '../src/lib/sticker.js';
import { mediaInMessage } from '../src/lib/media.js';

function riffWebp(chunks: Buffer[]): Buffer {
  const body = Buffer.concat([Buffer.from('WEBP', 'latin1'), ...chunks]);
  const header = Buffer.alloc(8);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

function chunk(fourcc: string, payload: Buffer): Buffer {
  const size = Buffer.alloc(4);
  size.writeUInt32LE(payload.length, 0);
  return Buffer.concat([Buffer.from(fourcc, 'latin1'), size, payload]);
}

/** VP8X: 1 byte de flags + 3 reservados + 3 bytes ancho-1 + 3 bytes alto-1. */
function vp8x(flags: number): Buffer {
  const payload = Buffer.alloc(10);
  payload[0] = flags;
  return chunk('VP8X', payload);
}

const STATIC_WEBP = riffWebp([chunk('VP8 ', Buffer.alloc(20))]);
const EXTENDED_STATIC_WEBP = riffWebp([vp8x(0x10), chunk('VP8L', Buffer.alloc(20))]);
const ANIMATED_FLAG_WEBP = riffWebp([vp8x(0x02), chunk('VP8 ', Buffer.alloc(20))]);
const ANIM_CHUNK_WEBP = riffWebp([vp8x(0x00), chunk('ANIM', Buffer.alloc(6)), chunk('ANMF', Buffer.alloc(16))]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
const GIF = Buffer.from('GIF89a' + '\u0000'.repeat(10), 'latin1');
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom', 'latin1'), Buffer.alloc(16)]);
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(20)]);

test('isAnimatedWebp detecta el flag de VP8X y el chunk ANIM', () => {
  assert.equal(isAnimatedWebp(ANIMATED_FLAG_WEBP), true);
  assert.equal(isAnimatedWebp(ANIM_CHUNK_WEBP), true);
  assert.equal(isAnimatedWebp(STATIC_WEBP), false);
  assert.equal(isAnimatedWebp(EXTENDED_STATIC_WEBP), false);
  assert.equal(isAnimatedWebp(JPEG), false);
  assert.equal(isAnimatedWebp(Buffer.from('ANIM dentro de texto plano')), false);
  assert.equal(isAnimatedWebp(Buffer.alloc(0)), false);
});

test('detectMedia reconoce webp, jpeg, png, gif, mp4 y webm', () => {
  assert.deepEqual(detectMedia(STATIC_WEBP), { mime: 'image/webp', ext: 'webp', kind: 'image', animated: false });
  assert.deepEqual(detectMedia(ANIMATED_FLAG_WEBP), { mime: 'image/webp', ext: 'webp', kind: 'image', animated: true });
  assert.deepEqual(detectMedia(JPEG), { mime: 'image/jpeg', ext: 'jpg', kind: 'image', animated: false });
  assert.deepEqual(detectMedia(PNG), { mime: 'image/png', ext: 'png', kind: 'image', animated: false });
  assert.deepEqual(detectMedia(GIF), { mime: 'image/gif', ext: 'gif', kind: 'video', animated: true });
  assert.deepEqual(detectMedia(MP4), { mime: 'video/mp4', ext: 'mp4', kind: 'video', animated: true });
  assert.deepEqual(detectMedia(WEBM), { mime: 'video/webm', ext: 'webm', kind: 'video', animated: true });
  assert.equal(detectMedia(Buffer.from('texto cualquiera')).kind, 'unknown');
  assert.equal(detectMedia(Buffer.alloc(0)).kind, 'unknown');
});

test('los límites de WhatsApp están fijados', () => {
  assert.equal(MAX_STATIC_BYTES, 100 * 1024);
  assert.equal(MAX_ANIMATED_BYTES, 500 * 1024);
});

test('mediaInMessage clasifica el contenido de un mensaje de Baileys', () => {
  assert.equal(mediaInMessage(undefined), null);
  assert.equal(mediaInMessage({ conversation: 'hola' }), null);
  assert.deepEqual(mediaInMessage({ imageMessage: { mimetype: 'image/png', fileLength: 10 } }), { kind: 'image', mimetype: 'image/png', isAnimated: false, declaredSize: 10 });
  assert.equal(mediaInMessage({ videoMessage: { mimetype: 'video/mp4' } })?.kind, 'video');
  assert.deepEqual(mediaInMessage({ stickerMessage: { isAnimated: true } }), { kind: 'sticker', mimetype: 'image/webp', isAnimated: true, declaredSize: 0 });
  assert.equal(mediaInMessage({ documentMessage: { mimetype: 'video/quicktime', fileLength: 5 } })?.kind, 'video');
  assert.equal(mediaInMessage({ documentMessage: { mimetype: 'image/gif' } })?.kind, 'image');
  assert.equal(mediaInMessage({ documentMessage: { mimetype: 'application/pdf' } }), null);
});
