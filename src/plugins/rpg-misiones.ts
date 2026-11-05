import type { PluginHandler, MessageContext } from '../types/message.js';
import { getDatabase, type Database } from '../lib/database.js';
import { EMOJI, msToTime } from '../lib/utils.js';
import {
  updateQuestProgress as updateQuestProgressImpl,
  claimCompletedQuests,
  ensureQuestsFresh,
  renderQuestList,
  DAILY_RESET,
  WEEKLY_RESET,
  type QuestGoal
} from '../lib/quests.js';
import { formatReward } from '../lib/rpg-actions.js';

/**
 * Compatibilidad: rpg-atacar/dungeon/robar importan updateQuestProgress desde
 * aquí. La implementación vive en lib/quests.ts.
 * @deprecated Importa updateQuestProgress de '../lib/quests.js'.
 */
export function updateQuestProgress(db: Database, jid: string, objective: QuestGoal, amount: number): void {
  updateQuestProgressImpl(db, jid, objective, amount);
}

async function replyClaim(ctx: MessageContext): Promise<void> {
  const { m, usedPrefix } = ctx;
  const result = claimCompletedQuests(getDatabase(), m.sender);

  if (result.completed.length === 0) {
    return void m.reply(
      `${EMOJI.info} No tienes misiones completadas pendientes de cobrar.\n\n` +
      `💡 Las misiones se cobran solas al completarse; usa *${usedPrefix}misiones* para ver tu progreso.`
    );
  }

  await m.reply(formatReward(ctx, `🎉 ${result.completed.length} misión(es) cobrada(s)`, result.lines));
  await m.react('🎉');
}

export const misionesPlugin: PluginHandler = {
  command: ['misiones', 'quests', 'mision', 'quest', 'tareas'],
  tags: ['rpg'],
  help: [
    'misiones - Ver tus misiones diarias y semanales',
    'misiones reclamar - Cobrar misiones completadas que sigan pendientes',
    'Las misiones se cobran automáticamente al completarse'
  ],
  usage: ['misiones', 'misiones reclamar'],
  register: true,

  handler: async (ctx: MessageContext) => {
    const { m, args, usedPrefix } = ctx;
    const sub = (args[0] ?? '').toLowerCase();
    if (['reclamar', 'claim', 'cobrar'].includes(sub)) return replyClaim(ctx);

    const db = getDatabase();
    const user = db.getUser(m.sender);
    const now = Date.now();

    if (ensureQuestsFresh(user, now)) {
      db.updateUser(m.sender, {
        dailyQuests: user.dailyQuests,
        weeklyQuests: user.weeklyQuests,
        lastDailyReset: user.lastDailyReset,
        lastWeeklyReset: user.lastWeeklyReset
      });
    }

    const daily = renderQuestList('📅 *Misiones Diarias:*', user.dailyQuests, msToTime(DAILY_RESET - (now - user.lastDailyReset)));
    const weekly = renderQuestList('📆 *Misiones Semanales:*', user.weeklyQuests, msToTime(WEEKLY_RESET - (now - user.lastWeeklyReset)));

    let text = `📜 *MISIONES ACTIVAS*\n━━━━━━━━━━━━━━━━━━━━━\n\n${daily.text}${weekly.text}━━━━━━━━━━━━━━━━━━━━━\n`;
    const pending = daily.pending + weekly.pending;
    text += pending > 0
      ? `🎉 *Tienes ${pending} misión(es) por cobrar.* Usa *${usedPrefix}misiones reclamar*.`
      : `💡 Las recompensas se entregan solas al completar cada misión.`;

    await m.reply(text);
  }
};

export const reclamarMisionPlugin: PluginHandler = {
  command: ['reclamarmision', 'claimquest', 'reclamarquest'],
  tags: ['rpg'],
  help: ['reclamarmision - Cobra las misiones completadas pendientes'],
  usage: ['reclamarmision'],
  register: true,
  handler: replyClaim
};

export default misionesPlugin;
