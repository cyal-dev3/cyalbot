/**
 * Plugin de Combate PvE - RPG
 * Comando: atacar - Lucha contra monstruos aleatorios
 */

import type { PluginHandler, MessageContext } from '../types/message.js';
import { getDatabase } from '../lib/database.js';
import { CONFIG } from '../config.js';
import { EMOJI, msToTime, formatNumber, randomInt, pickRandom } from '../lib/utils.js';
import { MONSTERS, ITEMS, CLASSES, type Monster } from '../types/rpg.js';
import { calculateTotalStats } from '../types/user.js';
import { globalModes, checkExpiredModes } from './owner-rpg.js';
import { applyDeathPenalty, generateIMSSMessage } from './rpg-bombardear.js';
import { PVP } from '../constants/rpg.js';

// Usar constantes centralizadas
const ATTACK_COOLDOWN = PVP.ATTACK_COOLDOWN;

/**
 * Selecciona un monstruo apropiado para el nivel del jugador
 */
function selectMonster(playerLevel: number): Monster {
  const availableMonsters = Object.values(MONSTERS).filter(
    m => m.level <= playerLevel + 5 && m.level >= Math.max(1, playerLevel - 10)
  );

  if (availableMonsters.length === 0) {
    return MONSTERS.slime;
  }

  // Dar más peso a monstruos cercanos al nivel del jugador
  const weighted: Monster[] = [];
  for (const monster of availableMonsters) {
    const levelDiff = Math.abs(monster.level - playerLevel);
    const weight = Math.max(1, 10 - levelDiff);
    for (let i = 0; i < weight; i++) {
      weighted.push(monster);
    }
  }

  return pickRandom(weighted);
}

/**
 * Calcula el daño de un ataque
 */
function calculateDamage(
  attackerAttack: number,
  defenderDefense: number,
  critChance: number
): { damage: number; isCrit: boolean } {
  const baseDamage = Math.max(1, attackerAttack - defenderDefense * 0.5);
  const variance = randomInt(-10, 10) / 100;
  let damage = Math.floor(baseDamage * (1 + variance));

  const isCrit = randomInt(1, 100) <= critChance;
  if (isCrit) {
    damage = Math.floor(damage * 1.5);
  }

  return { damage: Math.max(1, damage), isCrit };
}

/**
 * Simula un combate completo
 */
function simulateCombat(
  playerStats: { attack: number; defense: number; maxHealth: number; critChance: number },
  playerHealth: number,
  monster: Monster
): {
  won: boolean;
  playerDamageDealt: number;
  playerDamageTaken: number;
  turns: number;
  log: string[];
} {
  let pHealth = playerHealth;
  let mHealth = monster.health;
  let turns = 0;
  const log: string[] = [];
  let totalPlayerDamage = 0;
  let totalMonsterDamage = 0;

  while (pHealth > 0 && mHealth > 0 && turns < 20) {
    turns++;

    // Turno del jugador
    const playerHit = calculateDamage(playerStats.attack, monster.defense, playerStats.critChance);
    mHealth -= playerHit.damage;
    totalPlayerDamage += playerHit.damage;

    if (playerHit.isCrit) {
      log.push(`⚡ *CRÍTICO!* Causaste ${playerHit.damage} de daño`);
    } else {
      log.push(`⚔️ Atacaste y causaste ${playerHit.damage} de daño`);
    }

    if (mHealth <= 0) break;

    // Turno del monstruo
    const monsterHit = calculateDamage(monster.attack, playerStats.defense, 5);
    pHealth -= monsterHit.damage;
    totalMonsterDamage += monsterHit.damage;

    if (monsterHit.isCrit) {
      log.push(`💥 *${monster.name} CRÍTICO!* Te causó ${monsterHit.damage} de daño`);
    } else {
      log.push(`👹 ${monster.name} te atacó y causó ${monsterHit.damage} de daño`);
    }
  }

  return {
    won: mHealth <= 0,
    playerDamageDealt: totalPlayerDamage,
    playerDamageTaken: totalMonsterDamage,
    turns,
    log: log.slice(-6) // Solo los últimos 6 turnos
  };
}

/**
 * Procesa los drops del monstruo
 */
function processDrops(monster: Monster): string[] {
  const drops: string[] = [];

  for (const drop of monster.drops) {
    if (Math.random() <= drop.chance) {
      drops.push(drop.itemId);
    }
  }

  return drops;
}

/**
 * Plugin: Atacar - Combate PvE
 */
export const atacarPlugin: PluginHandler = {
  command: ['atacar', 'attack', 'cazar', 'hunt', 'pelear', 'fight'],
  tags: ['rpg'],
  help: [
    'atacar - Lucha contra un monstruo aleatorio',
    'Gana XP, dinero y posibles drops',
    'Usa tu clase y equipamiento sabiamente',
    'Cooldown: 3 minutos'
  ],
  register: true,

  handler: async (ctx: MessageContext) => {
    const { m } = ctx;
    const db = getDatabase();
    const user = db.getUser(m.sender);

    // Verificar modos globales expirados
    checkExpiredModes();

    // Verificar cooldown
    const now = Date.now();
    const lastAttack = user.lastAttack || 0;

    if (now - lastAttack < ATTACK_COOLDOWN) {
      const remaining = ATTACK_COOLDOWN - (now - lastAttack);
      await m.reply(
        `${EMOJI.time} ¡Necesitas recuperarte del último combate!\n\n` +
        `⏳ Espera *${msToTime(remaining)}* para volver a atacar.`
      );
      return;
    }

    // Calcular stats del jugador con equipamiento y clase
    const playerStats = calculateTotalStats(user, ITEMS, CLASSES);

    // Verificar salud
    if (user.health < PVP.MIN_HEALTH_COMBAT) {
      await m.reply(
        `${EMOJI.error} ¡Estás muy débil para combatir!\n\n` +
        `❤️ Salud actual: *${user.health}/${playerStats.maxHealth}*\n\n` +
        `💡 Usa una poción de salud o espera a regenerarte.`
      );
      return;
    }

    // Verificar stamina
    if (user.stamina < 10) {
      await m.reply(
        `${EMOJI.error} ¡No tienes suficiente energía!\n\n` +
        `⚡ Energía actual: *${user.stamina}/${user.maxStamina}*\n\n` +
        `💡 Espera a regenerar energía o usa una poción.`
      );
      return;
    }

    await m.react('⚔️');

    // Seleccionar monstruo
    const monster = selectMonster(user.level);

    // Simular combate
    const result = simulateCombat(
      playerStats,
      user.health,
      monster
    );

    // Aplicar cooldown y consumir stamina
    const staminaCost = 10;
    db.updateUser(m.sender, {
      lastAttack: now,
      stamina: Math.max(0, user.stamina - staminaCost)
    });

    // Actualizar estadísticas de combate
    const newCombatStats = { ...user.combatStats };
    newCombatStats.totalDamageDealt += result.playerDamageDealt;
    newCombatStats.totalDamageReceived += result.playerDamageTaken;

    if (result.won) {
      // Victoria
      newCombatStats.totalKills++;

      // Calcular recompensas base
      let expGain = monster.expReward + randomInt(0, Math.floor(monster.expReward * 0.2));
      let moneyGain = randomInt(monster.moneyReward[0], monster.moneyReward[1]);
      const drops = processDrops(monster);

      // Aplicar multiplicadores de modos globales
      let modeMessages: string[] = [];

      // Bonus Mode - Multiplicador de XP y dinero
      if (globalModes.bonusMode.active) {
        const bonusExp = Math.floor(expGain * (globalModes.bonusMode.expMultiplier - 1));
        const bonusMoney = Math.floor(moneyGain * (globalModes.bonusMode.moneyMultiplier - 1));
        expGain += bonusExp;
        moneyGain += bonusMoney;
        modeMessages.push(`🎁 Modo Bonus activo (x${globalModes.bonusMode.expMultiplier} XP)`);
      }

      // PvP Mode - Aumenta daño y recompensas en combate
      if (globalModes.pvpMode.active) {
        const pvpExp = Math.floor(expGain * (globalModes.pvpMode.damageMultiplier - 1));
        expGain += pvpExp;
        modeMessages.push(`⚔️ Modo PvP activo (x${globalModes.pvpMode.damageMultiplier} daño)`);
      }

      // Chaos Mode - Multiplicador general
      if (globalModes.chaosMode.active) {
        const chaosExp = Math.floor(expGain * (globalModes.chaosMode.multiplier - 1));
        const chaosMoney = Math.floor(moneyGain * (globalModes.chaosMode.multiplier - 1));
        expGain += chaosExp;
        moneyGain += chaosMoney;
        modeMessages.push(`🌀 Modo Caos activo (x${globalModes.chaosMode.multiplier})`);
      }

      // Event Mode - Multiplicador de drops/recompensas
      if (globalModes.eventMode.active) {
        const eventExp = Math.floor(expGain * (globalModes.eventMode.dropMultiplier - 1));
        const eventMoney = Math.floor(moneyGain * (globalModes.eventMode.dropMultiplier - 1));
        expGain += eventExp;
        moneyGain += eventMoney;
        modeMessages.push(`🎉 ${globalModes.eventMode.eventName} (x${globalModes.eventMode.dropMultiplier})`);
      }

      // Actualizar usuario
      const newHealth = Math.max(1, user.health - result.playerDamageTaken);
      db.updateUser(m.sender, {
        health: newHealth,
        exp: user.exp + expGain,
        money: user.money + moneyGain,
        totalEarned: user.totalEarned + moneyGain,
        combatStats: newCombatStats
      });

      // Agregar drops al inventario
      for (const itemId of drops) {
        const existingItem = user.inventory.find(i => i.itemId === itemId);
        if (existingItem) {
          existingItem.quantity++;
        } else {
          user.inventory.push({ itemId, quantity: 1 });
        }
      }
      if (drops.length > 0) {
        db.updateUser(m.sender, { inventory: user.inventory });
      }

      // Construir mensaje de victoria
      let victoryMsg = `⚔️ *¡VICTORIA!*\n`;
      victoryMsg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;
      victoryMsg += `${monster.emoji} Derrotaste a *${monster.name}* (Nv.${monster.level})\n\n`;

      victoryMsg += `📜 *Resumen del combate:*\n`;
      for (const line of result.log.slice(-4)) {
        victoryMsg += `   ${line}\n`;
      }

      victoryMsg += `\n🎁 *Recompensas:*\n`;
      victoryMsg += `   ${EMOJI.exp} +${formatNumber(expGain)} XP\n`;
      victoryMsg += `   ${EMOJI.coin} +${formatNumber(moneyGain)} monedas\n`;

      if (drops.length > 0) {
        victoryMsg += `   🎒 Items: `;
        victoryMsg += drops.map(d => ITEMS[d]?.emoji + ' ' + ITEMS[d]?.name).join(', ');
        victoryMsg += '\n';
      }

      // Mostrar modos activos
      if (modeMessages.length > 0) {
        victoryMsg += `\n🎮 *Bonificaciones:*\n`;
        victoryMsg += modeMessages.map(msg => `   ${msg}`).join('\n');
        victoryMsg += '\n';
      }

      victoryMsg += `\n❤️ Salud restante: *${newHealth}/${playerStats.maxHealth}*`;
      victoryMsg += `\n⏰ Próximo ataque: *3 minutos*`;

      await m.reply(victoryMsg);
      await m.react('🏆');

    } else {
      // Derrota - El jugador murió
      const playerDied = user.health - result.playerDamageTaken <= 0;

      db.updateUser(m.sender, {
        health: 1, // Revive con 1 HP
        combatStats: newCombatStats
      });

      let defeatMsg = `💀 *DERROTA*\n`;
      defeatMsg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;
      defeatMsg += `${monster.emoji} *${monster.name}* (Nv.${monster.level}) te venció.\n\n`;

      defeatMsg += `📜 *Resumen del combate:*\n`;
      for (const line of result.log.slice(-4)) {
        defeatMsg += `   ${line}\n`;
      }

      defeatMsg += `\n❤️ Salud restante: *1/${playerStats.maxHealth}*\n`;

      // Aplicar cuota del IMSS si murió
      if (playerDied) {
        const freshUser = db.getUser(m.sender);
        const imssResult = applyDeathPenalty(db, m.sender, freshUser);
        defeatMsg += generateIMSSMessage(imssResult, user.name);
      }

      defeatMsg += `\n💡 _Sube de nivel, mejora tu equipo o elige una clase para ser más fuerte._`;

      await m.reply(defeatMsg);
      await m.react('💀');
    }

    // Actualizar progreso de misiones de combate
    updateQuestProgress(db, m.sender, 'combat', 1);
  }
};

/**
 * Actualiza el progreso de misiones
 */
function updateQuestProgress(db: ReturnType<typeof getDatabase>, jid: string, objective: string, amount: number): void {
  const user = db.getUser(jid);

  // Actualizar misiones diarias
  for (const quest of user.dailyQuests) {
    if (!quest.completed && quest.questId.includes(objective)) {
      quest.progress += amount;
    }
  }

  // Actualizar misiones semanales
  for (const quest of user.weeklyQuests) {
    if (!quest.completed && quest.questId.includes(objective)) {
      quest.progress += amount;
    }
  }

  db.updateUser(jid, {
    dailyQuests: user.dailyQuests,
    weeklyQuests: user.weeklyQuests
  });
}

export default atacarPlugin;
