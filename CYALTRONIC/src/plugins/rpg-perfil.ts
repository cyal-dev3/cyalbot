/**
 * 👤 Plugin de Perfil - CYALTRONIC
 * Muestra el perfil y estadísticas del jugador
 */

import { createHash } from 'crypto';
import type { PluginHandler, MessageContext } from '../types/message.js';
import { EMOJI, formatNumber, createProgressBar } from '../lib/utils.js';
import { getLevelProgress, MULTIPLIER } from '../lib/levelling.js';
import { getRoleByLevel } from '../types/user.js';
import { getDatabase } from '../lib/database.js';

export const perfilPlugin: PluginHandler = {
  command: /^(perfil|profile|me|yo)$/i,
  tags: ['rpg'],
  help: [
    'perfil - Ver tu perfil',
    'perfil @usuario - Ver perfil de otro jugador'
  ],

  handler: async (ctx: MessageContext) => {
    const { m, usedPrefix } = ctx;
    const db = getDatabase();

    // Determinar a quién ver el perfil
    const targetJid = m.mentionedJid[0] || m.quoted?.sender || m.sender;
    const isSelf = targetJid === m.sender;
    const user = db.getUser(targetJid);

    // Verificar si está registrado
    if (!user.registered) {
      if (isSelf) {
        return m.reply(
          `${EMOJI.error} *¡No estás registrado!*\n\n` +
          `${EMOJI.info} Usa *${usedPrefix}verificar nombre.edad* para comenzar tu aventura.`
        );
      } else {
        return m.reply(
          `${EMOJI.error} *Este usuario no está registrado.*`
        );
      }
    }

    // Calcular información de nivel
    const progress = getLevelProgress(user.level, user.exp, MULTIPLIER);
    const role = getRoleByLevel(user.level);

    // Generar ID único
    const serialNumber = createHash('md5')
      .update(targetJid)
      .digest('hex')
      .slice(0, 12)
      .toUpperCase();

    // Calcular tiempo jugando
    const registeredDays = Math.floor((Date.now() - user.regTime) / (1000 * 60 * 60 * 24));

    // Barra de progreso visual
    const expBar = createProgressBar(progress.current, progress.needed, 10);

    // Construir perfil
    const profile = `
${EMOJI.crown}═══════════════════════════${EMOJI.crown}
      *PERFIL DE JUGADOR*
${EMOJI.crown}═══════════════════════════${EMOJI.crown}

${EMOJI.star} *${user.name}*
${EMOJI.info} ID: #${serialNumber}
${EMOJI.time} Jugando hace: ${registeredDays} días

╭─────────────────────────╮
│  ${EMOJI.level} *PROGRESIÓN*
├─────────────────────────
│  Nivel: *${user.level}* ${role}
│  EXP: ${formatNumber(progress.current)}/${formatNumber(progress.needed)}
│  ${expBar} ${progress.percent}%
│  Para subir: *${formatNumber(progress.remaining)}* XP
╰─────────────────────────╯

╭─────────────────────────╮
│  ${EMOJI.sword} *ESTADÍSTICAS*
├─────────────────────────
│  ${EMOJI.health} Salud: ${user.health}/100
│  ${createProgressBar(user.health, 100, 8)}
│
│  ${EMOJI.stamina} Energía: ${user.stamina}/100
│  ${createProgressBar(user.stamina, 100, 8)}
│
│  ${EMOJI.mana} Maná: ${user.mana}/100
│  ${createProgressBar(user.mana, 100, 8)}
╰─────────────────────────╯

╭─────────────────────────╮
│  ${EMOJI.coin} *ECONOMÍA*
├─────────────────────────
│  ${EMOJI.coin} Monedas: *${formatNumber(user.money)}*
│  ${EMOJI.diamond} Diamantes: *${formatNumber(user.limit)}*
│  ${EMOJI.potion} Pociones: *${user.potion}*
╰─────────────────────────╯

${EMOJI.sparkles} *EXP Total: ${formatNumber(user.exp)}*
`.trim();

    await m.reply(profile);
  }
};

export default perfilPlugin;
