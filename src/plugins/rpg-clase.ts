/**
 * Plugin de Clases - RPG
 * Comandos: clase, clases, elegirclase
 */

import type { PluginHandler, MessageContext } from '../types/message.js';
import { getDatabase } from '../lib/database.js';
import { EMOJI, formatNumber } from '../lib/utils.js';
import { CLASSES, SKILLS, type PlayerClass } from '../types/rpg.js';

/**
 * Nivel mínimo para elegir clase
 */
const MIN_LEVEL_FOR_CLASS = 5;

/**
 * Costo de cambiar de clase (después de la primera)
 */
const CLASS_CHANGE_COST = 10000;

/**
 * Plugin: Clases - Ver información de las clases
 */
export const clasesPlugin: PluginHandler = {
  command: ['clases', 'classes', 'verclases'],
  tags: ['rpg'],
  help: [
    'clases - Ver todas las clases disponibles',
    'Cada clase tiene stats y habilidades únicas'
  ],
  register: true,

  handler: async (ctx: MessageContext) => {
    const { m } = ctx;
    const db = getDatabase();
    const user = db.getUser(m.sender);

    let response = `🎭 *CLASES DISPONIBLES*\n`;
    response += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

    for (const [classId, classInfo] of Object.entries(CLASSES)) {
      const isCurrentClass = user.playerClass === classId;

      response += `${classInfo.emoji} *${classInfo.name}*`;
      if (isCurrentClass) response += ` ← Tu clase`;
      response += `\n`;
      response += `   _${classInfo.description}_\n\n`;

      response += `   📊 *Bonus de stats:*\n`;
      if (classInfo.baseStats.healthBonus > 0) response += `      ❤️ +${classInfo.baseStats.healthBonus} Vida\n`;
      if (classInfo.baseStats.manaBonus > 0) response += `      💠 +${classInfo.baseStats.manaBonus} Maná\n`;
      if (classInfo.baseStats.staminaBonus > 0) response += `      ⚡ +${classInfo.baseStats.staminaBonus} Energía\n`;
      if (classInfo.baseStats.attackBonus > 0) response += `      ⚔️ +${classInfo.baseStats.attackBonus} Ataque\n`;
      if (classInfo.baseStats.defenseBonus > 0) response += `      🛡️ +${classInfo.baseStats.defenseBonus} Defensa\n`;

      response += `\n   ✨ *Habilidades:*\n`;
      for (const skillId of classInfo.skills) {
        const skill = SKILLS[skillId];
        if (skill) {
          response += `      ${skill.emoji} ${skill.name}\n`;
        }
      }

      response += '\n';
    }

    response += `━━━━━━━━━━━━━━━━━━━━━\n`;
    response += `📝 */clase [nombre]* - Elegir clase\n`;
    response += `📊 Nivel mínimo: *${MIN_LEVEL_FOR_CLASS}*\n`;
    if (user.playerClass) {
      response += `💰 Cambiar clase: *${formatNumber(CLASS_CHANGE_COST)}* monedas`;
    }

    await m.reply(response);
  }
};

/**
 * Plugin: Clase - Elegir o ver tu clase
 */
export const clasePlugin: PluginHandler = {
  command: ['clase', 'class', 'elegirclase', 'selectclass'],
  tags: ['rpg'],
  help: [
    'clase - Ver tu clase actual y habilidades',
    'clase [guerrero/mago/ladron/arquero] - Elegir clase'
  ],
  register: true,

  handler: async (ctx: MessageContext) => {
    const { m, text } = ctx;
    const db = getDatabase();
    const user = db.getUser(m.sender);

    // Si no se especifica clase, mostrar la clase actual
    if (!text.trim()) {
      if (!user.playerClass) {
        await m.reply(
          `${EMOJI.info} Aún no has elegido una clase.\n\n` +
          `📝 Usa */clases* para ver las opciones.\n` +
          `📝 Usa */clase [nombre]* para elegir.\n\n` +
          `📊 Nivel requerido: *${MIN_LEVEL_FOR_CLASS}*\n` +
          `📊 Tu nivel: *${user.level}*`
        );
        return;
      }

      const classInfo = CLASSES[user.playerClass];
      if (!classInfo) {
        await m.reply(`${EMOJI.error} Error: Clase no encontrada.`);
        return;
      }

      let response = `${classInfo.emoji} *Tu clase: ${classInfo.name}*\n`;
      response += `━━━━━━━━━━━━━━━━━━━━━\n\n`;
      response += `📖 _${classInfo.description}_\n\n`;

      response += `📊 *Tus bonus de clase:*\n`;
      if (classInfo.baseStats.healthBonus > 0) response += `   ❤️ +${classInfo.baseStats.healthBonus} Vida máxima\n`;
      if (classInfo.baseStats.manaBonus > 0) response += `   💠 +${classInfo.baseStats.manaBonus} Maná máximo\n`;
      if (classInfo.baseStats.staminaBonus > 0) response += `   ⚡ +${classInfo.baseStats.staminaBonus} Energía máxima\n`;
      if (classInfo.baseStats.attackBonus > 0) response += `   ⚔️ +${classInfo.baseStats.attackBonus} Ataque\n`;
      if (classInfo.baseStats.defenseBonus > 0) response += `   🛡️ +${classInfo.baseStats.defenseBonus} Defensa\n`;

      response += `\n✨ *Tus habilidades:*\n`;
      for (const skillId of classInfo.skills) {
        const skill = SKILLS[skillId];
        if (skill) {
          response += `\n   ${skill.emoji} *${skill.name}*\n`;
          response += `      _${skill.description}_\n`;
          response += `      💠 Maná: ${skill.manaCost} | ⚡ Energía: ${skill.staminaCost}\n`;
        }
      }

      response += `\n━━━━━━━━━━━━━━━━━━━━━\n`;
      response += `💡 Las habilidades se usan automáticamente en combate.`;

      await m.reply(response);
      return;
    }

    // Elegir una clase
    const classChoice = text.toLowerCase().trim();

    const classMap: Record<string, PlayerClass> = {
      'guerrero': 'guerrero',
      'warrior': 'guerrero',
      'mago': 'mago',
      'mage': 'mago',
      'wizard': 'mago',
      'ladron': 'ladron',
      'ladrón': 'ladron',
      'thief': 'ladron',
      'rogue': 'ladron',
      'arquero': 'arquero',
      'archer': 'arquero',
      'ranger': 'arquero'
    };

    const selectedClass = classMap[classChoice];

    if (!selectedClass) {
      await m.reply(
        `${EMOJI.error} Clase no válida.\n\n` +
        `📝 Clases disponibles:\n` +
        `   ⚔️ Guerrero\n` +
        `   🔮 Mago\n` +
        `   🗡️ Ladrón\n` +
        `   🏹 Arquero\n\n` +
        `💡 Usa */clases* para ver detalles.`
      );
      return;
    }

    // Verificar nivel mínimo
    if (user.level < MIN_LEVEL_FOR_CLASS) {
      await m.reply(
        `${EMOJI.error} Necesitas nivel *${MIN_LEVEL_FOR_CLASS}* para elegir una clase.\n\n` +
        `📊 Tu nivel actual: *${user.level}*\n` +
        `💡 Sigue trabajando y luchando para subir de nivel!`
      );
      return;
    }

    // Si ya tiene la misma clase
    if (user.playerClass === selectedClass) {
      await m.reply(`${EMOJI.warning} ¡Ya eres ${CLASSES[selectedClass].name}!`);
      return;
    }

    // Si ya tiene clase, cobrar el cambio
    if (user.playerClass) {
      if (user.money < CLASS_CHANGE_COST) {
        await m.reply(
          `${EMOJI.error} Cambiar de clase cuesta *${formatNumber(CLASS_CHANGE_COST)}* monedas.\n\n` +
          `💰 Tu dinero: *${formatNumber(user.money)}* monedas\n` +
          `❌ Te faltan: *${formatNumber(CLASS_CHANGE_COST - user.money)}* monedas`
        );
        return;
      }

      user.money -= CLASS_CHANGE_COST;
    }

    // Aplicar la nueva clase
    const classInfo = CLASSES[selectedClass];
    const previousClass = user.playerClass;

    // Remover bonus de clase anterior si había
    if (previousClass) {
      const prevClassInfo = CLASSES[previousClass];
      user.maxHealth -= prevClassInfo.baseStats.healthBonus;
      user.maxMana -= prevClassInfo.baseStats.manaBonus;
      user.maxStamina -= prevClassInfo.baseStats.staminaBonus;
      user.attack -= prevClassInfo.baseStats.attackBonus;
      user.defense -= prevClassInfo.baseStats.defenseBonus;
    }

    // Aplicar bonus de nueva clase
    user.maxHealth += classInfo.baseStats.healthBonus;
    user.maxMana += classInfo.baseStats.manaBonus;
    user.maxStamina += classInfo.baseStats.staminaBonus;
    user.attack += classInfo.baseStats.attackBonus;
    user.defense += classInfo.baseStats.defenseBonus;

    // Actualizar stats actuales si superan el máximo
    user.health = Math.min(user.health, user.maxHealth);
    user.mana = Math.min(user.mana, user.maxMana);
    user.stamina = Math.min(user.stamina, user.maxStamina);

    // Guardar
    db.updateUser(m.sender, {
      playerClass: selectedClass,
      classSelectedAt: Date.now(),
      money: user.money,
      maxHealth: user.maxHealth,
      maxMana: user.maxMana,
      maxStamina: user.maxStamina,
      health: user.health,
      mana: user.mana,
      stamina: user.stamina,
      attack: user.attack,
      defense: user.defense
    });

    let response = `${classInfo.emoji} *¡Ahora eres ${classInfo.name}!*\n`;
    response += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

    if (previousClass) {
      response += `🔄 Cambiaste de ${CLASSES[previousClass].emoji} ${CLASSES[previousClass].name}\n`;
      response += `💰 Pagaste: *${formatNumber(CLASS_CHANGE_COST)}* monedas\n\n`;
    }

    response += `📊 *Nuevos stats:*\n`;
    response += `   ❤️ Vida: *${user.maxHealth}*\n`;
    response += `   💠 Maná: *${user.maxMana}*\n`;
    response += `   ⚡ Energía: *${user.maxStamina}*\n`;
    response += `   ⚔️ Ataque: *${user.attack}*\n`;
    response += `   🛡️ Defensa: *${user.defense}*\n\n`;

    response += `✨ *Habilidades desbloqueadas:*\n`;
    for (const skillId of classInfo.skills) {
      const skill = SKILLS[skillId];
      if (skill) {
        response += `   ${skill.emoji} ${skill.name}\n`;
      }
    }

    response += `\n💡 _Tus habilidades se activan automáticamente en combate._`;

    await m.reply(response);
    await m.react('✨');

    // Verificar logro de clase
    const achievementId = `class_${selectedClass === 'ladron' ? 'thief' : selectedClass}`;
    if (!user.achievements.includes(achievementId)) {
      // Aquí se podría llamar a una función de logros
    }
  }
};

/**
 * Plugin: Habilidades - Ver tus habilidades
 */
export const habilidadesPlugin: PluginHandler = {
  command: ['habilidades', 'skills', 'spells', 'poderes'],
  tags: ['rpg'],
  help: [
    'habilidades - Ver tus habilidades de clase',
    'Las habilidades se usan automáticamente en combate'
  ],
  register: true,

  handler: async (ctx: MessageContext) => {
    const { m } = ctx;
    const db = getDatabase();
    const user = db.getUser(m.sender);

    if (!user.playerClass) {
      await m.reply(
        `${EMOJI.info} No tienes habilidades porque no has elegido una clase.\n\n` +
        `📝 Usa */clases* para ver las opciones.\n` +
        `📊 Nivel mínimo: *${MIN_LEVEL_FOR_CLASS}*`
      );
      return;
    }

    const classInfo = CLASSES[user.playerClass];

    let response = `✨ *TUS HABILIDADES*\n`;
    response += `━━━━━━━━━━━━━━━━━━━━━\n`;
    response += `🎭 Clase: ${classInfo.emoji} ${classInfo.name}\n\n`;

    for (const skillId of classInfo.skills) {
      const skill = SKILLS[skillId];
      if (skill) {
        response += `${skill.emoji} *${skill.name}*\n`;
        response += `   📖 _${skill.description}_\n`;
        response += `   💠 Costo Maná: *${skill.manaCost}*\n`;
        response += `   ⚡ Costo Energía: *${skill.staminaCost}*\n`;
        response += `   ⏱️ Cooldown: *${skill.cooldown}* turnos\n`;

        if (skill.effect.damageMultiplier) {
          response += `   💥 Daño: *${Math.floor(skill.effect.damageMultiplier * 100)}%*\n`;
        }
        if (skill.effect.heal) {
          response += `   💚 Cura: *${skill.effect.heal}%* del daño\n`;
        }
        if (skill.effect.buff) {
          response += `   ⬆️ Buff: +${skill.effect.buff.value}% ${skill.effect.buff.stat}\n`;
        }
        if (skill.effect.debuff) {
          response += `   ⬇️ Debuff: -${skill.effect.debuff.value}% ${skill.effect.debuff.stat} al enemigo\n`;
        }

        response += '\n';
      }
    }

    response += `━━━━━━━━━━━━━━━━━━━━━\n`;
    response += `💡 Las habilidades se activan automáticamente\n`;
    response += `   en combate cuando tienes suficientes recursos.`;

    await m.reply(response);
  }
};

export default clasePlugin;
