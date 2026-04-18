// Matches #TipsterName anywhere in text.
// Name = letter followed by 2+ alphanumeric/accented chars (excludes #1, #ok, etc.)
export const TIPSTER_REGEX = /#([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ0-9]{2,})/i;

export function extractTipsterName(text: string | undefined | null): string | null {
  if (!text) return null;
  const m = text.match(TIPSTER_REGEX);
  if (!m) return null;
  return m[1].trim() || null;
}

// Fallback para mensajes históricos con 🎫 — solo para /pick y /tipster add/remove.
// NO usar en el Telegram bridge (mensajes nuevos ya no traen 🎫).
export function extractTipsterNameLegacy(text: string | undefined | null): string | null {
  const modern = extractTipsterName(text);
  if (modern) return modern;
  if (!text) return null;
  const m = text.match(/🎫\s*([^\n]+)/);
  return m ? m[1].trim() || null : null;
}
