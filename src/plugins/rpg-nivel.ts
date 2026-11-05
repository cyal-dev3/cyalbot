import type { PluginHandler, MessageContext } from '../types/message.js';
import { EMOJI, formatNumber, createProgressBar } from '../lib/utils.js';
import { canLevelUp, getLevelProgress, grantExp } from '../lib/levelling.js';
import { getRoleByLevel, getRankProgress, formatRankBenefits } from '../types/user.js';
import { getDatabase } from '../lib/database.js';
import { CONFIG } from '../config.js';

export const nivelPlugin: PluginHandler = {
  command: /^(nivel|lvl|levelup|level|subir)$/i,
  tags: ['rpg'],
  help: ['nivel - Ver tu progreso de nivel y rango (el nivel sube solo al ganar XP)'],
  usage: ['nivel'],
  register: true,

  handler: async (ctx: MessageContext) => {
    const { m, usedPrefix } = ctx;
    const db = getDatabase();
    const user = db.getUser(m.sender);

    // Usuarios antiguos: aplica los niveles que acumularon antes del nivel automático
    let pendingLevels = '';
    if (canLevelUp(user.level, user.exp)) {
      const previousRole = getRoleByLevel(user.level);
      const result = grantExp(user, 0);
      db.updateUser(m.sender, user);

      const bonus = CONFIG.rpg.levelUpBonus;
      const gained = result.to - result.from;
      pendingLevels = `${EMOJI.success} *¡Subiste ${gained > 1 ? `${gained} niveles` : 'de nivel'}!* ${result.from} ➜ *${result.to}*\n` +
        `${EMOJI.gift} +${gained * bonus.healthPerLevel} ${EMOJI.health} · +${gained * bonus.staminaPerLevel} ${EMOJI.stamina} · ` +
        `+${gained * bonus.manaPerLevel} ${EMOJI.mana} · +${formatNumber(gained * bonus.moneyPerLevel)} ${EMOJI.coin}\n`;
      const newRole = getRoleByLevel(user.level);
      if (newRole !== previousRole) pendingLevels += `${EMOJI.trophy} Nuevo rango: *${newRole}*\n`;
      pendingLevels += '\n';
    }

    const progress = getLevelProgress(user.level, user.exp);
    const rank = getRankProgress(user.level);
    const expBar = createProgressBar(progress.current, progress.needed, 10);

    let text = pendingLevels +
      `${EMOJI.level} *PROGRESO DE NIVEL*\n\n` +
      `${EMOJI.level} Nivel: *${user.level}* ${getRoleByLevel(user.level)}\n` +
      `${EMOJI.exp} Experiencia: ${formatNumber(progress.current)}/${formatNumber(progress.needed)}\n` +
      `${expBar} ${progress.percent}%\n` +
      `${EMOJI.info} Te faltan *${formatNumber(progress.remaining)}* XP para el nivel ${user.level + 1}.\n\n`;

    text += rank.isMaxRank
      ? `🐉👑 *¡Has alcanzado el rango máximo!*\n\n`
      : `📊 Siguiente rango: ${rank.nextRank} (en *${rank.levelsToNext}* niveles)\n\n`;

    // El perfil resume el rango en una línea y remite aquí para el detalle
    text += `${formatRankBenefits(user.level)}\n\n`;
    text += `💡 El nivel sube solo al ganar XP con *${usedPrefix}work*, *${usedPrefix}minar*, *${usedPrefix}daily* o combatiendo.`;

    await m.reply(text);
  }
};

export default nivelPlugin;
