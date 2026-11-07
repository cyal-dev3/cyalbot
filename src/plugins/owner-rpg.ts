import type { PluginHandler, MessageContext } from '../types/message.js';
import { getDatabase, type Database } from '../lib/database.js';
import { EMOJI, formatNumber, msToTime, getTargetUserOrSelf } from '../lib/utils.js';
import { getRoleByLevel, type UserRPG } from '../types/user.js';
import { ITEMS, CLASSES, FORGE_MATERIALS, type PlayerClass } from '../types/rpg.js';
import { COOLDOWNS, PVP } from '../constants/rpg.js';
import { calculateTotalStats } from '../lib/rpg-utils.js';
import { grantExp, loseExp, setLevel } from '../lib/levelling.js';
import { globalModes, getActiveModes, type GlobalModeKey } from '../lib/global-modes.js';
import { addItem, addMaterial, countItem, removeItem } from '../lib/rpg-inventory.js';
import { clearBusy, getBusy, listBusy } from '../lib/rpg-combat.js';
import {
  autoEventConfig, toggleAutoEvents, addAnnouncementGroup, removeAnnouncementGroup, setEventIntervals,
  forceRandomEvent, getAutoEventStatus
} from '../lib/auto-events.js';
import { activeDuels, cancelDuel } from './rpg-duelo.js';
import { activeDungeons, cancelDungeon } from './rpg-dungeon-interactivo.js';

/** Los demás plugins importaban los modos desde aquí; ahora viven en lib/global-modes.ts */
export { globalModes, checkExpiredModes } from '../lib/global-modes.js';

// ==================== UTILIDADES ====================

function parseTime(timeStr: string | undefined): number {
  const match = (timeStr ?? '').match(/^(\d+)(s|m|h|d)$/i);
  if (!match) return 0;
  const value = parseInt(match[1], 10);
  const units: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return value * units[match[2].toLowerCase()];
}

/** Entero >= 1 o null */
function parseCount(raw: string | undefined): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  const value = parseInt(raw, 10);
  return Number.isSafeInteger(value) && value >= 1 ? value : null;
}

/**
 * Argumentos sin los tokens de mención ("@521..."): la mención viaja en el
 * texto, así que "rpgdaritem @user espada 2" tiene el item en args[1] y no en args[0].
 */
function argsWithoutMentions(ctx: MessageContext): string[] {
  return ctx.args.filter(a => !/^@\d+$/.test(a));
}

/** Objetivo mencionado o citado; sin mención, el propio owner */
function targetOf(ctx: MessageContext): string {
  return getTargetUserOrSelf({ mentionedJid: ctx.m.mentionedJid, quoted: ctx.m.quoted, chat: ctx.m.chat, sender: ctx.m.sender });
}

function notRegistered(ctx: MessageContext, jid: string): string {
  return `${EMOJI.error} ${jid === ctx.m.sender ? 'No estás registrado' : 'Este usuario no está registrado'} en el RPG`;
}

type CooldownField = 'lastWork' | 'lastMine' | 'lastRob' | 'lastDuel' | 'lastAttack' | 'lastDungeon' | 'lastClaim' | 'lastBomb' | 'lastFumar';

const COOLDOWN_TYPES: Record<string, CooldownField> = {
  work: 'lastWork', trabajo: 'lastWork',
  mine: 'lastMine', minar: 'lastMine',
  rob: 'lastRob', robar: 'lastRob',
  duel: 'lastDuel', duelo: 'lastDuel',
  attack: 'lastAttack', atacar: 'lastAttack',
  dungeon: 'lastDungeon',
  daily: 'lastClaim', diario: 'lastClaim',
  bomb: 'lastBomb', bomba: 'lastBomb',
  fumar: 'lastFumar'
};

/** Campos de cooldown que corresponden a un tipo; 'all' devuelve todos */
export function cooldownFieldsFor(type: string): CooldownField[] {
  if (type === 'all' || type === 'todos') return [...new Set(Object.values(COOLDOWN_TYPES))];
  const field = COOLDOWN_TYPES[type];
  return field ? [field] : [];
}

const COOLDOWN_TYPE_LIST = 'work, mine, rob, duel, attack, dungeon, daily, bomb, fumar, all';

function modeLines(now: number): string {
  const active = getActiveModes(now);
  if (active.length === 0) return '_Ningún modo especial activo_\n';
  const describe: Record<GlobalModeKey, () => string> = {
    bonusMode: () => `Bonus (x${globalModes.bonusMode.expMultiplier} XP, x${globalModes.bonusMode.moneyMultiplier} 💰)`,
    freeRobMode: () => 'Robo Libre (sin cooldown)',
    eventMode: () => `Evento "${globalModes.eventMode.eventName}" (x${globalModes.eventMode.dropMultiplier})`,
    pvpMode: () => `PvP Intenso (x${globalModes.pvpMode.damageMultiplier} daño)`,
    chaosMode: () => `MODO CAOS (x${globalModes.chaosMode.multiplier} TODO)`
  };
  return active.map(a => `✅ ${describe[a.key]()} - ${msToTime(a.remainingMs)} (${a.activatedBy === 'SISTEMA_AUTO' ? 'automático' : 'owner'})\n`).join('');
}

// ==================== MENÚ ====================

export const ownerRpgMenuPlugin: PluginHandler = {
  command: ['rpgowner', 'ownerrpg', 'rpgadmin', 'rpgmenu'],
  tags: ['owner'],
  help: ['rpgowner - Muestra el menú de comandos del owner RPG'],
  owner: true,

  handler: async (ctx: MessageContext) => {
    const { m, usedPrefix: p } = ctx;
    const menu = `
👑 *PANEL DE CONTROL RPG - OWNER*
━━━━━━━━━━━━━━━━━━━━━━━━
📊 *MODOS ACTIVOS:*
${modeLines(Date.now())}━━━━━━━━━━━━━━━━━━━━━━━━

💰 *RECURSOS:*
• \`${p}rpgdar\` @user [tipo] [cantidad]
  _Tipos: dinero, xp, mana, diamantes, vida, stamina_
• \`${p}rpgquitar\` @user [tipo] [cantidad]
• \`${p}rpgset\` @user [stat] [valor]
  _Stats: level, attack, defense, crit, maxhealth, maxmana, maxstamina_
• \`${p}rpgdaritem\` @user [itemId|materialId] [cantidad]
• \`${p}rpgquitaritem\` @user [itemId] [cantidad]

🎭 *MODOS ESPECIALES:*
• \`${p}rpgbonus\` [xp] [dinero] [mana] [tiempo]
• \`${p}rpgrobolibre\` [tiempo]
• \`${p}rpgevento\` "nombre" [multiplicador] [tiempo]
• \`${p}rpgpvp\` [multiplicador] [tiempo]
• \`${p}rpgcaos\` [multiplicador] [tiempo]
• \`${p}rpgdesactivar\` [bonus|robo|evento|pvp|caos|todos]

⏰ *COOLDOWNS:*
• \`${p}rpgresetcd\` @user [tipo]
• \`${p}rpgresetcdall\` [tipo]
  _Tipos: ${COOLDOWN_TYPE_LIST}_

🔧 *MODIFICACIONES:*
• \`${p}rpgsetclase\` @user [guerrero|mago|ladron|arquero]
• \`${p}rpgfullstats\` @user
• \`${p}rpgsetnivel\` @user [nivel]
• \`${p}rpgborrar\` @user confirmar

📊 *INFORMACIÓN:*
• \`${p}rpginfo\` @user
• \`${p}rpglistitems\` [tipo]
• \`${p}rpgtop\` [level|money|diamonds|pvp|kills]
• \`${p}rpgsesiones\` - Duelos y dungeons en curso
• \`${p}rpgcancelar\` [@user|duelo] - Desatasca una sesión

🎁 *RECOMPENSAS MASIVAS:*
• \`${p}rpgdaratodos\` [tipo] [cantidad]
• \`${p}rpglluviamoney\` [cantidad]

🎲 *EVENTOS AUTOMÁTICOS:*
• \`${p}rpgautoevents\` [on|off]
• \`${p}rpgaddgrupo\` / \`${p}rpgremovegrupo\`
• \`${p}rpgeventinterval\` [min] [max]
• \`${p}rpgforceevent\` / \`${p}rpgeventstatus\`

👹 *JEFE MUNDIAL:* \`${p}bossinvocar\` [nombre] / \`${p}bossdespedir\`

⚠️ *Tiempos válidos: 30s, 5m, 1h, 2h, 1d*
`;
    await m.reply(menu);
  }
};

// ==================== RECURSOS ====================

type ResourceKey = 'money' | 'exp' | 'mana' | 'limit' | 'health' | 'stamina';

const RESOURCE_ALIASES: Record<string, ResourceKey> = {
  dinero: 'money', money: 'money', monedas: 'money',
  xp: 'exp', exp: 'exp', experiencia: 'exp',
  mana: 'mana',
  diamantes: 'limit', diamonds: 'limit', limit: 'limit',
  vida: 'health', health: 'health', hp: 'health',
  stamina: 'stamina', energia: 'stamina', energy: 'stamina'
};

const RESOURCE_LABEL: Record<ResourceKey, { name: string; emoji: string }> = {
  money: { name: 'monedas', emoji: '💰' },
  exp: { name: 'XP', emoji: '✨' },
  mana: { name: 'maná', emoji: '💠' },
  limit: { name: 'diamantes', emoji: '💎' },
  health: { name: 'vida', emoji: '❤️' },
  stamina: { name: 'energía', emoji: '⚡' }
};

/** Suma (o resta con amount negativo) un recurso respetando los máximos reales; devuelve el nuevo total */
function applyResource(db: Database, jid: string, user: UserRPG, key: ResourceKey, amount: number): number {
  const stats = calculateTotalStats(user);
  switch (key) {
    case 'exp': {
      if (amount >= 0) grantExp(user, amount);
      else loseExp(user, -amount);
      db.updateUser(jid, { exp: user.exp, level: user.level, maxHealth: user.maxHealth, maxStamina: user.maxStamina, maxMana: user.maxMana, health: user.health, stamina: user.stamina, mana: user.mana, money: user.money });
      return user.exp;
    }
    case 'money': {
      const value = Math.max(0, user.money + amount);
      db.updateUser(jid, { money: value });
      return value;
    }
    case 'limit': {
      const value = Math.max(0, user.limit + amount);
      db.updateUser(jid, { limit: value });
      return value;
    }
    case 'mana': {
      const value = Math.max(0, Math.min(stats.maxMana, user.mana + amount));
      db.updateUser(jid, { mana: value });
      return value;
    }
    case 'health': {
      const value = Math.max(1, Math.min(stats.maxHealth, user.health + amount));
      db.updateUser(jid, { health: value });
      return value;
    }
    case 'stamina': {
      const value = Math.max(0, Math.min(stats.maxStamina, user.stamina + amount));
      db.updateUser(jid, { stamina: value });
      return value;
    }
  }
}

export const rpgDarPlugin: PluginHandler = {
  command: ['rpgdar', 'rpggive', 'rpgadd'],
  tags: ['owner'],
  help: ['rpgdar @user [tipo] [cantidad] - Da recursos a un usuario'],
  owner: true,

  handler: async (ctx: MessageContext) => {
    const { m, usedPrefix } = ctx;
    const args = argsWithoutMentions(ctx);
    const db = getDatabase();
    const jid = targetOf(ctx);
    const user = db.getUser(jid);
    if (!user.registered) return m.reply(notRegistered(ctx, jid));

    const key = RESOURCE_ALIASES[args[0]?.toLowerCase() ?? ''];
    const amount = parseCount(args[1]);
    if (!key || amount === null) {
      return m.reply(
        `${EMOJI.error} Uso: ${usedPrefix}rpgdar [@user] [tipo] [cantidad]\n\n` +
        `*Tipos:* dinero, xp, mana, diamantes, vida, stamina\n` +
        `La cantidad debe ser un entero mayor que 0.\n💡 _Sin mención se aplica a ti mismo_`
      );
    }

    const total = applyResource(db, jid, user, key, amount);
    const label = RESOURCE_LABEL[key];
    await m.reply(`👑 *OWNER RPG*\n\n${label.emoji} Has dado *${formatNumber(amount)} ${label.name}* a *${user.name}*\n\n📊 Nuevo total: *${formatNumber(total)}*${key === 'exp' ? ` (nivel ${user.level})` : ''}`);
    await m.react('✅');
  }
};

export const rpgQuitarPlugin: PluginHandler = {
  command: ['rpgquitar', 'rpgremove', 'rpgtake'],
  tags: ['owner'],
  help: ['rpgquitar @user [tipo] [cantidad] - Quita recursos a un usuario'],
  owner: true,

  handler: async (ctx: MessageContext) => {
    const { m, usedPrefix } = ctx;
    const args = argsWithoutMentions(ctx);
    const db = getDatabase();
    const jid = targetOf(ctx);
    const user = db.getUser(jid);
    if (!user.registered) return m.reply(notRegistered(ctx, jid));

    const key = RESOURCE_ALIASES[args[0]?.toLowerCase() ?? ''];
    const amount = parseCount(args[1]);
    if (!key || amount === null) {
      return m.reply(`${EMOJI.error} Uso: ${usedPrefix}rpgquitar [@user] [tipo] [cantidad]\n\n*Tipos:* dinero, xp, mana, diamantes, vida, stamina\n💡 _Sin mención se aplica a ti mismo_`);
    }

    const total = applyResource(db, jid, user, key, -amount);
    const label = RESOURCE_LABEL[key];
    await m.reply(`👑 *OWNER RPG*\n\n${label.emoji} Has quitado *${formatNumber(amount)} ${label.name}* a *${user.name}*\n\n📊 Nuevo total: *${formatNumber(total)}*`);
    await m.react('✅');
  }
};

export const rpgSetPlugin: PluginHandler = {
  command: ['rpgset', 'rpgsetstat'],
  tags: ['owner'],
  help: ['rpgset @user [stat] [valor] - Establece un stat (level, attack, defense, crit, maxhealth, maxmana, maxstamina)'],
  owner: true,

  handler: async (ctx: MessageContext) => {
    const { m, usedPrefix } = ctx;
    const args = argsWithoutMentions(ctx);
    const db = getDatabase();
    const jid = targetOf(ctx);
    const user = db.getUser(jid);
    if (!user.registered) return m.reply(notRegistered(ctx, jid));

    const stat = args[0]?.toLowerCase();
    const value = parseInt(args[1] ?? '', 10);
    if (!stat || !Number.isFinite(value)) {
      return m.reply(
        `${EMOJI.error} Uso: ${usedPrefix}rpgset [@user] [stat] [valor]\n\n` +
        `*Stats:* level, attack, defense, crit, maxhealth, maxmana, maxstamina\n💡 _Sin mención se aplica a ti mismo_`
      );
    }

    const updates: Partial<UserRPG> = {};
    switch (stat) {
      case 'level': case 'nivel': {
        const result = setLevel(user, value);
        db.updateUser(jid, user);
        await m.reply(`👑 *OWNER RPG*\n\n📈 *${user.name}* pasa del nivel ${result.from} al *${result.to}*\n🏆 Rango: ${getRoleByLevel(user.level)}`);
        await m.react('✅');
        return;
      }
      case 'attack': case 'ataque': updates.attack = Math.max(1, value); break;
      case 'defense': case 'defensa': updates.defense = Math.max(0, value); break;
      case 'crit': case 'critico': updates.critChance = Math.max(0, Math.min(100, value)); break;
      case 'maxhealth': case 'maxvida':
        updates.maxHealth = Math.max(1, value);
        break;
      case 'maxmana':
        updates.maxMana = Math.max(0, value);
        break;
      case 'maxstamina': case 'maxenergia':
        updates.maxStamina = Math.max(0, value);
        break;
      default:
        return m.reply(`${EMOJI.error} Stat no válido. Usa: level, attack, defense, crit, maxhealth, maxmana, maxstamina`);
    }

    // Los stats actuales se acotan al nuevo máximo real (clase y equipo incluidos)
    const stats = calculateTotalStats({ ...user, ...updates });
    updates.health = Math.min(user.health, stats.maxHealth);
    updates.mana = Math.min(user.mana, stats.maxMana);
    updates.stamina = Math.min(user.stamina, stats.maxStamina);
    db.updateUser(jid, updates);

    await m.reply(`👑 *OWNER RPG*\n\n⚙️ Has establecido *${stat}* de *${user.name}* a *${formatNumber(value)}*`);
    await m.react('✅');
  }
};

export const rpgDarItemPlugin: PluginHandler = {
  command: ['rpgdaritem', 'rpggiveitem', 'rpgadditem'],
  tags: ['owner'],
  help: ['rpgdaritem @user [itemId|materialId] [cantidad] - Da items o materiales'],
  owner: true,

  handler: async (ctx: MessageContext) => {
    const { m, usedPrefix } = ctx;
    const args = argsWithoutMentions(ctx);
    const db = getDatabase();
    const jid = targetOf(ctx);
    const user = db.getUser(jid);
    if (!user.registered) return m.reply(notRegistered(ctx, jid));

    const id = args[0]?.toLowerCase();
    const quantity = args[1] === undefined ? 1 : parseCount(args[1]);
    if (!id || quantity === null) {
      return m.reply(`${EMOJI.error} Uso: ${usedPrefix}rpgdaritem [@user] [itemId] [cantidad]\n\n💡 Usa \`${usedPrefix}rpglistitems\` para ver los IDs\n💡 _Sin mención se aplica a ti mismo_`);
    }

    if (FORGE_MATERIALS[id]) {
      addMaterial(user, id, quantity);
      db.updateUser(jid, { forgeMaterials: user.forgeMaterials });
      const material = FORGE_MATERIALS[id];
      await m.reply(`👑 *OWNER RPG*\n\n${material.emoji} Has dado *${quantity}x ${material.name}* (material) a *${user.name}*`);
      await m.react('✅');
      return;
    }

    const item = ITEMS[id];
    if (!item) return m.reply(`${EMOJI.error} Item "${id}" no encontrado. Usa \`${usedPrefix}rpglistitems\``);

    const result = addItem(user, id, quantity);
    db.updateUser(jid, { inventory: user.inventory });
    let msg = `👑 *OWNER RPG*\n\n${item.emoji} Has dado *${result.added}x ${item.name}* a *${user.name}*`;
    if (!result.ok) msg += `\n${EMOJI.warning} Inventario lleno: solo cupieron ${result.added} de ${quantity}`;
    await m.reply(msg);
    await m.react('✅');
  }
};

export const rpgQuitarItemPlugin: PluginHandler = {
  command: ['rpgquitaritem', 'rpgremoveitem', 'rpgtakeitem'],
  tags: ['owner'],
  help: ['rpgquitaritem @user [itemId] [cantidad] - Quita items del inventario'],
  owner: true,

  handler: async (ctx: MessageContext) => {
    const { m, usedPrefix } = ctx;
    const args = argsWithoutMentions(ctx);
    const db = getDatabase();
    const jid = targetOf(ctx);
    const user = db.getUser(jid);
    if (!user.registered) return m.reply(notRegistered(ctx, jid));

    const id = args[0]?.toLowerCase();
    const quantity = args[1] === undefined ? 1 : parseCount(args[1]);
    if (!id || quantity === null) {
      return m.reply(`${EMOJI.error} Uso: ${usedPrefix}rpgquitaritem [@user] [itemId] [cantidad]`);
    }
    const item = ITEMS[id];
    if (!item) return m.reply(`${EMOJI.error} Item "${id}" no encontrado.`);

    const owned = countItem(user, id);
    if (!removeItem(user, id, quantity)) {
      return m.reply(`${EMOJI.error} *${user.name}* solo tiene ${owned}x ${item.name}.`);
    }
    if (owned - quantity <= 0) {
      for (const slot of ['weapon', 'armor', 'accessory'] as const) {
        if (user.equipment[slot] === id) user.equipment[slot] = null;
      }
    }
    db.updateUser(jid, { inventory: user.inventory, equipment: user.equipment });
    await m.reply(`👑 *OWNER RPG*\n\n${item.emoji} Has quitado *${quantity}x ${item.name}* a *${user.name}* (le quedan ${owned - quantity})`);
    await m.react('✅');
  }
};

export const rpgListItemsPlugin: PluginHandler = {
  command: ['rpglistitems', 'rpgitems'],
  tags: ['owner'],
  help: ['rpglistitems [weapon|armor|accessory|consumable|material] - Lista los ids'],
  owner: true,

  handler: async (ctx: MessageContext) => {
    const { m, args, usedPrefix } = ctx;
    const category = args[0]?.toLowerCase();

    const sections: Record<string, string[]> = { weapon: [], armor: [], accessory: [], consumable: [] };
    for (const [id, item] of Object.entries(ITEMS)) {
      if (category && item.type !== category) continue;
      sections[item.type]?.push(`${item.emoji} \`${id}\` - ${item.name}`);
    }
    const materials = !category || category === 'material'
      ? Object.values(FORGE_MATERIALS).map(mat => `${mat.emoji} \`${mat.id}\` - ${mat.name}`)
      : [];

    let msg = `📦 *LISTA DE ITEMS*\n━━━━━━━━━━━━━━━━━━━━\n\n`;
    if (sections.weapon.length) msg += `⚔️ *ARMAS:*\n${sections.weapon.join('\n')}\n\n`;
    if (sections.armor.length) msg += `🛡️ *ARMADURAS:*\n${sections.armor.join('\n')}\n\n`;
    if (sections.accessory.length) msg += `💍 *ACCESORIOS:*\n${sections.accessory.join('\n')}\n\n`;
    if (sections.consumable.length) msg += `🧪 *CONSUMIBLES:*\n${sections.consumable.join('\n')}\n\n`;
    if (materials.length) msg += `🪨 *MATERIALES (forgeMaterials):*\n${materials.join('\n')}\n\n`;
    msg += `💡 Filtrar: \`${usedPrefix}rpglistitems [weapon|armor|accessory|consumable|material]\``;

    await m.reply(msg);
  }
};

// ==================== MODOS GLOBALES ====================

export const rpgBonusPlugin: PluginHandler = {
  command: ['rpgbonus', 'bonusmode', 'modobonus'],
  tags: ['owner'],
  help: ['rpgbonus [xp] [dinero] [mana] [tiempo] - Activa modo bonus global'],
  owner: true,

  handler: async (ctx: MessageContext) => {
    const { m, args, usedPrefix } = ctx;
    if (args.length < 4) {
      return m.reply(`${EMOJI.error} Uso: ${usedPrefix}rpgbonus [xpMult] [moneyMult] [manaMult] [tiempo]\n\n*Ejemplo:* \`${usedPrefix}rpgbonus 2 3 2 1h\`\n*Tiempos:* 30s, 5m, 1h, 2h, 1d`);
    }
    const expMult = parseFloat(args[0]) || 1;
    const moneyMult = parseFloat(args[1]) || 1;
    const manaMult = parseFloat(args[2]) || 1;
    const duration = parseTime(args[3]);
    if (duration <= 0) return m.reply(`${EMOJI.error} Tiempo inválido. Usa formatos como: 30m, 1h, 2h, 1d`);

    globalModes.bonusMode = { active: true, expMultiplier: expMult, moneyMultiplier: moneyMult, manaMultiplier: manaMult, expiresAt: Date.now() + duration, activatedBy: m.sender };
    await m.reply(`👑 *MODO BONUS ACTIVADO*\n━━━━━━━━━━━━━━━━━━━━\n\n✨ XP: *x${expMult}*\n💰 Dinero: *x${moneyMult}*\n💠 Maná: *x${manaMult}*\n\n⏰ Duración: *${msToTime(duration)}*`);
    await m.react('🎉');
  }
};

export const rpgRoboLibrePlugin: PluginHandler = {
  command: ['rpgrobolibre', 'freerobo', 'robofree', 'modorobo'],
  tags: ['owner'],
  help: ['rpgrobolibre [tiempo] - Activa robo sin cooldown'],
  owner: true,

  handler: async (ctx: MessageContext) => {
    const { m, args, usedPrefix } = ctx;
    const duration = parseTime(args[0]);
    if (duration <= 0) return m.reply(`${EMOJI.error} Uso: ${usedPrefix}rpgrobolibre [tiempo]\n\n*Ejemplo:* \`${usedPrefix}rpgrobolibre 30m\``);

    globalModes.freeRobMode = { active: true, expiresAt: Date.now() + duration, activatedBy: m.sender };
    await m.reply(`👑 *MODO ROBO LIBRE ACTIVADO*\n━━━━━━━━━━━━━━━━━━━━\n\n🦹 ¡Robo SIN COOLDOWN!\n⏰ Duración: *${msToTime(duration)}*`);
    await m.react('🦹');
  }
};

export const rpgEventoPlugin: PluginHandler = {
  command: ['rpgevento', 'rpgevent', 'modoevento'],
  tags: ['owner'],
  help: ['rpgevento "nombre" [multiplicador] [tiempo] - Activa un evento especial'],
  owner: true,

  handler: async (ctx: MessageContext) => {
    const { m, text, usedPrefix } = ctx;
    const match = text.match(/^"([^"]+)"\s+(\d+(?:\.\d+)?)\s+(\d+[smhd])$/i) || text.match(/^(\S+)\s+(\d+(?:\.\d+)?)\s+(\d+[smhd])$/i);
    if (!match) {
      return m.reply(`${EMOJI.error} Uso: ${usedPrefix}rpgevento "Nombre" [multiplicador] [tiempo]\n\n*Ejemplo:* \`${usedPrefix}rpgevento "Lluvia de Oro" 5 2h\``);
    }
    const eventName = match[1];
    const dropMult = parseFloat(match[2]) || 1;
    const duration = parseTime(match[3]);
    if (duration <= 0) return m.reply(`${EMOJI.error} Tiempo inválido`);

    globalModes.eventMode = { active: true, dropMultiplier: dropMult, eventName, expiresAt: Date.now() + duration, activatedBy: m.sender };
    await m.reply(`👑 *EVENTO ACTIVADO*\n━━━━━━━━━━━━━━━━━━━━\n\n🎪 *${eventName}*\n📦 Multiplicador: *x${dropMult}*\n⏰ Duración: *${msToTime(duration)}*`);
    await m.react('🎪');
  }
};

export const rpgPvpModePlugin: PluginHandler = {
  command: ['rpgpvp', 'modopvp', 'pvpmode'],
  tags: ['owner'],
  help: ['rpgpvp [multiplicador] [tiempo] - Daño aumentado en duelos'],
  owner: true,

  handler: async (ctx: MessageContext) => {
    const { m, args, usedPrefix } = ctx;
    const damageMult = parseFloat(args[0] ?? '');
    const duration = parseTime(args[1]);
    if (!Number.isFinite(damageMult) || damageMult <= 0 || duration <= 0) {
      return m.reply(`${EMOJI.error} Uso: ${usedPrefix}rpgpvp [multiplicador] [tiempo]\n\n*Ejemplo:* \`${usedPrefix}rpgpvp 2 1h\``);
    }
    globalModes.pvpMode = { active: true, damageMultiplier: damageMult, expiresAt: Date.now() + duration, activatedBy: m.sender };
    await m.reply(`👑 *MODO PVP INTENSO*\n━━━━━━━━━━━━━━━━━━━━\n\n⚔️ Daño en duelos: *x${damageMult}*\n⏰ Duración: *${msToTime(duration)}*`);
    await m.react('⚔️');
  }
};

export const rpgCaosModePlugin: PluginHandler = {
  command: ['rpgcaos', 'modocaos', 'chaosmode'],
  tags: ['owner'],
  help: ['rpgcaos [multiplicador] [tiempo] - Modo caos: todo multiplicado'],
  owner: true,

  handler: async (ctx: MessageContext) => {
    const { m, args, usedPrefix } = ctx;
    const multiplier = parseFloat(args[0] ?? '');
    const duration = parseTime(args[1]);
    if (!Number.isFinite(multiplier) || multiplier <= 0 || duration <= 0) {
      return m.reply(`${EMOJI.error} Uso: ${usedPrefix}rpgcaos [multiplicador] [tiempo]\n\n*Ejemplo:* \`${usedPrefix}rpgcaos 3 30m\``);
    }
    globalModes.chaosMode = { active: true, multiplier, expiresAt: Date.now() + duration, activatedBy: m.sender };
    await m.reply(`👑 *¡¡MODO CAOS ACTIVADO!!*\n━━━━━━━━━━━━━━━━━━━━\n\n🌀 *TODO x${multiplier}*\n⏰ Duración: *${msToTime(duration)}*\n\n_¡¡QUE COMIENCE EL CAOS!!_`);
    await m.react('🌀');
  }
};

const MODE_ALIASES: Record<string, GlobalModeKey> = {
  bonus: 'bonusMode', robo: 'freeRobMode', evento: 'eventMode', event: 'eventMode', pvp: 'pvpMode', caos: 'chaosMode', chaos: 'chaosMode'
};
const MODE_NAMES: Record<GlobalModeKey, string> = {
  bonusMode: 'Bonus', freeRobMode: 'Robo Libre', eventMode: 'Evento', pvpMode: 'PvP Intenso', chaosMode: 'Caos'
};

export const rpgDesactivarPlugin: PluginHandler = {
  command: ['rpgdesactivar', 'rpgoff', 'rpgdisable'],
  tags: ['owner'],
  help: ['rpgdesactivar [bonus|robo|evento|pvp|caos|todos] - Desactiva un modo'],
  owner: true,

  handler: async (ctx: MessageContext) => {
    const { m, args, usedPrefix } = ctx;
    const mode = args[0]?.toLowerCase();
    if (!mode) return m.reply(`${EMOJI.error} Uso: ${usedPrefix}rpgdesactivar [modo]\n\n*Modos:* bonus, robo, evento, pvp, caos, todos`);

    const keys: GlobalModeKey[] = mode === 'todos' || mode === 'all'
      ? (Object.keys(MODE_NAMES) as GlobalModeKey[])
      : MODE_ALIASES[mode] ? [MODE_ALIASES[mode]] : [];
    if (keys.length === 0) return m.reply(`${EMOJI.error} Modo no válido. Usa: bonus, robo, evento, pvp, caos, todos`);

    const deactivated = keys.filter(key => globalModes[key].active);
    for (const key of deactivated) globalModes[key].active = false;
    if (deactivated.length === 0) return m.reply(`${EMOJI.warning} No hay modos activos para desactivar`);

    await m.reply(`👑 *MODOS DESACTIVADOS*\n\n❌ ${deactivated.map(k => MODE_NAMES[k]).join(', ')}`);
    await m.react('✅');
  }
};

// ==================== COOLDOWNS ====================

export const rpgResetCdPlugin: PluginHandler = {
  command: ['rpgresetcd', 'resetcooldown', 'resetcd'],
  tags: ['owner'],
  help: ['rpgresetcd @user [tipo] - Resetea cooldowns de un usuario'],
  owner: true,

  handler: async (ctx: MessageContext) => {
    const { m } = ctx;
    const args = argsWithoutMentions(ctx);
    const db = getDatabase();
    const jid = targetOf(ctx);
    const user = db.getUser(jid);
    if (!user.registered) return m.reply(notRegistered(ctx, jid));

    const type = args[0]?.toLowerCase() || 'all';
    const fields = cooldownFieldsFor(type);
    if (fields.length === 0) return m.reply(`${EMOJI.error} Tipo inválido.\n\n*Tipos:* ${COOLDOWN_TYPE_LIST}`);

    const updates: Partial<UserRPG> = {};
    for (const field of fields) updates[field] = 0;
    db.updateUser(jid, updates);

    await m.reply(`👑 *COOLDOWN RESETEADO*\n\n⏰ Se ha reseteado *${type === 'all' ? 'todos los cooldowns' : type}* de *${user.name}*`);
    await m.react('✅');
  }
};

export const rpgResetCdAllPlugin: PluginHandler = {
  command: ['rpgresetcdall', 'resetcdall'],
  tags: ['owner'],
  help: ['rpgresetcdall [tipo] - Resetea cooldowns de todos los usuarios'],
  owner: true,

  handler: async (ctx: MessageContext) => {
    const { m, args } = ctx;
    const db = getDatabase();
    const type = args[0]?.toLowerCase() || 'all';
    const fields = cooldownFieldsFor(type);
    if (fields.length === 0) return m.reply(`${EMOJI.error} Tipo inválido.\n\n*Tipos:* ${COOLDOWN_TYPE_LIST}`);

    let count = 0;
    for (const [jid] of db.getRegisteredUsers()) {
      const updates: Partial<UserRPG> = {};
      for (const field of fields) updates[field] = 0;
      db.updateUser(jid, updates);
      count++;
    }
    await m.reply(`👑 *COOLDOWN GLOBAL RESETEADO*\n\n⏰ Se ha reseteado *${type === 'all' ? 'todos los cooldowns' : type}* de *${count}* usuarios`);
    await m.react('✅');
  }
};

// ==================== MODIFICACIONES ====================

export const rpgSetClasePlugin: PluginHandler = {
  command: ['rpgsetclase', 'rpgsetclass'],
  tags: ['owner'],
  help: ['rpgsetclase @user [clase] - Establece la clase de un usuario'],
  owner: true,

  handler: async (ctx: MessageContext) => {
    const { m, usedPrefix } = ctx;
    const args = argsWithoutMentions(ctx);
    const db = getDatabase();
    const jid = targetOf(ctx);
    const user = db.getUser(jid);
    if (!user.registered) return m.reply(notRegistered(ctx, jid));

    const className = args[0]?.toLowerCase() as PlayerClass | undefined;
    if (!className || !CLASSES[className]) {
      return m.reply(`${EMOJI.error} Uso: ${usedPrefix}rpgsetclase [@user] [clase]\n\n*Clases:* guerrero ⚔️, mago 🔮, ladron 🗡️, arquero 🏹\n💡 _Sin mención se aplica a ti mismo_`);
    }

    // La clase solo se anota: sus bonus los suma calculateTotalStats
    const classInfo = CLASSES[className];
    const stats = calculateTotalStats({ ...user, playerClass: className });
    db.updateUser(jid, {
      playerClass: className,
      health: Math.min(user.health, stats.maxHealth),
      mana: Math.min(user.mana, stats.maxMana),
      stamina: Math.min(user.stamina, stats.maxStamina)
    });

    await m.reply(
      `👑 *CLASE ESTABLECIDA*\n\n${classInfo.emoji} *${user.name}* ahora es *${classInfo.name}*!\n\n` +
      `📊 *Bonus de clase (aplicado en los stats totales):*\n` +
      `❤️ Vida: +${classInfo.baseStats.healthBonus} | 💠 Maná: +${classInfo.baseStats.manaBonus} | ⚡ Energía: +${classInfo.baseStats.staminaBonus}\n` +
      `⚔️ Ataque: +${classInfo.baseStats.attackBonus} | 🛡️ Defensa: +${classInfo.baseStats.defenseBonus}`
    );
    await m.react('✅');
  }
};

export const rpgFullStatsPlugin: PluginHandler = {
  command: ['rpgfullstats', 'rpgmaxstats', 'rpggod'],
  tags: ['owner'],
  help: ['rpgfullstats @user - Da stats máximos a un usuario'],
  owner: true,

  handler: async (ctx: MessageContext) => {
    const { m } = ctx;
    const db = getDatabase();
    const jid = targetOf(ctx);
    const user = db.getUser(jid);
    if (!user.registered) return m.reply(notRegistered(ctx, jid));

    setLevel(user, 1000);
    user.maxHealth = 9999;
    user.maxMana = 9999;
    user.maxStamina = 9999;
    user.health = 9999;
    user.mana = 9999;
    user.stamina = 9999;
    user.attack = 999;
    user.defense = 999;
    user.critChance = 75;
    user.money = 99_999_999;
    user.limit = 99_999;
    db.updateUser(jid, user);

    await m.reply(
      `👑 *MODO DIOS ACTIVADO*\n\n⚡ *${user.name}* ahora tiene stats máximos!\n\n` +
      `🐉 Nivel: 1000 (${getRoleByLevel(1000)})\n❤️ Vida: 9,999 | 💠 Maná: 9,999 | ⚡ Energía: 9,999\n` +
      `⚔️ Ataque: 999 | 🛡️ Defensa: 999 | 💥 Crítico: 75%\n💰 Dinero: 99,999,999 | 💎 Diamantes: 99,999`
    );
    await m.react('⚡');
  }
};

export const rpgSetNivelPlugin: PluginHandler = {
  command: ['rpgsetnivel', 'rpgmaxlevel', 'rpgsetlevel'],
  tags: ['owner'],
  help: ['rpgsetnivel @user [nivel] - Fija el nivel (XP al mínimo del nivel, bonus ajustados)'],
  owner: true,

  handler: async (ctx: MessageContext) => {
    const { m, usedPrefix } = ctx;
    const args = argsWithoutMentions(ctx);
    const db = getDatabase();
    const jid = targetOf(ctx);
    const user = db.getUser(jid);
    if (!user.registered) return m.reply(notRegistered(ctx, jid));

    const level = parseInt(args[0] ?? '', 10);
    if (!Number.isFinite(level) || level < 0) return m.reply(`${EMOJI.error} Uso: ${usedPrefix}rpgsetnivel [@user] [nivel]`);

    const result = setLevel(user, level);
    db.updateUser(jid, user);
    await m.reply(`👑 *NIVEL ESTABLECIDO*\n\n📈 *${user.name}*: nivel ${result.from} → *${result.to}*\n🏆 Rango: *${getRoleByLevel(user.level)}*\n✨ XP: ${formatNumber(user.exp)}`);
    await m.react('✅');
  }
};

export const rpgInfoPlugin: PluginHandler = {
  command: ['rpginfo', 'rpgcheck'],
  tags: ['owner'],
  help: ['rpginfo @user - Ver toda la información RPG de un usuario'],
  owner: true,

  handler: async (ctx: MessageContext) => {
    const { m } = ctx;
    const db = getDatabase();
    const jid = targetOf(ctx);
    const user = db.getUser(jid);
    if (!user.registered) return m.reply(notRegistered(ctx, jid));

    const classInfo = user.playerClass ? CLASSES[user.playerClass] : null;
    const now = Date.now();
    const stats = calculateTotalStats(user);
    const cd = (last: number, cooldown: number) => {
      const left = Math.max(0, (last || 0) + cooldown - now);
      return left > 0 ? msToTime(left) : '✅ Listo';
    };
    const materials = Object.values(user.forgeMaterials || {}).reduce((sum, n) => sum + (typeof n === 'number' ? n : 0), 0);

    const info = `
👑 *INFO RPG: ${user.name}*
━━━━━━━━━━━━━━━━━━━━━━━━

📋 *DATOS BÁSICOS:*
• JID: ${jid}
• Registrado: ${user.regTime > 0 ? new Date(user.regTime).toLocaleDateString('es-MX') : 'desconocido'}
• Edad: ${user.age}

📊 *NIVEL Y RANGO:*
• Nivel: ${user.level}
• XP: ${formatNumber(user.exp)}
• Rango: ${getRoleByLevel(user.level)}
• Clase: ${classInfo ? `${classInfo.emoji} ${classInfo.name}` : 'Sin clase'}

❤️ *STATS (base → total con clase y equipo):*
• Vida: ${user.health}/${stats.maxHealth}
• Maná: ${user.mana}/${stats.maxMana}
• Energía: ${user.stamina}/${stats.maxStamina}
• Ataque: ${user.attack} → ${stats.attack}
• Defensa: ${user.defense} → ${stats.defense}
• Crítico: ${user.critChance}% → ${stats.critChance}%

💰 *ECONOMÍA:*
• Dinero: ${formatNumber(user.money)} | Banco: ${formatNumber(user.bank)}
• Diamantes: ${formatNumber(user.limit)}
• Deuda IMSS: ${formatNumber(user.debt)}
• Items: ${user.inventory.length} entradas | Materiales: ${materials}

⚔️ *COMBATE:*
• Kills: ${user.combatStats.totalKills} | Bosses: ${user.combatStats.bossesKilled}
• Dungeons: ${user.combatStats.dungeonsCompleted}
• PvP: ${user.combatStats.pvpWins}W - ${user.combatStats.pvpLosses}L

⏰ *COOLDOWNS (área combate):*
• Atacar: ${cd(user.lastAttack, PVP.ATTACK_COOLDOWN)}
• Dungeon: ${cd(user.lastDungeon, PVP.DUNGEON_COOLDOWN)}
• Duelo: ${cd(user.lastDuel, PVP.DUEL_COOLDOWN)}
• Bomba: ${cd(user.lastBomb, COOLDOWNS.BOMB)}
• Fumar: ${cd(user.lastFumar, COOLDOWNS.FUMAR)}

🛡️ *PROTECCIONES:*
• Anti-robo: ${user.shieldRobo > now ? msToTime(user.shieldRobo - now) : 'no'}
• Antibombas: ${user.shieldBombas > now ? msToTime(user.shieldBombas - now) : 'no'}
• Seguro de vida: ${user.seguroVida > now ? msToTime(user.seguroVida - now) : 'no'}
• Modo pasivo: ${user.passiveMode && user.passiveModeUntil > now ? 'sí' : 'no'}

🎒 *EQUIPAMIENTO:*
• Arma: ${user.equipment.weapon || 'Ninguna'}
• Armadura: ${user.equipment.armor || 'Ninguna'}
• Accesorio: ${user.equipment.accessory || 'Ninguno'}
`;
    await m.reply(info);
  }
};

// ==================== MASIVOS ====================

export const rpgDarATodosPlugin: PluginHandler = {
  command: ['rpgdaratodos', 'rpggiveall'],
  tags: ['owner'],
  help: ['rpgdaratodos [tipo] [cantidad] - Da recursos a todos los registrados'],
  owner: true,

  handler: async (ctx: MessageContext) => {
    const { m, args, usedPrefix } = ctx;
    const db = getDatabase();
    const key = RESOURCE_ALIASES[args[0]?.toLowerCase() ?? ''];
    const amount = parseCount(args[1]);
    if (!key || amount === null || key === 'health' || key === 'stamina') {
      return m.reply(`${EMOJI.error} Uso: ${usedPrefix}rpgdaratodos [tipo] [cantidad]\n\n*Tipos:* dinero, xp, mana, diamantes`);
    }

    let count = 0;
    for (const [jid, user] of db.getRegisteredUsers()) {
      applyResource(db, jid, user, key, amount);
      count++;
    }
    await m.reply(`👑 *REGALO MASIVO*\n\n🎁 Se ha dado *${formatNumber(amount)} ${RESOURCE_LABEL[key].name}* a *${count}* usuarios registrados!`);
    await m.react('🎁');
  }
};

export const rpgLluviaMoneyPlugin: PluginHandler = {
  command: ['rpglluviamoney', 'rpgrainmoney', 'lluviadinero'],
  tags: ['owner'],
  help: ['rpglluviamoney [cantidad] - Lluvia de dinero aleatorio en el grupo'],
  owner: true,
  group: true,

  handler: async (ctx: MessageContext) => {
    const { m, args, participants } = ctx;
    const db = getDatabase();
    const totalAmount = parseCount(args[0]) ?? 10000;

    const registered = (participants ?? []).filter(jid => db.getUser(jid).registered);
    if (registered.length === 0) return m.reply(`${EMOJI.error} No hay usuarios registrados en el grupo`);

    for (let i = registered.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [registered[i], registered[j]] = [registered[j], registered[i]];
    }

    const distributions: { amount: number; name: string }[] = [];
    let remaining = totalAmount;
    registered.forEach((jid, i) => {
      const user = db.getUser(jid);
      let amount = remaining;
      if (i < registered.length - 1) {
        const min = Math.floor(remaining * 0.05);
        const max = Math.floor(remaining * 0.4);
        amount = Math.min(remaining, Math.floor(Math.random() * (max - min + 1)) + min);
      }
      remaining -= amount;
      db.updateUser(jid, { money: user.money + amount });
      distributions.push({ amount, name: user.name });
    });
    distributions.sort((a, b) => b.amount - a.amount);

    let msg = `🌧️ *¡¡LLUVIA DE DINERO!!*\n━━━━━━━━━━━━━━━━━━━━\n\n💰 Total: *${formatNumber(totalAmount)}* monedas\n👥 Participantes: *${distributions.length}*\n\n📊 *DISTRIBUCIÓN:*\n`;
    msg += distributions.slice(0, 10).map(d => `• ${d.name}: +${formatNumber(d.amount)} 💰`).join('\n');
    if (distributions.length > 10) msg += `\n_... y ${distributions.length - 10} más_`;

    await m.reply(msg);
    await m.react('🌧️');
  }
};

export const rpgBorrarPlugin: PluginHandler = {
  command: ['rpgborrar', 'rpgdelete', 'rpgreset'],
  tags: ['owner'],
  help: ['rpgborrar @user confirmar - ELIMINA el progreso RPG de un usuario'],
  owner: true,

  handler: async (ctx: MessageContext) => {
    const { m, text, usedPrefix } = ctx;
    const db = getDatabase();
    const jid = targetOf(ctx);
    const user = db.getUser(jid);
    if (!user.registered) return m.reply(notRegistered(ctx, jid));

    if (!text.toLowerCase().includes('confirmar')) {
      return m.reply(
        `⚠️ *ADVERTENCIA*\n\nEsto ELIMINARÁ todo el progreso RPG de *${user.name}*:\n` +
        `• Nivel ${user.level}\n• ${formatNumber(user.money)} monedas\n• ${formatNumber(user.limit)} diamantes\n• ${user.inventory.length} items\n\n` +
        `Para confirmar escribe: \`${usedPrefix}rpgborrar [@user] confirmar\`\n💡 _Sin mención se aplica a ti mismo_`
      );
    }

    const name = user.name;
    db.resetUser(jid);
    await m.reply(`👑 *PROGRESO ELIMINADO*\n\n🗑️ Se ha eliminado todo el progreso RPG de *${name}*`);
    await m.react('🗑️');
  }
};

export const rpgTopPlugin: PluginHandler = {
  command: ['rpgtop', 'rpgranking'],
  tags: ['owner'],
  help: ['rpgtop [level|money|diamonds|pvp|kills] - Ver ranking de jugadores'],
  owner: true,

  handler: async (ctx: MessageContext) => {
    const { m, args } = ctx;
    const db = getDatabase();
    const type = args[0]?.toLowerCase() || 'level';
    const users = db.getRegisteredUsers().map(([jid, user]) => ({ jid, ...user }));

    const rankings: Record<string, { title: string; sort: (a: UserRPG, b: UserRPG) => number; format: (u: UserRPG) => string }> = {
      level: { title: '📊 RANKING POR NIVEL', sort: (a, b) => b.level - a.level || b.exp - a.exp, format: u => `Nv.${u.level} - ${formatNumber(u.exp)} XP` },
      money: { title: '💰 RANKING POR DINERO', sort: (a, b) => b.money - a.money, format: u => `${formatNumber(u.money)} monedas` },
      diamonds: { title: '💎 RANKING POR DIAMANTES', sort: (a, b) => b.limit - a.limit, format: u => `${formatNumber(u.limit)} diamantes` },
      pvp: { title: '⚔️ RANKING PVP', sort: (a, b) => b.combatStats.pvpWins - a.combatStats.pvpWins, format: u => `${u.combatStats.pvpWins}W - ${u.combatStats.pvpLosses}L` },
      kills: { title: '☠️ RANKING POR KILLS', sort: (a, b) => b.combatStats.totalKills - a.combatStats.totalKills, format: u => `${formatNumber(u.combatStats.totalKills)} kills` }
    };
    const aliases: Record<string, string> = { nivel: 'level', dinero: 'money', diamantes: 'diamonds' };
    const ranking = rankings[aliases[type] ?? type];
    if (!ranking) return m.reply(`${EMOJI.error} Tipo inválido.\n\n*Tipos:* level, money, diamonds, pvp, kills`);

    const medals = ['🥇', '🥈', '🥉'];
    let msg = `👑 *${ranking.title}*\n━━━━━━━━━━━━━━━━━━━━\n\n`;
    users.sort(ranking.sort).slice(0, 10).forEach((user, i) => {
      msg += `${medals[i] || `${i + 1}.`} *${user.name}*\n   ${ranking.format(user)}\n\n`;
    });
    msg += `\n📊 Total registrados: ${users.length}`;
    await m.reply(msg);
  }
};

// ==================== SESIONES DE COMBATE ====================

export const rpgSesionesPlugin: PluginHandler = {
  command: ['rpgsesiones', 'rpgsessions'],
  tags: ['owner'],
  help: ['rpgsesiones - Lista duelos y dungeons en curso'],
  owner: true,

  handler: async (ctx: MessageContext) => {
    const { m, usedPrefix } = ctx;
    const now = Date.now();
    let msg = `🎮 *SESIONES DE COMBATE*\n━━━━━━━━━━━━━━━━━━━━\n\n`;

    msg += `⚔️ *Duelos (${activeDuels.size}):*\n`;
    for (const [groupJid, duel] of activeDuels) {
      msg += `• ${groupJid.split('@')[0]}: ${duel.players.challenger.name} vs ${duel.players.target.name} (${msToTime(now - duel.startTime)}, ${duel.totalActions} acciones, pot ${formatNumber(duel.pot)})\n`;
    }
    if (activeDuels.size === 0) msg += `_Ninguno_\n`;

    msg += `\n🏰 *Dungeons (${activeDungeons.size}):*\n`;
    for (const [jid, session] of activeDungeons) {
      msg += `• ${session.playerName} (${jid.split('@')[0]}): ${session.dungeon.name}, turno ${session.turn}, inactivo ${msToTime(now - session.lastActionTime)}\n`;
    }
    if (activeDungeons.size === 0) msg += `_Ninguno_\n`;

    const busy = listBusy();
    msg += `\n🔒 *Ocupados (${busy.length}):* ${busy.map(b => `${b.jid.split('@')[0]} (${b.kind})`).join(', ') || '_ninguno_'}\n`;
    msg += `\n💡 \`${usedPrefix}rpgcancelar @user\` cierra su dungeon · \`${usedPrefix}rpgcancelar duelo\` cancela el duelo de este grupo`;
    await m.reply(msg);
  }
};

export const rpgCancelarPlugin: PluginHandler = {
  command: ['rpgcancelar', 'rpgcancel'],
  tags: ['owner'],
  help: ['rpgcancelar [@user|duelo] - Cierra un dungeon atascado o cancela el duelo del grupo (devuelve la apuesta)'],
  owner: true,

  handler: async (ctx: MessageContext) => {
    const { m, args, usedPrefix } = ctx;
    const db = getDatabase();

    if (args[0]?.toLowerCase() === 'duelo' || args[0]?.toLowerCase() === 'duel') {
      const result = cancelDuel(db, m.chat);
      if (!result) return m.reply(`${EMOJI.info} No hay duelo activo en este grupo.`);
      await m.reply(`👑 Duelo cancelado por el owner.\n${result.message}`);
      return;
    }

    const jid = targetOf(ctx);
    if (jid === m.sender && !activeDungeons.has(jid) && !getBusy(jid)) {
      return m.reply(`${EMOJI.error} Uso: ${usedPrefix}rpgcancelar @user (dungeon) o ${usedPrefix}rpgcancelar duelo`);
    }
    if (await cancelDungeon(jid)) {
      await m.reply(`👑 Dungeon de ${jid.split('@')[0]} cerrado.`);
      return;
    }
    // Marca de ocupado sin sesión detrás (p. ej. un envío que falló a mitad): se limpia a mano
    const busy = getBusy(jid);
    if (busy) {
      clearBusy(jid);
      await m.reply(`👑 ${jid.split('@')[0]} figuraba como ocupado (${busy}) sin sesión activa; marca limpiada.`);
      return;
    }
    await m.reply(`${EMOJI.info} Ese usuario no tiene un dungeon activo ni está marcado como ocupado.`);
  }
};

// ==================== EVENTOS AUTOMÁTICOS ====================

export const rpgAutoEventsPlugin: PluginHandler = {
  command: ['rpgautoevents', 'autoevents', 'autoeventos'],
  tags: ['owner'],
  help: ['rpgautoevents [on|off] - Activa/desactiva eventos aleatorios automáticos'],
  owner: true,

  handler: async (ctx: MessageContext) => {
    const { m, args, usedPrefix } = ctx;
    const action = args[0]?.toLowerCase();
    if (!action || !['on', 'off', 'activar', 'desactivar'].includes(action)) {
      const status = getAutoEventStatus();
      return m.reply(`🎲 *EVENTOS AUTOMÁTICOS*\n\nEstado actual: ${status.enabled ? '✅ ACTIVADO' : '❌ DESACTIVADO'}\n\nUso: \`${usedPrefix}rpgautoevents [on|off]\``);
    }
    const enable = action === 'on' || action === 'activar';
    toggleAutoEvents(enable);
    await m.reply(`🎲 *EVENTOS AUTOMÁTICOS*\n\n${enable ? '✅ Sistema ACTIVADO' : '❌ Sistema DESACTIVADO'}`);
    await m.react(enable ? '✅' : '❌');
  }
};

export const rpgAddGrupoPlugin: PluginHandler = {
  command: ['rpgaddgrupo', 'rpgaddgroup', 'eventaddgroup'],
  tags: ['owner'],
  help: ['rpgaddgrupo - Agrega este grupo a los anuncios de eventos'],
  owner: true,
  group: true,

  handler: async (ctx: MessageContext) => {
    const { m } = ctx;
    if (addAnnouncementGroup(m.chat)) {
      await m.reply(`🎲 *GRUPO AGREGADO*\n\n✅ Este grupo recibirá anuncios de eventos automáticos.\n📊 Total de grupos: *${autoEventConfig.announcementGroups.length}*`);
      await m.react('✅');
    } else {
      await m.reply(`${EMOJI.warning} Este grupo ya está en la lista de anuncios.`);
    }
  }
};

export const rpgRemoveGrupoPlugin: PluginHandler = {
  command: ['rpgremovegrupo', 'rpgremovegroup', 'eventremovegroup'],
  tags: ['owner'],
  help: ['rpgremovegrupo - Quita este grupo de los anuncios de eventos'],
  owner: true,
  group: true,

  handler: async (ctx: MessageContext) => {
    const { m } = ctx;
    if (removeAnnouncementGroup(m.chat)) {
      await m.reply(`🎲 *GRUPO REMOVIDO*\n\n❌ Este grupo ya no recibirá anuncios.\n📊 Total de grupos: *${autoEventConfig.announcementGroups.length}*`);
      await m.react('✅');
    } else {
      await m.reply(`${EMOJI.warning} Este grupo no estaba en la lista de anuncios.`);
    }
  }
};

export const rpgEventIntervalPlugin: PluginHandler = {
  command: ['rpgeventinterval', 'eventinterval', 'intervaloeventos'],
  tags: ['owner'],
  help: ['rpgeventinterval [min] [max] - Intervalo entre eventos (minutos)'],
  owner: true,

  handler: async (ctx: MessageContext) => {
    const { m, args, usedPrefix } = ctx;
    const minMinutes = parseInt(args[0] ?? '', 10);
    const maxMinutes = parseInt(args[1] ?? '', 10);
    if (!Number.isFinite(minMinutes) || !Number.isFinite(maxMinutes) || minMinutes < 1 || maxMinutes < minMinutes) {
      const status = getAutoEventStatus();
      return m.reply(`🎲 *INTERVALO DE EVENTOS*\n\nActual: *${status.minInterval}* - *${status.maxInterval}*\n\nUso: \`${usedPrefix}rpgeventinterval [min] [max]\` (minutos)`);
    }
    setEventIntervals(minMinutes, maxMinutes);
    await m.reply(`🎲 *INTERVALO ACTUALIZADO*\n\n⏰ Nuevo intervalo: *${minMinutes}* - *${maxMinutes}* minutos`);
    await m.react('✅');
  }
};

export const rpgForceEventPlugin: PluginHandler = {
  command: ['rpgforceevent', 'forceevent', 'forzarevento'],
  tags: ['owner'],
  help: ['rpgforceevent - Fuerza un evento aleatorio inmediatamente'],
  owner: true,

  handler: async (ctx: MessageContext) => {
    const { m } = ctx;
    const event = await forceRandomEvent();
    if (!event.applied) {
      await m.reply(`${EMOJI.warning} Todos los modos están ocupados por un owner; no se aplicó ningún evento. Libera uno con rpgdesactivar.`);
      return;
    }
    const rarity = event.isLegendary ? '🏆 LEGENDARIO' : event.isEpic ? '💎 ÉPICO' : '📢 Normal';
    await m.reply(
      `🎲 *EVENTO FORZADO*\n\n${event.type.emoji} *${event.type.name}*\n⚡ Multiplicador: *x${event.multiplier}*\n⏰ Duración: *${event.durationName}*\n✨ Rareza: *${rarity}*\n\n` +
      `_Anunciado en ${autoEventConfig.announcementGroups.length} grupos._`
    );
    await m.react('🎲');
  }
};

export const rpgEventStatusPlugin: PluginHandler = {
  command: ['rpgeventstatus', 'eventstatus', 'estadoeventos'],
  tags: ['owner'],
  help: ['rpgeventstatus - Ver estado del sistema de eventos automáticos'],
  owner: true,

  handler: async (ctx: MessageContext) => {
    const { m } = ctx;
    const status = getAutoEventStatus();
    await m.reply(
      `🎲 *ESTADO DE EVENTOS AUTOMÁTICOS*\n━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `📊 *Sistema:* ${status.enabled ? '✅ ACTIVADO' : '❌ DESACTIVADO'}\n` +
      `⏰ *Intervalo:* ${status.minInterval} - ${status.maxInterval}\n` +
      `📢 *Grupos de anuncio:* ${status.groups}\n` +
      `🎯 *Próximo evento:* ${status.nextEventIn || 'No programado'}\n\n` +
      `📊 *Modos activos ahora:*\n${modeLines(Date.now())}`
    );
  }
};

/** Nombre de registro legible y plugin, para plugins/index.ts */
export const ownerRpgEntries: [string, PluginHandler][] = [
  ['owner-rpg-menu', ownerRpgMenuPlugin],
  ['owner-rpg-dar', rpgDarPlugin],
  ['owner-rpg-quitar', rpgQuitarPlugin],
  ['owner-rpg-set', rpgSetPlugin],
  ['owner-rpg-daritem', rpgDarItemPlugin],
  ['owner-rpg-quitaritem', rpgQuitarItemPlugin],
  ['owner-rpg-listitems', rpgListItemsPlugin],
  ['owner-rpg-bonus', rpgBonusPlugin],
  ['owner-rpg-robolibre', rpgRoboLibrePlugin],
  ['owner-rpg-evento', rpgEventoPlugin],
  ['owner-rpg-pvp', rpgPvpModePlugin],
  ['owner-rpg-caos', rpgCaosModePlugin],
  ['owner-rpg-desactivar', rpgDesactivarPlugin],
  ['owner-rpg-resetcd', rpgResetCdPlugin],
  ['owner-rpg-resetcdall', rpgResetCdAllPlugin],
  ['owner-rpg-setclase', rpgSetClasePlugin],
  ['owner-rpg-fullstats', rpgFullStatsPlugin],
  ['owner-rpg-setnivel', rpgSetNivelPlugin],
  ['owner-rpg-info', rpgInfoPlugin],
  ['owner-rpg-daratodos', rpgDarATodosPlugin],
  ['owner-rpg-lluviamoney', rpgLluviaMoneyPlugin],
  ['owner-rpg-borrar', rpgBorrarPlugin],
  ['owner-rpg-top', rpgTopPlugin],
  ['owner-rpg-sesiones', rpgSesionesPlugin],
  ['owner-rpg-cancelar', rpgCancelarPlugin],
  ['owner-rpg-autoevents', rpgAutoEventsPlugin],
  ['owner-rpg-addgrupo', rpgAddGrupoPlugin],
  ['owner-rpg-removegrupo', rpgRemoveGrupoPlugin],
  ['owner-rpg-eventinterval', rpgEventIntervalPlugin],
  ['owner-rpg-forceevent', rpgForceEventPlugin],
  ['owner-rpg-eventstatus', rpgEventStatusPlugin]
];

