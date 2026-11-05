import type { PluginHandler, MessageContext } from '../types/message.js';
import { getDatabase } from '../lib/database.js';
import { EMOJI, formatNumber, randomInt, pickRandom, checkCooldown } from '../lib/utils.js';
import { COOLDOWNS } from '../constants/rpg.js';
import { loseExp } from '../lib/levelling.js';
import { calculateTotalStats } from '../lib/rpg-utils.js';
import { getRankBenefits, type UserRPG } from '../types/user.js';
import { grantRewards, replyCooldown, formatReward, type RewardInput, type RewardResult } from '../lib/rpg-actions.js';
import { ensureDebtTimestamps } from './rpg-economia.js';

const PIEDRA_COST = 100;

interface SmokeOutcome {
  /** Recompensas base: pasan por grantRewards y el mensaje muestra lo entregado de verdad */
  rewards?: RewardInput;
  updates?: Partial<UserRPG>;
  expLoss?: number;
  /** Texto del efecto cuando no hay recompensa (cambios directos o pérdidas) */
  message?: string;
}

interface SmokeEffect {
  name: string;
  emoji: string;
  description: string;
  apply: (user: UserRPG) => SmokeOutcome;
}

const POSITIVE_EFFECTS: SmokeEffect[] = [
  {
    name: 'Visión Divina',
    emoji: '👁️✨',
    description: 'Ves el futuro y ganas experiencia',
    apply: () => ({ rewards: { exp: randomInt(100, 500) } })
  },
  {
    name: 'Manos de Oro',
    emoji: '🙌💰',
    description: 'Encuentras dinero en tus bolsillos',
    apply: () => ({ rewards: { money: randomInt(200, 1000) } })
  },
  {
    name: 'Regeneración Total',
    emoji: '💚🔄',
    description: 'Tu salud se restaura completamente',
    apply: (user) => {
      const max = calculateTotalStats(user).maxHealth;
      return { updates: { health: max }, message: `Salud completa (${max}/${max})` };
    }
  },
  {
    name: 'Energía Infinita',
    emoji: '⚡🔥',
    description: 'Tu energía y maná se restauran',
    apply: (user) => {
      const total = calculateTotalStats(user);
      return { updates: { stamina: total.maxStamina, mana: total.maxMana }, message: 'Energía y maná al máximo' };
    }
  },
  {
    name: 'Suerte del Fumador',
    emoji: '🍀🎰',
    description: 'Ganas diamantes',
    apply: () => ({ rewards: { diamonds: randomInt(5, 20) } })
  },
  {
    name: 'Pociones Mágicas',
    emoji: '🧪✨',
    description: 'Aparecen pociones en tu inventario',
    apply: () => ({ rewards: { potions: randomInt(5, 15) } })
  },
  {
    name: 'Iluminación',
    emoji: '💡🌟',
    description: 'Una revelación te hace más sabio y más rico',
    apply: () => ({ rewards: { exp: randomInt(300, 800), money: randomInt(100, 300) } })
  }
];

/** Resume lo que grantRewards entregó de verdad (ya con rango, modos, gremio y corte de esclavitud) */
function describeDelivered(result: RewardResult): string {
  const parts: string[] = [];
  if (result.exp > 0) parts.push(`+${formatNumber(result.exp)} XP`);
  if (result.money > 0) parts.push(`+${formatNumber(result.money)} monedas`);
  if (result.diamonds > 0) parts.push(`+${result.diamonds} 💎 diamantes`);
  if (result.potions > 0) parts.push(`+${result.potions} pociones`);
  return parts.length ? parts.join(', ') : 'no te quedó nada';
}

const NEGATIVE_EFFECTS: SmokeEffect[] = [
  {
    name: 'Sobredosis',
    emoji: '💀☠️',
    description: 'Casi te mueres',
    apply: () => ({ updates: { health: 1 }, message: 'Tu salud cayó a 1' })
  },
  {
    name: 'Te Robaron',
    emoji: '🦹‍♂️💸',
    description: 'Mientras estabas ido, te robaron',
    apply: (user) => {
      const loss = Math.floor(user.money * 0.2);
      return { updates: { money: Math.max(0, user.money - loss) }, message: `-${formatNumber(loss)} monedas (20%)` };
    }
  },
  {
    name: 'Paranoia',
    emoji: '😰👻',
    description: 'Gastaste dinero en protección imaginaria',
    apply: (user) => {
      const loss = Math.min(user.money, randomInt(100, 500));
      return { updates: { money: user.money - loss }, message: `-${formatNumber(loss)} monedas` };
    }
  },
  {
    name: 'Resaca Brutal',
    emoji: '🤢🤮',
    description: 'Pierdes energía y maná',
    apply: (user) => ({
      updates: { stamina: Math.max(0, user.stamina - 50), mana: Math.max(0, user.mana - 30) },
      message: '-50 energía, -30 maná'
    })
  },
  {
    name: 'Amnesia',
    emoji: '🧠❌',
    description: 'Olvidas parte de tu experiencia',
    apply: () => {
      const expLoss = randomInt(50, 200);
      return { expLoss, message: `-${formatNumber(expLoss)} XP` };
    }
  },
  {
    name: 'Multa del IMSS',
    emoji: '🏥📋',
    description: 'El IMSS te multó por consumo ilegal',
    apply: (user) => {
      const fine = randomInt(200, 800);
      return { updates: { debt: user.debt + fine }, message: `+${formatNumber(fine)} deuda IMSS` };
    }
  },
  {
    name: 'Bad Trip',
    emoji: '😵‍💫🌀',
    description: 'Perdiste salud, energía y cordura',
    apply: (user) => ({
      updates: { health: Math.max(1, user.health - 30), stamina: Math.max(0, user.stamina - 30) },
      message: '-30 salud, -30 energía'
    })
  }
];

const SMOKE_INTRO_MESSAGES = [
  '🪨💨 *{name}* saca una piedrita sospechosa...',
  '🪨🔥 *{name}* enciende la pipa de la sabiduría...',
  '🪨💨 *{name}* inhala profundamente la piedra...',
  '🪨😤 *{name}* le da un buen jalón a la piedra...',
  '🪨🌬️ *{name}* fuma la roca del destino...'
];

export const fumarPlugin: PluginHandler = {
  command: ['fumar', 'smoke', 'piedra', 'crack', 'fumarpiedra'],
  tags: ['rpg'],
  help: [
    `fumar - Fuma una piedra ($${PIEDRA_COST}): 50% efecto positivo, 50% negativo`,
    `Cooldown: ${COOLDOWNS.FUMAR / 60000} minutos`
  ],
  usage: ['fumar'],
  register: true,

  handler: async (ctx: MessageContext) => {
    const { m, usedPrefix } = ctx;
    const db = getDatabase();
    const user = db.getUser(m.sender);
    const now = Date.now();

    const cd = checkCooldown(user.lastFumar || 0, COOLDOWNS.FUMAR, getRankBenefits(user.level).cooldownReduction);
    if (cd.onCooldown) {
      return replyCooldown(ctx, cd.remaining, [{ cmd: 'work', desc: 'Trabajar mientras se te baja' }]);
    }

    if (user.money < PIEDRA_COST) {
      return m.reply(
        `${EMOJI.error} No tienes dinero para comprar piedra.\n\n` +
        `💰 Tu dinero: *$${formatNumber(user.money)}*\n` +
        `🪨 Costo: *$${formatNumber(PIEDRA_COST)}*\n\n` +
        `💡 _Usa *${usedPrefix}work* o *${usedPrefix}minar* para conseguir dinero._`
      );
    }

    const senderName = user.name || m.pushName || 'Usuario';
    db.updateUser(m.sender, { money: user.money - PIEDRA_COST, lastFumar: now });

    const isPositive = Math.random() < 0.5;
    const effect = pickRandom(isPositive ? POSITIVE_EFFECTS : NEGATIVE_EFFECTS);
    const outcome = effect.apply(db.getUser(m.sender));
    const lines: string[] = [];

    if (outcome.updates) {
      db.updateUser(m.sender, outcome.updates);
      if (outcome.updates.debt !== undefined) {
        const fresh = db.getUser(m.sender);
        if (ensureDebtTimestamps(fresh, now)) db.updateUser(m.sender, fresh);
      }
    }
    if (outcome.expLoss) {
      const fresh = db.getUser(m.sender);
      const lost = loseExp(fresh, outcome.expLoss);
      db.updateUser(m.sender, { exp: fresh.exp });
      if (lost < outcome.expLoss) lines.push(`_Solo perdiste ${formatNumber(lost)} XP: no bajas de nivel_`);
    }

    const result = grantRewards(
      db,
      m.sender,
      { ...(outcome.rewards ?? {}), questObjectives: [{ objective: 'fumar', amount: 1 }] },
      { source: 'fumar', now }
    );
    // La línea del efecto muestra lo recibido tras rango, modos y esclavitud, no la cantidad base
    lines.unshift(`${effect.emoji} *${effect.name}*: ${outcome.rewards ? describeDelivered(result) : outcome.message ?? ''}`);
    lines.push(...result.lines);

    const title = isPositive ? '✅ ¡Te pusiste bien, Luisin!' : '❌ ¡Te pusiste mal, Luisin!';
    await m.reply(formatReward(ctx, title, lines, {
      intro: `${pickRandom(SMOKE_INTRO_MESSAGES).replace('{name}', senderName)}\n📖 _${effect.description}_`,
      footer: `💸 Gastaste *$${formatNumber(PIEDRA_COST)}* en piedra · ⏰ Próxima fumada en *${Math.ceil(cd.effectiveCooldown / 60000)} minutos*`
    }));
    await m.react(isPositive ? '🤩' : '💀');
  }
};

export default fumarPlugin;
