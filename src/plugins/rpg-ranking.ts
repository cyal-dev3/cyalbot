import type { MessageHandler } from '../handler.js';
import type { PluginHandler, MessageContext } from '../types/message.js';
import { getDatabase } from '../lib/database.js';
import { EMOJI, formatNumber, matchesIgnoreAccents } from '../lib/utils.js';
import { ACHIEVEMENTS, CLASSES, type Achievement } from '../types/rpg.js';
import type { UserRPG } from '../types/user.js';
import { grantRewards, formatReward } from '../lib/rpg-actions.js';

const POSITION_MEDALS = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

interface RankingCategory {
  title: string;
  sort: (a: UserRPG, b: UserRPG) => number;
  value: (user: UserRPG) => string;
}

const RANKINGS: Record<string, RankingCategory> = {
  nivel: {
    title: '📊 TOP NIVEL',
    sort: (a, b) => (b.level !== a.level ? b.level - a.level : b.exp - a.exp),
    value: u => `Nv.${u.level} (${formatNumber(u.exp)} XP)`
  },
  dinero: {
    title: '💰 TOP DINERO',
    sort: (a, b) => (b.money + b.bank) - (a.money + a.bank),
    value: u => `${formatNumber(u.money + u.bank)} monedas`
  },
  kills: {
    title: '💀 TOP MONSTRUOS DERROTADOS',
    sort: (a, b) => b.combatStats.totalKills - a.combatStats.totalKills,
    value: u => `${formatNumber(u.combatStats.totalKills)} kills`
  },
  pvp: {
    title: '⚔️ TOP PVP',
    sort: (a, b) => b.combatStats.pvpWins - a.combatStats.pvpWins,
    value: u => `${u.combatStats.pvpWins}W / ${u.combatStats.pvpLosses}L`
  },
  dungeons: {
    title: '🏰 TOP DUNGEONS',
    sort: (a, b) => b.combatStats.dungeonsCompleted - a.combatStats.dungeonsCompleted,
    value: u => `${u.combatStats.dungeonsCompleted} completados`
  },
  exp: {
    title: '✨ TOP EXPERIENCIA',
    sort: (a, b) => b.exp - a.exp,
    value: u => `${formatNumber(u.exp)} XP`
  }
};

const RANKING_ALIASES: Record<string, keyof typeof RANKINGS> = {
  dinero: 'dinero', money: 'dinero', oro: 'dinero', gold: 'dinero',
  kills: 'kills', muertes: 'kills', monstruos: 'kills',
  pvp: 'pvp', duelos: 'pvp', victorias: 'pvp',
  dungeons: 'dungeons', mazmorras: 'dungeons',
  exp: 'exp', xp: 'exp', experiencia: 'exp'
};

/** Usuarios registrados ya migrados (getRegisteredUsers devuelve los crudos) */
function registeredUsers(): [string, UserRPG][] {
  const db = getDatabase();
  return db.getRegisteredUsers().map(([jid]) => [jid, db.getUser(jid)] as [string, UserRPG]);
}

const rankingPlugin: PluginHandler = {
  command: ['ranking', 'top', 'leaderboard', 'mejores'],
  tags: ['rpg'],
  help: [
    'ranking - Top 10 por nivel',
    'ranking <dinero|kills|pvp|dungeons|exp> - Otras categorías'
  ],
  usage: ['ranking', 'ranking dinero'],
  register: true,

  handler: async (ctx: MessageContext) => {
    const { m, text, usedPrefix } = ctx;
    const key = RANKING_ALIASES[text.toLowerCase().trim()] ?? 'nivel';
    const category = RANKINGS[key];

    const users = registeredUsers();
    if (users.length === 0) return m.reply(`${EMOJI.info} Aún no hay jugadores registrados.`);

    const sorted = users.sort(([, a], [, b]) => category.sort(a, b));
    const position = sorted.findIndex(([jid]) => jid === m.sender) + 1;

    let response = `🏆 *${category.title}*\n━━━━━━━━━━━━━━━━━━━━━\n\n`;
    sorted.slice(0, 10).forEach(([jid, user], i) => {
      const medal = POSITION_MEDALS[i] ?? `${i + 1}.`;
      const self = jid === m.sender;
      const classEmoji = user.playerClass ? CLASSES[user.playerClass]?.emoji ?? '' : '';
      response += `${medal} ${self ? '*' : ''}${classEmoji} ${user.name}${self ? '*' : ''}\n     ${category.value(user)}\n`;
    });

    response += `\n━━━━━━━━━━━━━━━━━━━━━\n`;
    if (position > 0) response += `📍 Tu posición: #${position} de ${users.length}\n`;
    response += `\n💡 *${usedPrefix}ranking <categoría>*: dinero, kills, pvp, dungeons, exp`;

    await m.reply(response);
  }
};

function checkAchievement(user: UserRPG, achievement: Achievement): boolean {
  const value = achievement.requirement.value;
  switch (achievement.requirement.type) {
    case 'level': return user.level >= (value as number);
    case 'money': return user.money >= (value as number);
    case 'kills': return user.combatStats.totalKills >= (value as number);
    case 'dungeons': return user.combatStats.dungeonsCompleted >= (value as number);
    case 'class': return user.playerClass === value;
    default: return false;
  }
}

function claimableAchievements(user: UserRPG): Achievement[] {
  return ACHIEVEMENTS.filter(a => !user.achievements.includes(a.id) && checkAchievement(user, a));
}

const logrosPlugin: PluginHandler = {
  command: ['logros', 'achievements', 'medallas', 'trofeos'],
  tags: ['rpg'],
  help: ['logros - Ver tus logros y cuáles puedes reclamar'],
  usage: ['logros'],
  register: true,

  handler: async (ctx: MessageContext) => {
    const { m, usedPrefix } = ctx;
    const user = getDatabase().getUser(m.sender);

    const categories: Record<string, Achievement[]> = {
      Nivel: ACHIEVEMENTS.filter(a => a.requirement.type === 'level'),
      Dinero: ACHIEVEMENTS.filter(a => a.requirement.type === 'money'),
      Combate: ACHIEVEMENTS.filter(a => a.requirement.type === 'kills'),
      Exploración: ACHIEVEMENTS.filter(a => a.requirement.type === 'dungeons'),
      Clase: ACHIEVEMENTS.filter(a => a.requirement.type === 'class')
    };

    let response = `🏆 *TUS LOGROS*\n━━━━━━━━━━━━━━━━━━━━━\n\n`;
    let completed = 0;
    let claimable = 0;

    for (const [name, list] of Object.entries(categories)) {
      if (list.length === 0) continue;
      response += `*${name}:*\n`;
      for (const achievement of list) {
        const unlocked = user.achievements.includes(achievement.id);
        if (unlocked) {
          completed++;
          response += `   ✅ ${achievement.emoji} ${achievement.name}\n`;
        } else if (checkAchievement(user, achievement)) {
          claimable++;
          response += `   🔓 ${achievement.emoji} ${achievement.name} ← *¡NUEVO!*\n`;
        } else {
          response += `   🔒 ${achievement.emoji} ${achievement.name}\n      _${achievement.description}_\n`;
        }
      }
      response += '\n';
    }

    response += `━━━━━━━━━━━━━━━━━━━━━\n📊 Completados: *${completed}/${ACHIEVEMENTS.length}*`;
    if (claimable > 0) {
      response += `\n\n🎉 *¡Tienes ${claimable} logro(s) nuevo(s)!* Usa *${usedPrefix}reclamarlogro*.`;
    }

    await m.reply(response);
  }
};

const reclamarLogroPlugin: PluginHandler = {
  command: ['reclamarlogro', 'claimachievement'],
  tags: ['rpg'],
  help: ['reclamarlogro - Reclama todos los logros desbloqueados'],
  usage: ['reclamarlogro'],
  register: true,

  handler: async (ctx: MessageContext) => {
    const { m, usedPrefix } = ctx;
    const db = getDatabase();
    const user = db.getUser(m.sender);
    const achievements = claimableAchievements(user);

    if (achievements.length === 0) {
      return m.reply(`${EMOJI.info} No tienes logros pendientes de reclamar.\n\n💡 Usa *${usedPrefix}logros* para ver tu progreso.`);
    }

    let exp = 0;
    let money = 0;
    const newTitles: string[] = [];
    const newItems: string[] = [];

    for (const achievement of achievements) {
      user.achievements.push(achievement.id);
      exp += achievement.rewards.exp;
      money += achievement.rewards.money;

      if (achievement.rewards.title && !user.titles.includes(achievement.rewards.title)) {
        user.titles.push(achievement.rewards.title);
        newTitles.push(achievement.rewards.title);
      }
      for (const itemId of achievement.rewards.items ?? []) {
        const existing = user.inventory.find(i => i.itemId === itemId);
        if (existing) existing.quantity++;
        else user.inventory.push({ itemId, quantity: 1 });
        newItems.push(itemId);
      }
    }

    db.updateUser(m.sender, { achievements: user.achievements, titles: user.titles, inventory: user.inventory });
    const result = grantRewards(db, m.sender, { exp, money }, { source: 'achievement', rank: false });

    const lines = achievements.map(a => `${a.emoji} *${a.name}* — _${a.description}_`);
    lines.push(`+${formatNumber(result.exp)} ${EMOJI.exp} XP`, `+${formatNumber(result.money)} ${EMOJI.coin} monedas`);
    if (newTitles.length) lines.push(`🏷️ Títulos: ${newTitles.join(', ')}`);
    if (newItems.length) lines.push(`📦 Items: ${newItems.length}`);
    lines.push(...result.lines);

    await m.reply(formatReward(ctx, `🎉 ${achievements.length} logro(s) reclamado(s)`, lines, {
      footer: `📊 Logros: *${user.achievements.length}/${ACHIEVEMENTS.length}*`
    }));
    await m.react('🏆');
  }
};

const tituloPlugin: PluginHandler = {
  command: ['titulo', 'title', 'settitle'],
  tags: ['rpg'],
  help: [
    'titulo - Ver tus títulos disponibles',
    'titulo <nombre> - Equipar un título'
  ],
  usage: ['titulo', 'titulo <nombre>'],
  register: true,

  handler: async (ctx: MessageContext) => {
    const { m, text, usedPrefix } = ctx;
    const db = getDatabase();
    const user = db.getUser(m.sender);

    if (!text.trim()) {
      const list = user.titles.map(t => `   ${t === user.currentTitle ? '✓ ' : ''}${t}`).join('\n');
      return m.reply(
        `🏷️ *TUS TÍTULOS*\n━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `📌 *Título actual:* ${user.currentTitle}\n\n` +
        `📜 *Títulos disponibles:*\n${list}\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━\n📝 *${usedPrefix}titulo <nombre>* - Equipar título`
      );
    }

    const found = user.titles.find(t => matchesIgnoreAccents(t, text.trim()));
    if (!found) return m.reply(`${EMOJI.error} No tienes ese título.\n\n💡 Usa *${usedPrefix}titulo* para ver tus títulos.`);
    if (found === user.currentTitle) return m.reply(`${EMOJI.warning} Ya tienes ese título equipado.`);

    db.updateUser(m.sender, { currentTitle: found });
    await m.reply(`${EMOJI.success} ¡Título cambiado!\n\n🏷️ Nuevo título: *${found}*`);
    await m.react('✅');
  }
};

const statsPlugin: PluginHandler = {
  command: ['stats', 'estadisticas', 'statistics'],
  tags: ['rpg'],
  help: ['stats - Ver tus estadísticas de combate detalladas'],
  usage: ['stats'],
  register: true,

  handler: async (ctx: MessageContext) => {
    const { m } = ctx;
    const user = getDatabase().getUser(m.sender);
    const cs = user.combatStats;
    const classInfo = user.playerClass ? CLASSES[user.playerClass] : null;
    const duels = cs.pvpWins + cs.pvpLosses;
    const winRate = duels > 0 ? Math.floor((cs.pvpWins / duels) * 100) : 0;

    await m.reply(
      `📊 *ESTADÍSTICAS DE ${user.name.toUpperCase()}*\n━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `🎭 *General:*\n` +
      `   Nivel: *${user.level}*\n` +
      `   Clase: ${classInfo ? `${classInfo.emoji} ${classInfo.name}` : '_Sin clase_'}\n` +
      `   Título: ${user.currentTitle}\n` +
      `   Días jugando: *${Math.floor((Date.now() - user.regTime) / 86400000)}*\n\n` +
      `⚔️ *Combate PvE:*\n` +
      `   Monstruos derrotados: *${formatNumber(cs.totalKills)}*\n` +
      `   Bosses derrotados: *${formatNumber(cs.bossesKilled)}*\n` +
      `   Daño total causado: *${formatNumber(cs.totalDamageDealt)}*\n` +
      `   Daño total recibido: *${formatNumber(cs.totalDamageReceived)}*\n\n` +
      `🏰 *Exploración:*\n   Dungeons completados: *${cs.dungeonsCompleted}*\n\n` +
      `👥 *PvP:*\n   Victorias: *${cs.pvpWins}* · Derrotas: *${cs.pvpLosses}* · Win rate: *${winRate}%*\n\n` +
      `💰 *Economía:*\n   Dinero actual: *${formatNumber(user.money)}*\n   Total ganado: *${formatNumber(user.totalEarned)}*\n\n` +
      `🏆 *Logros:*\n   Completados: *${user.achievements.length}/${ACHIEVEMENTS.length}*\n   Títulos: *${user.titles.length}*`
    );
  }
};

export function registerRankingPlugins(handler: MessageHandler): void {
  handler.registerPlugin('ranking', rankingPlugin);
  handler.registerPlugin('logros', logrosPlugin);
  handler.registerPlugin('reclamarlogro', reclamarLogroPlugin);
  handler.registerPlugin('titulo', tituloPlugin);
  handler.registerPlugin('stats', statsPlugin);
}
