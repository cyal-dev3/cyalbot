/**
 * Plugin de Owner RPG
 * Control total del sistema RPG para el owner del bot
 *
 * Comandos disponibles:
 * - Dar/quitar recursos (dinero, xp, mana, diamantes, items)
 * - Modos especiales (bonus, robo libre, evento)
 * - Modificar stats de usuarios
 * - Reset de cooldowns
 * - Y mucho más...
 */

import type { PluginHandler, MessageContext } from '../types/message.js';
import { getDatabase } from '../lib/database.js';
import { EMOJI, formatNumber, msToTime } from '../lib/utils.js';
import { getRoleByLevel, calculateTotalStats } from '../types/user.js';
import { ITEMS, CLASSES, type PlayerClass } from '../types/rpg.js';
import {
  autoEventConfig,
  toggleAutoEvents,
  addAnnouncementGroup,
  removeAnnouncementGroup,
  setEventIntervals,
  forceRandomEvent,
  getAutoEventStatus
} from '../lib/auto-events.js';

// ==================== ESTADO GLOBAL DE MODOS ====================

interface GlobalModes {
  // Modo Bonus - Multiplicadores activos
  bonusMode: {
    active: boolean;
    expMultiplier: number;
    moneyMultiplier: number;
    manaMultiplier: number;
    expiresAt: number;
    activatedBy: string;
  };
  // Modo Robo Libre - Sin cooldown de robo
  freeRobMode: {
    active: boolean;
    expiresAt: number;
    activatedBy: string;
  };
  // Modo Evento - Drops aumentados
  eventMode: {
    active: boolean;
    dropMultiplier: number;
    eventName: string;
    expiresAt: number;
    activatedBy: string;
  };
  // Modo PvP - Daño aumentado en duelos
  pvpMode: {
    active: boolean;
    damageMultiplier: number;
    expiresAt: number;
    activatedBy: string;
  };
  // Modo Caos - Todo multiplicado (robo, pvp, xp, dinero)
  chaosMode: {
    active: boolean;
    multiplier: number;
    expiresAt: number;
    activatedBy: string;
  };
}

// Estado global de modos (en memoria - se puede persistir en DB)
export const globalModes: GlobalModes = {
  bonusMode: {
    active: false,
    expMultiplier: 1,
    moneyMultiplier: 1,
    manaMultiplier: 1,
    expiresAt: 0,
    activatedBy: ''
  },
  freeRobMode: {
    active: false,
    expiresAt: 0,
    activatedBy: ''
  },
  eventMode: {
    active: false,
    dropMultiplier: 1,
    eventName: '',
    expiresAt: 0,
    activatedBy: ''
  },
  pvpMode: {
    active: false,
    damageMultiplier: 1,
    expiresAt: 0,
    activatedBy: ''
  },
  chaosMode: {
    active: false,
    multiplier: 1,
    expiresAt: 0,
    activatedBy: ''
  }
};

// ==================== UTILIDADES ====================

/**
 * Verifica y desactiva modos expirados
 */
export function checkExpiredModes(): void {
  const now = Date.now();

  if (globalModes.bonusMode.active && now >= globalModes.bonusMode.expiresAt) {
    globalModes.bonusMode.active = false;
  }
  if (globalModes.freeRobMode.active && now >= globalModes.freeRobMode.expiresAt) {
    globalModes.freeRobMode.active = false;
  }
  if (globalModes.eventMode.active && now >= globalModes.eventMode.expiresAt) {
    globalModes.eventMode.active = false;
  }
  if (globalModes.pvpMode.active && now >= globalModes.pvpMode.expiresAt) {
    globalModes.pvpMode.active = false;
  }
  if (globalModes.chaosMode.active && now >= globalModes.chaosMode.expiresAt) {
    globalModes.chaosMode.active = false;
  }
}

/**
 * Obtiene el JID del usuario objetivo
 * Si no hay mención ni mensaje citado, retorna null
 */
function getTargetUser(ctx: MessageContext): string | null {
  if (ctx.m.mentionedJid.length > 0) {
    return ctx.m.mentionedJid[0];
  }
  if (ctx.m.quoted?.sender) {
    return ctx.m.quoted.sender;
  }
  return null;
}

/**
 * Obtiene el JID del usuario objetivo o el propio sender si no hay mención
 * Útil para comandos que pueden auto-aplicarse
 */
function getTargetUserOrSelf(ctx: MessageContext): string {
  const target = getTargetUser(ctx);
  return target || ctx.m.sender;
}

/**
 * Parsea tiempo en formato humano (1h, 30m, 2d, etc.)
 */
function parseTime(timeStr: string): number {
  const match = timeStr.match(/^(\d+)(s|m|h|d)$/i);
  if (!match) return 0;

  const value = parseInt(match[1]);
  const unit = match[2].toLowerCase();

  switch (unit) {
    case 's': return value * 1000;
    case 'm': return value * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    case 'd': return value * 24 * 60 * 60 * 1000;
    default: return 0;
  }
}

// ==================== COMANDOS ====================

/**
 * Menú de ayuda del Owner RPG
 */
export const ownerRpgMenuPlugin: PluginHandler = {
  command: ['rpgowner', 'ownerrpg', 'rpgadmin', 'rpgmenu'],
  tags: ['owner'],
  help: ['rpgowner - Muestra el menú de comandos del owner RPG'],
  owner: true,

  handler: async (ctx: MessageContext) => {
    const { m } = ctx;

    // Verificar modos activos
    checkExpiredModes();

    let modesStatus = '\n📊 *MODOS ACTIVOS:*\n';
    const now = Date.now();

    if (globalModes.bonusMode.active) {
      const remaining = msToTime(globalModes.bonusMode.expiresAt - now);
      modesStatus += `✅ Bonus (x${globalModes.bonusMode.expMultiplier} XP, x${globalModes.bonusMode.moneyMultiplier} 💰) - ${remaining}\n`;
    }
    if (globalModes.freeRobMode.active) {
      const remaining = msToTime(globalModes.freeRobMode.expiresAt - now);
      modesStatus += `✅ Robo Libre (sin cooldown) - ${remaining}\n`;
    }
    if (globalModes.eventMode.active) {
      const remaining = msToTime(globalModes.eventMode.expiresAt - now);
      modesStatus += `✅ Evento "${globalModes.eventMode.eventName}" (x${globalModes.eventMode.dropMultiplier} drops) - ${remaining}\n`;
    }
    if (globalModes.pvpMode.active) {
      const remaining = msToTime(globalModes.pvpMode.expiresAt - now);
      modesStatus += `✅ PvP Intenso (x${globalModes.pvpMode.damageMultiplier} daño) - ${remaining}\n`;
    }
    if (globalModes.chaosMode.active) {
      const remaining = msToTime(globalModes.chaosMode.expiresAt - now);
      modesStatus += `✅ MODO CAOS (x${globalModes.chaosMode.multiplier} TODO) - ${remaining}\n`;
    }

    if (!globalModes.bonusMode.active && !globalModes.freeRobMode.active &&
        !globalModes.eventMode.active && !globalModes.pvpMode.active && !globalModes.chaosMode.active) {
      modesStatus += '_Ningún modo especial activo_\n';
    }

    const menu = `
👑 *PANEL DE CONTROL RPG - OWNER*
━━━━━━━━━━━━━━━━━━━━━━━━
${modesStatus}
━━━━━━━━━━━━━━━━━━━━━━━━

💰 *RECURSOS:*
• \`.rpgdar\` @user [tipo] [cantidad]
  _Tipos: dinero, xp, mana, diamantes, vida, stamina_
• \`.rpgquitar\` @user [tipo] [cantidad]
• \`.rpgset\` @user [stat] [valor]
  _Stats: level, attack, defense, crit, maxhealth, maxmana_
• \`.rpgdaritem\` @user [itemId] [cantidad]
• \`.rpgquitaritem\` @user [itemId] [cantidad]

🎭 *MODOS ESPECIALES:*
• \`.rpgbonus\` [xp] [dinero] [mana] [tiempo]
  _Ej: .rpgbonus 2 3 2 1h (x2 xp, x3 dinero, x2 mana por 1h)_
• \`.rpgrobolibre\` [tiempo]
  _Ej: .rpgrobolibre 30m (robo sin cooldown por 30 min)_
• \`.rpgevento\` [nombre] [dropMultiplier] [tiempo]
  _Ej: .rpgevento "Lluvia de Oro" 5 2h_
• \`.rpgpvp\` [multiplicador] [tiempo]
  _Ej: .rpgpvp 2 1h (x2 daño en duelos)_
• \`.rpgcaos\` [multiplicador] [tiempo]
  _Ej: .rpgcaos 3 30m (TODO x3 por 30 min)_
• \`.rpgdesactivar\` [modo]
  _Modos: bonus, robo, evento, pvp, caos, todos_

⏰ *COOLDOWNS:*
• \`.rpgresetcd\` @user [tipo]
  _Tipos: work, mine, rob, duel, attack, dungeon, daily, all_
• \`.rpgresetcdall\` [tipo]
  _Resetea cooldown para TODOS los usuarios_

🔧 *MODIFICACIONES AVANZADAS:*
• \`.rpgsetclase\` @user [clase]
  _Clases: guerrero, mago, ladron, arquero_
• \`.rpgresetstats\` @user
  _Resetea stats a valores por defecto (mantiene nivel)_
• \`.rpgfullstats\` @user
  _Da stats máximos al usuario_
• \`.rpgmaxlevel\` @user [nivel]
  _Establece nivel instantáneamente_
• \`.rpgborrar\` @user
  _ELIMINA el progreso RPG del usuario_

📊 *INFORMACIÓN:*
• \`.rpginfo\` @user
  _Ver toda la info RPG de un usuario_
• \`.rpglistitems\`
  _Lista todos los items disponibles_
• \`.rpgtop\` [tipo]
  _Ver ranking: level, money, diamonds, pvp_

🎁 *RECOMPENSAS MASIVAS:*
• \`.rpgdaratodos\` [tipo] [cantidad]
  _Da recursos a TODOS los registrados_
• \`.rpglluviamoney\` [cantidad]
  _Lluvia de dinero aleatorio en el grupo_

🎲 *EVENTOS AUTOMÁTICOS:*
• \`.rpgautoevents\` [on/off]
  _Activa/desactiva eventos aleatorios_
• \`.rpgaddgrupo\`
  _Agrega este grupo a los anuncios_
• \`.rpgremovegrupo\`
  _Remueve este grupo de los anuncios_
• \`.rpgeventinterval\` [min] [max]
  _Intervalo entre eventos (minutos)_
• \`.rpgforceevent\`
  _Fuerza un evento aleatorio ahora_
• \`.rpgeventstatus\`
  _Ver estado del sistema de eventos_

⚠️ *Tiempos válidos: 1s, 30m, 1h, 2h, 1d, etc.*
`;

    await m.reply(menu);
  }
};

/**
 * Dar recursos a un usuario
 */
export const rpgDarPlugin: PluginHandler = {
  command: ['rpgdar', 'rpggive', 'rpgadd'],
  tags: ['owner'],
  help: ['rpgdar @user [tipo] [cantidad] - Da recursos a un usuario'],
  owner: true,

  handler: async (ctx: MessageContext) => {
    const { m, args } = ctx;
    const db = getDatabase();

    // Si no hay mención, se aplica a uno mismo
    const targetJid = getTargetUserOrSelf(ctx);

    const user = db.getUser(targetJid);
    if (!user.registered) {
      return m.reply(`${EMOJI.error} ${targetJid === m.sender ? 'No estás registrado' : 'Este usuario no está registrado'} en el RPG`);
    }

    const type = args[0]?.toLowerCase();
    const amount = parseInt(args[1]) || 0;

    if (!type || amount <= 0) {
      return m.reply(
        `${EMOJI.error} Uso: .rpgdar [@user] [tipo] [cantidad]\n\n` +
        `*Tipos disponibles:*\n` +
        `• dinero/money - Monedas\n` +
        `• xp/exp - Experiencia\n` +
        `• mana - Maná\n` +
        `• diamantes/diamonds/limit - Diamantes\n` +
        `• vida/health - Vida actual\n` +
        `• stamina/energia - Energía\n\n` +
        `💡 _Sin mención se aplica a ti mismo_`
      );
    }

    const updates: Record<string, number> = {};
    let resourceName = '';
    let emoji = '';

    // Calcular stats máximos reales (incluyendo clase y equipamiento)
    const realMaxStats = calculateTotalStats(user, ITEMS, CLASSES);

    switch (type) {
      case 'dinero':
      case 'money':
      case 'monedas':
        updates.money = user.money + amount;
        resourceName = 'monedas';
        emoji = '💰';
        break;
      case 'xp':
      case 'exp':
      case 'experiencia':
        updates.exp = user.exp + amount;
        resourceName = 'XP';
        emoji = '✨';
        break;
      case 'mana':
        updates.mana = Math.min(realMaxStats.maxMana, user.mana + amount);
        resourceName = 'maná';
        emoji = '💠';
        break;
      case 'diamantes':
      case 'diamonds':
      case 'limit':
        updates.limit = user.limit + amount;
        resourceName = 'diamantes';
        emoji = '💎';
        break;
      case 'vida':
      case 'health':
      case 'hp':
        updates.health = Math.min(realMaxStats.maxHealth, user.health + amount);
        resourceName = 'vida';
        emoji = '❤️';
        break;
      case 'stamina':
      case 'energia':
      case 'energy':
        updates.stamina = Math.min(realMaxStats.maxStamina, user.stamina + amount);
        resourceName = 'energía';
        emoji = '⚡';
        break;
      default:
        return m.reply(`${EMOJI.error} Tipo no válido. Usa: dinero, xp, mana, diamantes, vida, stamina`);
    }

    db.updateUser(targetJid, updates);

    await m.reply(
      `👑 *OWNER RPG*\n\n` +
      `${emoji} Has dado *${formatNumber(amount)} ${resourceName}* a *${user.name}*\n\n` +
      `📊 Nuevo total: *${formatNumber(updates[Object.keys(updates)[0]])}*`
    );
    await m.react('✅');
  }
};

/**
 * Quitar recursos a un usuario
 */
export const rpgQuitarPlugin: PluginHandler = {
  command: ['rpgquitar', 'rpgremove', 'rpgtake'],
  tags: ['owner'],
  help: ['rpgquitar @user [tipo] [cantidad] - Quita recursos a un usuario'],
  owner: true,

  handler: async (ctx: MessageContext) => {
    const { m, args } = ctx;
    const db = getDatabase();

    const targetJid = getTargetUserOrSelf(ctx);

    const user = db.getUser(targetJid);
    if (!user.registered) {
      return m.reply(`${EMOJI.error} ${targetJid === m.sender ? 'No estás registrado' : 'Este usuario no está registrado'} en el RPG`);
    }

    const type = args[0]?.toLowerCase();
    const amount = parseInt(args[1]) || 0;

    if (!type || amount <= 0) {
      return m.reply(`${EMOJI.error} Uso: .rpgquitar [@user] [tipo] [cantidad]\n💡 _Sin mención se aplica a ti mismo_`);
    }

    const updates: Record<string, number> = {};
    let resourceName = '';
    let emoji = '';

    switch (type) {
      case 'dinero':
      case 'money':
        updates.money = Math.max(0, user.money - amount);
        resourceName = 'monedas';
        emoji = '💰';
        break;
      case 'xp':
      case 'exp':
        updates.exp = Math.max(0, user.exp - amount);
        resourceName = 'XP';
        emoji = '✨';
        break;
      case 'mana':
        updates.mana = Math.max(0, user.mana - amount);
        resourceName = 'maná';
        emoji = '💠';
        break;
      case 'diamantes':
      case 'diamonds':
      case 'limit':
        updates.limit = Math.max(0, user.limit - amount);
        resourceName = 'diamantes';
        emoji = '💎';
        break;
      case 'vida':
      case 'health':
        updates.health = Math.max(1, user.health - amount);
        resourceName = 'vida';
        emoji = '❤️';
        break;
      case 'stamina':
      case 'energia':
        updates.stamina = Math.max(0, user.stamina - amount);
        resourceName = 'energía';
        emoji = '⚡';
        break;
      default:
        return m.reply(`${EMOJI.error} Tipo no válido`);
    }

    db.updateUser(targetJid, updates);

    await m.reply(
      `👑 *OWNER RPG*\n\n` +
      `${emoji} Has quitado *${formatNumber(amount)} ${resourceName}* a *${user.name}*\n\n` +
      `📊 Nuevo total: *${formatNumber(updates[Object.keys(updates)[0]])}*`
    );
    await m.react('✅');
  }
};

/**
 * Establecer stats específicos
 */
export const rpgSetPlugin: PluginHandler = {
  command: ['rpgset', 'rpgsetstat'],
  tags: ['owner'],
  help: ['rpgset @user [stat] [valor] - Establece un stat específico'],
  owner: true,

  handler: async (ctx: MessageContext) => {
    const { m, args } = ctx;
    const db = getDatabase();

    const targetJid = getTargetUserOrSelf(ctx);

    const user = db.getUser(targetJid);
    if (!user.registered) {
      return m.reply(`${EMOJI.error} ${targetJid === m.sender ? 'No estás registrado' : 'Este usuario no está registrado'} en el RPG`);
    }

    const stat = args[0]?.toLowerCase();
    const value = parseInt(args[1]);

    if (!stat || isNaN(value)) {
      return m.reply(
        `${EMOJI.error} Uso: .rpgset [@user] [stat] [valor]\n\n` +
        `*Stats disponibles:*\n` +
        `• level - Nivel\n` +
        `• attack - Ataque base\n` +
        `• defense - Defensa base\n` +
        `• crit - Probabilidad de crítico\n` +
        `• maxhealth - Vida máxima\n` +
        `• maxmana - Maná máximo\n` +
        `• maxstamina - Energía máxima\n\n` +
        `💡 _Sin mención se aplica a ti mismo_`
      );
    }

    const updates: Record<string, unknown> = {};

    switch (stat) {
      case 'level':
      case 'nivel':
        updates.level = Math.max(0, value);
        updates.role = getRoleByLevel(value);
        break;
      case 'attack':
      case 'ataque':
        updates.attack = Math.max(1, value);
        break;
      case 'defense':
      case 'defensa':
        updates.defense = Math.max(0, value);
        break;
      case 'crit':
      case 'critico':
        updates.critChance = Math.max(0, Math.min(100, value));
        break;
      case 'maxhealth':
      case 'maxvida':
        updates.maxHealth = Math.max(1, value);
        updates.health = Math.min(user.health, value);
        break;
      case 'maxmana':
        updates.maxMana = Math.max(0, value);
        updates.mana = Math.min(user.mana, value);
        break;
      case 'maxstamina':
      case 'maxenergia':
        updates.maxStamina = Math.max(0, value);
        updates.stamina = Math.min(user.stamina, value);
        break;
      default:
        return m.reply(`${EMOJI.error} Stat no válido`);
    }

    db.updateUser(targetJid, updates);

    await m.reply(
      `👑 *OWNER RPG*\n\n` +
      `⚙️ Has establecido *${stat}* de *${user.name}* a *${formatNumber(value)}*`
    );
    await m.react('✅');
  }
};

/**
 * Dar items a un usuario
 */
export const rpgDarItemPlugin: PluginHandler = {
  command: ['rpgdaritem', 'rpggiveitem', 'rpgadditem'],
  tags: ['owner'],
  help: ['rpgdaritem @user [itemId] [cantidad] - Da items a un usuario'],
  owner: true,

  handler: async (ctx: MessageContext) => {
    const { m, args } = ctx;
    const db = getDatabase();

    const targetJid = getTargetUserOrSelf(ctx);

    const user = db.getUser(targetJid);
    if (!user.registered) {
      return m.reply(`${EMOJI.error} ${targetJid === m.sender ? 'No estás registrado' : 'Este usuario no está registrado'} en el RPG`);
    }

    const itemId = args[0]?.toLowerCase();
    const quantity = parseInt(args[1]) || 1;

    if (!itemId) {
      return m.reply(
        `${EMOJI.error} Uso: .rpgdaritem [@user] [itemId] [cantidad]\n\n` +
        `💡 Usa \`.rpglistitems\` para ver los IDs disponibles\n` +
        `💡 _Sin mención se aplica a ti mismo_`
      );
    }

    const item = ITEMS[itemId];
    if (!item) {
      return m.reply(`${EMOJI.error} Item "${itemId}" no encontrado. Usa \`.rpglistitems\``);
    }

    // Agregar al inventario
    const inventory = [...user.inventory];
    const existingItem = inventory.find(i => i.itemId === itemId);

    if (existingItem) {
      existingItem.quantity += quantity;
    } else {
      inventory.push({ itemId, quantity });
    }

    db.updateUser(targetJid, { inventory });

    await m.reply(
      `👑 *OWNER RPG*\n\n` +
      `${item.emoji} Has dado *${quantity}x ${item.name}* a *${user.name}*`
    );
    await m.react('✅');
  }
};

/**
 * Lista todos los items disponibles
 */
export const rpgListItemsPlugin: PluginHandler = {
  command: ['rpglistitems', 'rpgitems'],
  tags: ['owner'],
  help: ['rpglistitems - Lista todos los items y sus IDs'],
  owner: true,

  handler: async (ctx: MessageContext) => {
    const { m, args } = ctx;

    const category = args[0]?.toLowerCase();

    let items = Object.entries(ITEMS);

    if (category) {
      items = items.filter(([, item]) => item.type === category);
    }

    const categorized: Record<string, string[]> = {
      weapon: [],
      armor: [],
      accessory: [],
      consumable: [],
      material: []
    };

    for (const [id, item] of items) {
      const line = `${item.emoji} \`${id}\` - ${item.name}`;
      if (categorized[item.type]) {
        categorized[item.type].push(line);
      }
    }

    let msg = `📦 *LISTA DE ITEMS*\n━━━━━━━━━━━━━━━━━━━━\n\n`;

    if (categorized.weapon.length) {
      msg += `⚔️ *ARMAS:*\n${categorized.weapon.join('\n')}\n\n`;
    }
    if (categorized.armor.length) {
      msg += `🛡️ *ARMADURAS:*\n${categorized.armor.join('\n')}\n\n`;
    }
    if (categorized.accessory.length) {
      msg += `💍 *ACCESORIOS:*\n${categorized.accessory.join('\n')}\n\n`;
    }
    if (categorized.consumable.length) {
      msg += `🧪 *CONSUMIBLES:*\n${categorized.consumable.join('\n')}\n\n`;
    }
    if (categorized.material.length) {
      msg += `🪨 *MATERIALES:*\n${categorized.material.join('\n')}\n\n`;
    }

    msg += `\n💡 Filtrar por tipo: \`.rpglistitems [weapon|armor|accessory|consumable|material]\``;

    await m.reply(msg);
  }
};

/**
 * Activar modo Bonus
 */
export const rpgBonusPlugin: PluginHandler = {
  command: ['rpgbonus', 'bonusmode', 'modobonus'],
  tags: ['owner'],
  help: ['rpgbonus [xp] [dinero] [mana] [tiempo] - Activa modo bonus global'],
  owner: true,

  handler: async (ctx: MessageContext) => {
    const { m, args } = ctx;

    if (args.length < 4) {
      return m.reply(
        `${EMOJI.error} Uso: .rpgbonus [xpMult] [moneyMult] [manaMult] [tiempo]\n\n` +
        `*Ejemplo:*\n` +
        `\`.rpgbonus 2 3 2 1h\`\n` +
        `_Activa x2 XP, x3 dinero, x2 maná por 1 hora_\n\n` +
        `*Tiempos válidos:* 30s, 5m, 1h, 2h, 1d`
      );
    }

    const expMult = parseFloat(args[0]) || 1;
    const moneyMult = parseFloat(args[1]) || 1;
    const manaMult = parseFloat(args[2]) || 1;
    const duration = parseTime(args[3]);

    if (duration <= 0) {
      return m.reply(`${EMOJI.error} Tiempo inválido. Usa formatos como: 30m, 1h, 2h, 1d`);
    }

    globalModes.bonusMode = {
      active: true,
      expMultiplier: expMult,
      moneyMultiplier: moneyMult,
      manaMultiplier: manaMult,
      expiresAt: Date.now() + duration,
      activatedBy: m.sender
    };

    const timeStr = msToTime(duration);

    await m.reply(
      `👑 *MODO BONUS ACTIVADO*\n` +
      `━━━━━━━━━━━━━━━━━━━━\n\n` +
      `✨ XP: *x${expMult}*\n` +
      `💰 Dinero: *x${moneyMult}*\n` +
      `💠 Maná: *x${manaMult}*\n\n` +
      `⏰ Duración: *${timeStr}*\n\n` +
      `_¡Todos los jugadores recibirán estos bonuses!_`
    );
    await m.react('🎉');
  }
};

/**
 * Activar modo Robo Libre
 */
export const rpgRoboLibrePlugin: PluginHandler = {
  command: ['rpgrobolibre', 'freerobo', 'robofree', 'modorobo'],
  tags: ['owner'],
  help: ['rpgrobolibre [tiempo] - Activa robo sin cooldown'],
  owner: true,

  handler: async (ctx: MessageContext) => {
    const { m, args } = ctx;

    if (!args[0]) {
      return m.reply(
        `${EMOJI.error} Uso: .rpgrobolibre [tiempo]\n\n` +
        `*Ejemplo:*\n` +
        `\`.rpgrobolibre 30m\`\n` +
        `_Robo sin cooldown por 30 minutos_`
      );
    }

    const duration = parseTime(args[0]);

    if (duration <= 0) {
      return m.reply(`${EMOJI.error} Tiempo inválido`);
    }

    globalModes.freeRobMode = {
      active: true,
      expiresAt: Date.now() + duration,
      activatedBy: m.sender
    };

    const timeStr = msToTime(duration);

    await m.reply(
      `👑 *MODO ROBO LIBRE ACTIVADO*\n` +
      `━━━━━━━━━━━━━━━━━━━━\n\n` +
      `🦹 ¡Robo SIN COOLDOWN!\n\n` +
      `⏰ Duración: *${timeStr}*\n\n` +
      `_¡A robar se ha dicho!_`
    );
    await m.react('🦹');
  }
};

/**
 * Activar modo Evento
 */
export const rpgEventoPlugin: PluginHandler = {
  command: ['rpgevento', 'rpgevent', 'modoevento'],
  tags: ['owner'],
  help: ['rpgevento [nombre] [dropMult] [tiempo] - Activa evento especial'],
  owner: true,

  handler: async (ctx: MessageContext) => {
    const { m, text } = ctx;

    // Parsear: "Nombre del Evento" 3 2h
    const match = text.match(/^"([^"]+)"\s+(\d+(?:\.\d+)?)\s+(\d+[smhd])$/i) ||
                  text.match(/^(\S+)\s+(\d+(?:\.\d+)?)\s+(\d+[smhd])$/i);

    if (!match) {
      return m.reply(
        `${EMOJI.error} Uso: .rpgevento "Nombre" [dropMult] [tiempo]\n\n` +
        `*Ejemplo:*\n` +
        `\`.rpgevento "Lluvia de Oro" 5 2h\`\n` +
        `_Evento con x5 drops por 2 horas_`
      );
    }

    const eventName = match[1];
    const dropMult = parseFloat(match[2]) || 1;
    const duration = parseTime(match[3]);

    if (duration <= 0) {
      return m.reply(`${EMOJI.error} Tiempo inválido`);
    }

    globalModes.eventMode = {
      active: true,
      dropMultiplier: dropMult,
      eventName: eventName,
      expiresAt: Date.now() + duration,
      activatedBy: m.sender
    };

    const timeStr = msToTime(duration);

    await m.reply(
      `👑 *EVENTO ACTIVADO*\n` +
      `━━━━━━━━━━━━━━━━━━━━\n\n` +
      `🎪 *${eventName}*\n\n` +
      `📦 Drops: *x${dropMult}*\n` +
      `⏰ Duración: *${timeStr}*\n\n` +
      `_¡Aprovecha los drops aumentados!_`
    );
    await m.react('🎪');
  }
};

/**
 * Activar modo PvP Intenso
 */
export const rpgPvpModePlugin: PluginHandler = {
  command: ['rpgpvp', 'modopvp', 'pvpmode'],
  tags: ['owner'],
  help: ['rpgpvp [multiplicador] [tiempo] - Activa daño aumentado en duelos'],
  owner: true,

  handler: async (ctx: MessageContext) => {
    const { m, args } = ctx;

    if (args.length < 2) {
      return m.reply(
        `${EMOJI.error} Uso: .rpgpvp [multiplicador] [tiempo]\n\n` +
        `*Ejemplo:*\n` +
        `\`.rpgpvp 2 1h\`\n` +
        `_Daño x2 en duelos por 1 hora_`
      );
    }

    const damageMult = parseFloat(args[0]) || 1;
    const duration = parseTime(args[1]);

    if (duration <= 0) {
      return m.reply(`${EMOJI.error} Tiempo inválido`);
    }

    globalModes.pvpMode = {
      active: true,
      damageMultiplier: damageMult,
      expiresAt: Date.now() + duration,
      activatedBy: m.sender
    };

    const timeStr = msToTime(duration);

    await m.reply(
      `👑 *MODO PVP INTENSO*\n` +
      `━━━━━━━━━━━━━━━━━━━━\n\n` +
      `⚔️ Daño en duelos: *x${damageMult}*\n` +
      `⏰ Duración: *${timeStr}*\n\n` +
      `_¡Los duelos serán más letales!_`
    );
    await m.react('⚔️');
  }
};

/**
 * Activar modo Caos - TODO multiplicado
 */
export const rpgCaosModePlugin: PluginHandler = {
  command: ['rpgcaos', 'modocaos', 'chaosmode'],
  tags: ['owner'],
  help: ['rpgcaos [multiplicador] [tiempo] - Modo caos: TODO multiplicado'],
  owner: true,

  handler: async (ctx: MessageContext) => {
    const { m, args } = ctx;

    if (args.length < 2) {
      return m.reply(
        `${EMOJI.error} Uso: .rpgcaos [multiplicador] [tiempo]\n\n` +
        `*Ejemplo:*\n` +
        `\`.rpgcaos 3 30m\`\n` +
        `_TODO x3 por 30 minutos_\n\n` +
        `⚠️ *ADVERTENCIA:* Este modo afecta XP, dinero, daño, robo, drops... ¡TODO!`
      );
    }

    const multiplier = parseFloat(args[0]) || 1;
    const duration = parseTime(args[1]);

    if (duration <= 0) {
      return m.reply(`${EMOJI.error} Tiempo inválido`);
    }

    globalModes.chaosMode = {
      active: true,
      multiplier: multiplier,
      expiresAt: Date.now() + duration,
      activatedBy: m.sender
    };

    const timeStr = msToTime(duration);

    await m.reply(
      `👑 *¡¡MODO CAOS ACTIVADO!!*\n` +
      `━━━━━━━━━━━━━━━━━━━━\n\n` +
      `🌀 *TODO x${multiplier}*\n\n` +
      `✨ XP: x${multiplier}\n` +
      `💰 Dinero: x${multiplier}\n` +
      `⚔️ Daño: x${multiplier}\n` +
      `🦹 Robo: x${multiplier}\n` +
      `📦 Drops: x${multiplier}\n\n` +
      `⏰ Duración: *${timeStr}*\n\n` +
      `_¡¡QUE COMIENCE EL CAOS!!_`
    );
    await m.react('🌀');
  }
};

/**
 * Desactivar modos
 */
export const rpgDesactivarPlugin: PluginHandler = {
  command: ['rpgdesactivar', 'rpgoff', 'rpgdisable'],
  tags: ['owner'],
  help: ['rpgdesactivar [modo] - Desactiva un modo especial'],
  owner: true,

  handler: async (ctx: MessageContext) => {
    const { m, args } = ctx;

    const mode = args[0]?.toLowerCase();

    if (!mode) {
      return m.reply(
        `${EMOJI.error} Uso: .rpgdesactivar [modo]\n\n` +
        `*Modos:*\n` +
        `• bonus - Modo bonus\n` +
        `• robo - Robo libre\n` +
        `• evento - Evento especial\n` +
        `• pvp - PvP intenso\n` +
        `• caos - Modo caos\n` +
        `• todos/all - Todos los modos`
      );
    }

    let deactivated: string[] = [];

    if (mode === 'bonus' || mode === 'todos' || mode === 'all') {
      if (globalModes.bonusMode.active) {
        globalModes.bonusMode.active = false;
        deactivated.push('Bonus');
      }
    }
    if (mode === 'robo' || mode === 'todos' || mode === 'all') {
      if (globalModes.freeRobMode.active) {
        globalModes.freeRobMode.active = false;
        deactivated.push('Robo Libre');
      }
    }
    if (mode === 'evento' || mode === 'event' || mode === 'todos' || mode === 'all') {
      if (globalModes.eventMode.active) {
        globalModes.eventMode.active = false;
        deactivated.push('Evento');
      }
    }
    if (mode === 'pvp' || mode === 'todos' || mode === 'all') {
      if (globalModes.pvpMode.active) {
        globalModes.pvpMode.active = false;
        deactivated.push('PvP Intenso');
      }
    }
    if (mode === 'caos' || mode === 'chaos' || mode === 'todos' || mode === 'all') {
      if (globalModes.chaosMode.active) {
        globalModes.chaosMode.active = false;
        deactivated.push('Caos');
      }
    }

    if (deactivated.length === 0) {
      return m.reply(`${EMOJI.warning} No hay modos activos para desactivar`);
    }

    await m.reply(
      `👑 *MODOS DESACTIVADOS*\n\n` +
      `❌ ${deactivated.join(', ')}`
    );
    await m.react('✅');
  }
};

/**
 * Reset de cooldowns
 */
export const rpgResetCdPlugin: PluginHandler = {
  command: ['rpgresetcd', 'resetcooldown', 'resetcd'],
  tags: ['owner'],
  help: ['rpgresetcd @user [tipo] - Resetea cooldowns de un usuario'],
  owner: true,

  handler: async (ctx: MessageContext) => {
    const { m, args } = ctx;
    const db = getDatabase();

    const targetJid = getTargetUserOrSelf(ctx);

    const user = db.getUser(targetJid);
    if (!user.registered) {
      return m.reply(`${EMOJI.error} ${targetJid === m.sender ? 'No estás registrado' : 'Este usuario no está registrado'} en el RPG`);
    }

    const type = args[0]?.toLowerCase() || 'all';
    const updates: Record<string, number> = {};

    switch (type) {
      case 'work':
        updates.lastWork = 0;
        break;
      case 'mine':
      case 'minar':
        updates.lastMine = 0;
        break;
      case 'rob':
      case 'robar':
        updates.lastRob = 0;
        break;
      case 'duel':
      case 'duelo':
        updates.lastDuel = 0;
        break;
      case 'attack':
      case 'atacar':
        updates.lastAttack = 0;
        break;
      case 'dungeon':
        updates.lastDungeon = 0;
        break;
      case 'daily':
      case 'diario':
        updates.lastClaim = 0;
        break;
      case 'all':
      case 'todos':
        updates.lastWork = 0;
        updates.lastMine = 0;
        updates.lastRob = 0;
        updates.lastDuel = 0;
        updates.lastAttack = 0;
        updates.lastDungeon = 0;
        updates.lastClaim = 0;
        break;
      default:
        return m.reply(
          `${EMOJI.error} Tipo inválido.\n\n` +
          `*Tipos:* work, mine, rob, duel, attack, dungeon, daily, all`
        );
    }

    db.updateUser(targetJid, updates);

    await m.reply(
      `👑 *COOLDOWN RESETEADO*\n\n` +
      `⏰ Se ha reseteado *${type === 'all' ? 'todos los cooldowns' : type}* de *${user.name}*`
    );
    await m.react('✅');
  }
};

/**
 * Reset de cooldowns para TODOS
 */
export const rpgResetCdAllPlugin: PluginHandler = {
  command: ['rpgresetcdall', 'resetcdall'],
  tags: ['owner'],
  help: ['rpgresetcdall [tipo] - Resetea cooldowns de TODOS los usuarios'],
  owner: true,

  handler: async (ctx: MessageContext) => {
    const { m, args } = ctx;
    const db = getDatabase();

    const type = args[0]?.toLowerCase() || 'all';
    const data = db.data;
    let count = 0;

    for (const jid of Object.keys(data.users)) {
      const user = data.users[jid];
      if (!user.registered) continue;

      const updates: Record<string, number> = {};

      switch (type) {
        case 'work':
          updates.lastWork = 0;
          break;
        case 'rob':
        case 'robar':
          updates.lastRob = 0;
          break;
        case 'all':
        case 'todos':
          updates.lastWork = 0;
          updates.lastMine = 0;
          updates.lastRob = 0;
          updates.lastDuel = 0;
          updates.lastAttack = 0;
          updates.lastDungeon = 0;
          updates.lastClaim = 0;
          break;
        default:
          if (type in user) {
            updates[`last${type}`] = 0;
          }
      }

      if (Object.keys(updates).length > 0) {
        db.updateUser(jid, updates);
        count++;
      }
    }

    await m.reply(
      `👑 *COOLDOWN GLOBAL RESETEADO*\n\n` +
      `⏰ Se ha reseteado *${type === 'all' ? 'todos los cooldowns' : type}* de *${count}* usuarios`
    );
    await m.react('✅');
  }
};

/**
 * Establecer clase de un usuario
 */
export const rpgSetClasePlugin: PluginHandler = {
  command: ['rpgsetclase', 'rpgsetclass'],
  tags: ['owner'],
  help: ['rpgsetclase @user [clase] - Establece la clase de un usuario'],
  owner: true,

  handler: async (ctx: MessageContext) => {
    const { m, args } = ctx;
    const db = getDatabase();

    const targetJid = getTargetUserOrSelf(ctx);

    const user = db.getUser(targetJid);
    if (!user.registered) {
      return m.reply(`${EMOJI.error} ${targetJid === m.sender ? 'No estás registrado' : 'Este usuario no está registrado'} en el RPG`);
    }

    const className = args[0]?.toLowerCase() as PlayerClass;

    if (!className || !CLASSES[className]) {
      return m.reply(
        `${EMOJI.error} Uso: .rpgsetclase [@user] [clase]\n\n` +
        `*Clases disponibles:*\n` +
        `• guerrero ⚔️\n` +
        `• mago 🔮\n` +
        `• ladron 🗡️\n` +
        `• arquero 🏹\n\n` +
        `💡 _Sin mención se aplica a ti mismo_`
      );
    }

    const classInfo = CLASSES[className];

    // Aplicar bonuses de clase
    db.updateUser(targetJid, {
      playerClass: className,
      classSelectedAt: Date.now(),
      maxHealth: 100 + classInfo.baseStats.healthBonus,
      maxMana: 20 + classInfo.baseStats.manaBonus,
      maxStamina: 100 + classInfo.baseStats.staminaBonus,
      attack: 10 + classInfo.baseStats.attackBonus,
      defense: 5 + classInfo.baseStats.defenseBonus
    });

    await m.reply(
      `👑 *CLASE ESTABLECIDA*\n\n` +
      `${classInfo.emoji} *${user.name}* ahora es un *${classInfo.name}*!\n\n` +
      `📊 *Bonuses aplicados:*\n` +
      `❤️ Vida: +${classInfo.baseStats.healthBonus}\n` +
      `💠 Maná: +${classInfo.baseStats.manaBonus}\n` +
      `⚡ Energía: +${classInfo.baseStats.staminaBonus}\n` +
      `⚔️ Ataque: +${classInfo.baseStats.attackBonus}\n` +
      `🛡️ Defensa: +${classInfo.baseStats.defenseBonus}`
    );
    await m.react('✅');
  }
};

/**
 * Full stats para un usuario
 */
export const rpgFullStatsPlugin: PluginHandler = {
  command: ['rpgfullstats', 'rpgmaxstats', 'rpggod'],
  tags: ['owner'],
  help: ['rpgfullstats @user - Da stats máximos a un usuario'],
  owner: true,

  handler: async (ctx: MessageContext) => {
    const { m } = ctx;
    const db = getDatabase();

    const targetJid = getTargetUserOrSelf(ctx);

    const user = db.getUser(targetJid);
    if (!user.registered) {
      return m.reply(`${EMOJI.error} ${targetJid === m.sender ? 'No estás registrado' : 'Este usuario no está registrado'} en el RPG`);
    }

    db.updateUser(targetJid, {
      level: 1000,
      exp: 99999999,
      role: getRoleByLevel(1000),
      health: 9999,
      maxHealth: 9999,
      mana: 9999,
      maxMana: 9999,
      stamina: 9999,
      maxStamina: 9999,
      attack: 999,
      defense: 999,
      critChance: 75,
      money: 99999999,
      limit: 99999
    });

    await m.reply(
      `👑 *MODO DIOS ACTIVADO*\n\n` +
      `⚡ *${user.name}* ahora tiene stats máximos!\n\n` +
      `🐉 Nivel: 1000\n` +
      `❤️ Vida: 9,999\n` +
      `💠 Maná: 9,999\n` +
      `⚡ Energía: 9,999\n` +
      `⚔️ Ataque: 999\n` +
      `🛡️ Defensa: 999\n` +
      `💥 Crítico: 75%\n` +
      `💰 Dinero: 99,999,999\n` +
      `💎 Diamantes: 99,999`
    );
    await m.react('⚡');
  }
};

/**
 * Establecer nivel instantáneamente
 */
export const rpgMaxLevelPlugin: PluginHandler = {
  command: ['rpgmaxlevel', 'rpgsetlevel'],
  tags: ['owner'],
  help: ['rpgmaxlevel @user [nivel] - Establece el nivel de un usuario'],
  owner: true,

  handler: async (ctx: MessageContext) => {
    const { m, args } = ctx;
    const db = getDatabase();

    const targetJid = getTargetUserOrSelf(ctx);

    const user = db.getUser(targetJid);
    if (!user.registered) {
      return m.reply(`${EMOJI.error} ${targetJid === m.sender ? 'No estás registrado' : 'Este usuario no está registrado'} en el RPG`);
    }

    const level = parseInt(args[0]) || 100;

    // Calcular XP necesaria para el nivel (aproximado)
    const expNeeded = level * level * 100;

    db.updateUser(targetJid, {
      level: level,
      exp: expNeeded,
      role: getRoleByLevel(level)
    });

    await m.reply(
      `👑 *NIVEL ESTABLECIDO*\n\n` +
      `📈 *${user.name}* ahora es nivel *${level}*!\n` +
      `🏆 Rango: *${getRoleByLevel(level)}*`
    );
    await m.react('✅');
  }
};

/**
 * Ver información completa de un usuario
 */
export const rpgInfoPlugin: PluginHandler = {
  command: ['rpginfo', 'rpgcheck'],
  tags: ['owner'],
  help: ['rpginfo @user - Ver toda la información RPG de un usuario'],
  owner: true,

  handler: async (ctx: MessageContext) => {
    const { m } = ctx;
    const db = getDatabase();

    const targetJid = getTargetUserOrSelf(ctx);

    const user = db.getUser(targetJid);
    if (!user.registered) {
      return m.reply(`${EMOJI.error} ${targetJid === m.sender ? 'No estás registrado' : 'Este usuario no está registrado'} en el RPG`);
    }

    const classInfo = user.playerClass ? CLASSES[user.playerClass] : null;
    const now = Date.now();

    // Calcular stats máximos reales (incluyendo clase y equipamiento)
    const realMaxStats = calculateTotalStats(user, ITEMS, CLASSES);

    // Calcular cooldowns restantes
    const cooldowns = {
      work: user.lastWork ? Math.max(0, (user.lastWork + 10 * 60 * 1000) - now) : 0,
      mine: user.lastMine ? Math.max(0, (user.lastMine + 15 * 60 * 1000) - now) : 0,
      rob: user.lastRob ? Math.max(0, (user.lastRob + 60 * 60 * 1000) - now) : 0,
      daily: user.lastClaim ? Math.max(0, (user.lastClaim + 24 * 60 * 60 * 1000) - now) : 0
    };

    const info = `
👑 *INFO RPG: ${user.name}*
━━━━━━━━━━━━━━━━━━━━━━━━

📋 *DATOS BÁSICOS:*
• JID: ${targetJid}
• Registrado: ${new Date(user.regTime).toLocaleDateString()}
• Edad: ${user.age}

📊 *NIVEL Y RANGO:*
• Nivel: ${user.level}
• XP: ${formatNumber(user.exp)}
• Rango: ${user.role}
• Clase: ${classInfo ? `${classInfo.emoji} ${classInfo.name}` : 'Sin clase'}

❤️ *STATS:*
• Vida: ${user.health}/${realMaxStats.maxHealth}
• Maná: ${user.mana}/${realMaxStats.maxMana}
• Energía: ${user.stamina}/${realMaxStats.maxStamina}
• Ataque: ${user.attack}
• Defensa: ${user.defense}
• Crítico: ${user.critChance}%

💰 *ECONOMÍA:*
• Dinero: ${formatNumber(user.money)}
• Diamantes: ${formatNumber(user.limit)}
• Pociones: ${user.potion}
• Items: ${user.inventory.length}

⚔️ *COMBATE:*
• Kills: ${user.combatStats.totalKills}
• Dungeons: ${user.combatStats.dungeonsCompleted}
• PvP Wins: ${user.combatStats.pvpWins}
• PvP Losses: ${user.combatStats.pvpLosses}
• Bosses: ${user.combatStats.bossesKilled}

⏰ *COOLDOWNS:*
• Work: ${cooldowns.work > 0 ? msToTime(cooldowns.work) : '✅ Listo'}
• Mine: ${cooldowns.mine > 0 ? msToTime(cooldowns.mine) : '✅ Listo'}
• Rob: ${cooldowns.rob > 0 ? msToTime(cooldowns.rob) : '✅ Listo'}
• Daily: ${cooldowns.daily > 0 ? msToTime(cooldowns.daily) : '✅ Listo'}

🎒 *EQUIPAMIENTO:*
• Arma: ${user.equipment.weapon || 'Ninguna'}
• Armadura: ${user.equipment.armor || 'Ninguna'}
• Accesorio: ${user.equipment.accessory || 'Ninguno'}
`;

    await m.reply(info);
  }
};

/**
 * Dar recursos a todos los usuarios registrados
 */
export const rpgDarATodosPlugin: PluginHandler = {
  command: ['rpgdaratodos', 'rpggiveall'],
  tags: ['owner'],
  help: ['rpgdaratodos [tipo] [cantidad] - Da recursos a TODOS los registrados'],
  owner: true,

  handler: async (ctx: MessageContext) => {
    const { m, args } = ctx;
    const db = getDatabase();

    const type = args[0]?.toLowerCase();
    const amount = parseInt(args[1]) || 0;

    if (!type || amount <= 0) {
      return m.reply(
        `${EMOJI.error} Uso: .rpgdaratodos [tipo] [cantidad]\n\n` +
        `*Tipos:* dinero, xp, mana, diamantes`
      );
    }

    const registeredUsers = db.getRegisteredUsers();
    let count = 0;

    for (const [jid, user] of registeredUsers) {
      const updates: Record<string, number> = {};

      switch (type) {
        case 'dinero':
        case 'money':
          updates.money = user.money + amount;
          break;
        case 'xp':
        case 'exp':
          updates.exp = user.exp + amount;
          break;
        case 'mana':
          updates.mana = Math.min(user.maxMana, user.mana + amount);
          break;
        case 'diamantes':
        case 'diamonds':
          updates.limit = user.limit + amount;
          break;
      }

      if (Object.keys(updates).length > 0) {
        db.updateUser(jid, updates);
        count++;
      }
    }

    await m.reply(
      `👑 *REGALO MASIVO*\n\n` +
      `🎁 Se ha dado *${formatNumber(amount)} ${type}* a *${count}* usuarios registrados!`
    );
    await m.react('🎁');
  }
};

/**
 * Lluvia de dinero en el grupo
 */
export const rpgLluviaMoneyPlugin: PluginHandler = {
  command: ['rpglluviamoney', 'rpgrainmoney', 'lluviadinero'],
  tags: ['owner'],
  help: ['rpglluviamoney [cantidad] - Lluvia de dinero aleatorio en el grupo'],
  owner: true,
  group: true,

  handler: async (ctx: MessageContext) => {
    const { m, args, participants } = ctx;
    const db = getDatabase();

    const totalAmount = parseInt(args[0]) || 10000;

    if (!participants || participants.length === 0) {
      return m.reply(`${EMOJI.error} No hay participantes en el grupo`);
    }

    // Filtrar solo usuarios registrados
    const registeredUsers = participants.filter(jid => {
      const user = db.getUser(jid);
      return user.registered;
    });

    if (registeredUsers.length === 0) {
      return m.reply(`${EMOJI.error} No hay usuarios registrados en el grupo`);
    }

    // Mezclar usuarios aleatoriamente para distribución justa (Fisher-Yates shuffle)
    const shuffledUsers = [...registeredUsers];
    for (let i = shuffledUsers.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffledUsers[i], shuffledUsers[j]] = [shuffledUsers[j], shuffledUsers[i]];
    }

    // Distribuir dinero aleatoriamente
    const distributions: { jid: string; amount: number; name: string }[] = [];
    let remaining = totalAmount;

    for (let i = 0; i < shuffledUsers.length; i++) {
      const jid = shuffledUsers[i];
      const user = db.getUser(jid);

      let amount: number;
      if (i === shuffledUsers.length - 1) {
        amount = remaining;
      } else {
        // Dar cantidad aleatoria entre 5% y 40% del restante para más variabilidad
        const minShare = Math.floor(remaining * 0.05);
        const maxShare = Math.floor(remaining * 0.4);
        amount = Math.floor(Math.random() * (maxShare - minShare + 1)) + minShare;
        amount = Math.min(amount, remaining);
      }

      remaining -= amount;

      db.updateUser(jid, { money: user.money + amount });
      distributions.push({ jid, amount, name: user.name });
    }

    // Ordenar por cantidad recibida
    distributions.sort((a, b) => b.amount - a.amount);

    let msg = `🌧️ *¡¡LLUVIA DE DINERO!!*\n━━━━━━━━━━━━━━━━━━━━\n\n`;
    msg += `💰 Total: *${formatNumber(totalAmount)}* monedas\n`;
    msg += `👥 Participantes: *${distributions.length}*\n\n`;
    msg += `📊 *DISTRIBUCIÓN:*\n`;

    for (const dist of distributions.slice(0, 10)) {
      msg += `• ${dist.name}: +${formatNumber(dist.amount)} 💰\n`;
    }

    if (distributions.length > 10) {
      msg += `_... y ${distributions.length - 10} más_`;
    }

    await m.reply(msg);
    await m.react('🌧️');
  }
};

/**
 * Borrar progreso RPG de un usuario
 */
export const rpgBorrarPlugin: PluginHandler = {
  command: ['rpgborrar', 'rpgdelete', 'rpgreset'],
  tags: ['owner'],
  help: ['rpgborrar @user - ELIMINA el progreso RPG de un usuario'],
  owner: true,

  handler: async (ctx: MessageContext) => {
    const { m, text } = ctx;
    const db = getDatabase();

    const targetJid = getTargetUserOrSelf(ctx);

    const user = db.getUser(targetJid);
    if (!user.registered) {
      return m.reply(`${EMOJI.error} ${targetJid === m.sender ? 'No estás registrado' : 'Este usuario no está registrado'} en el RPG`);
    }

    // Confirmación
    if (!text.includes('confirmar')) {
      return m.reply(
        `⚠️ *ADVERTENCIA*\n\n` +
        `Esto ELIMINARÁ todo el progreso RPG de *${user.name}*:\n` +
        `• Nivel ${user.level}\n` +
        `• ${formatNumber(user.money)} monedas\n` +
        `• ${formatNumber(user.limit)} diamantes\n` +
        `• ${user.inventory.length} items\n\n` +
        `Para confirmar, escribe:\n` +
        `\`.rpgborrar [@user] confirmar\`\n\n` +
        `💡 _Sin mención se aplica a ti mismo_`
      );
    }

    // Resetear a valores por defecto
    const { DEFAULT_USER } = await import('../types/user.js');
    db.updateUser(targetJid, { ...DEFAULT_USER });

    await m.reply(
      `👑 *PROGRESO ELIMINADO*\n\n` +
      `🗑️ Se ha eliminado todo el progreso RPG de *${user.name}*`
    );
    await m.react('🗑️');
  }
};

/**
 * Ver ranking
 */
export const rpgTopPlugin: PluginHandler = {
  command: ['rpgtop', 'rpgranking'],
  tags: ['owner'],
  help: ['rpgtop [tipo] - Ver ranking de jugadores'],
  owner: true,

  handler: async (ctx: MessageContext) => {
    const { m, args } = ctx;
    const db = getDatabase();

    const type = args[0]?.toLowerCase() || 'level';

    const users = db.getRegisteredUsers()
      .map(([jid, user]) => ({ jid, ...user }));

    let sorted: typeof users;
    let title: string;
    let format: (user: typeof users[0]) => string;

    switch (type) {
      case 'level':
      case 'nivel':
        sorted = users.sort((a, b) => b.level - a.level);
        title = '📊 RANKING POR NIVEL';
        format = (u) => `Nv.${u.level} - ${formatNumber(u.exp)} XP`;
        break;
      case 'money':
      case 'dinero':
        sorted = users.sort((a, b) => b.money - a.money);
        title = '💰 RANKING POR DINERO';
        format = (u) => `${formatNumber(u.money)} monedas`;
        break;
      case 'diamonds':
      case 'diamantes':
        sorted = users.sort((a, b) => b.limit - a.limit);
        title = '💎 RANKING POR DIAMANTES';
        format = (u) => `${formatNumber(u.limit)} diamantes`;
        break;
      case 'pvp':
        sorted = users.sort((a, b) => b.combatStats.pvpWins - a.combatStats.pvpWins);
        title = '⚔️ RANKING PVP';
        format = (u) => `${u.combatStats.pvpWins}W - ${u.combatStats.pvpLosses}L`;
        break;
      case 'kills':
        sorted = users.sort((a, b) => b.combatStats.totalKills - a.combatStats.totalKills);
        title = '☠️ RANKING POR KILLS';
        format = (u) => `${formatNumber(u.combatStats.totalKills)} kills`;
        break;
      default:
        return m.reply(
          `${EMOJI.error} Tipo inválido.\n\n` +
          `*Tipos:* level, money, diamonds, pvp, kills`
        );
    }

    const top10 = sorted.slice(0, 10);

    let msg = `👑 *${title}*\n━━━━━━━━━━━━━━━━━━━━\n\n`;

    const medals = ['🥇', '🥈', '🥉'];
    top10.forEach((user, i) => {
      const medal = medals[i] || `${i + 1}.`;
      msg += `${medal} *${user.name}*\n   ${format(user)}\n\n`;
    });

    msg += `\n📊 Total registrados: ${users.length}`;

    await m.reply(msg);
  }
};

// ==================== EVENTOS AUTOMÁTICOS ====================

/**
 * Activar/Desactivar eventos automáticos
 */
export const rpgAutoEventsPlugin: PluginHandler = {
  command: ['rpgautoevents', 'autoevents', 'autoeventos'],
  tags: ['owner'],
  help: ['rpgautoevents [on/off] - Activa/desactiva eventos aleatorios automáticos'],
  owner: true,

  handler: async (ctx: MessageContext) => {
    const { m, args } = ctx;

    const action = args[0]?.toLowerCase();

    if (!action || !['on', 'off', 'activar', 'desactivar'].includes(action)) {
      const status = getAutoEventStatus();
      return m.reply(
        `🎲 *EVENTOS AUTOMÁTICOS*\n\n` +
        `Estado actual: ${status.enabled ? '✅ ACTIVADO' : '❌ DESACTIVADO'}\n\n` +
        `Uso: \`.rpgautoevents [on/off]\``
      );
    }

    const enable = action === 'on' || action === 'activar';
    toggleAutoEvents(enable);

    await m.reply(
      `🎲 *EVENTOS AUTOMÁTICOS*\n\n` +
      `${enable ? '✅ Sistema ACTIVADO' : '❌ Sistema DESACTIVADO'}\n\n` +
      `${enable ? '_Los eventos aleatorios comenzarán a aparecer automáticamente._' : '_No habrá más eventos automáticos._'}`
    );
    await m.react(enable ? '✅' : '❌');
  }
};

/**
 * Agregar grupo a anuncios de eventos
 */
export const rpgAddGrupoPlugin: PluginHandler = {
  command: ['rpgaddgrupo', 'rpgaddgroup', 'eventaddgroup'],
  tags: ['owner'],
  help: ['rpgaddgrupo - Agrega este grupo a los anuncios de eventos'],
  owner: true,
  group: true,

  handler: async (ctx: MessageContext) => {
    const { m } = ctx;
    const groupId = m.chat;

    const added = addAnnouncementGroup(groupId);

    if (added) {
      await m.reply(
        `🎲 *GRUPO AGREGADO*\n\n` +
        `✅ Este grupo ahora recibirá anuncios de eventos automáticos.\n\n` +
        `📊 Total de grupos: *${autoEventConfig.announcementGroups.length}*`
      );
      await m.react('✅');
    } else {
      await m.reply(`${EMOJI.warning} Este grupo ya está en la lista de anuncios.`);
    }
  }
};

/**
 * Remover grupo de anuncios de eventos
 */
export const rpgRemoveGrupoPlugin: PluginHandler = {
  command: ['rpgremovegrupo', 'rpgremovegroup', 'eventremovegroup'],
  tags: ['owner'],
  help: ['rpgremovegrupo - Remueve este grupo de los anuncios de eventos'],
  owner: true,
  group: true,

  handler: async (ctx: MessageContext) => {
    const { m } = ctx;
    const groupId = m.chat;

    const removed = removeAnnouncementGroup(groupId);

    if (removed) {
      await m.reply(
        `🎲 *GRUPO REMOVIDO*\n\n` +
        `❌ Este grupo ya no recibirá anuncios de eventos automáticos.\n\n` +
        `📊 Total de grupos: *${autoEventConfig.announcementGroups.length}*`
      );
      await m.react('✅');
    } else {
      await m.reply(`${EMOJI.warning} Este grupo no estaba en la lista de anuncios.`);
    }
  }
};

/**
 * Configurar intervalo de eventos
 */
export const rpgEventIntervalPlugin: PluginHandler = {
  command: ['rpgeventinterval', 'eventinterval', 'intervaloeventos'],
  tags: ['owner'],
  help: ['rpgeventinterval [min] [max] - Configura el intervalo entre eventos (en minutos)'],
  owner: true,

  handler: async (ctx: MessageContext) => {
    const { m, args } = ctx;

    const minMinutes = parseInt(args[0]);
    const maxMinutes = parseInt(args[1]);

    if (isNaN(minMinutes) || isNaN(maxMinutes) || minMinutes < 1 || maxMinutes < minMinutes) {
      const status = getAutoEventStatus();
      return m.reply(
        `🎲 *INTERVALO DE EVENTOS*\n\n` +
        `Intervalo actual: *${status.minInterval}* - *${status.maxInterval}*\n\n` +
        `Uso: \`.rpgeventinterval [min] [max]\`\n` +
        `Ejemplo: \`.rpgeventinterval 30 120\`\n` +
        `_(eventos cada 30-120 minutos)_`
      );
    }

    setEventIntervals(minMinutes, maxMinutes);

    await m.reply(
      `🎲 *INTERVALO ACTUALIZADO*\n\n` +
      `⏰ Nuevo intervalo: *${minMinutes}* - *${maxMinutes}* minutos\n\n` +
      `_Los eventos aparecerán aleatoriamente dentro de este rango._`
    );
    await m.react('✅');
  }
};

/**
 * Forzar evento aleatorio
 */
export const rpgForceEventPlugin: PluginHandler = {
  command: ['rpgforceevent', 'forceevent', 'forzarevento'],
  tags: ['owner'],
  help: ['rpgforceevent - Fuerza un evento aleatorio inmediatamente'],
  owner: true,

  handler: async (ctx: MessageContext) => {
    const { m } = ctx;

    await m.reply(`🎲 *Generando evento aleatorio...*`);

    const event = await forceRandomEvent();

    const rarityText = event.isLegendary ? '🏆 LEGENDARIO' :
                       event.isEpic ? '💎 ÉPICO' : '📢 Normal';

    await m.reply(
      `🎲 *EVENTO FORZADO*\n\n` +
      `${event.type.emoji} *${event.type.name}*\n` +
      `⚡ Multiplicador: *x${event.multiplier}*\n` +
      `⏰ Duración: *${event.durationName}*\n` +
      `✨ Rareza: *${rarityText}*\n\n` +
      `_El evento ha sido anunciado en ${autoEventConfig.announcementGroups.length} grupos._`
    );
    await m.react('🎲');
  }
};

/**
 * Ver estado del sistema de eventos
 */
export const rpgEventStatusPlugin: PluginHandler = {
  command: ['rpgeventstatus', 'eventstatus', 'estadoeventos'],
  tags: ['owner'],
  help: ['rpgeventstatus - Ver estado del sistema de eventos automáticos'],
  owner: true,

  handler: async (ctx: MessageContext) => {
    const { m } = ctx;

    const status = getAutoEventStatus();

    await m.reply(
      `🎲 *ESTADO DE EVENTOS AUTOMÁTICOS*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `📊 *Sistema:* ${status.enabled ? '✅ ACTIVADO' : '❌ DESACTIVADO'}\n\n` +
      `⏰ *Intervalo:*\n` +
      `   Mínimo: ${status.minInterval}\n` +
      `   Máximo: ${status.maxInterval}\n\n` +
      `📢 *Grupos de anuncio:* ${status.groups}\n\n` +
      `🎯 *Próximo evento:* ${status.nextEventIn || 'No programado'}\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `💡 *Multiplicadores posibles:*\n` +
      `   x2 (30%), x3 (25%), x4 (18%)\n` +
      `   x5 (12%), x6 (7%), x7 (4%)\n` +
      `   x8 (2%), x10 (2% - ÉPICO)\n\n` +
      `⏱️ *Duraciones posibles:*\n` +
      `   1m (15%), 2m (20%), 5m (30%)\n` +
      `   10m (25%), 30m (10% - RARO)`
    );
  }
};

// Exportar todos los plugins
export default [
  ownerRpgMenuPlugin,
  rpgDarPlugin,
  rpgQuitarPlugin,
  rpgSetPlugin,
  rpgDarItemPlugin,
  rpgListItemsPlugin,
  rpgBonusPlugin,
  rpgRoboLibrePlugin,
  rpgEventoPlugin,
  rpgPvpModePlugin,
  rpgCaosModePlugin,
  rpgDesactivarPlugin,
  rpgResetCdPlugin,
  rpgResetCdAllPlugin,
  rpgSetClasePlugin,
  rpgFullStatsPlugin,
  rpgMaxLevelPlugin,
  rpgInfoPlugin,
  rpgDarATodosPlugin,
  rpgLluviaMoneyPlugin,
  rpgBorrarPlugin,
  rpgTopPlugin,
  // Eventos automáticos
  rpgAutoEventsPlugin,
  rpgAddGrupoPlugin,
  rpgRemoveGrupoPlugin,
  rpgEventIntervalPlugin,
  rpgForceEventPlugin,
  rpgEventStatusPlugin
];
