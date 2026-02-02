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
function detectFileType(buffer: Buffer): { mime: string; ext: string; isAnimated?: boolean } {
  // Detectar por magic bytes
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) {
    // RIFF header - puede ser webp
    if (buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
      // Verificar si es webp animado (buscar ANIM chunk)
      const isAnimated = buffer.includes(Buffer.from('ANIM')) || buffer.includes(Buffer.from('ANMF'));
      return { mime: 'image/webp', ext: 'webp', isAnimated };
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

  // MP4/MOV/3GP - buscar ftyp en diferentes posiciones
  // ftyp puede estar en posición 4 o después de un header
  const ftypIndex = buffer.indexOf(Buffer.from('ftyp'));
  if (ftypIndex !== -1 && ftypIndex < 12) {
    return { mime: 'video/mp4', ext: 'mp4' };
  }

  // WebM
  if (buffer[0] === 0x1A && buffer[1] === 0x45 && buffer[2] === 0xDF && buffer[3] === 0xA3) {
    return { mime: 'video/webm', ext: 'webm' };
  }

  // AVI
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
      buffer[8] === 0x41 && buffer[9] === 0x56 && buffer[10] === 0x49) {
    return { mime: 'video/avi', ext: 'avi' };
  }

  // MKV
  if (buffer[0] === 0x1A && buffer[1] === 0x45 && buffer[2] === 0xDF && buffer[3] === 0xA3) {
    return { mime: 'video/x-matroska', ext: 'mkv' };
  }

  // Fallback - intentar detectar si parece video por tamaño y estructura
  // Los videos suelen tener más de 50KB y estructura específica
  if (buffer.length > 50000) {
    // Buscar indicadores comunes de video
    if (buffer.includes(Buffer.from('moov')) || buffer.includes(Buffer.from('mdat'))) {
      return { mime: 'video/mp4', ext: 'mp4' };
    }
  }

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
  metadata: StickerMetadata = {},
  crop: boolean = true
): Promise<Buffer> {
  const { packname = 'CYALTRONIC', author = 'Bot', categories = [''] } = metadata;

  const fileType = detectFileType(buffer);
  const inputPath = getTempPath(fileType.ext);
  const outputPath = getTempPath('webp');

  try {
    await fs.writeFile(inputPath, buffer);

    // Elegir filtro basado en si queremos recortar o mantener transparencia
    // Por defecto recortamos para evitar barras
    const vfFilter = crop
      ? 'scale=512:512:force_original_aspect_ratio=increase,crop=512:512,setsar=1'
      : 'scale=512:512:flags=lanczos:force_original_aspect_ratio=decrease,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000,setsar=1';

    await runFfmpeg(inputPath, outputPath, [
      '-vf', vfFilter,
      '-c:v', 'libwebp',
      '-lossless', '0',
      '-quality', '90',
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

    // Convertir a webp animado (512x512, sin barras)
    // Escala el video para que el lado más pequeño sea 512 y luego recorta el centro
    // Esto evita las barras blancas/negras manteniendo todo el espacio ocupado
    await runFfmpeg(inputPath, outputPath, [
      '-vf', 'scale=512:512:force_original_aspect_ratio=increase,crop=512:512,fps=15',
      '-t', '8',
      '-c:v', 'libwebp',
      '-lossless', '0',
      '-quality', '60',
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
