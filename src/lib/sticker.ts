/**
 * 🎨 Librería de Stickers - CYALTRONIC
 * Convierte imágenes/videos a stickers y viceversa
 */

import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP_DIR = join(__dirname, '../../tmp');

// Asegurar que el directorio tmp existe
await fs.mkdir(TMP_DIR, { recursive: true }).catch(e => console.error('[Sticker] Error creando directorio tmp:', e.message));

/**
 * Interfaz para metadatos del sticker
 */
export interface StickerMetadata {
  packname?: string;
  author?: string;
  categories?: string[];
  isAiSticker?: boolean;
}

/**
 * Ejecuta ffmpeg con los argumentos especificados
 */
async function runFfmpeg(
  inputPath: string,
  outputPath: string,
  args: string[]
): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', ['-y', '-i', inputPath, ...args, outputPath]);

    ffmpeg.on('error', reject);
    ffmpeg.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}`));
    });
  });
}

/**
 * Genera un nombre de archivo temporal único
 */
function getTempPath(ext: string): string {
  return join(TMP_DIR, `${Date.now()}_${randomBytes(4).toString('hex')}.${ext}`);
}

/**
 * Detecta el tipo de archivo basado en el buffer
 */
function detectFileType(buffer: Buffer): { mime: string; ext: string } {
  // Detectar por magic bytes
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) {
    // RIFF header - puede ser webp
    if (buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
      return { mime: 'image/webp', ext: 'webp' };
    }
  }
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    return { mime: 'image/jpeg', ext: 'jpg' };
  }
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
    return { mime: 'image/png', ext: 'png' };
  }
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
    return { mime: 'image/gif', ext: 'gif' };
  }
  // MP4/MOV
  if (buffer[4] === 0x66 && buffer[5] === 0x74 && buffer[6] === 0x79 && buffer[7] === 0x70) {
    return { mime: 'video/mp4', ext: 'mp4' };
  }
  // Fallback
  return { mime: 'application/octet-stream', ext: 'bin' };
}

/**
 * Crea metadatos EXIF para el sticker
 */
function createExifMetadata(packname: string, author: string, categories: string[] = ['']): Buffer {
  const json = {
    'sticker-pack-id': 'CYALTRONIC_' + randomBytes(8).toString('hex').toUpperCase(),
    'sticker-pack-name': packname,
    'sticker-pack-publisher': author,
    'emojis': categories
  };

  const jsonBuffer = Buffer.from(JSON.stringify(json), 'utf8');
  const exifAttr = Buffer.from([
    0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x16, 0x00, 0x00, 0x00
  ]);

  const exif = Buffer.concat([exifAttr, jsonBuffer]);
  exif.writeUIntLE(jsonBuffer.length, 14, 4);

  return exif;
}

/**
 * Agrega metadatos EXIF a un sticker webp
 */
export async function addExif(
  webpBuffer: Buffer,
  packname: string = 'CYALTRONIC',
  author: string = 'Bot',
  categories: string[] = ['']
): Promise<Buffer> {
  try {
    // Importar dinámicamente node-webpmux
    const webp = await import('node-webpmux');
    const img = new webp.Image();

    await img.load(webpBuffer);
    img.exif = createExifMetadata(packname, author, categories);

    return Buffer.from(await img.save(null));
  } catch (error) {
    console.error('❌ Error agregando EXIF:', error);
    // Si falla, devolver el buffer original
    return webpBuffer;
  }
}

/**
 * Convierte imagen a sticker webp
 */
export async function imageToSticker(
  buffer: Buffer,
  metadata: StickerMetadata = {}
): Promise<Buffer> {
  const { packname = 'CYALTRONIC', author = 'Bot', categories = [''] } = metadata;

  const fileType = detectFileType(buffer);
  const inputPath = getTempPath(fileType.ext);
  const outputPath = getTempPath('webp');

  try {
    await fs.writeFile(inputPath, buffer);

    // Convertir a webp con escala 512x512
    await runFfmpeg(inputPath, outputPath, [
      '-vf', 'scale=512:512:flags=lanczos:force_original_aspect_ratio=decrease,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000,setsar=1',
      '-c:v', 'libwebp',
      '-lossless', '0',
      '-quality', '80',
      '-loop', '0'
    ]);

    let stickerBuffer: Buffer = Buffer.from(await fs.readFile(outputPath));

    // Agregar metadatos EXIF
    stickerBuffer = await addExif(stickerBuffer, packname, author, categories);

    return stickerBuffer;
  } finally {
    // Limpiar archivos temporales
    await fs.unlink(inputPath).catch(e => console.error('[Sticker] Error limpiando archivo temporal:', e.message));
    await fs.unlink(outputPath).catch(e => console.error('[Sticker] Error limpiando archivo temporal:', e.message));
  }
}

/**
 * Convierte video/gif a sticker webp animado
 */
export async function videoToSticker(
  buffer: Buffer,
  metadata: StickerMetadata = {}
): Promise<Buffer> {
  const { packname = 'CYALTRONIC', author = 'Bot', categories = [''] } = metadata;

  const fileType = detectFileType(buffer);
  const inputPath = getTempPath(fileType.ext);
  const outputPath = getTempPath('webp');

  try {
    await fs.writeFile(inputPath, buffer);

    // Convertir a webp animado (máximo 512x512, 10fps, 6 segundos)
    await runFfmpeg(inputPath, outputPath, [
      '-vf', "scale='min(512,iw)':min'(512,ih)':force_original_aspect_ratio=decrease,fps=10,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=white@0.0",
      '-t', '6',
      '-c:v', 'libwebp',
      '-lossless', '0',
      '-quality', '50',
      '-loop', '0',
      '-preset', 'default',
      '-an',
      '-vsync', '0'
    ]);

    let stickerBuffer: Buffer = Buffer.from(await fs.readFile(outputPath));

    // Agregar metadatos EXIF
    stickerBuffer = await addExif(stickerBuffer, packname, author, categories);

    return stickerBuffer;
  } finally {
    await fs.unlink(inputPath).catch(e => console.error('[Sticker] Error limpiando archivo temporal:', e.message));
    await fs.unlink(outputPath).catch(e => console.error('[Sticker] Error limpiando archivo temporal:', e.message));
  }
}

/**
 * Convierte sticker webp a imagen PNG
 */
export async function stickerToImage(buffer: Buffer): Promise<Buffer> {
  const inputPath = getTempPath('webp');
  const outputPath = getTempPath('png');

  try {
    await fs.writeFile(inputPath, buffer);

    await runFfmpeg(inputPath, outputPath, [
      '-vframes', '1'
    ]);

    return await fs.readFile(outputPath);
  } finally {
    await fs.unlink(inputPath).catch(e => console.error('[Sticker] Error limpiando archivo temporal:', e.message));
    await fs.unlink(outputPath).catch(e => console.error('[Sticker] Error limpiando archivo temporal:', e.message));
  }
}

/**
 * Convierte sticker webp animado a video MP4
 */
export async function stickerToVideo(buffer: Buffer): Promise<Buffer> {
  const inputPath = getTempPath('webp');
  const outputPath = getTempPath('mp4');

  try {
    await fs.writeFile(inputPath, buffer);

    await runFfmpeg(inputPath, outputPath, [
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-crf', '23',
      '-preset', 'fast',
      '-movflags', '+faststart'
    ]);

    return await fs.readFile(outputPath);
  } finally {
    await fs.unlink(inputPath).catch(e => console.error('[Sticker] Error limpiando archivo temporal:', e.message));
    await fs.unlink(outputPath).catch(e => console.error('[Sticker] Error limpiando archivo temporal:', e.message));
  }
}

/**
 * Convierte sticker webp animado a GIF
 */
export async function stickerToGif(buffer: Buffer): Promise<Buffer> {
  const inputPath = getTempPath('webp');
  const outputPath = getTempPath('gif');

  try {
    await fs.writeFile(inputPath, buffer);

    await runFfmpeg(inputPath, outputPath, [
      '-vf', 'split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse',
      '-loop', '0'
    ]);

    return await fs.readFile(outputPath);
  } finally {
    await fs.unlink(inputPath).catch(e => console.error('[Sticker] Error limpiando archivo temporal:', e.message));
    await fs.unlink(outputPath).catch(e => console.error('[Sticker] Error limpiando archivo temporal:', e.message));
  }
}

/**
 * Función principal para crear sticker (detecta automáticamente el tipo)
 */
export async function createSticker(
  buffer: Buffer,
  metadata: StickerMetadata = {}
): Promise<Buffer> {
  const fileType = detectFileType(buffer);

  if (fileType.mime.startsWith('video/') || fileType.mime === 'image/gif') {
    return videoToSticker(buffer, metadata);
  }

  return imageToSticker(buffer, metadata);
}

export default {
  createSticker,
  imageToSticker,
  videoToSticker,
  stickerToImage,
  stickerToVideo,
  stickerToGif,
  addExif
};
