import type { WASocket } from 'baileys';
import type { Database } from './database.js';

// Strip emoji variation selectors so ✅ and ✅︎ both match
function normalizeEmoji(e: string | null | undefined): string {
  return (e || '').replace(/\uFE0F|\uFE0E/g, '').trim();
}

const WIN  = new Set(['✅', '🟢'].map(normalizeEmoji));
const LOSS = new Set(['❌', '🔴'].map(normalizeEmoji));

export function registerReactionHandler(conn: WASocket, db: Database): void {
  conn.ev.on('messages.reaction', async (reactions) => {
    for (const r of reactions) {
      try {
        const emoji = normalizeEmoji(r.reaction?.text);
        const isWin  = WIN.has(emoji);
        const isLoss = LOSS.has(emoji);
        if (!isWin && !isLoss) continue;

        // r.key = key of the message being reacted to
        const chatId = r.key?.remoteJid;
        if (!chatId?.endsWith('@g.us')) continue;

        const messageId = r.key?.id;
        if (!messageId) continue;

        const pick = db.getPickByMessageId(chatId, messageId);
        if (!pick || pick.status !== 'pending') continue;

        // r.reaction.key = key of the reaction itself (sender info is here)
        const reactorJid = r.reaction?.key?.participant
          || r.reaction?.key?.remoteJid
          || '';
        if (!reactorJid) continue;

        // Allow: pick creator, any admin (TELEGRAM_BRIDGE acts as wildcard)
        const canResolve = pick.createdBy === 'TELEGRAM_BRIDGE'
          || pick.createdBy === reactorJid;
        if (!canResolve) continue;

        const won = isWin;
        db.resolvePick(chatId, pick.id, won, reactorJid);

        await conn.sendMessage(chatId, {
          text: `${won ? '✅' : '❌'} Pick ${pick.id.slice(-8)} de ${pick.tipsterOriginal} resuelto.`
        });
      } catch (err) {
        console.error('Error en reaction-handler:', err);
      }
    }
  });
}
