/**
 * 🪨💨 Plugin de Fumar Piedra - RPG
 * Comando: fumar - Fuma una piedra con efectos aleatorios
 * 50% positivo, 50% negativo - "Te pusiste bien Luisin"
 */

import type { PluginHandler, MessageContext } from '../types/message.js';
import { getDatabase } from '../lib/database.js';
import { EMOJI, formatNumber, randomInt, pickRandom } from '../lib/utils.js';

// Costo de una piedra
const PIEDRA_COST = 100;

// Cooldown de 5 minutos
const FUMAR_COOLDOWN = 5 * 60 * 1000;

// Efectos positivos
const POSITIVE_EFFECTS = [
  {
    name: 'Visión Divina',
    emoji: '👁️✨',
    description: 'Ves el futuro y ganas experiencia',
    apply: (user: any) => {
      const expGain = randomInt(100, 500);
      return { exp: user.exp + expGain, message: `+${formatNumber(expGain)} XP` };
    }
  },
  {
    name: 'Manos de Oro',
    emoji: '🙌💰',
    description: 'Encuentras dinero en tus bolsillos',
    apply: (user: any) => {
      const moneyGain = randomInt(200, 1000);
      return { money: user.money + moneyGain, message: `+${formatNumber(moneyGain)} monedas` };
    }
  },
  {
    name: 'Regeneración Total',
    emoji: '💚🔄',
    description: 'Tu salud se restaura completamente',
    apply: (user: any) => {
      return { health: user.maxHealth, message: `Salud completa (${user.maxHealth}/${user.maxHealth})` };
    }
  },
  {
    name: 'Energía Infinita',
    emoji: '⚡🔥',
    description: 'Tu stamina y maná se restauran',
    apply: (user: any) => {
      return {
        stamina: user.maxStamina,
        mana: user.maxMana,
        message: `Energía y maná al máximo`
      };
    }
  },
  {
    name: 'Suerte del Fumador',
    emoji: '🍀🎰',
    description: 'Ganas diamantes',
    apply: (user: any) => {
      const diamonds = randomInt(5, 20);
      return { limit: user.limit + diamonds, message: `+${diamonds} 💎 diamantes` };
    }
  },
  {
    name: 'Pociones Mágicas',
    emoji: '🧪✨',
    description: 'Aparecen pociones en tu inventario',
    apply: (user: any) => {
      const potions = randomInt(5, 15);
      return { potion: user.potion + potions, message: `+${potions} pociones` };
    }
  },
  {
    name: 'Iluminación',
    emoji: '💡🌟',
    description: 'Ganas un boost de XP temporal',
    apply: (user: any) => {
      const expGain = randomInt(300, 800);
      const moneyGain = randomInt(100, 300);
      return {
        exp: user.exp + expGain,
        money: user.money + moneyGain,
        message: `+${formatNumber(expGain)} XP, +${formatNumber(moneyGain)} monedas`
      };
    }
  }
];

// Efectos negativos
const NEGATIVE_EFFECTS = [
  {
    name: 'Sobredosis',
    emoji: '💀☠️',
    description: 'Casi te mueres',
    apply: (user: any) => {
      return { health: 1, message: `Tu salud cayó a 1` };
    }
  },
  {
    name: 'Te Robaron',
    emoji: '🦹‍♂️💸',
    description: 'Mientras estabas ido, te robaron',
    apply: (user: any) => {
      const moneyLoss = Math.floor(user.money * 0.2);
      return { money: Math.max(0, user.money - moneyLoss), message: `-${formatNumber(moneyLoss)} monedas (20%)` };
    }
  },
  {
    name: 'Paranoia',
    emoji: '😰👻',
    description: 'Gastaste dinero en protección imaginaria',
    apply: (user: any) => {
      const moneyLoss = randomInt(100, 500);
      return { money: Math.max(0, user.money - moneyLoss), message: `-${formatNumber(moneyLoss)} monedas` };
    }
  },
  {
    name: 'Resaca Brutal',
    emoji: '🤢🤮',
    description: 'Pierdes energía y maná',
    apply: (user: any) => {
      return {
        stamina: Math.max(0, user.stamina - 50),
        mana: Math.max(0, user.mana - 30),
        message: `-50 energía, -30 maná`
      };
    }
  },
  {
    name: 'Amnesia',
    emoji: '🧠❌',
    description: 'Olvidas parte de tu experiencia',
    apply: (user: any) => {
      const expLoss = Math.min(user.exp, randomInt(50, 200));
      return { exp: Math.max(0, user.exp - expLoss), message: `-${formatNumber(expLoss)} XP` };
    }
  },
  {
    name: 'Multa del IMSS',
    emoji: '🏥📋',
    description: 'El IMSS te multó por consumo ilegal',
    apply: (user: any) => {
      const debtIncrease = randomInt(200, 800);
      return { debt: user.debt + debtIncrease, message: `+${formatNumber(debtIncrease)} deuda IMSS` };
    }
  },
  {
    name: 'Bad Trip',
    emoji: '😵‍💫🌀',
    description: 'Perdiste salud, energía y cordura',
    apply: (user: any) => {
      return {
        health: Math.max(1, user.health - 30),
        stamina: Math.max(0, user.stamina - 30),
        message: `-30 salud, -30 energía`
      };
    }
  }
];

// Mensajes de fumada
const SMOKE_INTRO_MESSAGES = [
  '🪨💨 *{name}* saca una piedrita sospechosa...',
  '🪨🔥 *{name}* enciende la pipa de la sabiduría...',
  '🪨💨 *{name}* inhala profundamente la piedra...',
  '🪨😤 *{name}* le da un buen jalón a la piedra...',
  '🪨🌬️ *{name}* fuma la roca del destino...'
];

/**
 * Plugin: Fumar - Fuma una piedra con efectos aleatorios
 */
export const fumarPlugin: PluginHandler = {
  command: ['fumar', 'smoke', 'piedra', 'crack', 'fumarpiedra'],
  tags: ['rpg'],
  help: [
    'fumar - Fuma una piedra ($100)',
    '50% chance de efecto positivo',
    '50% chance de efecto negativo',
    'Cooldown: 5 minutos'
  ],
  register: true,

  handler: async (ctx: MessageContext) => {
    const { m } = ctx;
    const db = getDatabase();
    const user = db.getUser(m.sender);
    const now = Date.now();

    // Verificar cooldown
    const lastFumar = user.lastFumar || 0;
    if (now - lastFumar < FUMAR_COOLDOWN) {
      const remaining = FUMAR_COOLDOWN - (now - lastFumar);
      const minutes = Math.ceil(remaining / 60000);
      await m.reply(
        `${EMOJI.time} *¡Todavía estás muy fumado!*\n\n` +
        `😵‍💫 Espera *${minutes} minuto${minutes > 1 ? 's' : ''}* antes de fumar otra vez.\n\n` +
        `💡 _Mientras tanto, descansa un poco..._`
      );
      return;
    }

    // Verificar si tiene dinero
    if (user.money < PIEDRA_COST) {
      await m.reply(
        `${EMOJI.error} No tienes dinero para comprar piedra.\n\n` +
        `💰 Tu dinero: *$${formatNumber(user.money)}*\n` +
        `🪨 Costo: *$${formatNumber(PIEDRA_COST)}*\n\n` +
        `💡 _Trabaja o mina para conseguir dinero._`
      );
      return;
    }

    const senderName = m.pushName || user.name || 'Usuario';

    // Cobrar la piedra
    db.updateUser(m.sender, {
      money: user.money - PIEDRA_COST,
      lastFumar: now
    });

    // Refrescar usuario
    const freshUser = db.getUser(m.sender);

    // Determinar si es positivo o negativo (50/50)
    const isPositive = Math.random() < 0.5;

    // Seleccionar efecto aleatorio
    const effect = isPositive
      ? pickRandom(POSITIVE_EFFECTS)
      : pickRandom(NEGATIVE_EFFECTS);

    // Aplicar efecto
    const result = effect.apply(freshUser);
    const { message: effectMessage, ...updates } = result;
    db.updateUser(m.sender, updates);

    // Generar mensaje
    const introMsg = pickRandom(SMOKE_INTRO_MESSAGES).replace('{name}', senderName);

    let response = `${introMsg}\n\n`;

    if (isPositive) {
      response += `✅ *¡TE PUSISTE BIEN LUISIN!* ✅\n\n`;
      response += `${effect.emoji} *${effect.name}*\n`;
      response += `📖 ${effect.description}\n\n`;
      response += `🎁 *Efecto:* ${effectMessage}`;
    } else {
      response += `❌ *¡TE PUSISTE MAL LUISIN!* ❌\n\n`;
      response += `${effect.emoji} *${effect.name}*\n`;
      response += `📖 ${effect.description}\n\n`;
      response += `💀 *Efecto:* ${effectMessage}`;
    }

    response += `\n\n💸 Gastaste *$${formatNumber(PIEDRA_COST)}* en piedra\n`;
    response += `⏰ Próxima fumada en: *5 minutos*`;

    await m.reply(response);
    await m.react(isPositive ? '🤩' : '💀');
  }
};

export default fumarPlugin;
