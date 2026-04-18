/**
 * 🐾 Plugin Mascotas - CYALTRONIC
 * Sistema de compañeros: adopta, alimenta y entrena una mascota
 * que aporta pequeños buffs al dueño y sube de nivel con él.
 */

import type { PluginHandler, MessageContext } from '../types/message.js';
import { EMOJI, formatNumber, msToTime, randomInt } from '../lib/utils.js';
import { getDatabase } from '../lib/database.js';
import { CONFIG } from '../config.js';
import type { UserPet } from '../types/user.js';

// Especies y costos
const SPECIES: Record<string, { emoji: string; name: string; cost: number; attackMul: number; defenseMul: number }> = {
  rata:   { emoji: '🐀', name: 'Rata',   cost: 500,   attackMul: 0.02, defenseMul: 0.01 },
  gato:   { emoji: '🐱', name: 'Gato',   cost: 2000,  attackMul: 0.03, defenseMul: 0.02 },
  lobo:   { emoji: '🐺', name: 'Lobo',   cost: 8000,  attackMul: 0.05, defenseMul: 0.03 },
  fenix:  { emoji: '🔥', name: 'Fénix',  cost: 25000, attackMul: 0.08, defenseMul: 0.05 },
  dragon: { emoji: '🐲', name: 'Dragón', cost: 75000, attackMul: 0.12, defenseMul: 0.08 }
};

const FEED_COOLDOWN = 4 * 60 * 60 * 1000; // 4 h
const TRAIN_COOLDOWN = 60 * 60 * 1000;    // 1 h
const MAX_LEVEL = 50;
const EXP_PER_LEVEL = (lvl: number) => 100 * (lvl + 1);

/**
 * Devuelve los multiplicadores de buff que aporta la mascota al dueño.
 * Consumido por plugins de combate.
 */
export function getPetBuff(pet: UserPet | undefined | null): { attackMul: number; defenseMul: number } {
  if (!pet) return { attackMul: 0, defenseMul: 0 };
  const species = SPECIES[pet.species];
  if (!species) return { attackMul: 0, defenseMul: 0 };
  // Hambriento: no aporta buff
  if (pet.hunger < 30) return { attackMul: 0, defenseMul: 0 };
  const lvlFactor = 1 + pet.level / 20;
  return {
    attackMul: species.attackMul * lvlFactor,
    defenseMul: species.defenseMul * lvlFactor
  };
}

/** Concede exp a la mascota si existe. Devuelve true si subió de nivel. */
export function addPetExp(pet: UserPet | undefined, amount: number): boolean {
  if (!pet) return false;
  pet.exp += amount;
  let leveledUp = false;
  while (pet.level < MAX_LEVEL && pet.exp >= EXP_PER_LEVEL(pet.level)) {
    pet.exp -= EXP_PER_LEVEL(pet.level);
    pet.level++;
    leveledUp = true;
  }
  return leveledUp;
}

// ============================================================
// /adoptar <especie> <nombre>
// ============================================================
export const adoptarPlugin: PluginHandler = {
  command: /^(adoptar|adopt)$/i,
  tags: ['rpg', 'mascota'],
  help: ['adoptar <especie> <nombre> — adopta una mascota'],
  register: true,
  handler: async (ctx: MessageContext) => {
    const { m, args } = ctx;
    const db = getDatabase();
    const user = db.getUser(m.sender);
    if (!user.registered) return m.reply(CONFIG.messages.notRegistered);

    if (user.pet) {
      return m.reply(`🐾 Ya tienes una mascota: *${user.pet.name}* (${SPECIES[user.pet.species]?.emoji ?? ''} ${SPECIES[user.pet.species]?.name ?? user.pet.species}).`);
    }

    const speciesArg = (args[0] || '').toLowerCase();
    const name = (args.slice(1).join(' ') || '').trim();

    if (!speciesArg || !SPECIES[speciesArg] || !name) {
      const list = Object.entries(SPECIES)
        .map(([k, s]) => `  • ${s.emoji} *${k}* — ${formatNumber(s.cost)} 💰 (+${Math.round(s.attackMul * 100)}% atk, +${Math.round(s.defenseMul * 100)}% def)`)
        .join('\n');
      return m.reply(
        `🐾 *Adoptar Mascota*\n\n` +
        `Uso: /adoptar <especie> <nombre>\n\n` +
        `Especies disponibles:\n${list}\n\n` +
        `Ejemplo: /adoptar gato Pepito`
      );
    }

    if (name.length > 20) {
      return m.reply('❌ El nombre de la mascota no puede tener más de 20 caracteres.');
    }

    const species = SPECIES[speciesArg];
    if (user.money < species.cost) {
      return m.reply(`${EMOJI.warning} No tienes suficiente dinero. Necesitas *${formatNumber(species.cost)} 💰*.`);
    }

    user.money -= species.cost;
    user.pet = {
      species: speciesArg,
      name,
      level: 1,
      exp: 0,
      hunger: 100,
      lastFed: Date.now(),
      adoptedAt: Date.now()
    };
    db.updateUser(m.sender, { money: user.money, pet: user.pet });

    return m.reply(
      `🎉 *¡${name} es tu nueva mascota!*\n\n` +
      `${species.emoji} Especie: *${species.name}*\n` +
      `⭐ Nivel: 1\n` +
      `🍖 Hambre: 100/100\n\n` +
      `💡 Usa */alimentar* cada 4 h y */entrenar* cada 1 h.`
    );
  }
};

// ============================================================
// /mascota
// ============================================================
export const mascotaPlugin: PluginHandler = {
  command: /^(mascota|pet)$/i,
  tags: ['rpg', 'mascota'],
  register: true,
  handler: async (ctx: MessageContext) => {
    const { m } = ctx;
    const db = getDatabase();
    const user = db.getUser(m.sender);
    if (!user.registered) return m.reply(CONFIG.messages.notRegistered);
    if (!user.pet) return m.reply('🐾 No tienes mascota. Usa */adoptar <especie> <nombre>*.');

    const species = SPECIES[user.pet.species];
    const nextExp = EXP_PER_LEVEL(user.pet.level);
    const buff = getPetBuff(user.pet);

    return m.reply(
      `🐾 *${user.pet.name}*\n` +
      `━━━━━━━━━━━━━━\n` +
      `${species?.emoji ?? ''} Especie: ${species?.name ?? user.pet.species}\n` +
      `⭐ Nivel: ${user.pet.level}/${MAX_LEVEL}\n` +
      `📈 XP: ${user.pet.exp}/${nextExp}\n` +
      `🍖 Hambre: ${user.pet.hunger}/100\n\n` +
      `📊 *Buff activo:*\n` +
      `  • Ataque: +${(buff.attackMul * 100).toFixed(1)}%\n` +
      `  • Defensa: +${(buff.defenseMul * 100).toFixed(1)}%` +
      (user.pet.hunger < 30 ? '\n\n⚠️ _Mascota hambrienta: no aporta buff. ¡Aliméntala!_' : '')
    );
  }
};

// ============================================================
// /alimentar
// ============================================================
export const alimentarPlugin: PluginHandler = {
  command: /^(alimentar|feed)$/i,
  tags: ['rpg', 'mascota'],
  register: true,
  handler: async (ctx: MessageContext) => {
    const { m } = ctx;
    const db = getDatabase();
    const user = db.getUser(m.sender);
    if (!user.registered) return m.reply(CONFIG.messages.notRegistered);
    if (!user.pet) return m.reply('🐾 No tienes mascota.');

    const now = Date.now();
    const elapsed = now - user.pet.lastFed;
    if (elapsed < FEED_COOLDOWN) {
      return m.reply(`⏰ Puedes alimentarla de nuevo en *${msToTime(FEED_COOLDOWN - elapsed)}*.`);
    }

    const FEED_COST = 50;
    if (user.money < FEED_COST) {
      return m.reply(`${EMOJI.warning} La comida cuesta *${FEED_COST} 💰*.`);
    }

    user.money -= FEED_COST;
    user.pet.hunger = 100;
    user.pet.lastFed = now;
    const gained = randomInt(20, 40);
    const leveledUp = addPetExp(user.pet, gained);
    db.updateUser(m.sender, { money: user.money, pet: user.pet });

    return m.reply(
      `🍖 Alimentaste a *${user.pet.name}* (+${gained} XP).` +
      (leveledUp ? `\n⭐ ¡Subió a nivel *${user.pet.level}*!` : '')
    );
  }
};

// ============================================================
// /entrenar
// ============================================================
export const entrenarPlugin: PluginHandler = {
  command: /^(entrenar|train)$/i,
  tags: ['rpg', 'mascota'],
  register: true,
  handler: async (ctx: MessageContext) => {
    const { m } = ctx;
    const db = getDatabase();
    const user = db.getUser(m.sender);
    if (!user.registered) return m.reply(CONFIG.messages.notRegistered);
    if (!user.pet) return m.reply('🐾 No tienes mascota.');

    const now = Date.now();
    const cdKey = (user.pet as UserPet & { lastTrain?: number });
    const lastTrain = cdKey.lastTrain ?? 0;
    if (now - lastTrain < TRAIN_COOLDOWN) {
      return m.reply(`⏰ Podrás entrenar de nuevo en *${msToTime(TRAIN_COOLDOWN - (now - lastTrain))}*.`);
    }

    // Entrenar gasta hambre y da XP
    user.pet.hunger = Math.max(0, user.pet.hunger - 20);
    cdKey.lastTrain = now;
    const gained = randomInt(40, 80);
    const leveledUp = addPetExp(user.pet, gained);
    db.updateUser(m.sender, { pet: user.pet });

    return m.reply(
      `🏋️ *${user.pet.name}* entrenó duro y ganó ${gained} XP.\n` +
      `🍖 Hambre: ${user.pet.hunger}/100` +
      (leveledUp ? `\n⭐ ¡Subió a nivel *${user.pet.level}*!` : '')
    );
  }
};
