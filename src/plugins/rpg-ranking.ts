/**
 * Plugin de Rankings y Logros - RPG
 * Comandos: ranking, top, logros, achievements
 */

import type { MessageHandler } from '../handler.js';
import type { PluginHandler, MessageContext } from '../types/message.js';
import { getDatabase } from '../lib/database.js';
import { EMOJI, formatNumber, matchesIgnoreAccents } from '../lib/utils.js';
import { ACHIEVEMENTS, CLASSES, type Achievement } from '../types/rpg.js';
import type { UserRPG } from '../types/user.js';

/**
 * Medallas para posiciones
 */
const POSITION_MEDALS = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

/**
 * Plugin: Ranking - Ver top jugadores
 */
const rankingPlugin: PluginHandler = {
  command: ['ranking', 'top', 'leaderboard', 'mejores'],
  tags: ['rpg'],
  help: [
    'ranking - Ver top 10 por nivel',
    'ranking dinero - Top por dinero',
    'ranking kills - Top por monstruos derrotados',
    'ranking pvp - Top por victorias PvP'
  ],
  register: true,

  handler: async (ctx: MessageContext) => {
    const { m, text } = ctx;
    const db = getDatabase();
    const currentUser = db.getUser(m.sender);

    const category = text.toLowerCase().trim();

    // Obtener usuarios registrados
    const registeredUsers = db.getRegisteredUsers();

    if (registeredUsers.length === 0) {
      await m.reply(`${EMOJI.info} Aún no hay jugadores registrados.`);
      return;
    }

    type SortFn = (a: [string, UserRPG], b: [string, UserRPG]) => number;
    let sortFn: SortFn;
    let title: string;
    let valueGetter: (user: UserRPG) => string;

    switch (category) {
      case 'dinero':
      case 'money':
      case 'oro':
      case 'gold':
        sortFn = ([, a], [, b]) => b.money - a.money;
        title = '💰 TOP DINERO';
        valueGetter = (u) => `${formatNumber(u.money)} monedas`;
        break;

      case 'kills':
      case 'muertes':
      case 'monstruos':
        sortFn = ([, a], [, b]) => b.combatStats.totalKills - a.combatStats.totalKills;
        title = '💀 TOP MONSTRUOS DERROTADOS';
        valueGetter = (u) => `${formatNumber(u.combatStats.totalKills)} kills`;
        break;

      case 'pvp':
      case 'duelos':
      case 'victorias':
        sortFn = ([, a], [, b]) => b.combatStats.pvpWins - a.combatStats.pvpWins;
        title = '⚔️ TOP PVP';
        valueGetter = (u) => `${u.combatStats.pvpWins}W / ${u.combatStats.pvpLosses}L`;
        break;

      case 'dungeons':
      case 'mazmorras':
        sortFn = ([, a], [, b]) => b.combatStats.dungeonsCompleted - a.combatStats.dungeonsCompleted;
        title = '🏰 TOP DUNGEONS';
        valueGetter = (u) => `${u.combatStats.dungeonsCompleted} completados`;
        break;

      case 'exp':
      case 'xp':
      case 'experiencia':
        sortFn = ([, a], [, b]) => b.exp - a.exp;
        title = '✨ TOP EXPERIENCIA';
        valueGetter = (u) => `${formatNumber(u.exp)} XP`;
        break;

      default:
        // Por defecto: nivel
        sortFn = ([, a], [, b]) => {
          if (b.level !== a.level) return b.level - a.level;
          return b.exp - a.exp;
        };
        title = '📊 TOP NIVEL';
        valueGetter = (u) => `Nv.${u.level} (${formatNumber(u.exp)} XP)`;
    }

    // Ordenar y tomar top 10
    const sorted = [...registeredUsers].sort(sortFn);
    const top10 = sorted.slice(0, 10);

    // Encontrar posición del usuario actual
    const userPosition = sorted.findIndex(([jid]) => jid === m.sender) + 1;

    let response = `🏆 *${title}*\n`;
    response += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

    for (let i = 0; i < top10.length; i++) {
      const [jid, user] = top10[i];
      const medal = POSITION_MEDALS[i] || `${i + 1}.`;
      const isCurrentUser = jid === m.sender;
      const classEmoji = user.playerClass ? CLASSES[user.playerClass]?.emoji || '' : '';

      response += `${medal} ${isCurrentUser ? '*' : ''}${classEmoji} ${user.name}${isCurrentUser ? '*' : ''}\n`;
      response += `     ${valueGetter(user)}\n`;
    }

    response += `\n━━━━━━━━━━━━━━━━━━━━━\n`;

    if (userPosition > 0) {
      response += `📍 Tu posición: #${userPosition} de ${registeredUsers.length}\n`;
    }

    response += `\n💡 Usa */ranking [categoría]*\n`;
    response += `   Categorías: dinero, kills, pvp, dungeons, exp`;

    await m.reply(response);
  }
};

/**
 * Verifica si un usuario cumple con un logro
 */
function checkAchievement(user: UserRPG, achievement: Achievement): boolean {
  switch (achievement.requirement.type) {
    case 'level':
      return user.level >= (achievement.requirement.value as number);
    case 'money':
      return user.money >= (achievement.requirement.value as number);
    case 'kills':
      return user.combatStats.totalKills >= (achievement.requirement.value as number);
    case 'dungeons':
      return user.combatStats.dungeonsCompleted >= (achievement.requirement.value as number);
    case 'class':
      return user.playerClass === achievement.requirement.value;
    default:
      return false;
  }
}

/**
 * Plugin: Logros - Ver y reclamar logros
 */
const logrosPlugin: PluginHandler = {
  command: ['logros', 'achievements', 'medallas', 'trofeos'],
  tags: ['rpg'],
  help: [
    'logros - Ver todos tus logros',
    'Completa objetivos para desbloquear recompensas'
  ],
  register: true,

  handler: async (ctx: MessageContext) => {
    const { m } = ctx;
    const db = getDatabase();
    const user = db.getUser(m.sender);

    let response = `🏆 *TUS LOGROS*\n`;
    response += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

    let completedCount = 0;
    let unlockedCount = 0;
    const newAchievements: Achievement[] = [];

    // Agrupar logros por categoría
    const categories: Record<string, Achievement[]> = {
      'Nivel': ACHIEVEMENTS.filter(a => a.requirement.type === 'level'),
      'Dinero': ACHIEVEMENTS.filter(a => a.requirement.type === 'money'),
      'Combate': ACHIEVEMENTS.filter(a => a.requirement.type === 'kills'),
      'Exploración': ACHIEVEMENTS.filter(a => a.requirement.type === 'dungeons'),
      'Clase': ACHIEVEMENTS.filter(a => a.requirement.type === 'class')
    };

    for (const [categoryName, achievements] of Object.entries(categories)) {
      if (achievements.length === 0) continue;

      response += `*${categoryName}:*\n`;

      for (const achievement of achievements) {
        const isUnlocked = user.achievements.includes(achievement.id);
        const canUnlock = !isUnlocked && checkAchievement(user, achievement);

        if (canUnlock) {
          newAchievements.push(achievement);
        }

        if (isUnlocked) {
          completedCount++;
          response += `   ✅ ${achievement.emoji} ${achievement.name}\n`;
        } else if (canUnlock) {
          unlockedCount++;
          response += `   🔓 ${achievement.emoji} ${achievement.name} ← *¡NUEVO!*\n`;
        } else {
          response += `   🔒 ${achievement.emoji} ${achievement.name}\n`;
          response += `      _${achievement.description}_\n`;
        }
      }

      response += '\n';
    }

    response += `━━━━━━━━━━━━━━━━━━━━━\n`;
    response += `📊 Completados: *${completedCount}/${ACHIEVEMENTS.length}*\n`;

    if (newAchievements.length > 0) {
      response += `\n🎉 *¡Tienes ${newAchievements.length} logro(s) nuevo(s)!*\n`;
      response += `📝 Usa */reclamarlogro* para obtener tus recompensas.`;
    }

    await m.reply(response);
  }
};

/**
 * Plugin: Reclamar Logro - Reclamar recompensas de logros
 */
const reclamarLogroPlugin: PluginHandler = {
  command: ['reclamarlogro', 'claimachievement', 'reclamar'],
  tags: ['rpg'],
  help: ['reclamarlogro - Reclama todos los logros desbloqueados'],
  register: true,

  handler: async (ctx: MessageContext) => {
    const { m } = ctx;
    const db = getDatabase();
    const user = db.getUser(m.sender);

    // Buscar logros que se pueden reclamar
    const claimableAchievements: Achievement[] = [];

    for (const achievement of ACHIEVEMENTS) {
      if (!user.achievements.includes(achievement.id) && checkAchievement(user, achievement)) {
        claimableAchievements.push(achievement);
      }
    }

    if (claimableAchievements.length === 0) {
      await m.reply(
        `${EMOJI.info} No tienes logros pendientes de reclamar.\n\n` +
        `💡 Usa */logros* para ver tu progreso.`
      );
      return;
    }

    // Reclamar todos los logros
    let totalExp = 0;
    let totalMoney = 0;
    const newTitles: string[] = [];
    const newItems: string[] = [];

    for (const achievement of claimableAchievements) {
      user.achievements.push(achievement.id);
      totalExp += achievement.rewards.exp;
      totalMoney += achievement.rewards.money;

      if (achievement.rewards.title && !user.titles.includes(achievement.rewards.title)) {
        user.titles.push(achievement.rewards.title);
        newTitles.push(achievement.rewards.title);
      }

      if (achievement.rewards.items) {
        for (const itemId of achievement.rewards.items) {
          const existingItem = user.inventory.find(i => i.itemId === itemId);
          if (existingItem) {
            existingItem.quantity++;
          } else {
            user.inventory.push({ itemId, quantity: 1 });
          }
          newItems.push(itemId);
        }
      }
    }

    // Guardar cambios
    db.updateUser(m.sender, {
      achievements: user.achievements,
      exp: user.exp + totalExp,
      money: user.money + totalMoney,
      titles: user.titles,
      inventory: user.inventory
    });

    let response = `🎉 *¡LOGROS RECLAMADOS!*\n`;
    response += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

    for (const achievement of claimableAchievements) {
      response += `${achievement.emoji} *${achievement.name}*\n`;
      response += `   _${achievement.description}_\n\n`;
    }

    response += `🎁 *Recompensas totales:*\n`;
    response += `   ${EMOJI.exp} +${formatNumber(totalExp)} XP\n`;
    response += `   ${EMOJI.coin} +${formatNumber(totalMoney)} monedas\n`;

    if (newTitles.length > 0) {
      response += `   🏷️ Títulos: ${newTitles.join(', ')}\n`;
    }

    if (newItems.length > 0) {
      response += `   📦 Items: ${newItems.length} item(s)\n`;
    }

    response += `\n━━━━━━━━━━━━━━━━━━━━━\n`;
    response += `📊 Logros: *${user.achievements.length}/${ACHIEVEMENTS.length}*`;

    await m.reply(response);
    await m.react('🏆');
  }
};

/**
 * Plugin: Titulo - Cambiar título mostrado
 */
const tituloPlugin: PluginHandler = {
  command: ['titulo', 'title', 'settitle'],
  tags: ['rpg'],
  help: [
    'titulo - Ver tus títulos disponibles',
    'titulo [nombre] - Equipar un título'
  ],
  register: true,

  handler: async (ctx: MessageContext) => {
    const { m, text } = ctx;
    const db = getDatabase();
    const user = db.getUser(m.sender);

    if (!text.trim()) {
      // Mostrar títulos disponibles
      let response = `🏷️ *TUS TÍTULOS*\n`;
      response += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

      response += `📌 *Título actual:* ${user.currentTitle}\n\n`;

      response += `📜 *Títulos disponibles:*\n`;
      for (const title of user.titles) {
        const isCurrent = title === user.currentTitle;
        response += `   ${isCurrent ? '✓ ' : ''}${title}\n`;
      }

      response += `\n━━━━━━━━━━━━━━━━━━━━━\n`;
      response += `📝 */titulo [nombre]* - Equipar título`;

      await m.reply(response);
      return;
    }

    // Buscar título (sin importar tildes)
    const searchTerm = text.toLowerCase().trim();
    const foundTitle = user.titles.find(t => matchesIgnoreAccents(t, searchTerm));

    if (!foundTitle) {
      await m.reply(
        `${EMOJI.error} No tienes ese título.\n\n` +
        `💡 Usa */titulo* para ver tus títulos.`
      );
      return;
    }

    if (foundTitle === user.currentTitle) {
      await m.reply(`${EMOJI.warning} Ya tienes ese título equipado.`);
      return;
    }

    db.updateUser(m.sender, { currentTitle: foundTitle });

    await m.reply(
      `${EMOJI.success} ¡Título cambiado!\n\n` +
      `🏷️ Nuevo título: *${foundTitle}*`
    );
    await m.react('✅');
  }
};

/**
 * Plugin: Stats - Ver estadísticas detalladas
 */
const statsPlugin: PluginHandler = {
  command: ['stats', 'estadisticas', 'statistics'],
  tags: ['rpg'],
  help: ['stats - Ver tus estadísticas de combate detalladas'],
  register: true,

  handler: async (ctx: MessageContext) => {
    const { m } = ctx;
    const db = getDatabase();
    const user = db.getUser(m.sender);

    const cs = user.combatStats;
    const classInfo = user.playerClass ? CLASSES[user.playerClass] : null;

    let response = `📊 *ESTADÍSTICAS DE ${user.name.toUpperCase()}*\n`;
    response += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

    response += `🎭 *General:*\n`;
    response += `   Nivel: *${user.level}*\n`;
    response += `   Clase: ${classInfo ? `${classInfo.emoji} ${classInfo.name}` : '_Sin clase_'}\n`;
    response += `   Título: ${user.currentTitle}\n`;
    response += `   Días jugando: *${Math.floor((Date.now() - user.regTime) / (1000 * 60 * 60 * 24))}*\n\n`;

    response += `⚔️ *Combate PvE:*\n`;
    response += `   Monstruos derrotados: *${formatNumber(cs.totalKills)}*\n`;
    response += `   Bosses derrotados: *${formatNumber(cs.bossesKilled)}*\n`;
    response += `   Daño total causado: *${formatNumber(cs.totalDamageDealt)}*\n`;
    response += `   Daño total recibido: *${formatNumber(cs.totalDamageReceived)}*\n\n`;

    response += `🏰 *Exploración:*\n`;
    response += `   Dungeons completados: *${cs.dungeonsCompleted}*\n\n`;

    response += `👥 *PvP:*\n`;
    response += `   Victorias: *${cs.pvpWins}*\n`;
    response += `   Derrotas: *${cs.pvpLosses}*\n`;
    const winRate = cs.pvpWins + cs.pvpLosses > 0
      ? Math.floor((cs.pvpWins / (cs.pvpWins + cs.pvpLosses)) * 100)
      : 0;
    response += `   Win rate: *${winRate}%*\n\n`;

    response += `💰 *Economía:*\n`;
    response += `   Dinero actual: *${formatNumber(user.money)}*\n`;
    response += `   Total ganado: *${formatNumber(user.totalEarned)}*\n\n`;

    response += `🏆 *Logros:*\n`;
    response += `   Completados: *${user.achievements.length}/${ACHIEVEMENTS.length}*\n`;
    response += `   Títulos: *${user.titles.length}*`;

    await m.reply(response);
  }
};

/**
 * Registra los plugins de ranking y logros
 */
export function registerRankingPlugins(handler: MessageHandler): void {
  handler.registerPlugin('ranking', rankingPlugin);
  handler.registerPlugin('logros', logrosPlugin);
  handler.registerPlugin('reclamarlogro', reclamarLogroPlugin);
  handler.registerPlugin('titulo', tituloPlugin);
  handler.registerPlugin('stats', statsPlugin);
}
