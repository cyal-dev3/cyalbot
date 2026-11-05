import { readFile, writeFile } from 'node:fs/promises';
import { runFfmpeg, runFfprobe, withTempFiles } from './ffmpeg.js';
import { createLogger } from './logger.js';

const log = createLogger('media');

export interface VideoProbe {
  videoCodec: string | null;
  audioCodec: string | null;
  pixFmt: string | null;
  /** Nombres del demuxer separados por coma, p. ej. "mov,mp4,m4a,3gp,3g2,mj2". */
  format: string;
  width: number;
  height: number;
  duration: number;
}

interface FfprobeJson {
  streams?: { codec_type?: string; codec_name?: string; pix_fmt?: string; width?: number; height?: number }[];
  format?: { format_name?: string; duration?: string };
}

/** Un solo ffprobe: códecs de video y audio, pix_fmt, contenedor, dimensiones y duración. */
export async function probeVideo(path: string): Promise<VideoProbe> {
  const stdout = await runFfprobe([
    '-show_entries', 'stream=codec_type,codec_name,pix_fmt,width,height:format=format_name,duration',
    '-of', 'json',
    path,
  ]);
  const json = JSON.parse(stdout) as FfprobeJson;
  const video = json.streams?.find((s) => s.codec_type === 'video');
  const audio = json.streams?.find((s) => s.codec_type === 'audio');
  return {
    videoCodec: video?.codec_name?.toLowerCase() ?? null,
    audioCodec: audio?.codec_name?.toLowerCase() ?? null,
    pixFmt: video?.pix_fmt?.toLowerCase() ?? null,
    format: json.format?.format_name ?? '',
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    duration: Number(json.format?.duration ?? 0) || 0,
  };
}

/** WhatsApp reproduce en todo dispositivo H.264 yuv420p + AAC dentro de mp4. */
export function isWhatsAppCompatible(probe: VideoProbe): boolean {
  return (
    probe.videoCodec === 'h264' &&
    probe.pixFmt === 'yuv420p' &&
    (probe.audioCodec === null || probe.audioCodec === 'aac') &&
    probe.format.split(',').includes('mp4')
  );
}

export interface ConvertOptions {
  /** Factor de calidad de libx264 (más alto = más pequeño). */
  crf?: number;
  /** Alto máximo; se reescala manteniendo proporción y dimensiones pares. */
  maxHeight?: number;
  timeoutMs?: number;
}

function conversionArgs(input: string, output: string, options: ConvertOptions): string[] {
  const scale = options.maxHeight
    ? `scale=-2:'min(${options.maxHeight},ih)'`
    : 'scale=trunc(iw/2)*2:trunc(ih/2)*2';
  return [
    '-i', input,
    '-c:v', 'libx264', '-profile:v', 'main', '-level', '3.1', '-preset', 'veryfast',
    '-crf', String(options.crf ?? 26),
    '-vf', scale,
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-ar', '44100',
    '-movflags', '+faststart',
    '-max_muxing_queue_size', '1024',
    output,
  ];
}

/** Recodifica a H.264/AAC mp4 sin comprobar nada. */
export function convertVideoForWhatsApp(input: Buffer, options: ConvertOptions = {}): Promise<Buffer> {
  return withTempFiles(['in', 'mp4'], async ([inPath, outPath]) => {
    await writeFile(inPath, input);
    await runFfmpeg(conversionArgs(inPath, outPath, options), { timeoutMs: options.timeoutMs ?? 180_000 });
    return readFile(outPath);
  });
}

/** true si el video no es reproducible tal cual en WhatsApp (o si ffprobe no pudo leerlo). */
export function needsConversion(input: Buffer): Promise<boolean> {
  return withTempFiles(['in'], async ([inPath]) => {
    await writeFile(inPath, input);
    try {
      return !isWhatsAppCompatible(await probeVideo(inPath));
    } catch {
      return true;
    }
  });
}

/** Convierte solo si hace falta; usa el mismo temporal para inspeccionar y recodificar. */
export function ensureWhatsAppCompatible(input: Buffer, force = false): Promise<Buffer> {
  return withTempFiles(['in', 'mp4'], async ([inPath, outPath]) => {
    await writeFile(inPath, input);
    if (!force) {
      try {
        if (isWhatsAppCompatible(await probeVideo(inPath))) return input;
      } catch (error) {
        log.debug('ffprobe no pudo leer el video, se convierte:', error instanceof Error ? error.message : error);
      }
    }
    const started = Date.now();
    await runFfmpeg(conversionArgs(inPath, outPath, {}), { timeoutMs: 180_000 });
    const out = await readFile(outPath);
    log.debug(`video convertido en ${((Date.now() - started) / 1000).toFixed(1)} s (${input.length} -> ${out.length} bytes)`);
    return out;
  });
}

/** Comprime para que quepa en WhatsApp: crf 30 y 480p por defecto. */
export function compressVideo(input: Buffer, options: ConvertOptions = {}): Promise<Buffer> {
  return convertVideoForWhatsApp(input, { crf: 30, maxHeight: 480, ...options });
}

export type AudioFormat = 'mp3' | 'm4a';

/** Extrae la pista de audio; mp3 por defecto (lo que WhatsApp muestra como audio normal en todo dispositivo). */
export function extractAudioFromVideo(input: Buffer, format: AudioFormat = 'mp3'): Promise<Buffer> {
  const codecArgs = format === 'mp3'
    ? ['-c:a', 'libmp3lame', '-q:a', '4']
    : ['-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart'];
  return withTempFiles(['in', format], async ([inPath, outPath]) => {
    await writeFile(inPath, input);
    await runFfmpeg(['-i', inPath, '-vn', ...codecArgs, '-ar', '44100', '-ac', '2', outPath], { timeoutMs: 120_000 });
    return readFile(outPath);
  });
}
