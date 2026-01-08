/**
 * ⛏️ Plugin Minar - CYALTRONIC
 * Minar minerales para ganar dinero y experiencia cada 10 minutos
 */

import type { PluginHandler, MessageContext } from '../types/message.js';
import { EMOJI, formatNumber, msToTime, pickRandom, randomInt } from '../lib/utils.js';
import { getDatabase } from '../lib/database.js';
import { CONFIG } from '../config.js';
import { canLevelUp, MULTIPLIER } from '../lib/levelling.js';
import { globalModes, checkExpiredModes } from './owner-rpg.js';

// Tipos de minerales que se pueden encontrar
interface Mineral {
  name: string;
  emoji: string;
  rarity: 'comun' | 'raro' | 'epico' | 'legendario';
  minMoney: number;
  maxMoney: number;
  expBonus: number;
}

const MINERALS: Mineral[] = [
  // Comunes (60% probabilidad)
  { name: 'Carbón', emoji: '⬛', rarity: 'comun', minMoney: 10, maxMoney: 30, expBonus: 0 },
  { name: 'Piedra', emoji: '🪨', rarity: 'comun', minMoney: 5, maxMoney: 20, expBonus: 0 },
  { name: 'Cobre', emoji: '🟤', rarity: 'comun', minMoney: 15, maxMoney: 40, expBonus: 5 },
  { name: 'Hierro', emoji: '⚪', rarity: 'comun', minMoney: 20, maxMoney: 50, expBonus: 10 },

  // Raros (25% probabilidad)
  { name: 'Plata', emoji: '🩶', rarity: 'raro', minMoney: 50, maxMoney: 100, expBonus: 25 },
  { name: 'Oro', emoji: '🟡', rarity: 'raro', minMoney: 80, maxMoney: 150, expBonus: 40 },
  { name: 'Cristal', emoji: '🔷', rarity: 'raro', minMoney: 60, maxMoney: 120, expBonus: 30 },

  // Épicos (12% probabilidad)
  { name: 'Rubí', emoji: '🔴', rarity: 'epico', minMoney: 150, maxMoney: 300, expBonus: 75 },
  { name: 'Esmeralda', emoji: '🟢', rarity: 'epico', minMoney: 150, maxMoney: 300, expBonus: 75 },
  { name: 'Zafiro', emoji: '🔵', rarity: 'epico', minMoney: 150, maxMoney: 300, expBonus: 75 },

  // Legendarios (3% probabilidad)
  { name: 'Diamante', emoji: '💎', rarity: 'legendario', minMoney: 400, maxMoney: 800, expBonus: 200 },
  { name: 'Mithril', emoji: '✨', rarity: 'legendario', minMoney: 500, maxMoney: 1000, expBonus: 250 },
];

// Mensajes de minería
const MINING_MESSAGES = [
  'Excavaste profundamente en la mina abandonada',
  'Encontraste una veta oculta en las montañas',
  'Trabajaste duro en las cavernas oscuras',
  'Exploraste un túnel secreto bajo tierra',
  'Minaste en las profundidades del volcán',
  'Descubriste una cueva llena de minerales',
  'Rompiste rocas en la mina del pueblo',
  'Excavaste en las ruinas antiguas',
];

// Seleccionar mineral basado en probabilidad
function selectMineral(): Mineral {
  const roll = Math.random() * 100;

  let pool: Mineral[];
  if (roll < 3) {
    // 3% legendario
    pool = MINERALS.filter(m => m.rarity === 'legendario');
  } else if (roll < 15) {
    // 12% épico
    pool = MINERALS.filter(m => m.rarity === 'epico');
  } else if (roll < 40) {
    // 25% raro
    pool = MINERALS.filter(m => m.rarity === 'raro');
  } else {
    // 60% común
    pool = MINERALS.filter(m => m.rarity === 'comun');
  }

  return pickRandom(pool);
}

// Obtener color de rareza
function getRarityColor(rarity: string): string {
  switch (rarity) {
    case 'legendario': return '🟣';
    case 'epico': return '🟠';
    case 'raro': return '🔵';
    default: return '⚪';
  }
}

// Obtener nombre de rareza en español
function getRarityName(rarity: string): string {
  switch (rarity) {
    case 'legendario': return 'LEGENDARIO';
    case 'epico': return 'ÉPICO';
    case 'raro': return 'RARO';
    default: return 'COMÚN';
  }
}

export const minePlugin: PluginHandler = {
  command: /^(mine|minar|picar|excavar|cavar)$/i,
  tags: ['rpg'],
  help: ['minar - Minar minerales para ganar dinero y XP (cada 10 minutos)'],
  register: true,

  handler: async (ctx: MessageContext) => {
    const { m, usedPrefix } = ctx;
    const db = getDatabase();
    const user = db.getUser(m.sender);

    // Verificar registro
    if (!user.registered) {
      return m.reply(CONFIG.messages.notRegistered);
    }

    // Verificar modos globales expirados
    checkExpiredModes();

    // Verificar cooldown
    const now = Date.now();
    const cooldown = CONFIG.cooldowns.mine;
    const timeSinceLastMine = now - user.lastmine;

    if (timeSinceLastMine < cooldown) {
      const remaining = cooldown - timeSinceLastMine;
      return m.reply(
        `${EMOJI.time} *¡Estás agotado!*\n\n` +
        `${EMOJI.warning} Tu pico necesita reparación.\n` +
        `${EMOJI.info} Podrás minar en: *${msToTime(remaining)}*\n\n` +
        `${EMOJI.star} Mientras tanto:\n` +
        `• *${usedPrefix}perfil* - Ver tu progreso\n` +
        `• *${usedPrefix}trabajo* - Trabajar para ganar XP`
      );
    }

    // Calcular cantidad de minerales encontrados (1-3)
    const mineralsFound = randomInt(1, 3);
    let totalMoney = 0;
    let totalBonusExp = 0;
    const foundMinerals: { mineral: Mineral; money: number }[] = [];

    // Minar cada mineral
    for (let i = 0; i < mineralsFound; i++) {
      const mineral = selectMineral();
      const money = randomInt(mineral.minMoney, mineral.maxMoney);
      totalMoney += money;
      totalBonusExp += mineral.expBonus;
      foundMinerals.push({ mineral, money });
    }

    // Calcular XP base
    const baseExp = 80 + (user.level * 30);
    let totalExp = baseExp + totalBonusExp;

    // Aplicar multiplicadores de modos globales
    let modeMessages: string[] = [];

    // Bonus Mode - Multiplicador de XP y dinero
    if (globalModes.bonusMode.active) {
      const bonusExp = Math.floor(totalExp * (globalModes.bonusMode.expMultiplier - 1));
      const bonusMoney = Math.floor(totalMoney * (globalModes.bonusMode.moneyMultiplier - 1));
      totalExp += bonusExp;
      totalMoney += bonusMoney;
      modeMessages.push(`🎁 Modo Bonus: +${bonusExp} XP, +${bonusMoney} 💰`);
    }

    // Chaos Mode - Multiplicador general
    if (globalModes.chaosMode.active) {
      const chaosExp = Math.floor(totalExp * (globalModes.chaosMode.multiplier - 1));
      const chaosMoney = Math.floor(totalMoney * (globalModes.chaosMode.multiplier - 1));
      totalExp += chaosExp;
      totalMoney += chaosMoney;
      modeMessages.push(`🌀 Modo Caos: +${chaosExp} XP, +${chaosMoney} 💰`);
    }

    // Event Mode - Multiplicador de drops/recompensas
    if (globalModes.eventMode.active) {
      const eventExp = Math.floor(totalExp * (globalModes.eventMode.dropMultiplier - 1));
      const eventMoney = Math.floor(totalMoney * (globalModes.eventMode.dropMultiplier - 1));
      totalExp += eventExp;
      totalMoney += eventMoney;
      modeMessages.push(`🎉 ${globalModes.eventMode.eventName}: +${eventExp} XP, +${eventMoney} 💰`);
    }

    // Aplicar recompensas
    db.updateUser(m.sender, {
      exp: user.exp + totalExp,
      money: user.money + totalMoney,
      lastmine: now
    });

    // Verificar si puede subir de nivel
    const canLevel = canLevelUp(user.level, user.exp + totalExp, MULTIPLIER);
    const levelMessage = canLevel
      ? `\n\n${EMOJI.level} *¡Puedes subir de nivel!* Usa *${usedPrefix}nivel*`
      : '';

    // Construir lista de minerales encontrados
    const mineralsList = foundMinerals.map(({ mineral, money }) => {
      const rarityIndicator = mineral.rarity !== 'comun'
        ? ` ${getRarityColor(mineral.rarity)} [${getRarityName(mineral.rarity)}]`
        : '';
      return `│  ${mineral.emoji} *${mineral.name}*${rarityIndicator}\n│     └ +${formatNumber(money)} ${EMOJI.coin}`;
    }).join('\n');

    // Seleccionar mensaje de minería aleatorio
    const miningMessage = pickRandom(MINING_MESSAGES);

    // Mensaje especial si encontró algo legendario o épico
    let specialMessage = '';
    const hasLegendary = foundMinerals.some(f => f.mineral.rarity === 'legendario');
    const hasEpic = foundMinerals.some(f => f.mineral.rarity === 'epico');

    if (hasLegendary) {
      specialMessage = `\n\n🎉 *¡¡INCREÍBLE!! ¡Encontraste un mineral LEGENDARIO!* 🎉`;
    } else if (hasEpic) {
      specialMessage = `\n\n✨ *¡Wow! ¡Encontraste un mineral ÉPICO!* ✨`;
    }

    // Mensaje de modos activos
    let modesMsg = '';
    if (modeMessages.length > 0) {
      modesMsg = `\n\n🎮 *BONIFICACIONES ACTIVAS:*\n├ ${modeMessages.join('\n├ ')}`;
    }

    // Mensaje de minería completada
    await m.reply(
      `⛏️${EMOJI.sparkles} *¡MINERÍA COMPLETADA!* ${EMOJI.sparkles}⛏️\n\n` +
      `🪨 *${miningMessage}*${specialMessage}\n\n` +
      `╭═══════════════════════════╮\n` +
      `│  ${EMOJI.gift} *MINERALES ENCONTRADOS*\n` +
      `├───────────────────────────\n` +
      `${mineralsList}\n` +
      `╰═══════════════════════════╯\n\n` +
      `${EMOJI.success} *RECOMPENSA TOTAL:*\n` +
      `├ +${formatNumber(totalExp)} ${EMOJI.exp} Experiencia\n` +
      `╰ +${formatNumber(totalMoney)} ${EMOJI.coin} Monedas\n\n` +
      `${EMOJI.info} *Tu progreso:*\n` +
      `├ ${EMOJI.exp} EXP Total: *${formatNumber(user.exp + totalExp)}*\n` +
      `├ ${EMOJI.level} Nivel: *${user.level}*\n` +
      `╰ ${EMOJI.coin} Monedas: *${formatNumber(user.money + totalMoney)}*\n\n` +
      `${EMOJI.time} Próxima minería en: *10 minutos*${modesMsg}${levelMessage}`
    );
  }
};

export default minePlugin;
