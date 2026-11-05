import { DUNGEONS, MONSTERS, type Dungeon, type Monster } from '../types/rpg.js';
import type { UserRPG } from '../types/user.js';
import { PVE, PVP } from '../constants/rpg.js';
import { EMOJI, msToTime, randomInt } from '../lib/utils.js';
import { calculateTotalStats } from '../lib/rpg-utils.js';
import { formatAmbiguous, resolveItem, type ResolveResult } from '../lib/rpg-inventory.js';
import { busyMessage, fighterFromMonster, getBusy, rollDrops, type Fighter } from '../lib/rpg-combat.js';

export function findDungeon(term: string): ResolveResult<Dungeon> {
  return resolveItem(term, Object.values(DUNGEONS));
}

export { formatAmbiguous };

export type EntryCheck = { ok: true } | { ok: false; message: string };

/** Comprueba ocupación, cooldown, nivel, energía y salud antes de entrar */
export function checkDungeonEntry(user: UserRPG, jid: string, dungeon: Dungeon, now: number = Date.now()): EntryCheck {
  const busy = getBusy(jid);
  if (busy) return { ok: false, message: `${EMOJI.error} ${busyMessage(busy, 'Tú')}` };

  const lastDungeon = user.lastDungeon || 0;
  if (now - lastDungeon < PVP.DUNGEON_COOLDOWN) {
    return {
      ok: false,
      message: `${EMOJI.time} Necesitas descansar después de tu última expedición.\n\n⏳ Espera *${msToTime(PVP.DUNGEON_COOLDOWN - (now - lastDungeon))}* para entrar a otro dungeon.`
    };
  }
  if (user.level < dungeon.requiredLevel) {
    return { ok: false, message: `${EMOJI.error} Necesitas nivel *${dungeon.requiredLevel}* para entrar.\n\n📊 Tu nivel: *${user.level}*` };
  }
  const stats = calculateTotalStats(user);
  if (user.stamina < dungeon.staminaCost) {
    return {
      ok: false,
      message: `${EMOJI.error} No tienes suficiente energía.\n\n⚡ Requerida: *${dungeon.staminaCost}*\n⚡ Tu energía: *${user.stamina}/${stats.maxStamina}*\n\n💡 Espera o usa una poción de energía.`
    };
  }
  if (user.health < PVP.MIN_HEALTH_DUNGEON) {
    return {
      ok: false,
      message: `${EMOJI.error} Estás muy débil para entrar a un dungeon.\n\n❤️ Salud: *${user.health}/${stats.maxHealth}*\n\n💡 Cúrate antes de entrar.`
    };
  }
  return { ok: true };
}

export function formatDungeonList(user: UserRPG, usedPrefix: string): string {
  const stats = calculateTotalStats(user);
  let response = `🏰 *DUNGEONS DISPONIBLES*\n━━━━━━━━━━━━━━━━━━━━━\n`;
  response += `📊 Tu nivel: *${user.level}*\n`;
  response += `⚡ Tu energía: *${user.stamina}/${stats.maxStamina}*\n\n`;

  let recommended: Dungeon | null = null;
  for (const dungeon of Object.values(DUNGEONS)) {
    const canEnter = user.level >= dungeon.requiredLevel;
    const hasStamina = user.stamina >= dungeon.staminaCost;
    if (canEnter) recommended = dungeon;
    const status = canEnter ? (hasStamina ? '✅' : '⚡') : '🔒';
    const boss = MONSTERS[dungeon.bossId];
    response += `${status} ${dungeon.emoji} *${dungeon.name}* \`${dungeon.id}\`\n`;
    response += `   📖 _${dungeon.description}_\n`;
    response += `   📊 Nv.${dungeon.requiredLevel}+ | ⚡ ${dungeon.staminaCost} | 👹 ${dungeon.monsters.length} monstruos + ${boss ? boss.name : 'boss'}\n`;
    response += `   🎁 XP x${dungeon.rewards.expMultiplier} | 💰 x${dungeon.rewards.moneyMultiplier}\n\n`;
  }

  if (recommended) response += `💡 *Recomendado:* ${recommended.name}\n\n`;
  response += `━━━━━━━━━━━━━━━━━━━━━\n`;
  response += `⚔️ *${usedPrefix}dungeon [nombre]* - Modo interactivo por turnos\n`;
  response += `⚡ *${usedPrefix}dungeon [nombre] rapido* (o *${usedPrefix}dr [nombre]*) - Simulado al instante\n`;
  response += `⏰ Cooldown: ${msToTime(PVP.DUNGEON_COOLDOWN)}`;
  return response;
}

export interface Encounter {
  monster: Monster;
  boss: boolean;
  fighter: Fighter;
}

/** Monstruos del dungeon en orden y el boss al final con sus stats multiplicados */
export function buildEncounters(dungeon: Dungeon): Encounter[] {
  const encounters: Encounter[] = [];
  for (const id of dungeon.monsters) {
    const monster = MONSTERS[id];
    if (monster) encounters.push({ monster, boss: false, fighter: fighterFromMonster(monster, false) });
  }
  const boss = MONSTERS[dungeon.bossId];
  if (boss) encounters.push({ monster: boss, boss: true, fighter: fighterFromMonster(boss, true) });
  return encounters;
}

/** XP y dinero por derrotar a un monstruo (el boss da el doble) */
export function monsterRewards(monster: Monster, boss: boolean): { exp: number; money: number } {
  const factor = boss ? PVE.DUNGEON.BOSS_REWARD_MULTIPLIER : 1;
  return {
    exp: monster.expReward * factor,
    money: randomInt(monster.moneyReward[0], monster.moneyReward[1]) * factor
  };
}

/** Drops de un monstruo dentro del dungeon (los normales con la probabilidad reducida) */
export function monsterDrops(monster: Monster, boss: boolean, luckBonus: number): string[] {
  return rollDrops(monster.drops, { chanceMultiplier: boss ? 1 : PVE.DUNGEON.DROP_CHANCE_REDUCTION, luckBonus });
}

export type DungeonEndReason = 'victory' | 'death' | 'flee' | 'timeout' | 'error';

export interface DungeonLoot {
  exp: number;
  money: number;
  items: string[];
}

/**
 * Aplica al botín acumulado el resultado final: multiplicadores y drops del
 * dungeon si se completó; recorte (y pérdida de items) si no.
 */
export function finalizeDungeonLoot(
  dungeon: Dungeon,
  loot: DungeonLoot,
  reason: DungeonEndReason,
  opts: { diedToBoss?: boolean; luckBonus?: number } = {}
): DungeonLoot {
  if (reason === 'victory') {
    const items = [...loot.items, ...dungeon.rewards.guaranteedDrops, ...rollDrops(dungeon.rewards.bonusDrops, { luckBonus: opts.luckBonus })];
    return {
      exp: Math.floor(loot.exp * dungeon.rewards.expMultiplier),
      money: Math.floor(loot.money * dungeon.rewards.moneyMultiplier),
      items
    };
  }

  const D = PVE.DUNGEON;
  const factor = reason === 'death'
    ? (opts.diedToBoss ? D.XP_MULTIPLIER_ON_DEATH.FULL : D.XP_MULTIPLIER_ON_DEATH.PARTIAL)
    : reason === 'flee' ? D.XP_MULTIPLIER_ON_FLEE : D.XP_MULTIPLIER_ON_TIMEOUT;

  return { exp: Math.floor(loot.exp * factor), money: Math.floor(loot.money * factor), items: [] };
}

export function healthBar(current: number, max: number, size: number = 10): string {
  const ratio = max > 0 ? current / max : 0;
  const filled = Math.min(size, Math.max(0, Math.floor(ratio * size)));
  return '█'.repeat(filled) + '░'.repeat(size - filled);
}
