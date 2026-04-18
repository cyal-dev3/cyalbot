import type { PluginHandler, MessageContext } from '../types/message.js';
import { getDatabase } from '../lib/database.js';
import type { BettingPick } from '../types/database.js';

export const myBetsPlugin: PluginHandler = {
  command: /^(misapuestas|mispicks|mybets|myplays)$/i,
  tags: ['betting'],
  help: ['misapuestas - Ver tus picks activos e historial personal'],

  handler: async (ctx: MessageContext) => {
    const { m } = ctx;
    const db = getDatabase();
    const me = m.sender;

    const chatIds = db.getAllChatIds();
    const mine: BettingPick[] = [];

    for (const cid of chatIds) {
      const sys = db.getBettingSystem(cid);
      if (!sys.enabled) continue;
      for (const p of sys.picks) {
        if (p.createdBy === me || p.followers.includes(me)) {
          mine.push(p);
        }
      }
    }

    const active = mine.filter(p => p.status === 'pending');
    const recent = mine
      .filter(p => p.status !== 'pending')
      .sort((a, b) => (b.resolvedAt || 0) - (a.resolvedAt || 0))
      .slice(0, 10);

    if (active.length === 0 && recent.length === 0) {
      return m.reply('📭 No tienes apuestas registradas.');
    }

    const userBet = db.getUserBetting(me);
    const { wonFollowed, lostFollowed, totalFollowed } = userBet.stats;
    const winrate = (wonFollowed + lostFollowed) > 0
      ? ((wonFollowed / (wonFollowed + lostFollowed)) * 100).toFixed(1)
      : '-';

    let msg = `🎰 *MIS APUESTAS*\n\n`;

    if (active.length > 0) {
      msg += `⏳ *ACTIVAS (${active.length})*\n`;
      for (const p of active) {
        const role = p.createdBy === me ? '[creador]' : '[seguidor]';
        msg += `• ${role} 🎫 *${p.tipsterOriginal}* — ${p.units}u — ID: \`${p.id.slice(-8)}\`\n`;
      }
      msg += '\n';
    }

    if (recent.length > 0) {
      msg += `📜 *RECIENTES (${recent.length})*\n`;
      for (const p of recent) {
        const icon = p.status === 'won' ? '✅' : '❌';
        const role = p.createdBy === me ? '[creador]' : '[seguidor]';
        msg += `• ${icon} ${role} 🎫 *${p.tipsterOriginal}* — ${p.units}u\n`;
      }
      msg += '\n';
    }

    msg +=
      `📊 *TOTALES*\n` +
      `✅ Ganados: ${wonFollowed} | ❌ Perdidos: ${lostFollowed}\n` +
      `🏆 Winrate: ${winrate}%`;

    await m.reply(msg);
  }
};
