import type { PluginHandler } from '../types/message.js';
import type { MessageHandler } from '../handler.js';
import { getDatabase } from '../lib/database.js';
import { mentionTag } from '../lib/utils.js';
import { listActiveTables, closeAllTables } from '../lib/games/session.js';
import { enter, playerName } from '../lib/games/common.js';

/** Muestra la mesa activa del grupo, sea del juego que sea, y los segundos de la fase. */
export const mesaPlugin: PluginHandler = {
  command: ['mesa', 'mesas'],
  description: 'Ver la mesa activa del grupo y el tiempo de la fase',
  category: 'casino',
  async handler(ctx) {
    enter(ctx);
    const tables = listActiveTables(ctx.m.chat);
    if (tables.length === 0) {
      await ctx.m.reply(`No hay ninguna mesa abierta aquí. Usa *${ctx.usedPrefix}casino* para ver los juegos.`);
      return;
    }
    const db = getDatabase();
    const mentions: string[] = [];
    const blocks = tables.map((t) => {
      mentions.push(...t.players);
      const players = t.players.length === 0 ? 'sin jugadores' : t.players.map((j) => `${mentionTag(j)} (${playerName(j, null, db)})`).join(', ');
      const time = t.remainingSeconds > 0 ? ` · ${t.remainingSeconds} s` : '';
      return `🎲 *${t.label}* — fase: ${t.phase}${time}\n👥 ${players}`;
    });
    await ctx.conn.sendMessage(ctx.m.chat, { text: blocks.join('\n\n'), mentions }, { quoted: ctx.m.rawMessage });
  },
};

/** Cierra todas las mesas del grupo devolviendo las apuestas (admin u owner). */
export const cerrarMesaPlugin: PluginHandler = {
  command: ['cerrarmesa', 'cerrarmesas'],
  description: 'Cerrar la mesa del grupo y reembolsar apuestas',
  category: 'casino',
  group: true,
  admin: true,
  async handler(ctx) {
    enter(ctx);
    const closed = closeAllTables(ctx.m.chat);
    if (closed.length === 0) {
      await ctx.m.reply('No había mesas abiertas.');
      return;
    }
    await ctx.m.reply(`🧹 Mesa cerrada (${closed.join(', ')}). Las apuestas fueron reembolsadas.`);
  },
};

export function registerMesa(handler: MessageHandler): void {
  handler.registerPlugin('game-mesa', mesaPlugin);
  handler.registerPlugin('game-cerrarmesa', cerrarMesaPlugin);
}
