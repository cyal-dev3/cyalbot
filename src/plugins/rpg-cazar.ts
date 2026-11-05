import type { PluginHandler, MessageContext } from '../types/message.js';
import { EMOJI, formatNumber, pickRandom, randomInt, checkCooldown } from '../lib/utils.js';
import { getDatabase } from '../lib/database.js';
import { CONFIG } from '../config.js';
import { getRankBenefits } from '../types/user.js';
import { calculateTotalStats } from '../lib/rpg-utils.js';
import { grantRewards, replyCooldown, formatReward } from '../lib/rpg-actions.js';
import { FORGE_MATERIALS } from './rpg-forja.js';

/** Energía que cuesta cada cacería */
export const HUNT_STAMINA_COST = 20;

interface Prey {
  name: string;
  emoji: string;
  weight: number;
  minMoney: number;
  maxMoney: number;
  exp: number;
  /** Probabilidad de herirse (%) y daño en % de la vida máxima */
  injuryChance: number;
  injuryPercent: [number, number];
  /** Materiales de forja que puede dejar (id -> probabilidad %) */
  drops: Record<string, number>;
}

const PREY: Prey[] = [
  { name: 'Conejo', emoji: '🐇', weight: 30, minMoney: 20, maxMoney: 50, exp: 30, injuryChance: 2, injuryPercent: [2, 5], drops: { cuero: 40 } },
  { name: 'Ciervo', emoji: '🦌', weight: 25, minMoney: 50, maxMoney: 120, exp: 60, injuryChance: 5, injuryPercent: [5, 10], drops: { cuero: 70 } },
  { name: 'Jabalí', emoji: '🐗', weight: 20, minMoney: 80, maxMoney: 180, exp: 90, injuryChance: 20, injuryPercent: [10, 20], drops: { cuero: 60 } },
  { name: 'Lobo', emoji: '🐺', weight: 15, minMoney: 120, maxMoney: 260, exp: 130, injuryChance: 30, injuryPercent: [10, 25], drops: { cuero: 50, fragmento_alma: 5 } },
  { name: 'Oso', emoji: '🐻', weight: 8, minMoney: 250, maxMoney: 500, exp: 220, injuryChance: 45, injuryPercent: [15, 35], drops: { cuero: 80, fragmento_alma: 10 } },
  { name: 'Dragón joven', emoji: '🐲', weight: 2, minMoney: 800, maxMoney: 1600, exp: 600, injuryChance: 60, injuryPercent: [25, 45], drops: { escama_dragon: 60, esencia_fuego: 30 } }
];

const HUNT_MESSAGES = [
  'Rastreaste huellas en el bosque oscuro',
  'Esperaste en silencio entre los arbustos',
  'Seguiste a tu presa hasta el claro',
  'Tendiste una emboscada junto al río',
  'Cazaste bajo la luz de la luna'
];

export function selectPrey(roll: number = Math.random()): Prey {
  const total = PREY.reduce((sum, p) => sum + p.weight, 0);
  let remaining = roll * total;
  for (const prey of PREY) {
    remaining -= prey.weight;
    if (remaining <= 0) return prey;
  }
  return PREY[PREY.length - 1];
}

/**
 * El comando es `caceria` y no `cazar`/`hunt` porque rpg-atacar.ts registra
 * ambos como alias de atacar y el handler se queda con el primer plugin que
 * los registra. Cuando combate los suelte, se añaden aquí.
 */
export const cazarPlugin: PluginHandler = {
  command: /^(caceria|cacería|cazarpresa)$/i,
  tags: ['rpg'],
  help: [
    `caceria - Salir de caza: dinero, XP y materiales (cada ${CONFIG.cooldowns.hunt / 60000} minutos)`,
    `Cuesta ${HUNT_STAMINA_COST} de energía y puedes salir herido`
  ],
  usage: ['caceria'],
  register: true,

  handler: async (ctx: MessageContext) => {
    const { m, usedPrefix } = ctx;
    const db = getDatabase();
    const user = db.getUser(m.sender);
    const now = Date.now();

    const cd = checkCooldown(user.lastHunt ?? 0, CONFIG.cooldowns.hunt, getRankBenefits(user.level).cooldownReduction);
    if (cd.onCooldown) {
      return replyCooldown(ctx, cd.remaining, [
        { cmd: 'pescar', desc: 'Ir a pescar' },
        { cmd: 'explorar', desc: 'Explorar el mapa' }
      ]);
    }

    if (user.stamina < HUNT_STAMINA_COST) {
      return m.reply(
        `${EMOJI.stamina} Estás demasiado cansado para cazar.\n\n` +
        `⚡ Energía: *${user.stamina}* / necesitas *${HUNT_STAMINA_COST}*\n` +
        `💡 La energía se regenera sola con el tiempo.`
      );
    }

    const prey = selectPrey();
    const money = randomInt(prey.minMoney, prey.maxMoney);
    const total = calculateTotalStats(user);

    const materials = { ...user.forgeMaterials };
    const dropLines: string[] = [];
    for (const [materialId, chance] of Object.entries(prey.drops)) {
      const material = FORGE_MATERIALS[materialId];
      if (!material || randomInt(1, 100) > chance) continue;
      materials[materialId] = (materials[materialId] || 0) + 1;
      dropLines.push(`${material.emoji} +1 ${material.name} (material de forja)`);
    }

    // La herida nunca mata: la vida queda como mínimo en 1
    let injuryLine = '';
    let health = user.health;
    if (randomInt(1, 100) <= prey.injuryChance) {
      const percent = randomInt(prey.injuryPercent[0], prey.injuryPercent[1]);
      const damage = Math.min(health - 1, Math.max(1, Math.floor(total.maxHealth * percent / 100)));
      if (damage > 0) {
        health -= damage;
        injuryLine = `🩸 ¡${prey.name} te hirió! -${damage} ${EMOJI.health} (quedas con ${health})`;
      }
    }

    db.updateUser(m.sender, {
      lastHunt: now,
      stamina: user.stamina - HUNT_STAMINA_COST,
      health,
      forgeMaterials: materials
    });

    const result = grantRewards(
      db,
      m.sender,
      { exp: prey.exp + user.level * 5, money, questObjectives: [{ objective: 'hunt', amount: 1 }] },
      { source: 'hunt', now }
    );

    const lines = [
      `${prey.emoji} Cazaste un *${prey.name}*`,
      ...dropLines,
      `+${formatNumber(result.exp)} ${EMOJI.exp} XP`,
      `+${formatNumber(result.money)} ${EMOJI.coin} monedas`,
      `-${HUNT_STAMINA_COST} ${EMOJI.stamina} energía`
    ];
    if (injuryLine) lines.push(injuryLine);
    lines.push(...result.lines);

    const fresh = db.getUser(m.sender);
    await m.reply(formatReward(ctx, '🏹 Cacería completada', lines, {
      intro: `🌲 *${pickRandom(HUNT_MESSAGES)}*`,
      footer: `${EMOJI.health} ${fresh.health}/${total.maxHealth} · ${EMOJI.stamina} ${fresh.stamina}/${total.maxStamina} · ${EMOJI.coin} ${formatNumber(fresh.money)}\n` +
        `${EMOJI.time} Próxima cacería en *${Math.floor(cd.effectiveCooldown / 60000)} minutos*. Materiales para *${usedPrefix}forja*.`
    }));
  }
};

export default cazarPlugin;
