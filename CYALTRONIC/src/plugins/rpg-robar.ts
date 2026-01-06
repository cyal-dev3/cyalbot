/**
 * 🦹 Plugin de Robo - RPG
 * Comando: robar - Intenta robar recursos de otro jugador
 */

import type { PluginHandler, MessageContext } from '../types/message.js';
import { getDatabase } from '../lib/database.js';
import { CONFIG } from '../config.js';
import { EMOJI, msToTime, formatNumber, randomInt, pickRandom } from '../lib/utils.js';

/**
 * Tipos de recursos que se pueden robar
 */
type RobbableResource = 'money' | 'exp' | 'mana';

interface RobResult {
  success: boolean;
  resource: RobbableResource;
  amount: number;
  message: string;
}

/**
 * Mensajes de éxito al robar
 */
const SUCCESS_MESSAGES: Record<RobbableResource, string[]> = {
  money: [
    '💰 Te infiltraste sigilosamente y robaste {amount} monedas de {victim}!',
    '🦹 Como un verdadero ladrón, le quitaste {amount} monedas a {victim}!',
    '💸 Mientras {victim} dormía, le robaste {amount} monedas!',
    '🎭 Con tu disfraz perfecto, engañaste a {victim} y te llevaste {amount} monedas!',
    '🌙 Bajo la luz de la luna, robaste {amount} monedas de la bolsa de {victim}!'
  ],
  exp: [
    '✨ Absorbiste {amount} XP de la esencia vital de {victim}!',
    '🔮 Con magia oscura, drenaste {amount} XP de {victim}!',
    '⚡ Canalizaste la energía de {victim} y obtuviste {amount} XP!',
    '💫 El conocimiento de {victim} ahora es tuyo: +{amount} XP!',
    '🌟 Robaste {amount} puntos de experiencia del aura de {victim}!'
  ],
  mana: [
    '💠 Drenaste {amount} de maná de {victim}!',
    '🔵 Con un hechizo prohibido, robaste {amount} de maná a {victim}!',
    '💎 La energía mágica de {victim} fluye hacia ti: +{amount} maná!',
    '✨ Absorbiste {amount} puntos de maná de {victim}!',
    '🌀 El maná de {victim} ahora corre por tus venas: +{amount}!'
  ]
};

/**
 * Mensajes de fallo al robar
 */
const FAIL_MESSAGES = [
  '🚨 ¡{victim} te atrapó con las manos en la masa! Perdiste {penalty} monedas como multa.',
  '👮 ¡Los guardias te vieron! Pagaste {penalty} monedas de fianza.',
  '💥 ¡{victim} te noqueó mientras intentabas robarle! Perdiste {penalty} monedas.',
  '🐕 ¡El perro guardián de {victim} te mordió! Gastaste {penalty} monedas en curarte.',
  '⚔️ ¡{victim} estaba alerta y te venció! Dejaste caer {penalty} monedas.',
  '🪤 ¡Caíste en una trampa de {victim}! Perdiste {penalty} monedas.',
  '👁️ ¡Un testigo te delató! Pagaste {penalty} monedas para silenciarlo.',
  '🏃 ¡Huiste pero tropezaste! Se te cayeron {penalty} monedas.'
];

/**
 * Calcula el resultado del intento de robo
 */
function calculateRobAttempt(
  thiefLevel: number,
  victimLevel: number,
  victimMoney: number,
  victimExp: number,
  victimMana: number
): RobResult {
  // Probabilidad base: 40%
  // +2% por cada nivel del ladrón
  // -3% por cada nivel de la víctima
  const levelDiff = thiefLevel - victimLevel;
  const baseChance = 40;
  const thiefBonus = thiefLevel * 2;
  const victimDefense = victimLevel * 3;
  const successChance = Math.min(75, Math.max(15, baseChance + thiefBonus - victimDefense + (levelDiff * 2)));

  const roll = randomInt(1, 100);
  const success = roll <= successChance;

  if (!success) {
    // Falló - calcular penalización
    const penalty = randomInt(50, 200);
    return {
      success: false,
      resource: 'money',
      amount: penalty,
      message: pickRandom(FAIL_MESSAGES)
    };
  }

  // Éxito - determinar qué robar
  // Prioridad: dinero (60%), exp (25%), mana (15%)
  const resourceRoll = randomInt(1, 100);
  let resource: RobbableResource;
  let maxSteal: number;
  let minSteal: number;

  if (resourceRoll <= 60 && victimMoney > 100) {
    resource = 'money';
    // Robar entre 5% y 15% del dinero de la víctima
    minSteal = Math.floor(victimMoney * 0.05);
    maxSteal = Math.floor(victimMoney * 0.15);
  } else if (resourceRoll <= 85 && victimExp > 500) {
    resource = 'exp';
    // Robar entre 2% y 8% de la experiencia
    minSteal = Math.floor(victimExp * 0.02);
    maxSteal = Math.floor(victimExp * 0.08);
  } else if (victimMana > 10) {
    resource = 'mana';
    // Robar entre 5 y 20 de maná
    minSteal = 5;
    maxSteal = Math.min(20, victimMana - 5);
  } else {
    // Fallback a dinero
    resource = 'money';
    minSteal = Math.floor(victimMoney * 0.03);
    maxSteal = Math.floor(victimMoney * 0.10);
  }

  // Asegurar mínimos
  minSteal = Math.max(minSteal, 10);
  maxSteal = Math.max(maxSteal, minSteal + 10);

  const amount = randomInt(minSteal, maxSteal);

  return {
    success: true,
    resource,
    amount: Math.max(amount, 1),
    message: pickRandom(SUCCESS_MESSAGES[resource])
  };
}

/**
 * Obtiene el JID del usuario objetivo
 */
function getTargetUser(ctx: MessageContext): string | null {
  // Primero menciones
  if (ctx.m.mentionedJid.length > 0) {
    return ctx.m.mentionedJid[0];
  }

  // Luego mensaje citado
  if (ctx.m.quoted?.sender) {
    return ctx.m.quoted.sender;
  }

  return null;
}

/**
 * Plugin: Robar - Intenta robar a otro jugador
 */
export const robarPlugin: PluginHandler = {
  command: ['robar', 'rob', 'steal', 'asaltar', 'hurtar'],
  tags: ['rpg'],
  help: [
    'robar @usuario - Intenta robar dinero, XP o maná',
    'El éxito depende de tu nivel vs el de la víctima',
    'Si fallas, pagarás una multa',
    'Cooldown: 2 horas'
  ],
  register: true,
  group: true,

  handler: async (ctx: MessageContext) => {
    const { m, usedPrefix } = ctx;
    const db = getDatabase();
    const thief = db.getUser(m.sender);

    // Verificar cooldown
    const now = Date.now();
    const cooldown = CONFIG.cooldowns.rob;
    const lastRob = thief.lastrob || 0;

    if (now - lastRob < cooldown) {
      const remaining = cooldown - (now - lastRob);
      await m.reply(
        `${EMOJI.time} ¡Los guardias te están buscando!\n\n` +
        `⏳ Espera *${msToTime(remaining)}* antes de volver a robar.`
      );
      return;
    }

    // Obtener víctima
    const victimJid = getTargetUser(ctx);

    if (!victimJid) {
      await m.reply(
        `${EMOJI.error} ¿A quién quieres robar?\n\n` +
        `📝 *Uso:* ${usedPrefix}robar @usuario\n` +
        `💡 Menciona o responde al mensaje de tu víctima.`
      );
      return;
    }

    // No robarse a sí mismo
    if (victimJid === m.sender) {
      await m.reply(`${EMOJI.error} No puedes robarte a ti mismo... ¿o sí? 🤔`);
      return;
    }

    // Verificar que la víctima esté registrada
    const victim = db.getUser(victimJid);
    if (!victim.registered) {
      await m.reply(
        `${EMOJI.error} Esa persona no está registrada en el juego.\n` +
        `No hay nada que robarle... aún.`
      );
      return;
    }

    // Verificar que la víctima tenga recursos
    if (victim.money < 100 && victim.exp < 500 && victim.mana < 10) {
      await m.reply(
        `${EMOJI.warning} *${victim.name}* está en la pobreza total.\n` +
        `No vale la pena el riesgo... busca una víctima más jugosa. 💀`
      );
      return;
    }

    // Verificar que el ladrón tenga dinero para la multa potencial
    if (thief.money < 50) {
      await m.reply(
        `${EMOJI.error} Necesitas al menos *50 monedas* para robar.\n` +
        `Si fallas, tendrás que pagar una multa.`
      );
      return;
    }

    // Realizar el intento de robo
    await m.react('🦹');

    const result = calculateRobAttempt(
      thief.level,
      victim.level,
      victim.money,
      victim.exp,
      victim.mana
    );

    // Aplicar el cooldown
    db.updateUser(m.sender, { lastrob: now });

    if (result.success) {
      // Éxito - transferir recursos
      const victimName = victim.name;

      switch (result.resource) {
        case 'money':
          db.updateUser(m.sender, { money: thief.money + result.amount });
          db.updateUser(victimJid, { money: Math.max(0, victim.money - result.amount) });
          break;
        case 'exp':
          db.updateUser(m.sender, { exp: thief.exp + result.amount });
          db.updateUser(victimJid, { exp: Math.max(0, victim.exp - result.amount) });
          break;
        case 'mana':
          db.updateUser(m.sender, { mana: Math.min(100, thief.mana + result.amount) });
          db.updateUser(victimJid, { mana: Math.max(0, victim.mana - result.amount) });
          break;
      }

      const message = result.message
        .replace('{amount}', formatNumber(result.amount))
        .replace('{victim}', victimName);

      const resourceEmoji = {
        money: EMOJI.coin,
        exp: EMOJI.exp,
        mana: EMOJI.mana
      };

      await m.reply(
        `🦹 *¡ROBO EXITOSO!*\n\n` +
        `${message}\n\n` +
        `${resourceEmoji[result.resource]} *+${formatNumber(result.amount)}* ${result.resource === 'money' ? 'monedas' : result.resource === 'exp' ? 'XP' : 'maná'}\n\n` +
        `⏰ Próximo robo: *2 horas*`
      );

      await m.react('💰');

    } else {
      // Falló - aplicar penalización
      const penalty = Math.min(result.amount, thief.money);
      db.updateUser(m.sender, { money: Math.max(0, thief.money - penalty) });

      const message = result.message
        .replace('{penalty}', formatNumber(penalty))
        .replace('{victim}', victim.name);

      await m.reply(
        `🚨 *¡ROBO FALLIDO!*\n\n` +
        `${message}\n\n` +
        `${EMOJI.coin} *-${formatNumber(penalty)}* monedas\n\n` +
        `💡 _Tip: Tu éxito depende de la diferencia de niveles._\n` +
        `⏰ Próximo intento: *2 horas*`
      );

      await m.react('💀');
    }
  }
};

export default robarPlugin;
