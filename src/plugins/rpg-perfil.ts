import type { PluginHandler, MessageContext } from '../types/message.js';
import { EMOJI, formatNumber, createProgressBar, msToTime, checkCooldown } from '../lib/utils.js';
import { getLevelProgress } from '../lib/levelling.js';
import { getRoleByLevel, getRankBenefits, formatRankBenefits, type UserRPG } from '../types/user.js';
import { getDatabase, type Database } from '../lib/database.js';
import { CLASSES } from '../types/rpg.js';
import { CONFIG } from '../config.js';
import { COOLDOWNS } from '../constants/rpg.js';
import { calculateTotalStats } from '../lib/rpg-utils.js';
import { applyRegenToUser, getRegenInfo } from '../lib/auto-regen.js';
import { getPlayerId } from '../lib/rpg-actions.js';
import { getUserGuild } from './rpg-gremios.js';
import { getPetHunger } from './rpg-mascotas.js';

/** Cooldowns visibles en el perfil; `last` lee el timestamp del usuario */
const PROFILE_COOLDOWNS: { label: string; cooldown: number; last: (u: UserRPG) => number }[] = [
  { label: 'work', cooldown: CONFIG.cooldowns.work, last: u => u.lastWork },
  { label: 'minar', cooldown: CONFIG.cooldowns.mine, last: u => u.lastMine },
  { label: 'daily', cooldown: CONFIG.cooldowns.daily, last: u => u.lastClaim },
  { label: 'robar', cooldown: CONFIG.cooldowns.rob, last: u => u.lastRob },
  { label: 'fumar', cooldown: COOLDOWNS.FUMAR, last: u => u.lastFumar }
];

export function formatCooldowns(user: UserRPG, prefix: string): string {
  const reduction = getRankBenefits(user.level).cooldownReduction;
  return PROFILE_COOLDOWNS.map(({ label, cooldown, last }) => {
    const cd = checkCooldown(last(user) || 0, cooldown, reduction);
    return `│  ${cd.onCooldown ? '⏳' : '✅'} ${prefix}${label}: ${cd.onCooldown ? msToTime(cd.remaining) : 'listo'}`;
  }).join('\n');
}

function formatPet(user: UserRPG, now: number): string {
  if (!user.pet) return '_Sin mascota_';
  return `${user.pet.name} (Nv.${user.pet.level}, 🍖 ${getPetHunger(user.pet, now)}/100)`;
}

function formatGuild(db: Database, jid: string, user: UserRPG): string {
  const guild = getUserGuild(db, jid, user);
  return guild ? `[${guild.tag}] ${guild.name} (Nv.${guild.level})` : '_Sin gremio_';
}

export const perfilPlugin: PluginHandler = {
  command: /^(perfil|profile|me|yo)$/i,
  tags: ['rpg'],
  help: [
    'perfil - Ver tu perfil',
    'perfil @usuario - Ver el perfil de otro jugador'
  ],
  usage: ['perfil', 'perfil @usuario'],

  handler: async (ctx: MessageContext) => {
    const { m, args, usedPrefix } = ctx;
    const db = getDatabase();

    const targetJid = ctx.target({ args, allowSelf: true }) ?? m.sender;
    const isSelf = targetJid === m.sender;
    const user = db.getUser(targetJid);

    if (!user.registered) {
      return m.reply(isSelf
        ? `${EMOJI.error} *¡No estás registrado!*\n\n${EMOJI.info} Usa *${usedPrefix}verificar nombre edad* para comenzar tu aventura.`
        : `${EMOJI.error} *Este usuario no está registrado.*`);
    }

    const now = Date.now();
    const regen = applyRegenToUser(targetJid);
    const regenInfo = getRegenInfo(targetJid);
    const fresh = db.getUser(targetJid);

    const progress = getLevelProgress(fresh.level, fresh.exp);
    const total = calculateTotalStats(fresh);
    const playerId = getPlayerId(db, targetJid, fresh);
    const days = Math.floor((now - fresh.regTime) / 86400000);
    const classInfo = fresh.playerClass ? CLASSES[fresh.playerClass] : null;

    let regenLine = '';
    if (regen.healthRegen > 0 || regen.staminaRegen > 0) {
      regenLine = `\n🔄 *Regeneración aplicada:*${regen.healthRegen > 0 ? ` ❤️+${regen.healthRegen}` : ''}${regen.staminaRegen > 0 ? ` ⚡+${regen.staminaRegen}` : ''}\n`;
    }

    const profile = `
${EMOJI.crown}═══════════════════════════${EMOJI.crown}
      *PERFIL DE JUGADOR*
${EMOJI.crown}═══════════════════════════${EMOJI.crown}
${regenLine}
${EMOJI.star} *${fresh.name}* · ${fresh.currentTitle}
${EMOJI.info} ID: #${playerId}
${EMOJI.time} Jugando hace: ${days} día${days === 1 ? '' : 's'}
🎭 Clase: ${classInfo ? `${classInfo.emoji} ${classInfo.name}` : '_Sin clase_'}
🏰 Gremio: ${formatGuild(db, targetJid, fresh)}
🐾 Mascota: ${formatPet(fresh, now)}

╭─────────────────────────╮
│  ${EMOJI.level} *PROGRESIÓN*
├─────────────────────────
│  Nivel: *${fresh.level}* ${getRoleByLevel(fresh.level)}
│  EXP: ${formatNumber(progress.current)}/${formatNumber(progress.needed)}
│  ${createProgressBar(progress.current, progress.needed, 10)} ${progress.percent}%
│  Para subir: *${formatNumber(progress.remaining)}* XP
╰─────────────────────────╯

╭─────────────────────────╮
│  ${EMOJI.sword} *ESTADÍSTICAS*
├─────────────────────────
│  ${EMOJI.health} Salud: ${fresh.health}/${total.maxHealth}
│  ${createProgressBar(fresh.health, total.maxHealth, 8)}
│  ${EMOJI.stamina} Energía: ${fresh.stamina}/${total.maxStamina}
│  ${createProgressBar(fresh.stamina, total.maxStamina, 8)}
│  ${EMOJI.mana} Maná: ${fresh.mana}/${total.maxMana}
│  ${createProgressBar(fresh.mana, total.maxMana, 8)}
│  ⚔️ Ataque: ${total.attack} · 🛡️ Defensa: ${total.defense} · 💥 Crítico: ${total.critChance}%
│  🔄 Regen: +${regenInfo.healthPerHour}❤️/h +${regenInfo.staminaPerHour}⚡/h
╰─────────────────────────╯

╭─────────────────────────╮
│  ${EMOJI.coin} *ECONOMÍA*
├─────────────────────────
│  ${EMOJI.coin} Monedas: *${formatNumber(fresh.money)}*
│  🏦 Banco: *${formatNumber(fresh.bank)}*
│  ${EMOJI.diamond} Diamantes: *${formatNumber(fresh.limit)}*
│  ${EMOJI.potion} Pociones: *${fresh.potion}*${fresh.debt > 0 ? `\n│  ⚠️ Deuda IMSS: *${formatNumber(fresh.debt)}*` : ''}
╰─────────────────────────╯

╭─────────────────────────╮
│  ${EMOJI.time} *COOLDOWNS*
├─────────────────────────
${formatCooldowns(fresh, usedPrefix)}
╰─────────────────────────╯

${formatRankBenefits(fresh.level)}

${EMOJI.sparkles} *EXP Total: ${formatNumber(fresh.exp)}*
`.trim();

    await m.reply(profile);
  }
};

export default perfilPlugin;
