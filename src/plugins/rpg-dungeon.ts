import type { PluginHandler, MessageContext } from '../types/message.js';
import { getDatabase } from '../lib/database.js';
import { EMOJI, msToTime, formatNumber } from '../lib/utils.js';
import type { Dungeon } from '../types/rpg.js';
import type { UserRPG } from '../types/user.js';
import { PVE, PVP } from '../constants/rpg.js';
import { checkExpiredModes } from '../lib/global-modes.js';
import { clearBusy, fighterFromUser, getDropLuck, grantCombatRewards, handlePlayerDeath, playerStats, setBusy, simulateFight } from '../lib/rpg-combat.js';
import { addPetExp } from './rpg-mascotas.js';
import {
  buildEncounters, checkDungeonEntry, findDungeon, finalizeDungeonLoot, formatAmbiguous, formatDungeonList,
  monsterDrops, monsterRewards, type DungeonEndReason
} from './rpg-dungeon-common.js';
import { activeDungeons, formatSessionStatus, startInteractiveDungeon } from './rpg-dungeon-interactivo.js';

const QUICK_WORDS = new Set(['rapido', 'rápido', 'fast', 'auto', 'r']);
const PET_EXP_PER_DUNGEON = 40;

/**
 * Simula el dungeon completo de golpe. Reutiliza los encuentros, recompensas y
 * drops del modo interactivo; un combate que llega al límite de turnos obliga a
 * retirarse (cuenta como huida).
 */
async function runQuickDungeon(ctx: MessageContext, user: UserRPG, dungeon: Dungeon): Promise<void> {
  const { m } = ctx;
  const db = getDatabase();
  const now = Date.now();
  const encounters = buildEncounters(dungeon);
  if (encounters.length < 2) {
    await m.reply(`${EMOJI.error} Ese dungeon no tiene encuentros configurados.`);
    return;
  }
  if (!setBusy(m.sender, 'dungeon')) {
    await m.reply(`${EMOJI.error} Ya estás en otra actividad.`);
    return;
  }

  checkExpiredModes();
  await m.react('🏰');

  const stats = playerStats(user);
  const luckBonus = getDropLuck(user, now);
  db.updateUser(m.sender, { stamina: user.stamina - dungeon.staminaCost, lastDungeon: now });

  let health = Math.min(user.health, stats.maxHealth);
  let monstersKilled = 0;
  let totalDamage = 0;
  const loot = { exp: 0, money: 0, items: [] as string[] };
  const log: string[] = [`🚪 Entrando a *${dungeon.name}*...`, ''];
  let reason: DungeonEndReason = 'victory';
  let diedToBoss = false;

  try {
    for (const encounter of encounters) {
      const { monster, boss } = encounter;
      log.push(boss
        ? `👹 *¡BOSS!* ${monster.emoji} ${monster.name} (Nv.${monster.level})`
        : `⚔️ *Encuentro:* ${monster.emoji} ${monster.name} (Nv.${monster.level})`);

      const fight = simulateFight(fighterFromUser(user, health), encounter.fighter, { maxTurns: PVE.DUNGEON.MAX_TURNS_PER_FIGHT });
      health = fight.attackerHealth;
      totalDamage += fight.damageDealt;

      if (fight.result === 'won') {
        monstersKilled++;
        const rewards = monsterRewards(monster, boss);
        loot.exp += rewards.exp;
        loot.money += rewards.money;
        loot.items.push(...monsterDrops(monster, boss, luckBonus));
        log.push(`   ✅ Derrotaste a ${monster.name} en ${fight.turns} turnos (-${fight.damageTaken} HP)`, '');
        continue;
      }
      if (fight.result === 'lost') {
        log.push(`   ❌ ${monster.name} te venció`, '', `💀 *¡Has caído en el dungeon!*`);
        reason = 'death';
        diedToBoss = boss;
      } else {
        log.push(`   🏃 ${monster.name} aguantó ${fight.turns} turnos y tuviste que retirarte`);
        reason = 'flee';
      }
      break;
    }
  } finally {
    clearBusy(m.sender);
  }

  if (reason === 'victory') log.push(`✨ *¡DUNGEON COMPLETADO!*`);

  const fresh = db.getUser(m.sender);
  const combatStats = { ...fresh.combatStats };
  combatStats.totalKills += monstersKilled;
  combatStats.totalDamageDealt += totalDamage;
  combatStats.totalDamageReceived += Math.max(0, Math.min(user.health, stats.maxHealth) - health);
  if (reason === 'victory') {
    combatStats.dungeonsCompleted++;
    combatStats.bossesKilled++;
  }
  const petLeveled = reason === 'victory' && addPetExp(fresh.pet, PET_EXP_PER_DUNGEON);
  db.updateUser(m.sender, { health: reason === 'death' ? 0 : Math.max(1, health), combatStats, pet: fresh.pet });

  const final = finalizeDungeonLoot(dungeon, loot, reason, { diedToBoss, luckBonus });
  const rewards = grantCombatRewards(db, m.sender, {
    exp: final.exp,
    money: final.money,
    items: final.items,
    quest: reason === 'victory' ? { objective: 'dungeon', amount: 1 } : undefined
  }, now);

  let response = `⚡ *MODO RÁPIDO*\n${dungeon.emoji} *${dungeon.name.toUpperCase()}*\n━━━━━━━━━━━━━━━━━━━━━\n\n`;
  response += log.join('\n') + '\n';
  response += `\n━━━━━━━━━━━━━━━━━━━━━\n📊 *Resultados:*\n`;
  response += `   💀 Monstruos: ${monstersKilled}\n`;
  response += `   ${EMOJI.exp} XP: +${formatNumber(rewards.exp)}\n`;
  response += `   ${EMOJI.coin} Monedas: +${formatNumber(rewards.money)}\n`;
  if (rewards.items.length > 0) response += `   🎁 Botín: ${rewards.items.join(', ')}\n`;
  if (rewards.lost.length > 0) response += `   ${EMOJI.warning} Inventario lleno, se perdió: ${rewards.lost.join(', ')}\n`;
  if (reason !== 'victory' && loot.items.length > 0) response += `   _Los drops recogidos se perdieron al no completar el dungeon_\n`;
  if (rewards.lines.length > 0) response += `\n🎮 *Bonificaciones:*\n${rewards.lines.map(l => `   ${l}`).join('\n')}\n`;
  if (petLeveled && fresh.pet) response += `\n🐾 ¡Tu mascota *${fresh.pet.name}* subió al nivel ${fresh.pet.level}!\n`;

  if (reason === 'death') {
    const death = handlePlayerDeath(db, m.sender, user.name, now);
    response += `\n❤️ Salud: *1/${stats.maxHealth}*\n${death.message}`;
  } else {
    response += `\n❤️ Salud: *${Math.max(1, health)}/${stats.maxHealth}*`;
  }
  response += `\n\n⏰ Próximo dungeon: *${msToTime(PVP.DUNGEON_COOLDOWN)}*`;

  await m.reply(response);
  await m.react(reason === 'victory' ? '🏆' : '💀');
}

export const dungeonPlugin: PluginHandler = {
  command: ['dungeon', 'dungeons', 'mazmorra', 'dr'],
  tags: ['rpg'],
  help: [
    'dungeon - Ver las mazmorras disponibles',
    'dungeon [nombre] - Entrar en modo interactivo (por turnos)',
    'dungeon [nombre] rapido - Simular el dungeon al instante',
    'dr [nombre] - Atajo del modo rápido'
  ],
  register: true,

  handler: async (ctx: MessageContext) => {
    const { m, args, command, usedPrefix } = ctx;
    const db = getDatabase();
    const user = db.getUser(m.sender);

    const current = activeDungeons.get(m.sender);
    if (current) {
      await m.reply(`${EMOJI.warning} Ya estás en un dungeon. Usa *a*, *d*, *h*, *i* o *huir*.`);
      await m.reply(formatSessionStatus(current));
      return;
    }

    const words = [...args];
    let quick = command === 'dr';
    if (words.length > 0 && QUICK_WORDS.has(words[words.length - 1].toLowerCase())) {
      quick = true;
      words.pop();
    }
    const term = words.join(' ').trim();

    if (!term) {
      await m.reply(formatDungeonList(user, usedPrefix));
      return;
    }

    const found = findDungeon(term);
    if (found.status === 'none') {
      await m.reply(`${EMOJI.error} Dungeon no encontrado.\n\n💡 Usa *${usedPrefix}dungeon* para ver las mazmorras disponibles.`);
      return;
    }
    if (found.status === 'ambiguous') {
      await m.reply(formatAmbiguous(found.candidates));
      return;
    }
    const dungeon = found.item;

    const entry = checkDungeonEntry(user, m.sender, dungeon);
    if (!entry.ok) {
      await m.reply(entry.message);
      return;
    }

    if (quick) await runQuickDungeon(ctx, user, dungeon);
    else await startInteractiveDungeon(ctx, user, dungeon);
  }
};

export default dungeonPlugin;
