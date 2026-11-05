import type { PluginHandler, MessageContext } from '../types/message.js';
import { EMOJI, formatNumber, pickRandom, randomInt, checkCooldown } from '../lib/utils.js';
import { getDatabase } from '../lib/database.js';
import { getRankBenefits } from '../types/user.js';
import { grantRewards, replyCooldown, formatReward } from '../lib/rpg-actions.js';
import { FORGE_MATERIALS } from './rpg-forja.js';

export const FISH_COOLDOWN = 15 * 60 * 1000;
/** Material de forja que deja la pesca, si existe en FORGE_MATERIALS */
const FISH_MATERIAL_ID = 'pescado';

type Rarity = 'comun' | 'raro' | 'epico' | 'legendario';

interface Fish {
  name: string;
  emoji: string;
  rarity: Rarity;
  minMoney: number;
  maxMoney: number;
  exp: number;
}

const FISH: Fish[] = [
  { name: 'Sardina', emoji: '🐟', rarity: 'comun', minMoney: 10, maxMoney: 30, exp: 15 },
  { name: 'Trucha', emoji: '🐟', rarity: 'comun', minMoney: 20, maxMoney: 45, exp: 20 },
  { name: 'Carpa', emoji: '🐠', rarity: 'comun', minMoney: 15, maxMoney: 40, exp: 20 },
  { name: 'Bota vieja', emoji: '👢', rarity: 'comun', minMoney: 1, maxMoney: 5, exp: 5 },
  { name: 'Salmón', emoji: '🐟', rarity: 'raro', minMoney: 60, maxMoney: 120, exp: 50 },
  { name: 'Pez globo', emoji: '🐡', rarity: 'raro', minMoney: 70, maxMoney: 140, exp: 55 },
  { name: 'Calamar', emoji: '🦑', rarity: 'raro', minMoney: 80, maxMoney: 160, exp: 60 },
  { name: 'Pez espada', emoji: '🗡️', rarity: 'epico', minMoney: 200, maxMoney: 400, exp: 150 },
  { name: 'Tiburón', emoji: '🦈', rarity: 'epico', minMoney: 250, maxMoney: 500, exp: 180 },
  { name: 'Pulpo gigante', emoji: '🐙', rarity: 'epico', minMoney: 220, maxMoney: 450, exp: 160 },
  { name: 'Pez dorado legendario', emoji: '✨', rarity: 'legendario', minMoney: 800, maxMoney: 1500, exp: 500 },
  { name: 'Kraken bebé', emoji: '🐉', rarity: 'legendario', minMoney: 1000, maxMoney: 2000, exp: 650 }
];

const RARITY_LABEL: Record<Rarity, string> = {
  comun: '',
  raro: ' 🔵 [RARO]',
  epico: ' 🟠 [ÉPICO]',
  legendario: ' 🟣 [LEGENDARIO]'
};

const FISHING_MESSAGES = [
  'Lanzaste la caña al lago místico',
  'Esperaste pacientemente en el muelle',
  'Pescaste en el río de la aldea',
  'Te adentraste en el pantano con tu red',
  'Pescaste bajo la lluvia en la costa'
];

export function selectFish(roll: number = Math.random() * 100): Fish {
  const rarity: Rarity = roll < 2 ? 'legendario' : roll < 12 ? 'epico' : roll < 35 ? 'raro' : 'comun';
  return pickRandom(FISH.filter(f => f.rarity === rarity));
}

export const pescarPlugin: PluginHandler = {
  command: /^(pescar|fish|pesca)$/i,
  tags: ['rpg'],
  help: [`pescar - Pescar para ganar dinero y XP (cada ${FISH_COOLDOWN / 60000} minutos)`],
  usage: ['pescar'],
  register: true,

  handler: async (ctx: MessageContext) => {
    const { m, usedPrefix } = ctx;
    const db = getDatabase();
    const user = db.getUser(m.sender);
    const now = Date.now();

    const cd = checkCooldown(user.lastFish ?? 0, FISH_COOLDOWN, getRankBenefits(user.level).cooldownReduction);
    if (cd.onCooldown) {
      return replyCooldown(ctx, cd.remaining, [
        { cmd: 'caceria', desc: 'Salir de caza' },
        { cmd: 'minar', desc: 'Minar minerales' }
      ]);
    }

    const catches: { fish: Fish; money: number }[] = [];
    let money = 0;
    let exp = 10 + user.level * 5;
    for (let i = randomInt(1, 2); i > 0; i--) {
      const fish = selectFish();
      const value = randomInt(fish.minMoney, fish.maxMoney);
      catches.push({ fish, money: value });
      money += value;
      exp += fish.exp;
    }

    const updates: Parameters<typeof db.updateUser>[1] = { lastFish: now };
    const materialLine: string[] = [];
    if (FORGE_MATERIALS[FISH_MATERIAL_ID]) {
      const edible = catches.filter(c => c.fish.rarity !== 'comun' || c.fish.name !== 'Bota vieja').length;
      if (edible > 0) {
        updates.forgeMaterials = { ...user.forgeMaterials, [FISH_MATERIAL_ID]: (user.forgeMaterials[FISH_MATERIAL_ID] || 0) + edible };
        materialLine.push(`${FORGE_MATERIALS[FISH_MATERIAL_ID].emoji} +${edible} ${FORGE_MATERIALS[FISH_MATERIAL_ID].name} (material de forja)`);
      }
    }
    db.updateUser(m.sender, updates);

    const result = grantRewards(
      db,
      m.sender,
      { exp, money, questObjectives: [{ objective: 'fish', amount: 1 }] },
      { source: 'fish', now }
    );

    const lines = catches.map(({ fish, money: value }) => `${fish.emoji} *${fish.name}*${RARITY_LABEL[fish.rarity]} +${formatNumber(value)} ${EMOJI.coin}`);
    lines.push(...materialLine);
    lines.push(`+${formatNumber(result.exp)} ${EMOJI.exp} XP`, `+${formatNumber(result.money)} ${EMOJI.coin} monedas en total`);
    lines.push(...result.lines);

    const fresh = db.getUser(m.sender);
    await m.reply(formatReward(ctx, '🎣 Pesca completada', lines, {
      intro: `🌊 *${pickRandom(FISHING_MESSAGES)}*`,
      footer: `${EMOJI.level} Nivel *${fresh.level}* · ${EMOJI.coin} ${formatNumber(fresh.money)}\n` +
        `${EMOJI.time} Próxima pesca en *${Math.floor(cd.effectiveCooldown / 60000)} minutos*. Prueba *${usedPrefix}caceria* mientras tanto.`
    }));
  }
};

export default pescarPlugin;
