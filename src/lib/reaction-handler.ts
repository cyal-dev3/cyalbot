import type { WASocket } from 'baileys';
import type { Database } from './database.js';

const WIN_EMOJIS = new Set(['✅', '🟢']);
const LOSS_EMOJIS = new Set(['❌', '🔴']);

export function registerReactionHandler(conn: WASocket, db: Database): void {
  conn.ev.on('messages.reaction', async (reactions) => {
    for (const r of reactions) {
      try {
        const emoji = r.reaction?.text;
        if (!emoji || (!WIN_EMOJIS.has(emoji) && !LOSS_EMOJIS.has(emoji))) continue;

        const chatId = r.key.remoteJid;
        if (!chatId?.endsWith('@g.us')) continue;

        const messageId = r.key.id;
        if (!messageId) continue;

        const pick = db.getPickByMessageId(chatId, messageId);
        if (!pick || pick.status !== 'pending') continue;

        // Obtain the JID of who reacted
        const reactorJid = (r as any).reaction?.key?.participant
          || (r as any).key?.participant
          || (r as any).reaction?.key?.remoteJid;
        if (!reactorJid) continue;

        const canResolve = pick.createdBy === reactorJid
          || pick.createdBy === 'TELEGRAM_BRIDGE';
        if (!canResolve) continue;

        const won = WIN_EMOJIS.has(emoji);
        db.resolvePick(chatId, pick.id, won, reactorJid);

        await conn.sendMessage(chatId, {
          text: `${won ? '✅' : '❌'} Pick \`${pick.id.slice(-8)}\` de *${pick.tipsterOriginal}* resuelto por reacción.`
        });
      } catch (err) {
        console.error('Error en reaction-handler:', err);
      }
    }
  });
}
