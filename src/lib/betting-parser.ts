export const TIPSTER_REGEX = /^#([^\s][^\n]*)/;

export function extractTipsterName(text: string | undefined | null): string | null {
  if (!text) return null;
  const firstLine = text.split('\n', 1)[0];
  const m = firstLine.match(TIPSTER_REGEX);
  if (!m) return null;
  const name = m[1].replace(/^#+/, '').trim();
  return name || null;
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
