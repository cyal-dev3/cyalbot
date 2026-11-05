/**
 * Plugin Minar
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
  materialId: string;  // ID para el sistema de forja
}

const MINERALS: Mineral[] = [
  // Comunes (60% probabilidad)
  { name: 'Carbón', emoji: '⬛', rarity: 'comun', minMoney: 10, maxMoney: 30, expBonus: 0, materialId: 'carbon' },
  { name: 'Piedra', emoji: '🪨', rarity: 'comun', minMoney: 5, maxMoney: 20, expBonus: 0, materialId: 'piedra' },
  { name: 'Cobre', emoji: '🟤', rarity: 'comun', minMoney: 15, maxMoney: 40, expBonus: 5, materialId: 'cobre' },
  { name: 'Hierro', emoji: '⚪', rarity: 'comun', minMoney: 20, maxMoney: 50, expBonus: 10, materialId: 'hierro' },
  { name: 'Cuero', emoji: '🟫', rarity: 'comun', minMoney: 15, maxMoney: 35, expBonus: 5, materialId: 'cuero' },

  // Raros (25% probabilidad)
  { name: 'Plata', emoji: '🩶', rarity: 'raro', minMoney: 50, maxMoney: 100, expBonus: 25, materialId: 'plata' },
  { name: 'Oro', emoji: '🟡', rarity: 'raro', minMoney: 80, maxMoney: 150, expBonus: 40, materialId: 'oro' },
  { name: 'Cristal', emoji: '🔷', rarity: 'raro', minMoney: 60, maxMoney: 120, expBonus: 30, materialId: 'cristal' },
  { name: 'Acero', emoji: '⬜', rarity: 'raro', minMoney: 70, maxMoney: 130, expBonus: 35, materialId: 'acero' },

  // Épicos (12% probabilidad)
  { name: 'Rubí', emoji: '🔴', rarity: 'epico', minMoney: 150, maxMoney: 300, expBonus: 75, materialId: 'rubi' },
  { name: 'Esmeralda', emoji: '🟢', rarity: 'epico', minMoney: 150, maxMoney: 300, expBonus: 75, materialId: 'esmeralda' },
  { name: 'Zafiro', emoji: '🔵', rarity: 'epico', minMoney: 150, maxMoney: 300, expBonus: 75, materialId: 'zafiro' },
  { name: 'Titanio', emoji: '🔘', rarity: 'epico', minMoney: 180, maxMoney: 350, expBonus: 85, materialId: 'titanio' },
  { name: 'Esencia de Fuego', emoji: '🔥', rarity: 'epico', minMoney: 200, maxMoney: 400, expBonus: 100, materialId: 'esencia_fuego' },
  { name: 'Esencia de Hielo', emoji: '❄️', rarity: 'epico', minMoney: 200, maxMoney: 400, expBonus: 100, materialId: 'esencia_hielo' },
  { name: 'Esencia de Rayo', emoji: '⚡', rarity: 'epico', minMoney: 200, maxMoney: 400, expBonus: 100, materialId: 'esencia_rayo' },
  { name: 'Fragmento de Alma', emoji: '👻', rarity: 'epico', minMoney: 250, maxMoney: 450, expBonus: 120, materialId: 'fragmento_alma' },

  // Legendarios (3% probabilidad)
  { name: 'Diamante', emoji: '💎', rarity: 'legendario', minMoney: 400, maxMoney: 800, expBonus: 200, materialId: 'diamante' },
  { name: 'Mithril', emoji: '✨', rarity: 'legendario', minMoney: 500, maxMoney: 1000, expBonus: 250, materialId: 'mithril' },
  { name: 'Adamantita', emoji: '💠', rarity: 'legendario', minMoney: 600, maxMoney: 1200, expBonus: 300, materialId: 'adamantita' },
  { name: 'Polvo Estelar', emoji: '⭐', rarity: 'legendario', minMoney: 550, maxMoney: 1100, expBonus: 280, materialId: 'polvo_estelar' },
  { name: 'Escama de Dragón', emoji: '🐉', rarity: 'legendario', minMoney: 800, maxMoney: 1500, expBonus: 400, materialId: 'escama_dragon' },
  { name: 'Núcleo Elemental', emoji: '🌀', rarity: 'legendario', minMoney: 900, maxMoney: 1800, expBonus: 500, materialId: 'nucleo_elemental' },
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
    const timeSinceLastMine = now - user.lastMine;

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
    const materialUpdates: Record<string, number> = {};
    for (let i = 0; i < mineralsFound; i++) {
      const mineral = selectMineral();
      const money = randomInt(mineral.minMoney, mineral.maxMoney);
      totalMoney += money;
      totalBonusExp += mineral.expBonus;
      foundMinerals.push({ mineral, money });

      // Agregar material a la colección de forja
      if (mineral.materialId) {
        materialUpdates[mineral.materialId] = (materialUpdates[mineral.materialId] || 0) + 1;
      }
    }

    // Actualizar forgeMaterials del usuario
    const updatedForgeMaterials = { ...user.forgeMaterials };
    for (const [materialId, quantity] of Object.entries(materialUpdates)) {
      updatedForgeMaterials[materialId] = (updatedForgeMaterials[materialId] || 0) + quantity;
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

    // Verificar si el usuario es esclavo y transferir parte al amo
    let slaveryMessage = '';
    let masterExpCut = 0;
    let masterMoneyCut = 0;
    const SLAVERY_CUT_PERCENT = 50; // 50% va al amo

    if (user.slaveMaster && user.slaveUntil > now) {
      const master = db.getUser(user.slaveMaster);

      // Calcular el corte del amo (50%)
      masterExpCut = Math.floor(totalExp * (SLAVERY_CUT_PERCENT / 100));
      masterMoneyCut = Math.floor(totalMoney * (SLAVERY_CUT_PERCENT / 100));

      // Reducir las ganancias del esclavo
      totalExp -= masterExpCut;
      totalMoney -= masterMoneyCut;

      // Transferir al amo
      if (masterExpCut > 0 || masterMoneyCut > 0) {
        db.updateUser(user.slaveMaster, {
          exp: master.exp + masterExpCut,
          money: master.money + masterMoneyCut
        });

        slaveryMessage = `\n\n⛓️ *ESCLAVITUD ACTIVA*\n` +
          `├ Tu amo *${master.name}* recibió:\n` +
          `│  ${masterExpCut > 0 ? `+${formatNumber(masterExpCut)} ${EMOJI.exp} XP` : ''}` +
          `${masterExpCut > 0 && masterMoneyCut > 0 ? ' | ' : ''}` +
          `${masterMoneyCut > 0 ? `+${formatNumber(masterMoneyCut)} ${EMOJI.coin}` : ''}\n` +
          `╰ _${SLAVERY_CUT_PERCENT}% de tus ganancias_`;
      }
    }

    // Aplicar recompensas
    db.updateUser(m.sender, {
      exp: user.exp + totalExp,
      money: user.money + totalMoney,
      lastMine: now,
      forgeMaterials: updatedForgeMaterials
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
      `${EMOJI.time} Próxima minería en: *10 minutos*${slaveryMessage}${modesMsg}${levelMessage}\n\n` +
      `⚒️ _Materiales guardados para /forja_`
    );
  }
};

export default minePlugin;
