import type { PluginHandler, MessageContext } from '../types/message.js';
import { EMOJI, formatNumber, pickRandom, randomInt, checkCooldown } from '../lib/utils.js';
import { getDatabase } from '../lib/database.js';
import { CONFIG } from '../config.js';
import { getRankBenefits } from '../types/user.js';
import { grantRewards, replyCooldown, formatReward } from '../lib/rpg-actions.js';

interface Mineral {
  name: string;
  emoji: string;
  rarity: 'comun' | 'raro' | 'epico' | 'legendario';
  minMoney: number;
  maxMoney: number;
  expBonus: number;
  /** ID del material para la forja (FORGE_MATERIALS en rpg-forja.ts) */
  materialId: string;
}

const MINERALS: Mineral[] = [
  // Comunes (60%)
  { name: 'Carbón', emoji: '⬛', rarity: 'comun', minMoney: 10, maxMoney: 30, expBonus: 0, materialId: 'carbon' },
  { name: 'Piedra', emoji: '🪨', rarity: 'comun', minMoney: 5, maxMoney: 20, expBonus: 0, materialId: 'piedra' },
  { name: 'Cobre', emoji: '🟤', rarity: 'comun', minMoney: 15, maxMoney: 40, expBonus: 5, materialId: 'cobre' },
  { name: 'Hierro', emoji: '⚪', rarity: 'comun', minMoney: 20, maxMoney: 50, expBonus: 10, materialId: 'hierro' },
  { name: 'Cuero', emoji: '🟫', rarity: 'comun', minMoney: 15, maxMoney: 35, expBonus: 5, materialId: 'cuero' },

  // Raros (25%)
  { name: 'Plata', emoji: '🩶', rarity: 'raro', minMoney: 50, maxMoney: 100, expBonus: 25, materialId: 'plata' },
  { name: 'Oro', emoji: '🟡', rarity: 'raro', minMoney: 80, maxMoney: 150, expBonus: 40, materialId: 'oro' },
  { name: 'Cristal', emoji: '🔷', rarity: 'raro', minMoney: 60, maxMoney: 120, expBonus: 30, materialId: 'cristal' },
  { name: 'Acero', emoji: '⬜', rarity: 'raro', minMoney: 70, maxMoney: 130, expBonus: 35, materialId: 'acero' },

  // Épicos (12%)
  { name: 'Rubí', emoji: '🔴', rarity: 'epico', minMoney: 150, maxMoney: 300, expBonus: 75, materialId: 'rubi' },
  { name: 'Esmeralda', emoji: '🟢', rarity: 'epico', minMoney: 150, maxMoney: 300, expBonus: 75, materialId: 'esmeralda' },
  { name: 'Zafiro', emoji: '🔵', rarity: 'epico', minMoney: 150, maxMoney: 300, expBonus: 75, materialId: 'zafiro' },
  { name: 'Titanio', emoji: '🔘', rarity: 'epico', minMoney: 180, maxMoney: 350, expBonus: 85, materialId: 'titanio' },
  { name: 'Esencia de Fuego', emoji: '🔥', rarity: 'epico', minMoney: 200, maxMoney: 400, expBonus: 100, materialId: 'esencia_fuego' },
  { name: 'Esencia de Hielo', emoji: '❄️', rarity: 'epico', minMoney: 200, maxMoney: 400, expBonus: 100, materialId: 'esencia_hielo' },
  { name: 'Esencia de Rayo', emoji: '⚡', rarity: 'epico', minMoney: 200, maxMoney: 400, expBonus: 100, materialId: 'esencia_rayo' },
  { name: 'Fragmento de Alma', emoji: '👻', rarity: 'epico', minMoney: 250, maxMoney: 450, expBonus: 120, materialId: 'fragmento_alma' },

  // Legendarios (3%)
  { name: 'Diamante', emoji: '💎', rarity: 'legendario', minMoney: 400, maxMoney: 800, expBonus: 200, materialId: 'diamante' },
  { name: 'Mithril', emoji: '✨', rarity: 'legendario', minMoney: 500, maxMoney: 1000, expBonus: 250, materialId: 'mithril' },
  { name: 'Adamantita', emoji: '💠', rarity: 'legendario', minMoney: 600, maxMoney: 1200, expBonus: 300, materialId: 'adamantita' },
  { name: 'Polvo Estelar', emoji: '⭐', rarity: 'legendario', minMoney: 550, maxMoney: 1100, expBonus: 280, materialId: 'polvo_estelar' },
  { name: 'Escama de Dragón', emoji: '🐉', rarity: 'legendario', minMoney: 800, maxMoney: 1500, expBonus: 400, materialId: 'escama_dragon' },
  { name: 'Núcleo Elemental', emoji: '🌀', rarity: 'legendario', minMoney: 900, maxMoney: 1800, expBonus: 500, materialId: 'nucleo_elemental' }
];

const MINING_MESSAGES = [
  'Excavaste profundamente en la mina abandonada',
  'Encontraste una veta oculta en las montañas',
  'Trabajaste duro en las cavernas oscuras',
  'Exploraste un túnel secreto bajo tierra',
  'Minaste en las profundidades del volcán',
  'Descubriste una cueva llena de minerales',
  'Rompiste rocas en la mina del pueblo',
  'Excavaste en las ruinas antiguas'
];

const RARITY_LABEL: Record<Mineral['rarity'], string> = {
  comun: '',
  raro: ' 🔵 [RARO]',
  epico: ' 🟠 [ÉPICO]',
  legendario: ' 🟣 [LEGENDARIO]'
};

function selectMineral(): Mineral {
  const roll = Math.random() * 100;
  const rarity: Mineral['rarity'] = roll < 3 ? 'legendario' : roll < 15 ? 'epico' : roll < 40 ? 'raro' : 'comun';
  return pickRandom(MINERALS.filter(m => m.rarity === rarity));
}

export const minePlugin: PluginHandler = {
  command: /^(mine|minar|picar|excavar|cavar)$/i,
  tags: ['rpg'],
  help: ['minar - Minar minerales para ganar dinero, XP y materiales de forja (cada 10 minutos)'],
  usage: ['minar'],
  register: true,

  handler: async (ctx: MessageContext) => {
    const { m, usedPrefix } = ctx;
    const db = getDatabase();
    const user = db.getUser(m.sender);
    const now = Date.now();
    const benefits = getRankBenefits(user.level);

    const cd = checkCooldown(user.lastMine, CONFIG.cooldowns.mine, benefits.cooldownReduction);
    if (cd.onCooldown) {
      return replyCooldown(ctx, cd.remaining, [
        { cmd: 'work', desc: 'Trabajar por XP' },
        { cmd: 'forja', desc: 'Usar tus materiales' }
      ]);
    }

    const found: { mineral: Mineral; money: number }[] = [];
    const materials = { ...user.forgeMaterials };
    let money = 0;
    let bonusExp = 0;

    for (let i = randomInt(1, 3); i > 0; i--) {
      const mineral = selectMineral();
      const value = randomInt(mineral.minMoney, mineral.maxMoney);
      found.push({ mineral, money: value });
      money += value;
      bonusExp += mineral.expBonus;
      materials[mineral.materialId] = (materials[mineral.materialId] || 0) + 1;
    }

    db.updateUser(m.sender, { lastMine: now, forgeMaterials: materials });

    const result = grantRewards(
      db,
      m.sender,
      { exp: 80 + user.level * 30 + bonusExp, money, questObjectives: [{ objective: 'mine', amount: 1 }] },
      { source: 'mine', now }
    );

    const lines = found.map(({ mineral, money: value }) =>
      `${mineral.emoji} *${mineral.name}*${RARITY_LABEL[mineral.rarity]} +${formatNumber(value)} ${EMOJI.coin}`
    );
    lines.push(`+${formatNumber(result.exp)} ${EMOJI.exp} XP`, `+${formatNumber(result.money)} ${EMOJI.coin} monedas en total`);
    lines.push(...result.lines);

    const best = found.some(f => f.mineral.rarity === 'legendario')
      ? '\n🎉 *¡Encontraste un mineral LEGENDARIO!*'
      : found.some(f => f.mineral.rarity === 'epico') ? '\n✨ *¡Encontraste un mineral ÉPICO!*' : '';

    const fresh = db.getUser(m.sender);
    await m.reply(formatReward(ctx, '⛏️ Minería completada', lines, {
      intro: `🪨 *${pickRandom(MINING_MESSAGES)}*${best}`,
      footer: `${EMOJI.level} Nivel *${fresh.level}* · ${EMOJI.coin} ${formatNumber(fresh.money)}\n` +
        `${EMOJI.time} Próxima minería en *${Math.floor(cd.effectiveCooldown / 60000)} minutos*. ⚒️ Materiales guardados para *${usedPrefix}forja*.`
    }));
  }
};

export default minePlugin;
