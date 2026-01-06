/**
 * 🏰 Plugin de Dungeons - RPG
 * Comando: dungeon - Explora mazmorras peligrosas
 */

import type { PluginHandler, MessageContext } from '../types/message.js';
import { getDatabase } from '../lib/database.js';
import { EMOJI, msToTime, formatNumber, randomInt, pickRandom } from '../lib/utils.js';
import { DUNGEONS, MONSTERS, ITEMS, type Dungeon, type Monster } from '../types/rpg.js';
import { calculateTotalStats } from '../types/user.js';

/**
 * Cooldown de dungeon: 30 minutos
 */
const DUNGEON_COOLDOWN = 30 * 60 * 1000;

/**
 * Calcula el daño en combate de dungeon
 */
function calculateDamage(attack: number, defense: number, critChance: number): { damage: number; isCrit: boolean } {
  const baseDamage = Math.max(1, attack - defense * 0.5);
  const variance = randomInt(-10, 10) / 100;
  let damage = Math.floor(baseDamage * (1 + variance));

  const isCrit = randomInt(1, 100) <= critChance;
  if (isCrit) damage = Math.floor(damage * 1.5);

  return { damage: Math.max(1, damage), isCrit };
}

/**
 * Simula un combate contra un monstruo en dungeon
 */
function fightMonster(
  playerStats: { attack: number; defense: number; critChance: number },
  playerHealth: number,
  monster: Monster
): { won: boolean; playerDamage: number; playerHealth: number; log: string } {
  let pHealth = playerHealth;
  let mHealth = monster.health;
  let turns = 0;

  while (pHealth > 0 && mHealth > 0 && turns < 10) {
    turns++;

    // Jugador ataca
    const pHit = calculateDamage(playerStats.attack, monster.defense, playerStats.critChance);
    mHealth -= pHit.damage;

    if (mHealth <= 0) break;

    // Monstruo ataca
    const mHit = calculateDamage(monster.attack, playerStats.defense, 5);
    pHealth -= mHit.damage;
  }

  const won = mHealth <= 0;
  const damageTaken = playerHealth - Math.max(0, pHealth);

  let log = won
    ? `✅ Derrotaste a ${monster.emoji} ${monster.name} (-${damageTaken} HP)`
    : `❌ ${monster.emoji} ${monster.name} te venció`;

  return { won, playerDamage: damageTaken, playerHealth: Math.max(0, pHealth), log };
}

/**
 * Simula un dungeon completo
 */
function runDungeon(
  dungeon: Dungeon,
  playerStats: ReturnType<typeof calculateTotalStats>,
  playerHealth: number,
  playerLevel: number
): {
  completed: boolean;
  bossDefeated: boolean;
  monstersKilled: number;
  totalDamage: number;
  finalHealth: number;
  log: string[];
  expGained: number;
  moneyGained: number;
  itemsGained: string[];
} {
  const log: string[] = [];
  let currentHealth = playerHealth;
  let monstersKilled = 0;
  let totalDamage = 0;
  let expGained = 0;
  let moneyGained = 0;
  const itemsGained: string[] = [];

  log.push(`🚪 Entrando a *${dungeon.name}*...`);
  log.push('');

  // Pelear contra cada monstruo
  for (const monsterId of dungeon.monsters) {
    const monster = MONSTERS[monsterId];
    if (!monster) continue;

    log.push(`⚔️ *Encuentro:* ${monster.emoji} ${monster.name} (Nv.${monster.level})`);

    const result = fightMonster(playerStats, currentHealth, monster);
    log.push(`   ${result.log}`);

    currentHealth = result.playerHealth;
    totalDamage += result.playerDamage;

    if (result.won) {
      monstersKilled++;
      expGained += monster.expReward;
      moneyGained += randomInt(monster.moneyReward[0], monster.moneyReward[1]);

      // Drops de monstruos normales (chance reducida en dungeon)
      for (const drop of monster.drops) {
        if (Math.random() <= drop.chance * 0.5) {
          itemsGained.push(drop.itemId);
        }
      }
    }

    if (currentHealth <= 0) {
      log.push('');
      log.push(`💀 *¡Has caído en el dungeon!*`);
      return {
        completed: false,
        bossDefeated: false,
        monstersKilled,
        totalDamage,
        finalHealth: 0,
        log,
        expGained: Math.floor(expGained * 0.5), // 50% de XP si mueres
        moneyGained: Math.floor(moneyGained * 0.5),
        itemsGained: []
      };
    }

    log.push('');
  }

  // Pelear contra el boss
  const boss = MONSTERS[dungeon.bossId];
  if (boss) {
    log.push(`👹 *¡BOSS APARECE!* ${boss.emoji} ${boss.name} (Nv.${boss.level})`);

    // El boss tiene stats aumentados
    const enhancedBoss = {
      ...boss,
      health: Math.floor(boss.health * 1.5),
      attack: Math.floor(boss.attack * 1.2),
      defense: Math.floor(boss.defense * 1.2)
    };

    const bossResult = fightMonster(playerStats, currentHealth, enhancedBoss);
    log.push(`   ${bossResult.log}`);

    currentHealth = bossResult.playerHealth;
    totalDamage += bossResult.playerDamage;

    if (!bossResult.won) {
      log.push('');
      log.push(`💀 *El boss te ha derrotado...*`);
      return {
        completed: false,
        bossDefeated: false,
        monstersKilled,
        totalDamage,
        finalHealth: Math.max(1, currentHealth),
        log,
        expGained: Math.floor(expGained * 0.7),
        moneyGained: Math.floor(moneyGained * 0.7),
        itemsGained
      };
    }

    // Boss derrotado - recompensas extra
    expGained += boss.expReward * 2;
    moneyGained += randomInt(boss.moneyReward[0], boss.moneyReward[1]) * 2;

    // Drops del boss
    for (const drop of boss.drops) {
      if (Math.random() <= drop.chance) {
        itemsGained.push(drop.itemId);
      }
    }

    log.push('');
    log.push(`🏆 *¡BOSS DERROTADO!*`);
  }

  // Aplicar multiplicadores del dungeon
  expGained = Math.floor(expGained * dungeon.rewards.expMultiplier);
  moneyGained = Math.floor(moneyGained * dungeon.rewards.moneyMultiplier);

  // Drops garantizados
  for (const itemId of dungeon.rewards.guaranteedDrops) {
    itemsGained.push(itemId);
  }

  // Bonus drops
  for (const bonusDrop of dungeon.rewards.bonusDrops) {
    if (Math.random() <= bonusDrop.chance) {
      itemsGained.push(bonusDrop.itemId);
    }
  }

  log.push('');
  log.push(`✨ *¡DUNGEON COMPLETADO!*`);

  return {
    completed: true,
    bossDefeated: true,
    monstersKilled: monstersKilled + 1, // +1 por el boss
    totalDamage,
    finalHealth: currentHealth,
    log,
    expGained,
    moneyGained,
    itemsGained
  };
}

/**
 * Plugin: Dungeons - Ver dungeons disponibles
 */
export const dungeonsPlugin: PluginHandler = {
  command: ['dungeons', 'mazmorras', 'exploraciones'],
  tags: ['rpg'],
  help: [
    'dungeons - Ver todas las mazmorras disponibles',
    'Cada dungeon tiene diferentes dificultades y recompensas'
  ],
  register: true,

  handler: async (ctx: MessageContext) => {
    const { m } = ctx;
    const db = getDatabase();
    const user = db.getUser(m.sender);

    let response = `🏰 *DUNGEONS DISPONIBLES*\n`;
    response += `━━━━━━━━━━━━━━━━━━━━━\n`;
    response += `📊 Tu nivel: *${user.level}*\n`;
    response += `⚡ Tu energía: *${user.stamina}/${user.maxStamina}*\n\n`;

    for (const [dungeonId, dungeon] of Object.entries(DUNGEONS)) {
      const canEnter = user.level >= dungeon.requiredLevel;
      const hasStamina = user.stamina >= dungeon.staminaCost;
      const status = canEnter ? (hasStamina ? '✅' : '⚡') : '🔒';

      response += `${status} ${dungeon.emoji} *${dungeon.name}*\n`;
      response += `   📖 _${dungeon.description}_\n`;
      response += `   📊 Nivel: ${dungeon.requiredLevel}+ | ⚡ Costo: ${dungeon.staminaCost}\n`;
      response += `   🎁 XP x${dungeon.rewards.expMultiplier} | 💰 x${dungeon.rewards.moneyMultiplier}\n\n`;
    }

    response += `━━━━━━━━━━━━━━━━━━━━━\n`;
    response += `📝 */dungeon [nombre]* - Entrar a un dungeon\n`;
    response += `⏰ Cooldown: 30 minutos`;

    await m.reply(response);
  }
};

/**
 * Plugin: Dungeon - Entrar a un dungeon
 */
export const dungeonPlugin: PluginHandler = {
  command: ['dungeon', 'mazmorra', 'explorar', 'd'],
  tags: ['rpg'],
  help: [
    'dungeon [nombre] - Entra a una mazmorra',
    'Combate monstruos y un boss final',
    'Gana XP, dinero y items únicos'
  ],
  register: true,

  handler: async (ctx: MessageContext) => {
    const { m, text } = ctx;
    const db = getDatabase();
    const user = db.getUser(m.sender);

    // Verificar cooldown
    const now = Date.now();
    const lastDungeon = user.lastdungeon || 0;

    if (now - lastDungeon < DUNGEON_COOLDOWN) {
      const remaining = DUNGEON_COOLDOWN - (now - lastDungeon);
      await m.reply(
        `${EMOJI.time} Necesitas descansar después de tu última expedición.\n\n` +
        `⏳ Espera *${msToTime(remaining)}* para entrar a otro dungeon.`
      );
      return;
    }

    // Si no especifica dungeon, mostrar lista
    if (!text.trim()) {
      // Encontrar dungeon recomendado según nivel
      let recommendedDungeon: Dungeon | null = null;
      for (const dungeon of Object.values(DUNGEONS)) {
        if (user.level >= dungeon.requiredLevel) {
          recommendedDungeon = dungeon;
        }
      }

      let response = `${EMOJI.error} Especifica a qué dungeon quieres entrar.\n\n`;
      response += `📝 *Uso:* /dungeon cueva slimes\n\n`;
      response += `🏰 *Dungeons disponibles:*\n`;

      for (const dungeon of Object.values(DUNGEONS)) {
        const canEnter = user.level >= dungeon.requiredLevel;
        response += `   ${canEnter ? '✅' : '🔒'} ${dungeon.name} (Nv.${dungeon.requiredLevel}+)\n`;
      }

      if (recommendedDungeon) {
        response += `\n💡 *Recomendado:* ${recommendedDungeon.name}`;
      }

      await m.reply(response);
      return;
    }

    // Buscar dungeon
    const searchTerm = text.toLowerCase().trim();
    let selectedDungeon: Dungeon | null = null;

    for (const dungeon of Object.values(DUNGEONS)) {
      if (dungeon.name.toLowerCase().includes(searchTerm) ||
          dungeon.id.includes(searchTerm.replace(/\s+/g, '_'))) {
        selectedDungeon = dungeon;
        break;
      }
    }

    if (!selectedDungeon) {
      await m.reply(
        `${EMOJI.error} Dungeon no encontrado.\n\n` +
        `💡 Usa */dungeons* para ver las mazmorras disponibles.`
      );
      return;
    }

    // Verificar nivel
    if (user.level < selectedDungeon.requiredLevel) {
      await m.reply(
        `${EMOJI.error} Necesitas nivel *${selectedDungeon.requiredLevel}* para entrar.\n\n` +
        `📊 Tu nivel: *${user.level}*`
      );
      return;
    }

    // Verificar stamina
    if (user.stamina < selectedDungeon.staminaCost) {
      await m.reply(
        `${EMOJI.error} No tienes suficiente energía.\n\n` +
        `⚡ Requerida: *${selectedDungeon.staminaCost}*\n` +
        `⚡ Tu energía: *${user.stamina}/${user.maxStamina}*\n\n` +
        `💡 Espera o usa una poción de energía.`
      );
      return;
    }

    // Verificar salud
    if (user.health < 50) {
      await m.reply(
        `${EMOJI.error} Estás muy débil para entrar a un dungeon.\n\n` +
        `❤️ Salud: *${user.health}/${user.maxHealth}*\n\n` +
        `💡 Cúrate antes de entrar.`
      );
      return;
    }

    await m.react('🏰');

    // Consumir stamina y aplicar cooldown
    db.updateUser(m.sender, {
      stamina: user.stamina - selectedDungeon.staminaCost,
      lastdungeon: now
    });

    // Calcular stats del jugador
    const playerStats = calculateTotalStats(user, ITEMS);

    // Ejecutar dungeon
    const result = runDungeon(selectedDungeon, playerStats, user.health, user.level);

    // Actualizar estadísticas
    const newCombatStats = { ...user.combatStats };
    newCombatStats.totalKills += result.monstersKilled;
    newCombatStats.totalDamageDealt += result.totalDamage;

    if (result.completed) {
      newCombatStats.dungeonsCompleted++;
      if (result.bossDefeated) {
        newCombatStats.bossesKilled++;
      }
    }

    // Agregar items al inventario
    for (const itemId of result.itemsGained) {
      const existingItem = user.inventory.find(i => i.itemId === itemId);
      if (existingItem) {
        existingItem.quantity++;
      } else {
        user.inventory.push({ itemId, quantity: 1 });
      }
    }

    // Guardar cambios
    db.updateUser(m.sender, {
      health: Math.max(1, result.finalHealth),
      exp: user.exp + result.expGained,
      money: user.money + result.moneyGained,
      totalEarned: user.totalEarned + result.moneyGained,
      combatStats: newCombatStats,
      inventory: user.inventory
    });

    // Construir mensaje de resultado
    let response = `${selectedDungeon.emoji} *${selectedDungeon.name.toUpperCase()}*\n`;
    response += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

    // Log de combate (resumido)
    for (const line of result.log) {
      response += `${line}\n`;
    }

    response += `\n━━━━━━━━━━━━━━━━━━━━━\n`;
    response += `📊 *Resultados:*\n`;
    response += `   💀 Monstruos: ${result.monstersKilled}\n`;
    response += `   ${EMOJI.exp} XP: +${formatNumber(result.expGained)}\n`;
    response += `   ${EMOJI.coin} Monedas: +${formatNumber(result.moneyGained)}\n`;

    if (result.itemsGained.length > 0) {
      response += `   🎁 Items: `;
      const itemNames = result.itemsGained.map(id => {
        const item = ITEMS[id];
        return item ? `${item.emoji} ${item.name}` : id;
      });
      response += itemNames.join(', ') + '\n';
    }

    response += `\n❤️ Salud: *${result.finalHealth}/${user.maxHealth}*\n`;
    response += `⏰ Próximo dungeon: *30 minutos*`;

    await m.reply(response);
    await m.react(result.completed ? '🏆' : '💀');

    // Actualizar progreso de misiones
    if (result.completed) {
      // Aquí se actualizaría el progreso de misiones de dungeon
    }
  }
};

export default dungeonPlugin;
