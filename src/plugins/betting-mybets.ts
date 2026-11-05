import type { PluginHandler } from '../types/message.js';
import type { BettingPick } from '../types/database.js';
import { getDatabase } from '../lib/database.js';

export const myBetsPlugin: PluginHandler = {
  command: ['misapuestas', 'mispicks', 'mybets', 'myplays'],
  tags: ['betting'],
  description: 'Tus picks activos e historial en todos los grupos',
  help: ['misapuestas - Ver tus picks activos e historial personal'],
  usage: ['misapuestas'],

  handler: async ({ m }) => {
    const db = getDatabase();
    const me = m.sender;

    const mine: BettingPick[] = [];
    for (const chatId of db.getAllChatIds()) {
      // Se lee sin crear: recorrer todos los chats no debe fabricar sistemas de betting vacíos.
      const system = db.betting.peekBettingSystem(chatId);
      if (!system?.enabled) continue;
      for (const pick of system.picks) {
        if (pick.createdBy === me || pick.followers.includes(me)) mine.push(pick);
      }
    }

    const active = mine.filter((p) => p.status === 'pending');
    const recent = mine
      .filter((p) => p.status !== 'pending')
      .sort((a, b) => (b.resolvedAt || 0) - (a.resolvedAt || 0))
      .slice(0, 10);

    if (active.length === 0 && recent.length === 0) {
      return m.reply('📭 No tienes apuestas registradas.');
    }

    const { wonFollowed, lostFollowed } = db.betting.getUserBetting(me).stats;
    const resolvedTotal = wonFollowed + lostFollowed;
    const winrate = resolvedTotal > 0 ? `${((wonFollowed / resolvedTotal) * 100).toFixed(1)}%` : '-';

    let msg = `🎰 *MIS APUESTAS*\n\n`;
    if (active.length > 0) {
      msg += `⏳ *Activas* (${active.length})\n`;
      for (const p of active) {
        msg += `• ${p.createdBy === me ? '[creador]' : '[seguidor]'} 🎫 ${p.tipsterOriginal} · ${p.units}u · id ${p.id.slice(-8)}\n`;
      }
      msg += '\n';
    }
    if (recent.length > 0) {
      msg += `📜 *Recientes* (${recent.length})\n`;
      for (const p of recent) {
        msg += `• ${p.status === 'won' ? '✅' : '❌'} ${p.createdBy === me ? '[creador]' : '[seguidor]'} 🎫 ${p.tipsterOriginal} · ${p.units}u\n`;
      }
      msg += '\n';
    }
    msg += `📊 *Totales*\n✅ Ganados: ${wonFollowed} · ❌ Perdidos: ${lostFollowed} · 🏆 Winrate: ${winrate}`;
    await m.reply(msg);
  },
};
