/**
 * Resolución de picks de apuestas por reacción: ✅/🟢 gana, ❌/🔴 pierde.
 */

import type { WASocket } from 'baileys';
import type { Database } from './database.js';
import { createLogger } from './logger.js';
import { isOwnerId, sameUser } from '../config.js';
import { getGroupMetadataCached, isGroupAdmin } from './group-events.js';

const log = createLogger('betting');

/** Quita los selectores de variante para que ✅ y ✅︎ cuenten igual. */
function normalizeEmoji(e: string | null | undefined): string {
  return (e || '').replace(/️|︎/g, '').trim();
}

const WIN = new Set(['✅', '🟢'].map(normalizeEmoji));
const LOSS = new Set(['❌', '🔴'].map(normalizeEmoji));

export function registerReactionHandler(conn: WASocket, db: Database): void {
  conn.ev.on('messages.reaction', async (reactions) => {
    for (const r of reactions) {
      try {
        const emoji = normalizeEmoji(r.reaction?.text);
        const isWin = WIN.has(emoji);
        if (!isWin && !LOSS.has(emoji)) continue;

        // r.key es el mensaje reaccionado; r.reaction.key identifica a quien reaccionó.
        const chatId = r.key?.remoteJid;
        const messageId = r.key?.id;
        if (!chatId?.endsWith('@g.us') || !messageId) continue;

        const pick = db.betting.getPickByMessageId(chatId, messageId);
        if (!pick || pick.status !== 'pending') continue;

        const reactorJid = r.reaction?.key?.participant || r.reaction?.key?.remoteJid || '';
        if (!reactorJid) continue;

        // Los picks del puente de Telegram no tienen dueño: solo un admin del grupo o un owner los cierra.
        let canResolve = sameUser(pick.createdBy, reactorJid) || isOwnerId(reactorJid);
        if (!canResolve && pick.createdBy === 'TELEGRAM_BRIDGE') {
          canResolve = isGroupAdmin(await getGroupMetadataCached(conn, chatId), reactorJid);
        }
        if (!canResolve) continue;

        db.betting.resolvePick(chatId, pick.id, isWin, reactorJid);
        await conn.sendMessage(chatId, {
          text: `${isWin ? '✅' : '❌'} Pick ${pick.id.slice(-8)} de ${pick.tipsterOriginal} resuelto.`,
        });
      } catch (error) {
        log.error('error resolviendo pick por reacción:', error);
      }
    }
  });
}
