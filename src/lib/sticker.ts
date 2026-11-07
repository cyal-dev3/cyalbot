import { randomBytes } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FfmpegError, runFfmpeg, withTempDir } from './ffmpeg.js';
import { createLogger } from './logger.js';

const log = createLogger('sticker');

export interface StickerMetadata {
  packname?: string;
  author?: string;
  categories?: string[];
}

export interface StickerOptions {
  /** Recortar al cuadrado (true) o encajar con fondo transparente (false). */
  crop?: boolean;
}

export const STICKER_SIZE = 512;
/** Límites de WhatsApp: los estáticos deben pesar <= 100 KB y los animados <= 500 KB. */
export const MAX_STATIC_BYTES = 100 * 1024;
export const MAX_ANIMATED_BYTES = 500 * 1024;
export const MAX_ANIMATED_SECONDS = 8;

/** Ningún reintento dejó el sticker bajo el tope de WhatsApp. */
export class StickerTooLargeError extends Error {
  constructor(readonly size: number, readonly max: number, readonly attempts: number, readonly animated: boolean) {
    super(
      `El sticker sigue pesando ${Math.ceil(size / 1024)} KB tras ${attempts} intentos (máximo ${Math.round(max / 1024)} KB). ` +
        (animated ? 'Usa un video más corto o con menos movimiento.' : 'Usa una imagen más sencilla.'),
    );
    this.name = 'StickerTooLargeError';
  }
}

export type MediaKind = 'image' | 'video' | 'unknown';

export interface DetectedMedia {
  mime: string;
  ext: string;
  kind: MediaKind;
  animated: boolean;
}

function hasAscii(buffer: Buffer, text: string, offset: number): boolean {
  return buffer.length >= offset + text.length && buffer.toString('latin1', offset, offset + text.length) === text;
}

/** true si el buffer es un WebP con animación (flag del chunk VP8X o chunk ANIM presente). */
export function isAnimatedWebp(buffer: Buffer): boolean {
  if (!hasAscii(buffer, 'RIFF', 0) || !hasAscii(buffer, 'WEBP', 8)) return false;
  if (hasAscii(buffer, 'VP8X', 12) && buffer.length > 20 && (buffer[20] & 0x02) !== 0) return true;
  return buffer.indexOf('ANIM', 12, 'latin1') !== -1;
}

/** Tipo real del archivo por sus primeros bytes. */
export function detectMedia(buffer: Buffer): DetectedMedia {
  if (hasAscii(buffer, 'RIFF', 0) && hasAscii(buffer, 'WEBP', 8)) {
    return { mime: 'image/webp', ext: 'webp', kind: 'image', animated: isAnimatedWebp(buffer) };
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg', kind: 'image', animated: false };
  if (buffer[0] === 0x89 && hasAscii(buffer, 'PNG', 1)) return { mime: 'image/png', ext: 'png', kind: 'image', animated: false };
  if (hasAscii(buffer, 'GIF8', 0)) return { mime: 'image/gif', ext: 'gif', kind: 'video', animated: true };
  if (hasAscii(buffer, 'ftyp', 4)) return { mime: 'video/mp4', ext: 'mp4', kind: 'video', animated: true };
  if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) {
    return { mime: 'video/webm', ext: 'webm', kind: 'video', animated: true };
  }
  if (hasAscii(buffer, 'RIFF', 0) && hasAscii(buffer, 'AVI ', 8)) return { mime: 'video/avi', ext: 'avi', kind: 'video', animated: true };
  return { mime: 'application/octet-stream', ext: 'bin', kind: 'unknown', animated: false };
}

function createExif(packname: string, author: string, categories: string[]): Buffer {
  const json = Buffer.from(
    JSON.stringify({
      'sticker-pack-id': `CYALTRONIC_${randomBytes(8).toString('hex').toUpperCase()}`,
      'sticker-pack-name': packname,
      'sticker-pack-publisher': author,
      emojis: categories,
    }),
    'utf8',
  );
  // Cabecera TIFF little-endian con una sola entrada IFD (tag 0x5741, tipo UNDEFINED) que apunta al JSON.
  const header = Buffer.from([
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x16, 0x00, 0x00, 0x00,
  ]);
  header.writeUInt32LE(json.length, 14);
  return Buffer.concat([header, json]);
}

type WebpmuxImage = import('node-webpmux').Image;

/** node-webpmux es CommonJS: según el cargador la clase llega como export con nombre o dentro de default. */
async function loadWebp(buffer: Buffer): Promise<WebpmuxImage> {
  const mod = (await import('node-webpmux')) as unknown as { Image?: new () => WebpmuxImage; default?: { Image?: new () => WebpmuxImage } };
  const Image = mod.Image ?? mod.default?.Image;
  if (!Image) throw new Error('node-webpmux no expone Image');
  const img = new Image();
  await img.load(buffer);
  return img;
}

/** Inserta el EXIF de pack/autor en un WebP. Si node-webpmux falla devuelve el original. */
export async function addExif(webp: Buffer, packname = 'CYALTRONIC', author = 'Bot', categories: string[] = ['']): Promise<Buffer> {
  try {
    const img = await loadWebp(webp);
    img.exif = createExif(packname, author, categories);
    return Buffer.from(await img.save(null));
  } catch (error) {
    log.warn('no se pudo escribir el EXIF del sticker:', error instanceof Error ? error.message : error);
    return webp;
  }
}

function scaleFilter(crop: boolean): string {
  return crop
    ? `scale=${STICKER_SIZE}:${STICKER_SIZE}:force_original_aspect_ratio=increase,crop=${STICKER_SIZE}:${STICKER_SIZE},setsar=1`
    : `scale=${STICKER_SIZE}:${STICKER_SIZE}:flags=lanczos:force_original_aspect_ratio=decrease,format=rgba,pad=${STICKER_SIZE}:${STICKER_SIZE}:(ow-iw)/2:(oh-ih)/2:color=#00000000,setsar=1`;
}

const STATIC_QUALITIES = [90, 75, 60, 45, 30, 15, 5];
/** Los dos últimos escalones recortan la duración: la resolución no baja porque WhatsApp exige 512x512. */
const ANIMATED_ATTEMPTS: { fps: number; quality: number; seconds: number }[] = [
  { fps: 15, quality: 60, seconds: MAX_ANIMATED_SECONDS },
  { fps: 12, quality: 45, seconds: MAX_ANIMATED_SECONDS },
  { fps: 10, quality: 30, seconds: MAX_ANIMATED_SECONDS },
  { fps: 8, quality: 20, seconds: MAX_ANIMATED_SECONDS },
  { fps: 8, quality: 10, seconds: 5 },
  { fps: 6, quality: 5, seconds: 3 },
];

/** Codifica con cada intento hasta que el resultado cabe; si ninguno cabe, lanza StickerTooLargeError. */
async function encodeUntilFits(
  attempts: number,
  maxBytes: number,
  encode: (attempt: number, output: string) => Promise<void>,
  output: string,
  animated: boolean,
): Promise<Buffer> {
  let size = 0;
  for (let i = 0; i < attempts; i++) {
    await encode(i, output);
    size = (await stat(output)).size;
    if (size <= maxBytes) return readFile(output);
    log.debug(`sticker de ${size} bytes supera ${maxBytes}, reintentando (${i + 1}/${attempts})`);
  }
  throw new StickerTooLargeError(size, maxBytes, attempts, animated);
}

/** Imagen a WebP estático de 512x512; baja la calidad hasta quedar bajo 100 KB. */
export async function imageToSticker(buffer: Buffer, metadata: StickerMetadata = {}, options: StickerOptions = {}): Promise<Buffer> {
  const crop = options.crop ?? true;
  const webp = await withTempDir(async (dir) => {
    const input = await mediaInputArgs(buffer, dir);
    const outPath = join(dir, 'out.webp');
    return encodeUntilFits(STATIC_QUALITIES.length, MAX_STATIC_BYTES, (i, out) =>
      runFfmpeg([
        ...input, '-frames:v', '1',
        '-vf', scaleFilter(crop),
        '-c:v', 'libwebp', '-lossless', '0', '-quality', String(STATIC_QUALITIES[i]), '-compression_level', '6',
        out,
      ]), outPath, false);
  });
  return addExif(webp, metadata.packname, metadata.author, metadata.categories);
}

/** Video, GIF o WebP animado a WebP animado (8 s máx.); baja fps, calidad y duración hasta quedar bajo 500 KB. */
export async function videoToSticker(buffer: Buffer, metadata: StickerMetadata = {}, options: StickerOptions = {}): Promise<Buffer> {
  const crop = options.crop ?? true;
  const webp = await withTempDir(async (dir) => {
    const input = await mediaInputArgs(buffer, dir);
    const outPath = join(dir, 'out.webp');
    return encodeUntilFits(ANIMATED_ATTEMPTS.length, MAX_ANIMATED_BYTES, (i, out) => {
      const { fps, quality, seconds } = ANIMATED_ATTEMPTS[i];
      // El filtro fps deja la salida a ritmo constante, así que no hace falta -vsync/-fps_mode.
      return runFfmpeg([
        ...input, '-t', String(seconds), '-an',
        '-vf', `${scaleFilter(crop)},fps=${fps}`,
        '-c:v', 'libwebp', '-lossless', '0', '-quality', String(quality), '-compression_level', '6', '-loop', '0',
        out,
      ], { timeoutMs: 90_000 });
    }, outPath, true);
  });
  return addExif(webp, metadata.packname, metadata.author, metadata.categories);
}

/**
 * Escribe el buffer en `dir` y devuelve los argumentos de entrada para ffmpeg.
 * ffmpeg (hasta 7.0) no decodifica WebP animado: esos se separan en fotogramas
 * con node-webpmux y se entregan como lista concat con la duración real de cada
 * uno. Cualquier otro formato (incluido WebP estático) se pasa directo.
 */
async function mediaInputArgs(buffer: Buffer, dir: string): Promise<string[]> {
  const media = detectMedia(buffer);
  const inPath = join(dir, `in.${media.ext}`);
  await writeFile(inPath, buffer);
  if (media.mime !== 'image/webp' || !media.animated) return ['-i', inPath];

  const img = await loadWebp(buffer);
  const frames = img.hasAnim ? await img.demux({ buffers: true }) : [];
  if (!frames.length) return ['-i', inPath];

  const lines = ['ffconcat version 1.0'];
  for (const [i, frame] of frames.entries()) {
    const name = `f_${String(i).padStart(4, '0')}.webp`;
    await writeFile(join(dir, name), frame);
    // El delay viene en ms; WhatsApp usa 0 para "lo más rápido posible".
    const delayMs = Math.max(20, img.frames?.[i]?.delay ?? 100);
    lines.push(`file '${name}'`, `duration ${(delayMs / 1000).toFixed(3)}`);
  }
  // El concat ignora la duración del último fotograma salvo que se repita.
  lines.push(`file 'f_${String(frames.length - 1).padStart(4, '0')}.webp'`);
  const listPath = join(dir, 'list.txt');
  await writeFile(listPath, `${lines.join('\n')}\n`);
  return ['-f', 'concat', '-safe', '0', '-i', listPath];
}

/** Primer fotograma del sticker como PNG. */
export function stickerToImage(buffer: Buffer): Promise<Buffer> {
  return withTempDir(async (dir) => {
    const input = await mediaInputArgs(buffer, dir);
    const outPath = join(dir, 'out.png');
    await runFfmpeg([...input, '-frames:v', '1', outPath]);
    return readFile(outPath);
  });
}

/** Sticker animado a mp4 H.264 (fondo negro donde había transparencia). */
export function stickerToVideo(buffer: Buffer): Promise<Buffer> {
  return withTempDir(async (dir) => {
    const input = await mediaInputArgs(buffer, dir);
    const outPath = join(dir, 'out.mp4');
    const encode = (vfrFlag: string) => runFfmpeg([
      ...input,
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p',
      vfrFlag, 'vfr', '-c:v', 'libx264', '-crf', '23', '-preset', 'fast', '-movflags', '+faststart',
      outPath,
    ]);
    // -fps_mode existe desde ffmpeg 5.1 y -vsync desapareció en ffmpeg 8; se prueba el
    // moderno y, si la versión instalada no lo conoce, se repite con el antiguo (ffmpeg 4.4).
    try {
      await encode('-fps_mode');
    } catch (error) {
      if (!(error instanceof FfmpegError) || !/fps_mode|Option not found|Unrecognized option/i.test(error.message)) throw error;
      await encode('-vsync');
    }
    return readFile(outPath);
  });
}

/** Sticker animado a GIF con paleta propia. */
export function stickerToGif(buffer: Buffer): Promise<Buffer> {
  return withTempDir(async (dir) => {
    const input = await mediaInputArgs(buffer, dir);
    const outPath = join(dir, 'out.gif');
    await runFfmpeg([...input, '-vf', 'split[s0][s1];[s0]palettegen=reserve_transparent=1[p];[s1][p]paletteuse', '-loop', '0', outPath]);
    return readFile(outPath);
  });
}

/** Crea el sticker eligiendo estático o animado según el contenido real del buffer. */
export function createSticker(buffer: Buffer, metadata: StickerMetadata = {}, options: StickerOptions = {}): Promise<Buffer> {
  const media = detectMedia(buffer);
  return media.kind === 'video' || media.animated
    ? videoToSticker(buffer, metadata, options)
    : imageToSticker(buffer, metadata, options);
}
