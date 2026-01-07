/**
 * 📜 Plugin de Misiones - RPG
 * Comandos: misiones, mision, reclamarmision
 */

import type { PluginHandler, MessageContext } from '../types/message.js';
import { getDatabase } from '../lib/database.js';
import { EMOJI, formatNumber, pickRandom } from '../lib/utils.js';
import { DAILY_QUESTS, WEEKLY_QUESTS, ITEMS, type Quest } from '../types/rpg.js';
import type { QuestProgress } from '../types/user.js';

/**
 * Tiempo de reset (milisegundos)
 */
const DAILY_RESET = 24 * 60 * 60 * 1000; // 24 horas
const WEEKLY_RESET = 7 * 24 * 60 * 60 * 1000; // 7 días

/**
 * Número de misiones asignadas
 */
const DAILY_QUEST_COUNT = 3;
const WEEKLY_QUEST_COUNT = 2;

/**
 * Asigna misiones aleatorias
 */
function assignRandomQuests(questPool: Quest[], count: number): QuestProgress[] {
  const shuffled = [...questPool].sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, count);

  return selected.map(quest => ({
    questId: quest.id,
    progress: 0,
    completed: false
  }));
}

/**
 * Obtiene información de una misión por ID
 */
function getQuestById(questId: string): Quest | null {
  return [...DAILY_QUESTS, ...WEEKLY_QUESTS].find(q => q.id === questId) || null;
}

/**
 * Genera barra de progreso
 */
function progressBar(current: number, max: number, size: number = 10): string {
  const filled = Math.min(size, Math.floor((current / max) * size));
  const empty = size - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

/**
 * Plugin: Misiones - Ver misiones activas
 */
export const misionesPlugin: PluginHandler = {
  command: ['misiones', 'quests', 'mision', 'quest', 'tareas'],
  tags: ['rpg'],
  help: [
    'misiones - Ver tus misiones diarias y semanales',
    'Completa objetivos para ganar recompensas extra'
  ],
  register: true,

  handler: async (ctx: MessageContext) => {
    const { m } = ctx;
    const db = getDatabase();
    const user = db.getUser(m.sender);

    const now = Date.now();

    // Verificar reset de misiones diarias
    if (now - user.lastDailyReset >= DAILY_RESET || user.dailyQuests.length === 0) {
      user.dailyQuests = assignRandomQuests(DAILY_QUESTS, DAILY_QUEST_COUNT);
      user.lastDailyReset = now;
      db.updateUser(m.sender, {
        dailyQuests: user.dailyQuests,
        lastDailyReset: user.lastDailyReset
      });
    }

    // Verificar reset de misiones semanales
    if (now - user.lastWeeklyReset >= WEEKLY_RESET || user.weeklyQuests.length === 0) {
      user.weeklyQuests = assignRandomQuests(WEEKLY_QUESTS, WEEKLY_QUEST_COUNT);
      user.lastWeeklyReset = now;
      db.updateUser(m.sender, {
        weeklyQuests: user.weeklyQuests,
        lastWeeklyReset: user.lastWeeklyReset
      });
    }

    let response = `📜 *MISIONES ACTIVAS*\n`;
    response += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

    // Misiones diarias
    response += `📅 *Misiones Diarias:*\n`;
    const dailyTimeLeft = DAILY_RESET - (now - user.lastDailyReset);
    const dailyHoursLeft = Math.floor(dailyTimeLeft / (60 * 60 * 1000));
    response += `   ⏰ Reset en: ${dailyHoursLeft}h\n\n`;

    let dailyClaimable = 0;
    for (const questProgress of user.dailyQuests) {
      const quest = getQuestById(questProgress.questId);
      if (!quest) continue;

      const progress = Math.min(questProgress.progress, quest.target);
      const isComplete = progress >= quest.target;
      const isClaimed = questProgress.completed && questProgress.claimedAt;

      if (isComplete && !isClaimed) dailyClaimable++;

      let status = isClaimed ? '✅' : (isComplete ? '🎁' : '⏳');
      response += `${status} ${quest.emoji} *${quest.name}*\n`;
      response += `   ${quest.description}\n`;
      response += `   [${progressBar(progress, quest.target, 8)}] ${progress}/${quest.target}\n`;

      if (!isClaimed) {
        response += `   🎁 ${formatNumber(quest.rewards.exp)} XP + ${formatNumber(quest.rewards.money)} 💰`;
        if (quest.rewards.diamonds) {
          response += ` + ${quest.rewards.diamonds} 💎`;
        }
        response += '\n';
      }
      response += '\n';
    }

    // Misiones semanales
    response += `📆 *Misiones Semanales:*\n`;
    const weeklyTimeLeft = WEEKLY_RESET - (now - user.lastWeeklyReset);
    const weeklyDaysLeft = Math.floor(weeklyTimeLeft / (24 * 60 * 60 * 1000));
    response += `   ⏰ Reset en: ${weeklyDaysLeft}d\n\n`;

    let weeklyClaimable = 0;
    for (const questProgress of user.weeklyQuests) {
      const quest = getQuestById(questProgress.questId);
      if (!quest) continue;

      const progress = Math.min(questProgress.progress, quest.target);
      const isComplete = progress >= quest.target;
      const isClaimed = questProgress.completed && questProgress.claimedAt;

      if (isComplete && !isClaimed) weeklyClaimable++;

      let status = isClaimed ? '✅' : (isComplete ? '🎁' : '⏳');
      response += `${status} ${quest.emoji} *${quest.name}*\n`;
      response += `   ${quest.description}\n`;
      response += `   [${progressBar(progress, quest.target, 8)}] ${progress}/${quest.target}\n`;

      if (!isClaimed) {
        response += `   🎁 ${formatNumber(quest.rewards.exp)} XP + ${formatNumber(quest.rewards.money)} 💰`;
        if (quest.rewards.diamonds) {
          response += ` + ${quest.rewards.diamonds} 💎`;
        }
        if (quest.rewards.items && quest.rewards.items.length > 0) {
          response += ` + Items`;
        }
        response += '\n';
      }
      response += '\n';
    }

    response += `━━━━━━━━━━━━━━━━━━━━━\n`;

    const totalClaimable = dailyClaimable + weeklyClaimable;
    if (totalClaimable > 0) {
      response += `🎉 *¡Tienes ${totalClaimable} misión(es) completada(s)!*\n`;
      response += `📝 Usa */reclamarmision* para obtener recompensas.`;
    } else {
      response += `💡 Completa misiones para ganar recompensas extra.`;
    }

    await m.reply(response);
  }
};

/**
 * Plugin: Reclamar Misión - Reclamar recompensas de misiones completadas
 */
export const reclamarMisionPlugin: PluginHandler = {
  command: ['reclamarmision', 'claimquest', 'reclamarquest'],
  tags: ['rpg'],
  help: ['reclamarmision - Reclama todas las misiones completadas'],
  register: true,

  handler: async (ctx: MessageContext) => {
    const { m } = ctx;
    const db = getDatabase();
    const user = db.getUser(m.sender);

    let totalExp = 0;
    let totalMoney = 0;
    let totalDiamonds = 0;
    const itemsGained: string[] = [];
    let claimedCount = 0;

    // Procesar misiones diarias
    for (const questProgress of user.dailyQuests) {
      const quest = getQuestById(questProgress.questId);
      if (!quest) continue;

      const isComplete = questProgress.progress >= quest.target;
      const isClaimed = questProgress.completed && questProgress.claimedAt;

      if (isComplete && !isClaimed) {
        questProgress.completed = true;
        questProgress.claimedAt = Date.now();

        totalExp += quest.rewards.exp;
        totalMoney += quest.rewards.money;
        if (quest.rewards.diamonds) {
          totalDiamonds += quest.rewards.diamonds;
        }
        claimedCount++;

        if (quest.rewards.items) {
          for (const itemId of quest.rewards.items) {
            itemsGained.push(itemId);
          }
        }
      }
    }

    // Procesar misiones semanales
    for (const questProgress of user.weeklyQuests) {
      const quest = getQuestById(questProgress.questId);
      if (!quest) continue;

      const isComplete = questProgress.progress >= quest.target;
      const isClaimed = questProgress.completed && questProgress.claimedAt;

      if (isComplete && !isClaimed) {
        questProgress.completed = true;
        questProgress.claimedAt = Date.now();

        totalExp += quest.rewards.exp;
        totalMoney += quest.rewards.money;
        if (quest.rewards.diamonds) {
          totalDiamonds += quest.rewards.diamonds;
        }
        claimedCount++;

        if (quest.rewards.items) {
          for (const itemId of quest.rewards.items) {
            itemsGained.push(itemId);
          }
        }
      }
    }

    if (claimedCount === 0) {
      await m.reply(
        `${EMOJI.info} No tienes misiones completadas para reclamar.\n\n` +
        `💡 Usa */misiones* para ver tu progreso.`
      );
      return;
    }

    // Agregar items al inventario
    for (const itemId of itemsGained) {
      const existingItem = user.inventory.find(i => i.itemId === itemId);
      if (existingItem) {
        existingItem.quantity++;
      } else {
        user.inventory.push({ itemId, quantity: 1 });
      }
    }

    // Guardar cambios
    db.updateUser(m.sender, {
      exp: user.exp + totalExp,
      money: user.money + totalMoney,
      limit: user.limit + totalDiamonds,
      dailyQuests: user.dailyQuests,
      weeklyQuests: user.weeklyQuests,
      inventory: user.inventory
    });

    let response = `🎉 *¡MISIONES RECLAMADAS!*\n`;
    response += `━━━━━━━━━━━━━━━━━━━━━\n\n`;
    response += `📜 Misiones completadas: *${claimedCount}*\n\n`;

    response += `🎁 *Recompensas:*\n`;
    response += `   ${EMOJI.exp} +${formatNumber(totalExp)} XP\n`;
    response += `   ${EMOJI.coin} +${formatNumber(totalMoney)} monedas\n`;
    if (totalDiamonds > 0) {
      response += `   💎 +${formatNumber(totalDiamonds)} diamantes\n`;
    }

    if (itemsGained.length > 0) {
      response += `   📦 Items:\n`;
      for (const itemId of itemsGained) {
        const item = ITEMS[itemId];
        if (item) {
          response += `      ${item.emoji} ${item.name}\n`;
        }
      }
    }

    response += `\n━━━━━━━━━━━━━━━━━━━━━\n`;
    response += `💎 Total diamantes: *${formatNumber(user.limit + totalDiamonds)}*\n`;
    response += `💡 Sigue completando misiones para más recompensas!`;

    await m.reply(response);
    await m.react('🎉');
  }
};

/**
 * Función auxiliar para actualizar progreso de misiones
 * Esta función debe ser llamada desde otros plugins
 */
export function updateQuestProgress(
  db: ReturnType<typeof getDatabase>,
  jid: string,
  objective: 'work' | 'combat' | 'dungeon' | 'rob' | 'spend' | 'earn',
  amount: number
): void {
  const user = db.getUser(jid);

  // Mapeo de objetivos a IDs de misiones
  const objectiveToQuestPattern: Record<string, string> = {
    work: 'work',
    combat: 'combat',
    dungeon: 'dungeon',
    rob: 'rob',
    spend: 'spend',
    earn: 'earn'
  };

  const pattern = objectiveToQuestPattern[objective];
  if (!pattern) return;

  let updated = false;

  // Actualizar misiones diarias
  for (const questProgress of user.dailyQuests) {
    if (questProgress.questId.includes(pattern) && !questProgress.claimedAt) {
      questProgress.progress += amount;
      updated = true;
    }
  }

  // Actualizar misiones semanales
  for (const questProgress of user.weeklyQuests) {
    if (questProgress.questId.includes(pattern) && !questProgress.claimedAt) {
      questProgress.progress += amount;
      updated = true;
    }
  }

  if (updated) {
    db.updateUser(jid, {
      dailyQuests: user.dailyQuests,
      weeklyQuests: user.weeklyQuests
    });
  }
}

export default misionesPlugin;
