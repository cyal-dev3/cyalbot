/**
 * 🎬 Conversor de Video para WhatsApp - CYALTRONIC
 * Re-codifica videos para compatibilidad con WhatsApp
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, unlink, readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

const execFileAsync = promisify(execFile);

// Relativo al cwd para que funcione en cualquier VPS/OS sin rutas absolutas
const TMP_DIR = join(process.cwd(), 'tmp');
// Crear directorio (idempotente) al cargar el módulo
mkdir(TMP_DIR, { recursive: true }).catch(() => {});

/**
 * Convierte un buffer de video a formato compatible con WhatsApp
 * - Codec de video: H.264 (libx264)
 * - Codec de audio: AAC
 * - Contenedor: MP4
 * - Perfil: baseline (máxima compatibilidad)
 */
export async function convertVideoForWhatsApp(inputBuffer: Buffer<ArrayBufferLike>): Promise<Buffer> {
  const id = randomBytes(8).toString('hex');
  const inputPath = join(TMP_DIR, `input_${id}.mp4`);
  const outputPath = join(TMP_DIR, `output_${id}.mp4`);

  try {
    // Escribir buffer de entrada
    await writeFile(inputPath, inputBuffer);

    // Convertir con ffmpeg - Parámetros optimizados para Android
    await execFileAsync('ffmpeg', [
      '-i', inputPath,
      '-c:v', 'libx264',        // Codec de video H.264
      '-profile:v', 'baseline', // Perfil baseline (máxima compatibilidad Android)
      '-level', '3.0',          // Nivel 3.0 para dispositivos móviles
      '-preset', 'fast',        // Velocidad de encoding
      '-crf', '28',             // Calidad (más alto = menor tamaño)
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', // Asegurar dimensiones pares
      '-c:a', 'aac',            // Codec de audio AAC
      '-ac', '2',               // 2 canales de audio (stereo)
      '-ar', '44100',           // Sample rate estándar
      '-b:a', '128k',           // Bitrate de audio
      '-movflags', '+faststart', // Optimizar para streaming
      '-pix_fmt', 'yuv420p',    // Formato de pixel compatible
      '-max_muxing_queue_size', '1024',
      '-y',                      // Sobrescribir sin preguntar
      outputPath
    ], {
      timeout: 180000 // 3 minutos máximo
    });

    // Leer buffer de salida
    const outputBuffer = await readFile(outputPath);

    return outputBuffer;
  } finally {
    // Limpiar archivos temporales
    try {
      await unlink(inputPath);
    } catch { /* ignorar */ }
    try {
      await unlink(outputPath);
    } catch { /* ignorar */ }
  }
}

/**
 * Verifica si un video necesita conversión
 * Analiza los codecs del video para determinar si es compatible con WhatsApp
 */
export async function needsConversion(inputBuffer: Buffer<ArrayBufferLike>): Promise<boolean> {
  const id = randomBytes(8).toString('hex');
  const inputPath = join(TMP_DIR, `probe_${id}.mp4`);

  try {
    await writeFile(inputPath, inputBuffer);

    // Usar ffprobe para analizar el video
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=codec_name',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      inputPath
    ], {
      timeout: 10000
    });

    const codec = stdout.trim().toLowerCase();

    // Si no es h264, necesita conversión
    return codec !== 'h264';
  } catch {
    // Si hay error al analizar, convertir por si acaso
    return true;
  } finally {
    try {
      await unlink(inputPath);
    } catch { /* ignorar */ }
  }
}

/**
 * Convierte video solo si es necesario
 */
export async function ensureWhatsAppCompatible(inputBuffer: Buffer<ArrayBufferLike>, forceConvert = false): Promise<Buffer> {
  // Si se fuerza la conversión o el video lo necesita
  const needs = forceConvert || await needsConversion(inputBuffer);

  if (needs) {
    console.log('🔄 Convirtiendo video para WhatsApp (Android compatible)...');
    const startTime = Date.now();
    const result = await convertVideoForWhatsApp(inputBuffer);
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`✅ Video convertido en ${duration}s (${(inputBuffer.length / 1024 / 1024).toFixed(1)}MB → ${(result.length / 1024 / 1024).toFixed(1)}MB)`);
    return result;
  }

  console.log('✅ Video ya es compatible con WhatsApp');
  return inputBuffer;
}

/**
 * Convierte video forzosamente (para YouTube y otros problemáticos)
 */
export async function forceConvertForWhatsApp(inputBuffer: Buffer<ArrayBufferLike>): Promise<Buffer> {
  return ensureWhatsAppCompatible(inputBuffer, true);
}

/**
 * Extrae el audio de un video y lo convierte a formato compatible con WhatsApp
 * Devuelve un buffer de audio en formato M4A/AAC
 */
export async function extractAudioFromVideo(inputBuffer: Buffer<ArrayBufferLike>): Promise<Buffer> {
  const id = randomBytes(8).toString('hex');
  const inputPath = join(TMP_DIR, `video_${id}.mp4`);
  const outputPath = join(TMP_DIR, `audio_${id}.m4a`);

  try {
    // Escribir buffer de entrada
    await writeFile(inputPath, inputBuffer);

    console.log('🎵 Extrayendo audio del video...');
    const startTime = Date.now();

    // Extraer audio con ffmpeg
    await execFileAsync('ffmpeg', [
      '-i', inputPath,
      '-vn',                    // Sin video
      '-c:a', 'aac',           // Codec AAC
      '-b:a', '192k',          // Bitrate de audio
      '-ar', '44100',          // Sample rate
      '-ac', '2',              // Stereo
      '-movflags', '+faststart',
      '-y',
      outputPath
    ], {
      timeout: 120000 // 2 minutos máximo
    });

    // Leer buffer de salida
    const outputBuffer = await readFile(outputPath);
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`✅ Audio extraído en ${duration}s (${(outputBuffer.length / 1024 / 1024).toFixed(1)}MB)`);

    return outputBuffer;
  } finally {
    // Limpiar archivos temporales
    try {
      await unlink(inputPath);
    } catch { /* ignorar */ }
    try {
      await unlink(outputPath);
    } catch { /* ignorar */ }
  }
}
