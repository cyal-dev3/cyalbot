import type { PluginHandler, MessageContext } from '../types/message.js';
import { getDatabase, type Database } from '../lib/database.js';
import { EMOJI, formatNumber, msToTime, randomInt } from '../lib/utils.js';
import { BOSS, PVE } from '../constants/rpg.js';
import { calculateDamage } from '../lib/rpg-utils.js';
import { createLogger } from '../lib/logger.js';
import { busyMessage, getBusy, grantCombatRewards, handlePlayerDeath, playerStats } from '../lib/rpg-combat.js';
import { pickMysteryBoxItem } from './rpg-items-especiales.js';

const log = createLogger('rpg');

/** Estado del jefe mundial; vive en db.getSettings().worldBoss (campo no tipado en DatabaseSchema) */
export interface WorldBossState {
  active: boolean;
  name: string;
  emoji: string;
  maxHealth: number;
  health: number;
  /** Daño acumulado por jugador */
  damage: Record<string, number>;
  /** Nombre visible de cada atacante */
  names: Record<string, string>;
  /** Último ataque de cada jugador */
  lastAttack: Record<string, number>;
  spawnedAt: number;
  spawnedBy: string;
}

const BOSS_NAMES = [
  { name: 'Behemoth de Obsidiana', emoji: '🗿' },
  { name: 'Dragón Ancestral', emoji: '🐉' },
  { name: 'Rey Lich', emoji: '💀' },
  { name: 'Titán de Hierro', emoji: '🤖' },
  { name: 'Hidra Abisal', emoji: '🐍' }
];

type SettingsWithBoss = ReturnType<Database['getSettings']> & { worldBoss?: WorldBossState };

export function getBossState(db: Database): WorldBossState | null {
  const settings = db.getSettings() as SettingsWithBoss;
  const boss = settings.worldBoss;
  return boss && boss.active ? boss : null;
}

function saveBoss(db: Database, boss: WorldBossState | null): void {
  db.updateSettings({ worldBoss: boss ?? undefined } as Partial<SettingsWithBoss>);
}

export function spawnBoss(db: Database, spawnedBy: string, name?: string, now: number = Date.now()): WorldBossState {
  const pick = BOSS_NAMES[randomInt(0, BOSS_NAMES.length - 1)];
  const boss: WorldBossState = {
    active: true,
    name: name?.trim() || pick.name,
    emoji: pick.emoji,
    maxHealth: BOSS.BASE_HEALTH,
    health: BOSS.BASE_HEALTH,
    damage: {},
    names: {},
    lastAttack: {},
    spawnedAt: now,
    spawnedBy
  };
  saveBoss(db, boss);
  log.info(`jefe mundial invocado: ${boss.name}`);
  return boss;
}

export function topAttackers(boss: WorldBossState, size: number = BOSS.TOP_SIZE): { jid: string; name: string; damage: number }[] {
  return Object.entries(boss.damage)
    .map(([jid, damage]) => ({ jid, name: boss.names[jid] || jid.split('@')[0], damage }))
    .sort((a, b) => b.damage - a.damage)
    .slice(0, size);
}

function bossStatus(boss: WorldBossState, usedPrefix: string): string {
  const filled = Math.min(10, Math.max(0, Math.floor((boss.health / boss.maxHealth) * 10)));
  let msg = `${boss.emoji} *JEFE MUNDIAL: ${boss.name.toUpperCase()}*\n━━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `❤️ [${'█'.repeat(filled)}${'░'.repeat(10 - filled)}] ${formatNumber(boss.health)}/${formatNumber(boss.maxHealth)}\n`;
  msg += `⚔️ Ataque: ${BOSS.ATTACK} | 🛡️ Defensa: ${BOSS.DEFENSE}\n`;
  msg += `👥 Atacantes: ${Object.keys(boss.damage).length}\n\n`;
  const top = topAttackers(boss);
  if (top.length > 0) {
    const medals = ['🥇', '🥈', '🥉'];
    msg += `🏆 *Top daño:*\n${top.map((t, i) => `   ${medals[i] ?? `${i + 1}.`} ${t.name}: ${formatNumber(t.damage)}`).join('\n')}\n\n`;
  }
  msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `📝 *${usedPrefix}boss atacar* - Golpea al jefe (${BOSS.STAMINA_COST}⚡, cada ${msToTime(BOSS.ATTACK_COOLDOWN)})\n`;
  msg += `💰 Botín al morir: ${formatNumber(BOSS.REWARD.MONEY_POOL)} monedas repartidas entre el top ${BOSS.TOP_SIZE} y XP para todos`;
  return msg;
}

async function distributeLoot(db: Database, boss: WorldBossState): Promise<string> {
  const top = topAttackers(boss);
  let msg = `\n💥 *¡${boss.name.toUpperCase()} HA CAÍDO!*\n━━━━━━━━━━━━━━━━━━━━━\n\n`;
  const medals = ['🥇', '🥈', '🥉'];

  for (const [jid, damage] of Object.entries(boss.damage)) {
    const rank = top.findIndex(t => t.jid === jid);
    const money = rank >= 0 ? Math.floor(BOSS.REWARD.MONEY_POOL * (BOSS.REWARD.TOP_SHARE[rank] ?? 0)) : 0;
    const exp = Math.floor(damage * BOSS.REWARD.EXP_PER_DAMAGE);
    const items: string[] = [];
    if (rank === 0) {
      const item = pickMysteryBoxItem();
      if (item) items.push(item.id);
    }
    const rewards = grantCombatRewards(db, jid, { exp, money, items });
    if (rank >= 0) {
      msg += `${medals[rank]} *${boss.names[jid]}*: +${formatNumber(rewards.exp)} XP, +${formatNumber(rewards.money)} 💰`;
      if (rewards.items.length) msg += `, ${rewards.items.join(', ')}`;
      msg += '\n';
    }
  }
  const others = Object.keys(boss.damage).length - top.length;
  if (others > 0) msg += `\n_Y ${others} aventurero(s) más recibieron XP por su daño._\n`;

  for (const jid of Object.keys(boss.damage)) {
    const u = db.getUser(jid);
    u.combatStats.bossesKilled++;
    db.updateUser(jid, { combatStats: u.combatStats });
  }
  saveBoss(db, null);
  return msg;
}

export const bossPlugin: PluginHandler = {
  command: ['boss', 'jefe', 'worldboss'],
  tags: ['rpg'],
  help: [
    'boss - Ver el jefe mundial activo',
    'boss atacar - Golpear al jefe (todos los jugadores comparten su vida)'
  ],
  register: true,

  handler: async (ctx: MessageContext) => {
    const { m, args, usedPrefix } = ctx;
    const db = getDatabase();
    const boss = getBossState(db);

    if (!boss) {
      await m.reply(`${EMOJI.info} No hay ningún jefe mundial activo.\n\n💡 El owner puede invocar uno con *${usedPrefix}bossinvocar*.`);
      return;
    }

    const sub = args[0]?.toLowerCase();
    if (!sub || !['atacar', 'a', 'attack', 'golpe'].includes(sub)) {
      await m.reply(bossStatus(boss, usedPrefix));
      return;
    }

    const user = db.getUser(m.sender);
    const now = Date.now();
    const busy = getBusy(m.sender);
    if (busy) {
      await m.reply(`${EMOJI.error} ${busyMessage(busy, 'Tú')}`);
      return;
    }
    const last = boss.lastAttack[m.sender] || 0;
    if (now - last < BOSS.ATTACK_COOLDOWN) {
      await m.reply(`${EMOJI.time} Espera *${msToTime(BOSS.ATTACK_COOLDOWN - (now - last))}* para volver a golpear al jefe.`);
      return;
    }
    if (user.stamina < BOSS.STAMINA_COST) {
      await m.reply(`${EMOJI.error} Necesitas ${BOSS.STAMINA_COST} ⚡ de energía para atacar al jefe.`);
      return;
    }
    if (user.health <= 1) {
      await m.reply(`${EMOJI.error} Estás demasiado herido. Cúrate antes de enfrentarte al jefe.`);
      return;
    }

    const stats = playerStats(user);
    // El jefe tiene miles de puntos de vida: el daño escala con el nivel para que un grupo lo tumbe en horas, no en semanas
    const hit = calculateDamage(stats.attack, BOSS.DEFENSE, stats.critChance, 1 + user.level / 10);
    const damage = Math.min(hit.damage, boss.health);
    const counter = calculateDamage(BOSS.ATTACK, stats.defense, PVE.MONSTER_CRIT_CHANCE);

    boss.health -= damage;
    boss.damage[m.sender] = (boss.damage[m.sender] || 0) + damage;
    boss.names[m.sender] = user.name;
    boss.lastAttack[m.sender] = now;

    const newHealth = Math.max(0, user.health - counter.damage);
    db.updateUser(m.sender, { stamina: user.stamina - BOSS.STAMINA_COST, health: newHealth });

    let msg = `${boss.emoji} *${user.name}* golpea a *${boss.name}*${hit.isCrit ? ' 💥CRIT' : ''} → *${formatNumber(damage)}*\n`;
    msg += `👹 El jefe contraataca → *${counter.damage}*${counter.isCrit ? ' 💥' : ''} (❤️ ${newHealth}/${stats.maxHealth})\n`;
    msg += `📊 Tu daño total: *${formatNumber(boss.damage[m.sender])}*\n`;

    if (newHealth <= 0) msg += handlePlayerDeath(db, m.sender, user.name, now).message + '\n';

    if (boss.health <= 0) {
      msg += await distributeLoot(db, boss);
    } else {
      saveBoss(db, boss);
      msg += `\n❤️ Jefe: ${formatNumber(boss.health)}/${formatNumber(boss.maxHealth)}`;
    }

    await m.reply(msg);
    await m.react(boss.health <= 0 ? '🏆' : '⚔️');
  }
};

export const bossInvocarPlugin: PluginHandler = {
  command: ['bossinvocar', 'invocarboss', 'spawnboss'],
  tags: ['owner'],
  help: ['bossinvocar [nombre] - Invoca un jefe mundial (owner)'],
  owner: true,

  handler: async (ctx: MessageContext) => {
    const { m, text, usedPrefix } = ctx;
    const db = getDatabase();
    if (getBossState(db)) {
      await m.reply(`${EMOJI.warning} Ya hay un jefe activo. Usa *${usedPrefix}boss* para verlo o *${usedPrefix}bossdespedir* para quitarlo.`);
      return;
    }
    const boss = spawnBoss(db, m.sender, text);
    await m.reply(`${boss.emoji} *¡UN JEFE MUNDIAL HA APARECIDO!*\n\n*${boss.name}* con ${formatNumber(boss.maxHealth)} de vida.\n\n📝 Todos pueden golpearlo con *${usedPrefix}boss atacar*.`);
  }
};

export const bossDespedirPlugin: PluginHandler = {
  command: ['bossdespedir', 'quitarboss', 'despawnboss'],
  tags: ['owner'],
  help: ['bossdespedir - Elimina el jefe mundial sin repartir botín (owner)'],
  owner: true,

  handler: async (ctx: MessageContext) => {
    const { m } = ctx;
    const db = getDatabase();
    if (!getBossState(db)) {
      await m.reply(`${EMOJI.info} No hay jefe activo.`);
      return;
    }
    saveBoss(db, null);
    await m.reply(`${EMOJI.success} El jefe mundial se ha retirado.`);
  }
};

export const bossPlugins: [string, PluginHandler][] = [
  ['rpg-boss', bossPlugin],
  ['owner-boss-invocar', bossInvocarPlugin],
  ['owner-boss-despedir', bossDespedirPlugin]
];
