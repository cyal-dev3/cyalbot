import type { PluginHandler, MessageContext } from '../types/message.js';
import { getDatabase } from '../lib/database.js';
import { EMOJI, msToTime, formatNumber, randomInt, pickRandom } from '../lib/utils.js';
import { MONSTERS, type Monster } from '../types/rpg.js';
import { PVE, PVP } from '../constants/rpg.js';
import { checkExpiredModes } from '../lib/global-modes.js';
import {
  busyMessage, fighterFromMonster, fighterFromUser, getBusy, getDropLuck, grantCombatRewards, handlePlayerDeath,
  playerStats, rollDrops, simulateFight
} from '../lib/rpg-combat.js';
import { addPetExp } from './rpg-mascotas.js';

/** XP que gana la mascota por victoria del dueño */
const PET_EXP_PER_WIN = 15;

/** Monstruo cercano al nivel del jugador, con más peso cuanto más cerca */
export function selectMonster(playerLevel: number): Monster {
  const available = Object.values(MONSTERS).filter(
    m => m.level <= playerLevel + 5 && m.level >= Math.max(1, playerLevel - 10)
  );
  if (available.length === 0) return MONSTERS.slime;

  const weighted: Monster[] = [];
  for (const monster of available) {
    const weight = Math.max(1, 10 - Math.abs(monster.level - playerLevel));
    for (let i = 0; i < weight; i++) weighted.push(monster);
  }
  return pickRandom(weighted);
}

export const atacarPlugin: PluginHandler = {
  command: ['atacar', 'attack', 'cazar', 'hunt', 'pelear', 'fight'],
  tags: ['rpg'],
  help: [
    'atacar - Lucha contra un monstruo aleatorio',
    'Gana XP, dinero y posibles drops',
    `Cooldown: ${msToTime(PVP.ATTACK_COOLDOWN)}`
  ],
  register: true,

  handler: async (ctx: MessageContext) => {
    const { m, usedPrefix } = ctx;
    const db = getDatabase();
    const user = db.getUser(m.sender);
    checkExpiredModes();

    const busy = getBusy(m.sender);
    if (busy) {
      await m.reply(`${EMOJI.error} ${busyMessage(busy, 'Tú')}`);
      return;
    }

    const now = Date.now();
    const lastAttack = user.lastAttack || 0;
    if (now - lastAttack < PVP.ATTACK_COOLDOWN) {
      await m.reply(
        `${EMOJI.time} ¡Necesitas recuperarte del último combate!\n\n` +
        `⏳ Espera *${msToTime(PVP.ATTACK_COOLDOWN - (now - lastAttack))}* para volver a atacar.`
      );
      return;
    }

    const stats = playerStats(user);
    if (user.health < PVP.MIN_HEALTH_COMBAT) {
      await m.reply(
        `${EMOJI.error} ¡Estás muy débil para combatir!\n\n` +
        `❤️ Salud actual: *${user.health}/${stats.maxHealth}*\n\n` +
        `💡 Usa una poción de salud o espera a regenerarte.`
      );
      return;
    }
    if (user.stamina < PVE.ATTACK_MIN_STAMINA) {
      await m.reply(
        `${EMOJI.error} ¡No tienes suficiente energía!\n\n` +
        `⚡ Energía actual: *${user.stamina}/${stats.maxStamina}*\n\n` +
        `💡 Espera a regenerar energía o usa una poción.`
      );
      return;
    }

    await m.react('⚔️');

    const monster = selectMonster(user.level);
    const fight = simulateFight(fighterFromUser(user), fighterFromMonster(monster), { maxTurns: PVE.MAX_TURNS });

    const combatStats = { ...user.combatStats };
    combatStats.totalDamageDealt += fight.damageDealt;
    combatStats.totalDamageReceived += fight.damageTaken;

    // El empate solo aplica el daño recibido; nadie cayó
    const newHealth = fight.result === 'lost' ? 0 : Math.max(1, user.health - fight.damageTaken);
    const petLeveled = fight.result === 'won' && addPetExp(user.pet, PET_EXP_PER_WIN);
    if (fight.result === 'won') combatStats.totalKills++;

    db.updateUser(m.sender, {
      lastAttack: now,
      stamina: Math.max(0, user.stamina - PVE.ATTACK_STAMINA_COST),
      health: newHealth,
      combatStats,
      pet: user.pet
    });

    const summary = fight.log.slice(-4).map(line => `   ${line}`).join('\n');
    const nextAttack = `\n⏰ Próximo ataque: *${msToTime(PVP.ATTACK_COOLDOWN)}*`;

    if (fight.result === 'won') {
      const expGain = monster.expReward + randomInt(0, Math.floor(monster.expReward * 0.2));
      const moneyGain = randomInt(monster.moneyReward[0], monster.moneyReward[1]);
      const drops = rollDrops(monster.drops, { luckBonus: getDropLuck(user, now) });
      const rewards = grantCombatRewards(db, m.sender, { exp: expGain, money: moneyGain, items: drops, quest: { objective: 'combat', amount: 1 } }, now);

      let msg = `⚔️ *¡VICTORIA!*\n━━━━━━━━━━━━━━━━━━━━━\n\n`;
      msg += `${monster.emoji} Derrotaste a *${monster.name}* (Nv.${monster.level}) en ${fight.turns} turnos\n\n`;
      msg += `📜 *Resumen del combate:*\n${summary}\n\n`;
      msg += `🎁 *Recompensas:*\n`;
      msg += `   ${EMOJI.exp} +${formatNumber(rewards.exp)} XP\n`;
      msg += `   ${EMOJI.coin} +${formatNumber(rewards.money)} monedas\n`;
      if (rewards.items.length > 0) msg += `   🎒 Botín: ${rewards.items.join(', ')}\n`;
      if (rewards.lost.length > 0) msg += `   ${EMOJI.warning} Inventario lleno, se perdió: ${rewards.lost.join(', ')}\n`;
      if (rewards.lines.length > 0) msg += `\n🎮 *Bonificaciones:*\n${rewards.lines.map(l => `   ${l}`).join('\n')}\n`;
      if (petLeveled && user.pet) msg += `\n🐾 ¡Tu mascota *${user.pet.name}* subió al nivel ${user.pet.level}!\n`;
      msg += `\n❤️ Salud restante: *${newHealth}/${stats.maxHealth}*${nextAttack}`;

      await m.reply(msg);
      await m.react('🏆');
      return;
    }

    if (fight.result === 'draw') {
      updateCombatQuest(db, m.sender);
      let msg = `🤝 *EMPATE*\n━━━━━━━━━━━━━━━━━━━━━\n\n`;
      msg += `${monster.emoji} *${monster.name}* (Nv.${monster.level}) aguantó ${fight.turns} turnos y ambos se retiraron.\n\n`;
      msg += `📜 *Resumen del combate:*\n${summary}\n\n`;
      msg += `❤️ Salud restante: *${newHealth}/${stats.maxHealth}*\n`;
      msg += `💡 _Sin recompensa; mejora tu ataque para rematar antes._${nextAttack}`;
      await m.reply(msg);
      await m.react('🤝');
      return;
    }

    updateCombatQuest(db, m.sender);
    const death = handlePlayerDeath(db, m.sender, user.name, now);
    let msg = `💀 *DERROTA*\n━━━━━━━━━━━━━━━━━━━━━\n\n`;
    msg += `${monster.emoji} *${monster.name}* (Nv.${monster.level}) te venció.\n\n`;
    msg += `📜 *Resumen del combate:*\n${summary}\n\n`;
    msg += `❤️ Salud restante: *1/${stats.maxHealth}*\n`;
    msg += death.message;
    msg += `\n\n💡 _Sube de nivel, mejora tu equipo o elige una clase con ${usedPrefix}clase._${nextAttack}`;

    await m.reply(msg);
    await m.react('💀');
  }
};

/** Un combate perdido o empatado también cuenta para las misiones de combate */
function updateCombatQuest(db: ReturnType<typeof getDatabase>, jid: string): void {
  grantCombatRewards(db, jid, { exp: 0, money: 0, quest: { objective: 'combat', amount: 1 } });
}

export default atacarPlugin;
