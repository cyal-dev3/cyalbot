import { createHash } from 'crypto';
import type { Database } from './database.js';
import type { MessageContext, PluginHandler } from '../types/message.js';
import { getRankBenefits, type UserRPG } from '../types/user.js';
import { applyGlobalModes } from './global-modes.js';
import { grantExp } from './levelling.js';
import { formatNumber, msToTime } from './utils.js';
import { updateQuestProgress, type QuestGoal } from './quests.js';

/** Porcentaje de las ganancias (XP y dinero) que recibe el amo de un esclavo */
export const SLAVERY_CUT = 50;

/** Bonus de XP por cada nivel del gremio al que pertenece el jugador (%) */
export const GUILD_XP_BONUS_PER_LEVEL = 2;

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

/**
 * Único criterio de modo pasivo: es un interruptor sin caducidad. El campo
 * passiveModeUntil ya no se consulta (caducaba en silencio a los 30 días).
 */
export function isPassiveActive(user: UserRPG, _now: number = Date.now()): boolean {
  return user.passiveMode === true;
}

/** true si el usuario es esclavo de alguien en este momento */
export function isEnslaved(user: UserRPG, now: number = Date.now()): boolean {
  return Boolean(user.slaveMaster) && user.slaveUntil > now;
}

/** ID público estable del jugador; se persiste la primera vez que se pide */
export function getPlayerId(db: Database, jid: string, user: UserRPG = db.getUser(jid)): string {
  if (user.playerId) return user.playerId;
  const playerId = createHash('md5').update(jid).digest('hex').slice(0, 12).toUpperCase();
  db.updateUser(jid, { playerId });
  return playerId;
}

export interface RewardInput {
  exp?: number;
  money?: number;
  diamonds?: number;
  potions?: number;
  /** Objetivos de misión que esta acción hace avanzar (además de 'earn' por el dinero) */
  questObjectives?: { objective: QuestGoal; amount: number }[];
}

export interface RewardOptions {
  /** Origen de la recompensa, para logs y líneas del mensaje */
  source: string;
  /** Multiplicador extra sobre XP y dinero (rachas, eventos del plugin) */
  multiplier?: number;
  /** Aplicar los multiplicadores de rango (por defecto sí) */
  rank?: boolean;
  now?: number;
}

export interface RewardResult {
  /** Líneas para el mensaje: modos globales, gremio, esclavitud, nivel, misiones */
  lines: string[];
  leveledUp: boolean;
  from: number;
  to: number;
  /** XP y dinero que recibió el jugador (ya con rango, modos y corte de esclavitud) */
  exp: number;
  money: number;
  diamonds: number;
  potions: number;
}

/**
 * Único punto de entrega de recompensas: rango, modos globales, bonus de
 * gremio, corte de esclavitud, totalEarned, misiones y nivel automático.
 * Persiste al jugador (y al amo si aplica) con db.updateUser.
 */
export function grantRewards(db: Database, jid: string, input: RewardInput, opts: RewardOptions): RewardResult {
  const now = opts.now ?? Date.now();
  const user = db.getUser(jid);
  const lines: string[] = [];

  const multiplier = Number.isFinite(opts.multiplier) && (opts.multiplier as number) > 0 ? (opts.multiplier as number) : 1;
  const benefits = getRankBenefits(user.level);
  const rankExp = opts.rank === false ? 1 : benefits.expMultiplier;
  const rankMoney = opts.rank === false ? 1 : benefits.moneyMultiplier;

  const baseExp = Math.max(0, Math.floor((input.exp ?? 0) * multiplier * rankExp));
  const baseMoney = Math.max(0, Math.floor((input.money ?? 0) * multiplier * rankMoney));
  const diamonds = Math.max(0, Math.floor(input.diamonds ?? 0));
  const potions = Math.max(0, Math.floor(input.potions ?? 0));

  const modes = applyGlobalModes({ exp: baseExp, money: baseMoney }, now);
  let exp = modes.exp;
  let money = modes.money;
  lines.push(...modes.lines);

  if (user.guildId) {
    const guild = db.getGuild(user.guildId);
    if (guild) {
      const guildExp = Math.floor(baseExp * (guild.level * GUILD_XP_BONUS_PER_LEVEL) / 100);
      if (guildExp > 0) {
        exp += guildExp;
        lines.push(`🏰 Gremio [${guild.tag}] Nv.${guild.level}: +${formatNumber(guildExp)} XP`);
      }
    }
  }

  if (isEnslaved(user, now) && user.slaveMaster) {
    const expCut = Math.floor(exp * SLAVERY_CUT / 100);
    const moneyCut = Math.floor(money * SLAVERY_CUT / 100);
    if (expCut > 0 || moneyCut > 0) {
      exp -= expCut;
      money -= moneyCut;
      const master = db.getUser(user.slaveMaster);
      grantExp(master, expCut);
      master.money += moneyCut;
      master.totalEarned += moneyCut;
      db.updateUser(user.slaveMaster, master);
      lines.push(`⛓️ Tu amo *${master.name || 'desconocido'}* se llevó +${formatNumber(expCut)} XP y +${formatNumber(moneyCut)} 💰 (${SLAVERY_CUT}%)`);
    }
  }

  const level = grantExp(user, exp);
  user.money += money;
  user.totalEarned += money;
  user.limit += diamonds;
  user.potion += potions;
  db.updateUser(jid, user);

  if (level.leveledUp) {
    lines.push(`📈 ¡Subiste al nivel *${level.to}*!${level.to - level.from > 1 ? ` (+${level.to - level.from} niveles)` : ''}`);
  }

  if (money > 0) {
    lines.push(...updateQuestProgress(db, jid, 'earn', money, now).lines);
  }
  for (const { objective, amount } of input.questObjectives ?? []) {
    lines.push(...updateQuestProgress(db, jid, objective, amount, now).lines);
  }

  return { lines, leveledUp: level.leveledUp, from: level.from, to: level.to, exp, money, diamonds, potions };
}

export interface CooldownSuggestion {
  cmd: string;
  desc: string;
}

/** Respuesta estándar de cooldown; una sola línea en modo compacto */
export async function replyCooldown(ctx: MessageContext, remaining: number, suggestions: CooldownSuggestion[] = []): Promise<void> {
  const { m, usedPrefix, command } = ctx;
  const wait = msToTime(remaining);

  if (ctx.handler.isCompactMode(m.chat)) {
    await m.reply(`⏰ *${usedPrefix}${command}* en *${wait}*.`);
    return;
  }

  let text = `⏰ *¡Aún no puedes usar ${usedPrefix}${command}!*\n\n` +
    `⏳ Vuelve en: *${wait}*`;

  if (suggestions.length > 0) {
    text += `\n\n⭐ Mientras tanto:\n` + suggestions.map(s => `• *${usedPrefix}${s.cmd}* - ${s.desc}`).join('\n');
  }

  const reduction = getRankBenefits(ctx.user.level).cooldownReduction;
  if (reduction > 0) {
    text += `\n\n🎖️ _Tu rango reduce cooldowns -${reduction}%_`;
  }

  await m.reply(text);
}

export interface FormatRewardOptions {
  /** Forzar el formato compacto (por defecto se decide con ctx.handler.isCompactMode) */
  compact?: boolean;
  /** Texto libre antes de las líneas (narración de la acción) */
  intro?: string;
  /** Texto libre después de las líneas */
  footer?: string;
}

/** Mensaje de recompensa: una línea en compacto, bloque con viñetas en normal */
export function formatReward(ctx: MessageContext, title: string, lines: string[], opts: FormatRewardOptions = {}): string {
  const compact = opts.compact ?? ctx.handler.isCompactMode(ctx.m.chat);
  const clean = lines.filter(l => l && l.trim().length > 0);

  if (compact) {
    return `${title}: ${clean.join(' · ')}`;
  }

  let text = `*${title}*\n`;
  if (opts.intro) text += `\n${opts.intro}\n`;
  if (clean.length > 0) {
    text += '\n' + clean.map((line, i) => `${i === clean.length - 1 ? '╰' : '├'} ${line}`).join('\n');
  }
  if (opts.footer) text += `\n\n${opts.footer}`;
  return text;
}

function pluginAliases(plugin: PluginHandler): string[] {
  if (Array.isArray(plugin.command)) return plugin.command;
  const match = plugin.command.source.match(/\(([^()]+)\)/);
  return match ? match[1].split('|').map(s => s.replace(/\\/g, '')) : [plugin.command.source];
}

/** Error de uso: imprime usage (o help) del plugin con el prefijo real */
export async function usageError(ctx: MessageContext, plugin: PluginHandler, reason?: string): Promise<void> {
  const { m, usedPrefix } = ctx;
  const aliases = new Set(pluginAliases(plugin).map(a => a.toLowerCase()));
  const source = plugin.usage?.length ? plugin.usage : plugin.help ?? [];

  const lines = source.map(line => {
    const first = line.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
    return aliases.has(first) ? `• ${usedPrefix}${line.trim()}` : `• ${line.trim()}`;
  });

  let text = `❌ *${reason ?? 'Uso incorrecto.'}*`;
  if (lines.length > 0) text += `\n\n📝 *Uso:*\n${lines.join('\n')}`;
  await m.reply(text);
}
