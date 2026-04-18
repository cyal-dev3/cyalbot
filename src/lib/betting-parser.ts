import type { TipsterStats } from '../types/database.js';

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

export function buildTipsterStatCard(tipsterName: string, tipster: TipsterStats | null | undefined): string {
  const displayName = `*#${tipsterName.toUpperCase()}*`;

  if (!tipster || (tipster.wins + tipster.losses) === 0) {
    return `${displayName} | 🆕 *Nuevo Tipster*\n━━━━━━━━━━━━━━━━━━━━━━\n_Sin historial aún — sé el primero en seguirlo_`;
  }

  const total = tipster.wins + tipster.losses;
  const winrate = Math.round((tipster.wins / total) * 100);

  // Nivel basado en winrate
  let nivelEmoji: string;
  let nivelText: string;
  if (winrate < 35)      { nivelEmoji = '🚨'; nivelText = 'Tipster Deficiente'; }
  else if (winrate < 45) { nivelEmoji = '⚠️'; nivelText = 'Tipster Regular'; }
  else if (winrate < 55) { nivelEmoji = '📈'; nivelText = 'Tipster Promedio'; }
  else if (winrate < 65) { nivelEmoji = '💪'; nivelText = 'Tipster Bueno'; }
  else if (winrate < 75) { nivelEmoji = '🏆'; nivelText = 'Tipster Experto'; }
  else                   { nivelEmoji = '🌟'; nivelText = 'Tipster Élite'; }

  // Racha: 8 cuadros mostrando racha actual (más reciente a la izquierda)
  const streak = tipster.currentStreak;
  const BOXES = 8;
  let rachaStr: string;
  if (streak > 0) {
    const n = Math.min(streak, BOXES);
    rachaStr = '🟩'.repeat(n) + '⬜'.repeat(BOXES - n);
  } else if (streak < 0) {
    const n = Math.min(Math.abs(streak), BOXES);
    rachaStr = '🟥'.repeat(n) + '⬜'.repeat(BOXES - n);
  } else {
    rachaStr = '⬜'.repeat(BOXES);
  }

  return (
    `${displayName} | 💎 *${winrate}% Win Rate*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `✅ *G:* ${tipster.wins}  |  ❌ *P:* ${tipster.losses}  |  🏁 *Total:* ${total}\n` +
    `📊 *Racha:* ${rachaStr}\n` +
    `${nivelEmoji} *Nivel:* ${nivelText}`
  );
}
