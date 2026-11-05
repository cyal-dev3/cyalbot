/**
 * Utilidades de moderación: detección de palabras prohibidas.
 *
 * La detección es por palabra completa e ignora acentos y mayúsculas, así
 * "puta" no dispara con "computadora" ni "culo" con "vínculo", pero sí
 * detecta "PUTA", "pùta" o "puta," con signos pegados.
 */

/** Minúsculas, sin acentos ni diacríticos. */
export function foldText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ñ/g, 'n');
}

/** Separa en palabras usando letras y dígitos Unicode; lo demás es separador. */
function tokenize(text: string): string[] {
  return foldText(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/**
 * Devuelve la primera palabra prohibida presente en el texto, o null.
 * Si una entrada de la lista tiene espacios se busca como frase.
 */
export function findBadWord(text: string, badWords: readonly string[]): string | null {
  if (!text || badWords.length === 0) return null;
  const tokens = tokenize(text);
  if (tokens.length === 0) return null;
  const joined = ` ${tokens.join(' ')} `;

  for (const raw of badWords) {
    const word = foldText(raw).trim();
    if (!word) continue;
    if (word.includes(' ')) {
      if (joined.includes(` ${word.split(/\s+/).join(' ')} `)) return raw;
    } else if (tokens.includes(word)) {
      return raw;
    }
  }
  return null;
}
