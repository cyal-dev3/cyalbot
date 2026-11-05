import type { PluginHandler, MessageContext } from '../types/message.js';
import { getDatabase } from '../lib/database.js';
import { CONFIG } from '../config.js';
import { EMOJI, formatNumber, randomInt, pickRandom, checkCooldown, mentionTag, msToTime } from '../lib/utils.js';
import { getRankBenefits, getRoleByLevel, type UserRPG } from '../types/user.js';
import { globalModes, checkExpiredModes } from '../lib/global-modes.js';
import { ROB, PVP } from '../constants/rpg.js';
import { grantExp, loseExp, xpRange } from '../lib/levelling.js';
import { calculateTotalStats } from '../lib/rpg-utils.js';
import { clamp, isPassiveActive, replyCooldown, usageError } from '../lib/rpg-actions.js';
import { updateQuestProgress } from '../lib/quests.js';

export type RobbableResource = 'money' | 'exp' | 'mana';

export interface RobResult {
  success: boolean;
  resource: RobbableResource;
  /** Cantidad a transferir (éxito) o multa (fallo); 0 si no había nada que robar */
  amount: number;
  message: string;
  successChance: number;
}

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

const EMPTY_POCKETS = '🫗 ¡La víctima no tiene nada que robar! Sus bolsillos están vacíos.';

export interface RobAttemptOptions {
  /** Bonus de rango/modos a la probabilidad de éxito (puntos porcentuales) */
  successBonus?: number;
  /** Bonus de rango/modos a la cantidad robada (%) */
  amountBonus?: number;
  /** Generador aleatorio inyectable para tests */
  rand?: (min: number, max: number) => number;
}

/**
 * Recursos que realmente pueden cambiar de manos: la XP por encima del mínimo
 * del nivel de la víctima (loseExp no baja de ahí) y el maná que además cabe en
 * el ladrón. Sin `thief`, el maná solo se limita por la víctima.
 */
export function getStealableResources(victim: UserRPG, thief?: UserRPG): Record<RobbableResource, number> {
  const victimMana = Math.max(0, Math.floor(victim.mana));
  const thiefRoom = thief ? Math.max(0, calculateTotalStats(thief).maxMana - thief.mana) : victimMana;
  return {
    money: Math.max(0, Math.floor(victim.money)),
    exp: Math.max(0, Math.floor(victim.exp) - xpRange(Math.max(0, Math.floor(victim.level || 0))).min),
    mana: Math.min(victimMana, thiefRoom)
  };
}

/** true si la víctima tiene algo que valga la pena robar según ROB.MIN_VICTIM_RESOURCES */
export function hasStealableResources(victim: UserRPG, thief?: UserRPG): boolean {
  const available = getStealableResources(victim, thief);
  return available.money >= ROB.MIN_VICTIM_RESOURCES.MONEY
    || available.exp >= ROB.MIN_VICTIM_RESOURCES.EXP
    || available.mana >= ROB.MIN_VICTIM_RESOURCES.MANA;
}

const RESOURCE_ORDER: RobbableResource[] = ['money', 'exp', 'mana'];

/**
 * Decide el resultado de un robo con las constantes ROB.*. La cantidad nunca
 * supera lo que la víctima puede perder de verdad (getStealableResources), así
 * el ladrón gana exactamente lo que la víctima pierde (ver applyRobTransfer) y
 * un robo exitoso nunca transfiere 0.
 */
export function calculateRobAttempt(thief: UserRPG, victim: UserRPG, opts: RobAttemptOptions = {}): RobResult {
  const rand = opts.rand ?? randomInt;
  const successChance = clamp(
    ROB.BASE_CHANCE
      + thief.level * ROB.THIEF_BONUS_PER_LEVEL
      - victim.level * ROB.VICTIM_DEFENSE_PER_LEVEL
      + (opts.successBonus ?? 0),
    ROB.MIN_SUCCESS_CHANCE,
    ROB.MAX_SUCCESS_CHANCE
  );

  if (rand(1, 100) > successChance) {
    return {
      success: false,
      resource: 'money',
      amount: rand(ROB.FAIL_PENALTY.MIN, ROB.FAIL_PENALTY.MAX),
      message: pickRandom(FAIL_MESSAGES),
      successChance
    };
  }

  const amountMultiplier = 1 + (opts.amountBonus ?? 0) / 100;
  const available = getStealableResources(victim, thief);
  const minimums: Record<RobbableResource, number> = {
    money: ROB.MIN_VICTIM_RESOURCES.MONEY,
    exp: ROB.MIN_VICTIM_RESOURCES.EXP,
    mana: ROB.MIN_VICTIM_RESOURCES.MANA
  };
  const worthIt = (r: RobbableResource) => available[r] >= minimums[r];

  const roll = rand(1, 100);
  const rolled: RobbableResource = roll <= ROB.RESOURCE_CHANCES.MONEY ? 'money'
    : roll <= ROB.RESOURCE_CHANCES.MONEY + ROB.RESOURCE_CHANCES.EXP ? 'exp'
    : 'mana';

  // Si el recurso sorteado no alcanza el mínimo, se cae al primero que sí; como
  // último recurso, calderilla de dinero
  const resource = worthIt(rolled) ? rolled : RESOURCE_ORDER.find(worthIt) ?? (available.money > 0 ? 'money' : null);
  if (!resource) {
    return { success: false, resource: 'money', amount: 0, message: EMPTY_POCKETS, successChance };
  }

  let amount: number;
  switch (resource) {
    case 'money':
      amount = worthIt('money')
        ? rand(
          Math.floor(available.money * ROB.MONEY_STEAL_PERCENT.MIN * amountMultiplier),
          Math.floor(available.money * ROB.MONEY_STEAL_PERCENT.MAX * amountMultiplier)
        )
        : Math.floor(available.money * ROB.MONEY_STEAL_PERCENT.MIN * amountMultiplier);
      break;
    case 'exp':
      amount = rand(
        Math.floor(available.exp * ROB.EXP_STEAL_PERCENT.MIN * amountMultiplier),
        Math.floor(available.exp * ROB.EXP_STEAL_PERCENT.MAX * amountMultiplier)
      );
      break;
    case 'mana':
      amount = rand(Math.floor(ROB.MANA_STEAL.MIN * amountMultiplier), Math.floor(ROB.MANA_STEAL.MAX * amountMultiplier));
      break;
  }
  amount = clamp(amount, 1, available[resource]);

  return { success: true, resource, amount, message: pickRandom(SUCCESS_MESSAGES[resource]), successChance };
}

/**
 * Mueve el recurso robado de la víctima al ladrón con contabilidad cerrada:
 * devuelve lo que realmente cambió de manos (XP limitada por loseExp, maná por
 * el máximo del ladrón). Muta ambos usuarios; el caller persiste.
 */
export function applyRobTransfer(thief: UserRPG, victim: UserRPG, resource: RobbableResource, amount: number): number {
  switch (resource) {
    case 'money': {
      const taken = clamp(Math.floor(amount), 0, victim.money);
      victim.money -= taken;
      thief.money += taken;
      return taken;
    }
    case 'exp': {
      const lost = loseExp(victim, amount);
      grantExp(thief, lost);
      return lost;
    }
    case 'mana': {
      const room = Math.max(0, calculateTotalStats(thief).maxMana - thief.mana);
      const taken = clamp(Math.floor(amount), 0, Math.min(victim.mana, room));
      victim.mana -= taken;
      thief.mana += taken;
      return taken;
    }
  }
}

const RESOURCE_LABEL: Record<RobbableResource, string> = { money: 'monedas', exp: 'XP', mana: 'maná' };
const RESOURCE_EMOJI: Record<RobbableResource, string> = { money: EMOJI.coin, exp: EMOJI.exp, mana: EMOJI.mana };

export const robarPlugin: PluginHandler = {
  command: ['robar', 'rob', 'steal', 'asaltar', 'hurtar'],
  tags: ['rpg'],
  help: [
    'robar @usuario - Intenta robar dinero, XP o maná',
    'El éxito depende de tu nivel, el de la víctima y tu rango',
    'Si fallas, pagas una multa. Cooldown: 1 hora'
  ],
  usage: ['robar @usuario'],
  register: true,
  group: true,

  handler: async (ctx: MessageContext) => {
    const { m, args, usedPrefix } = ctx;
    const db = getDatabase();
    const thief = db.getUser(m.sender);
    const now = Date.now();

    if (thief.level < PVP.MIN_LEVEL_PVP) {
      return m.reply(
        `${EMOJI.error} ¡Necesitas más experiencia para robar!\n\n` +
        `📊 Tu nivel: *${thief.level}* · 🎯 Nivel requerido: *${PVP.MIN_LEVEL_PVP}*\n\n` +
        `💡 Sube de nivel atacando monstruos o trabajando.`
      );
    }

    checkExpiredModes(now);
    const freeRob = globalModes.freeRobMode.active;
    const chaos = globalModes.chaosMode.active;
    const benefits = getRankBenefits(thief.level);

    const cd = checkCooldown(thief.lastRob || 0, CONFIG.cooldowns.rob, benefits.cooldownReduction);
    if (!freeRob && cd.onCooldown) {
      return replyCooldown(ctx, cd.remaining, [{ cmd: 'work', desc: 'Ganar dinero honradamente' }]);
    }

    const victimJid = ctx.target({ args });
    if (!victimJid) return usageError(ctx, robarPlugin, '¿A quién quieres robar? Menciona o responde a tu víctima.');

    const victim = db.getUser(victimJid);
    if (!victim.registered) {
      return m.reply(`${EMOJI.error} Esa persona no está registrada en el juego. No hay nada que robarle... aún.`);
    }

    if (victim.level < PVP.MIN_LEVEL_PVP) {
      return m.reply(`${EMOJI.error} *${victim.name}* es nivel ${victim.level}; solo puedes robar a jugadores de nivel *${PVP.MIN_LEVEL_PVP}* o más.`);
    }

    if (isPassiveActive(thief, now)) {
      return m.reply(
        `${EMOJI.error} Estás en *modo pasivo*.\n\n` +
        `🕊️ No puedes robar mientras estés protegido. Usa *${usedPrefix}pasivo* para desactivarlo.`
      );
    }

    if (isPassiveActive(victim, now)) {
      return m.reply(`🕊️ *${victim.name}* está en *modo pasivo*. No puedes robar a jugadores protegidos.`);
    }

    if (victim.shieldRobo > now) {
      return m.reply(
        `🛡️ *${victim.name}* tiene un *escudo anti-robo* activo.\n` +
        `⏳ Expira en: *${msToTime(victim.shieldRobo - now)}*`
      );
    }

    if (!hasStealableResources(victim, thief)) {
      return m.reply(`${EMOJI.warning} *${victim.name}* no tiene nada que puedas llevarte ahora. Busca una víctima más jugosa. 💀`);
    }

    if (thief.money < 50) {
      return m.reply(`${EMOJI.error} Necesitas al menos *50 monedas* para robar: si fallas, pagarás una multa.`);
    }

    await m.react('🦹');

    let successBonus = benefits.robSuccessBonus;
    let amountBonus = benefits.robAmountBonus;
    if (chaos) {
      successBonus += 20 * globalModes.chaosMode.multiplier;
      amountBonus += 50 * globalModes.chaosMode.multiplier;
    }

    const result = calculateRobAttempt(thief, victim, { successBonus, amountBonus });

    const modeLines: string[] = [];
    if (freeRob) modeLines.push('🦹 *MODO ROBO LIBRE* - sin cooldown');
    if (chaos) modeLines.push(`🌀 *MODO CAOS x${globalModes.chaosMode.multiplier}* - bonus aumentados`);
    const nextRob = freeRob ? '¡YA!' : msToTime(cd.effectiveCooldown);
    const victimTag = mentionTag(victimJid);

    if (result.success) {
      const taken = applyRobTransfer(thief, victim, result.resource, result.amount);
      // getStealableResources ya acota la cantidad; esta guarda evita anunciar "+0" si algo cambiara entre medias
      if (taken <= 0) {
        return m.reply(`${EMOJI.warning} *${victim.name}* no tiene nada que puedas llevarte ahora. No gastaste el cooldown.`);
      }
      thief.lastRob = now;
      db.updateUser(m.sender, thief);
      db.updateUser(victimJid, victim);

      const questLines = updateQuestProgress(db, m.sender, 'rob', 1, now).lines;
      if (result.resource === 'money' && taken > 0) {
        questLines.push(...updateQuestProgress(db, m.sender, 'earn', taken, now).lines);
      }

      const rankLine = benefits.robSuccessBonus > 0 || benefits.robAmountBonus > 0
        ? `\n🎖️ Rango ${getRoleByLevel(thief.level)}: +${benefits.robSuccessBonus}% éxito, +${benefits.robAmountBonus}% cantidad`
        : '';

      await ctx.send({
        text: `🦹 *¡ROBO EXITOSO!*\n\n` +
          `${result.message.replace('{amount}', formatNumber(taken)).replace('{victim}', victimTag)}\n\n` +
          `${RESOURCE_EMOJI[result.resource]} *+${formatNumber(taken)}* ${RESOURCE_LABEL[result.resource]} (probabilidad ${result.successChance}%)` +
          rankLine +
          (modeLines.length ? `\n${modeLines.join('\n')}` : '') +
          `\n⏰ Próximo robo: *${nextRob}*` +
          (questLines.length ? `\n\n${questLines.join('\n')}` : ''),
        mentions: [victimJid]
      });
      return m.react('💰');
    }

    const penalty = Math.min(result.amount, thief.money);
    thief.money -= penalty;
    thief.lastRob = now;
    db.updateUser(m.sender, thief);
    const questLines = updateQuestProgress(db, m.sender, 'rob', 1, now).lines;

    await ctx.send({
      text: `🚨 *¡ROBO FALLIDO!*\n\n` +
        `${result.message.replace('{penalty}', formatNumber(penalty)).replace('{victim}', victimTag)}\n\n` +
        (penalty > 0 ? `${EMOJI.coin} *-${formatNumber(penalty)}* monedas (probabilidad ${result.successChance}%)\n` : '') +
        `🎖️ Tu rango: ${getRoleByLevel(thief.level)}` +
        (modeLines.length ? `\n${modeLines.join('\n')}` : '') +
        `\n⏰ Próximo intento: *${nextRob}*` +
        (questLines.length ? `\n\n${questLines.join('\n')}` : ''),
      mentions: [victimJid]
    });
    await m.react('💀');
  }
};

export default robarPlugin;
