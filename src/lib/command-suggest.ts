/**
 * Alias de comandos y sugerencias para comandos mal escritos.
 * Vive fuera de plugins/ para que handler, ai y menu lo importen sin ciclos.
 */

import type { PluginHandler } from '../types/message.js';

/** Regex del estilo /^(a|b|c)$/i: una sola alternancia literal entre anclas. */
const SIMPLE_ALTERNATION = /^\^\(\?:?([^()]+)\)\$$/;

function unescapeAlias(alias: string): string {
  return alias.replace(/\\(.)/g, '$1');
}

/**
 * Alias que responde un plugin. Para RegExp solo se expanden alternancias
 * simples (`^(a|b)$`); si tiene cuantificadores u otros metacaracteres se
 * devuelve vacío y el handler lo evalúa con `test()`.
 */
export function commandAliases(plugin: PluginHandler): string[] {
  if (Array.isArray(plugin.command)) {
    return plugin.command.map((c) => c.toLowerCase());
  }
  const match = plugin.command.source.match(SIMPLE_ALTERNATION);
  if (!match) return [];
  const parts = match[1].split('|').map(unescapeAlias);
  if (parts.some((p) => p.length === 0 || /[.*+?[\]{}^$]/.test(p))) return [];
  return parts.map((p) => p.toLowerCase());
}

/** true si el comando del plugin puede indexarse por alias (array o alternancia simple). */
export function isSimpleCommand(plugin: PluginHandler): boolean {
  return Array.isArray(plugin.command) || commandAliases(plugin).length > 0;
}

/** Distancia de Damerau-Levenshtein (inserción, borrado, sustitución y transposición). */
export function damerauLevenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let i = 0; i < rows; i++) d[i][0] = i;
  for (let j = 0; j < cols; j++) d[0][j] = j;

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}

function fold(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function commonPrefixLength(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

export interface SuggestOptions {
  /** Alias principales (primer alias de cada plugin); se prefieren ante empate. */
  primary?: ReadonlySet<string>;
  /** Distancia máxima aceptada. Por defecto 2. */
  maxDistance?: number;
  /** Prefijo común mínimo para aceptar sin mirar la distancia. Por defecto 4. */
  minPrefix?: number;
}

/**
 * Sugiere el alias más parecido a `cmd`, o null si ninguno se acerca.
 * Acepta distancia <= 2 (sin tildes ni mayúsculas) o prefijo común >= 4;
 * ante empate prefiere el alias principal y luego el más corto.
 */
export function suggestCommand(cmd: string, aliases: readonly string[], options: SuggestOptions = {}): string | null {
  const target = fold(cmd.trim());
  if (!target) return null;
  // En palabras cortas una distancia de 2 reescribe casi todo ("xyz" -> "yo"),
  // así que el margen se acota a la mitad de la longitud.
  const maxDistance = Math.min(options.maxDistance ?? 2, Math.floor((target.length - 1) / 2));
  const minPrefix = options.minPrefix ?? 4;
  const primary = options.primary;

  let best: { alias: string; distance: number; isPrimary: boolean } | null = null;
  const seen = new Set<string>();
  for (const alias of aliases) {
    const folded = fold(alias);
    if (!folded || seen.has(folded)) continue;
    seen.add(folded);

    const distance = damerauLevenshtein(target, folded);
    const prefix = commonPrefixLength(target, folded);
    if (distance > maxDistance && prefix < minPrefix) continue;

    const isPrimary = primary?.has(alias) ?? false;
    const candidate = { alias, distance, isPrimary };
    if (!best) {
      best = candidate;
      continue;
    }
    if (distance !== best.distance) {
      if (distance < best.distance) best = candidate;
      continue;
    }
    if (isPrimary !== best.isPrimary) {
      if (isPrimary) best = candidate;
      continue;
    }
    if (alias.length < best.alias.length) best = candidate;
  }
  return best?.alias ?? null;
}
