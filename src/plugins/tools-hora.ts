import type { PluginHandler } from '../types/message.js';
import { normalizeText } from '../lib/utils.js';

/** Alias cortos que la gente escribe en lugar del nombre IANA. */
const ZONE_ALIASES: Record<string, string> = {
  mx: 'America/Mexico_City', mexico: 'America/Mexico_City', cdmx: 'America/Mexico_City',
  es: 'Europe/Madrid', espana: 'Europe/Madrid', madrid: 'Europe/Madrid',
  ar: 'America/Argentina/Buenos_Aires', argentina: 'America/Argentina/Buenos_Aires', 'buenos aires': 'America/Argentina/Buenos_Aires',
  co: 'America/Bogota', colombia: 'America/Bogota', bogota: 'America/Bogota',
  pe: 'America/Lima', peru: 'America/Lima', lima: 'America/Lima',
  cl: 'America/Santiago', chile: 'America/Santiago', santiago: 'America/Santiago',
  ve: 'America/Caracas', venezuela: 'America/Caracas', caracas: 'America/Caracas',
  ec: 'America/Guayaquil', ecuador: 'America/Guayaquil', quito: 'America/Guayaquil',
  uy: 'America/Montevideo', uruguay: 'America/Montevideo', montevideo: 'America/Montevideo',
  py: 'America/Asuncion', paraguay: 'America/Asuncion', asuncion: 'America/Asuncion',
  bo: 'America/La_Paz', bolivia: 'America/La_Paz', 'la paz': 'America/La_Paz',
  us: 'America/New_York', usa: 'America/New_York', eeuu: 'America/New_York', ny: 'America/New_York', 'nueva york': 'America/New_York',
  la: 'America/Los_Angeles', 'los angeles': 'America/Los_Angeles', california: 'America/Los_Angeles',
  uk: 'Europe/London', londres: 'Europe/London', london: 'Europe/London',
  jp: 'Asia/Tokyo', japon: 'Asia/Tokyo', tokio: 'Asia/Tokyo', tokyo: 'Asia/Tokyo',
  cn: 'Asia/Shanghai', china: 'Asia/Shanghai', pekin: 'Asia/Shanghai', beijing: 'Asia/Shanghai',
  in: 'Asia/Kolkata', india: 'Asia/Kolkata',
};

const ZONE_LABELS: Record<string, string> = {
  'America/Mexico_City': 'México',
  'Europe/Madrid': 'España',
  'America/Argentina/Buenos_Aires': 'Argentina',
  'America/Bogota': 'Colombia',
  'America/Lima': 'Perú',
  'America/Santiago': 'Chile',
  'America/Caracas': 'Venezuela',
  'America/Guayaquil': 'Ecuador',
  'America/Montevideo': 'Uruguay',
  'America/Asuncion': 'Paraguay',
  'America/La_Paz': 'Bolivia',
  'America/New_York': 'Nueva York',
  'America/Los_Angeles': 'Los Ángeles',
  'Europe/London': 'Londres',
  'Asia/Tokyo': 'Japón',
  'Asia/Shanghai': 'China',
  'Asia/Kolkata': 'India',
};

/** Zonas que se muestran cuando no se pide ninguna. */
const DEFAULT_ZONES = ['America/Mexico_City', 'Europe/Madrid', 'America/Argentina/Buenos_Aires', 'America/Bogota', 'America/Lima', 'America/New_York'];

const SUPPORTED = new Set(Intl.supportedValuesOf('timeZone'));
const SUPPORTED_LOWER = new Map([...SUPPORTED].map((z) => [z.toLowerCase(), z]));

/** Resuelve alias, nombre IANA (sin distinguir mayúsculas) o ciudad final ("mexico_city"). */
export function resolveZone(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  const alias = ZONE_ALIASES[normalizeText(raw).replace(/_/g, ' ')];
  if (alias && SUPPORTED.has(alias)) return alias;
  const exact = SUPPORTED_LOWER.get(raw.toLowerCase().replace(/ /g, '_'));
  if (exact) return exact;
  const city = normalizeText(raw).replace(/ /g, '_');
  for (const [lower, zone] of SUPPORTED_LOWER) {
    if (lower.split('/').pop() === city) return zone;
  }
  return null;
}

export interface ZoneTime {
  zone: string;
  label: string;
  /** "lun 10:30" */
  time: string;
  /** "5 de noviembre" */
  date: string;
  /** Desfase respecto a UTC, p. ej. "UTC-6" */
  offset: string;
}

export function getTimeIn(zoneOrAlias: string, now = new Date()): ZoneTime | null {
  const zone = resolveZone(zoneOrAlias);
  if (!zone) return null;
  const time = new Intl.DateTimeFormat('es-MX', { timeZone: zone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
  const date = new Intl.DateTimeFormat('es-MX', { timeZone: zone, day: 'numeric', month: 'long' }).format(now);
  const offsetPart = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' })
    .formatToParts(now)
    .find((p) => p.type === 'timeZoneName')?.value ?? '';
  const offset = offsetPart.replace('GMT', 'UTC') || 'UTC';
  return { zone, label: ZONE_LABELS[zone] ?? zone.split('/').pop()!.replace(/_/g, ' '), time, date, offset };
}

export function listZoneAliases(): string[] {
  return [...new Set(Object.keys(ZONE_ALIASES).filter((k) => k.length <= 4))];
}

export const horaPlugin: PluginHandler = {
  command: ['hora', 'time', 'horario'],
  description: 'Hora actual en una zona horaria o país',
  category: 'herramientas',
  help: ['hora [zona] - Hora actual en varias ciudades o en la zona indicada (mx, es, ar, co, ny, jp...)'],
  usage: ['hora', 'hora es', 'hora Asia/Tokyo'],

  handler: async ({ m, text, usedPrefix }) => {
    const now = new Date();
    if (!text.trim()) {
      const lines = DEFAULT_ZONES.map((z) => getTimeIn(z, now)).filter((t): t is ZoneTime => t !== null)
        .map((t) => `• *${t.label}:* ${t.time} (${t.offset})`);
      await m.reply(`🕒 *Hora actual*\n${lines.join('\n')}\n\n_${usedPrefix}hora <zona> para otra: ${listZoneAliases().slice(0, 12).join(', ')}..._`);
      return;
    }
    const result = getTimeIn(text, now);
    if (!result) {
      await m.reply(`No conozco la zona "${text.trim()}". Prueba con un alias (${listZoneAliases().slice(0, 10).join(', ')}) o un nombre IANA como Europe/Madrid.`);
      return;
    }
    await m.reply(`🕒 *${result.label}* (${result.zone})\n${result.time}, ${result.date} · ${result.offset}`);
  },
};
