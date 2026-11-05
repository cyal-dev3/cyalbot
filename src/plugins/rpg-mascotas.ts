import type { PluginHandler, MessageContext } from '../types/message.js';
import { EMOJI, formatNumber, msToTime, randomInt, checkCooldown } from '../lib/utils.js';
import { getDatabase } from '../lib/database.js';
import { COOLDOWNS } from '../constants/rpg.js';
import type { UserPet } from '../types/user.js';
import { clamp, replyCooldown, usageError } from '../lib/rpg-actions.js';
import { updateQuestProgress } from '../lib/quests.js';

const SPECIES: Record<string, { emoji: string; name: string; cost: number; attackMul: number; defenseMul: number }> = {
  rata:   { emoji: '🐀', name: 'Rata',   cost: 500,   attackMul: 0.02, defenseMul: 0.01 },
  gato:   { emoji: '🐱', name: 'Gato',   cost: 2000,  attackMul: 0.03, defenseMul: 0.02 },
  lobo:   { emoji: '🐺', name: 'Lobo',   cost: 8000,  attackMul: 0.05, defenseMul: 0.03 },
  fenix:  { emoji: '🔥', name: 'Fénix',  cost: 25000, attackMul: 0.08, defenseMul: 0.05 },
  dragon: { emoji: '🐲', name: 'Dragón', cost: 75000, attackMul: 0.12, defenseMul: 0.08 }
};

export const PET_MAX_LEVEL = 50;
export const FEED_COST = 50;
/** Puntos de hambre que pierde la mascota por hora sin comer */
export const HUNGER_DECAY_PER_HOUR = 4;
/** Por debajo de este hambre la mascota no aporta buff */
export const HUNGER_BUFF_THRESHOLD = 30;
const TRAIN_HUNGER_COST = 20;

export const petExpForLevel = (level: number): number => 100 * (level + 1);

/** Hambre actual: el valor guardado decae con las horas desde la última comida */
export function getPetHunger(pet: UserPet, now: number = Date.now()): number {
  const hours = Math.max(0, (now - pet.lastFed) / 3600000);
  return clamp(Math.floor(pet.hunger - hours * HUNGER_DECAY_PER_HOUR), 0, 100);
}

/**
 * Buff que la mascota aporta al dueño. Lo deben aplicar los plugins de combate
 * (atacar/duelo/dungeon) sobre ataque y defensa.
 */
export function getPetBuff(pet: UserPet | undefined | null, now: number = Date.now()): { attackMul: number; defenseMul: number } {
  if (!pet) return { attackMul: 0, defenseMul: 0 };
  const species = SPECIES[pet.species];
  if (!species || getPetHunger(pet, now) < HUNGER_BUFF_THRESHOLD) return { attackMul: 0, defenseMul: 0 };
  const levelFactor = 1 + pet.level / 20;
  return { attackMul: species.attackMul * levelFactor, defenseMul: species.defenseMul * levelFactor };
}

/** Suma XP a la mascota; devuelve true si subió de nivel */
export function addPetExp(pet: UserPet | undefined, amount: number): boolean {
  if (!pet || !Number.isFinite(amount) || amount <= 0) return false;
  pet.exp += Math.floor(amount);
  let leveledUp = false;
  while (pet.level < PET_MAX_LEVEL && pet.exp >= petExpForLevel(pet.level)) {
    pet.exp -= petExpForLevel(pet.level);
    pet.level++;
    leveledUp = true;
  }
  return leveledUp;
}

function describeSpecies(pet: UserPet): string {
  const species = SPECIES[pet.species];
  return species ? `${species.emoji} ${species.name}` : pet.species;
}

export const adoptarPlugin: PluginHandler = {
  command: /^(adoptar|adopt)$/i,
  tags: ['rpg', 'mascota'],
  help: [
    'adoptar <especie> <nombre> - Adopta una mascota que da buffs en combate',
    'Especies: rata, gato, lobo, fenix, dragon'
  ],
  usage: ['adoptar <especie> <nombre>', 'adoptar gato Pepito'],
  register: true,
  handler: async (ctx: MessageContext) => {
    const { m, args, usedPrefix } = ctx;
    const db = getDatabase();
    const user = db.getUser(m.sender);

    if (user.pet) {
      return m.reply(`🐾 Ya tienes una mascota: *${user.pet.name}* (${describeSpecies(user.pet)}).`);
    }

    const speciesId = (args[0] ?? '').toLowerCase();
    const name = args.slice(1).join(' ').trim();
    const species = SPECIES[speciesId];

    if (!species || !name) {
      const list = Object.entries(SPECIES)
        .map(([id, s]) => `• ${s.emoji} *${id}* — ${formatNumber(s.cost)} 💰 (+${Math.round(s.attackMul * 100)}% atk, +${Math.round(s.defenseMul * 100)}% def)`)
        .join('\n');
      return usageError(ctx, adoptarPlugin, `Elige una especie y un nombre.\n\n${list}`);
    }

    if (name.length > 20) return m.reply(`${EMOJI.error} El nombre no puede tener más de 20 caracteres.`);
    if (user.money < species.cost) {
      return m.reply(`${EMOJI.warning} No tienes suficiente dinero. Necesitas *${formatNumber(species.cost)} 💰*.`);
    }

    const now = Date.now();
    const pet: UserPet = { species: speciesId, name, level: 1, exp: 0, hunger: 100, lastFed: now, adoptedAt: now };
    db.updateUser(m.sender, { money: user.money - species.cost, pet });
    const questLines = updateQuestProgress(db, m.sender, 'spend', species.cost).lines;

    await m.reply(
      `🎉 *¡${name} es tu nueva mascota!*\n\n` +
      `${species.emoji} Especie: *${species.name}*\n⭐ Nivel: 1\n🍖 Hambre: 100/100\n\n` +
      `💡 Usa *${usedPrefix}alimentar* cada ${msToTime(COOLDOWNS.FEED)} y *${usedPrefix}entrenar* cada ${msToTime(COOLDOWNS.TRAIN)}.` +
      (questLines.length ? `\n\n${questLines.join('\n')}` : '')
    );
  }
};

export const mascotaPlugin: PluginHandler = {
  command: /^(mascota|pet)$/i,
  tags: ['rpg', 'mascota'],
  help: ['mascota - Ver el estado y los buffs de tu mascota'],
  usage: ['mascota'],
  register: true,
  handler: async (ctx: MessageContext) => {
    const { m, usedPrefix } = ctx;
    const user = getDatabase().getUser(m.sender);
    if (!user.pet) return m.reply(`🐾 No tienes mascota. Usa *${usedPrefix}adoptar <especie> <nombre>*.`);

    const now = Date.now();
    const hunger = getPetHunger(user.pet, now);
    const buff = getPetBuff(user.pet, now);

    await m.reply(
      `🐾 *${user.pet.name}*\n━━━━━━━━━━━━━━\n` +
      `${describeSpecies(user.pet)}\n` +
      `⭐ Nivel: ${user.pet.level}/${PET_MAX_LEVEL}\n` +
      `📈 XP: ${user.pet.exp}/${petExpForLevel(user.pet.level)}\n` +
      `🍖 Hambre: ${hunger}/100 (pierde ${HUNGER_DECAY_PER_HOUR}/h)\n\n` +
      `📊 *Buff activo:*\n` +
      `• Ataque: +${(buff.attackMul * 100).toFixed(1)}%\n` +
      `• Defensa: +${(buff.defenseMul * 100).toFixed(1)}%` +
      (hunger < HUNGER_BUFF_THRESHOLD ? `\n\n⚠️ _Mascota hambrienta: no aporta buff. Usa ${usedPrefix}alimentar._` : '')
    );
  }
};

export const alimentarPlugin: PluginHandler = {
  command: /^(alimentar|feed)$/i,
  tags: ['rpg', 'mascota'],
  help: [`alimentar - Alimenta a tu mascota (${FEED_COST} 💰, cada ${msToTime(COOLDOWNS.FEED)})`],
  usage: ['alimentar'],
  register: true,
  handler: async (ctx: MessageContext) => {
    const { m, usedPrefix } = ctx;
    const db = getDatabase();
    const user = db.getUser(m.sender);
    if (!user.pet) return m.reply(`🐾 No tienes mascota. Usa *${usedPrefix}adoptar*.`);

    const cd = checkCooldown(user.pet.lastFed, COOLDOWNS.FEED);
    if (cd.onCooldown) return replyCooldown(ctx, cd.remaining, [{ cmd: 'entrenar', desc: 'Entrenar a tu mascota' }]);
    if (user.money < FEED_COST) return m.reply(`${EMOJI.warning} La comida cuesta *${FEED_COST} 💰*.`);

    user.money -= FEED_COST;
    user.pet.hunger = 100;
    user.pet.lastFed = Date.now();
    const gained = randomInt(20, 40);
    const leveledUp = addPetExp(user.pet, gained);
    db.updateUser(m.sender, { money: user.money, pet: user.pet });

    await m.reply(
      `🍖 Alimentaste a *${user.pet.name}* (+${gained} XP, hambre 100/100).` +
      (leveledUp ? `\n⭐ ¡Subió a nivel *${user.pet.level}*!` : '')
    );
  }
};

export const entrenarPlugin: PluginHandler = {
  command: /^(entrenar|train)$/i,
  tags: ['rpg', 'mascota'],
  help: [`entrenar - Entrena a tu mascota (gasta ${TRAIN_HUNGER_COST} de hambre, cada ${msToTime(COOLDOWNS.TRAIN)})`],
  usage: ['entrenar'],
  register: true,
  handler: async (ctx: MessageContext) => {
    const { m, usedPrefix } = ctx;
    const db = getDatabase();
    const user = db.getUser(m.sender);
    if (!user.pet) return m.reply(`🐾 No tienes mascota. Usa *${usedPrefix}adoptar*.`);

    const now = Date.now();
    const cd = checkCooldown(user.pet.lastTrain ?? 0, COOLDOWNS.TRAIN);
    if (cd.onCooldown) return replyCooldown(ctx, cd.remaining, [{ cmd: 'alimentar', desc: 'Alimentar a tu mascota' }]);

    const hunger = getPetHunger(user.pet, now);
    if (hunger < TRAIN_HUNGER_COST) {
      return m.reply(`🍖 *${user.pet.name}* tiene demasiada hambre para entrenar (${hunger}/100). Usa *${usedPrefix}alimentar* primero.`);
    }

    // Restar al valor guardado equivale a restar al hambre efectivo: el decaimiento sigue contando desde lastFed
    user.pet.hunger -= TRAIN_HUNGER_COST;
    user.pet.lastTrain = now;
    const gained = randomInt(40, 80);
    const leveledUp = addPetExp(user.pet, gained);
    db.updateUser(m.sender, { pet: user.pet });

    await m.reply(
      `🏋️ *${user.pet.name}* entrenó duro y ganó ${gained} XP.\n` +
      `🍖 Hambre: ${getPetHunger(user.pet, now)}/100` +
      (leveledUp ? `\n⭐ ¡Subió a nivel *${user.pet.level}*!` : '')
    );
  }
};
