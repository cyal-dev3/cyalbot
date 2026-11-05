import type { PluginHandler, MessageContext } from '../types/message.js';
import { getDatabase } from '../lib/database.js';
import { EMOJI, formatNumber, normalizeText } from '../lib/utils.js';
import { CLASSES, SKILLS, type ClassInfo, type PlayerClass } from '../types/rpg.js';
import { CLASS } from '../constants/rpg.js';
import { calculateTotalStats } from '../lib/rpg-utils.js';
import { updateQuestProgress } from '../lib/quests.js';
import { usageError } from '../lib/rpg-actions.js';

const CLASS_IDS = Object.keys(CLASSES) as PlayerClass[];

const CLASS_ALIASES: Record<string, PlayerClass> = {
  guerrero: 'guerrero', warrior: 'guerrero',
  mago: 'mago', mage: 'mago', wizard: 'mago',
  ladron: 'ladron', thief: 'ladron', rogue: 'ladron',
  arquero: 'arquero', archer: 'arquero', ranger: 'arquero'
};

/** Resuelve "Ladrón", "ladron", "thief" o el número de la lista (1-4) */
export function resolveClass(input: string): PlayerClass | null {
  const text = normalizeText(input.trim());
  if (!text) return null;
  if (/^\d+$/.test(text)) {
    return CLASS_IDS[parseInt(text, 10) - 1] ?? null;
  }
  return CLASS_ALIASES[text] ?? null;
}

/** Lista de bonus de stats de una clase, una línea por stat distinto de cero */
export function formatClassStats(classInfo: ClassInfo, indent: string = '   '): string {
  const b = classInfo.baseStats;
  const lines: string[] = [];
  if (b.healthBonus) lines.push(`${indent}❤️ +${b.healthBonus} Vida`);
  if (b.manaBonus) lines.push(`${indent}💠 +${b.manaBonus} Maná`);
  if (b.staminaBonus) lines.push(`${indent}⚡ +${b.staminaBonus} Energía`);
  if (b.attackBonus) lines.push(`${indent}⚔️ +${b.attackBonus} Ataque`);
  if (b.defenseBonus) lines.push(`${indent}🛡️ +${b.defenseBonus} Defensa`);
  return lines.join('\n');
}

/** Habilidades de una clase; con `detailed` incluye descripción y costes */
export function formatClassSkills(classInfo: ClassInfo, detailed: boolean = false, indent: string = '   '): string {
  return classInfo.skills
    .map(id => SKILLS[id])
    .filter(Boolean)
    .map(skill => detailed
      ? `${indent}${skill.emoji} *${skill.name}*\n${indent}   _${skill.description}_\n${indent}   💠 Maná: ${skill.manaCost} | ⚡ Energía: ${skill.staminaCost}`
      : `${indent}${skill.emoji} ${skill.name}`)
    .join('\n');
}

function classListForErrors(): string {
  return CLASS_IDS.map((id, i) => `   ${i + 1}. ${CLASSES[id].emoji} ${CLASSES[id].name}`).join('\n');
}

/** Bonus de stats en una línea: `❤️ +50 · ⚔️ +5` */
function formatClassStatsInline(classInfo: ClassInfo): string {
  return formatClassStats(classInfo, '').split('\n').filter(Boolean).map(l => l.replace(/ (Vida|Maná|Energía|Ataque|Defensa)$/, '')).join(' · ');
}

export const clasesPlugin: PluginHandler = {
  command: ['clases', 'classes', 'verclases'],
  tags: ['rpg'],
  help: [
    'clases - Resumen de las clases disponibles',
    'clases <nombre o número> - Detalle de una clase (stats y habilidades)'
  ],
  usage: ['clases', 'clases <nombre o número>'],
  register: true,

  handler: async (ctx: MessageContext) => {
    const { m, text: query, usedPrefix } = ctx;
    const user = getDatabase().getUser(m.sender);

    // Detalle bajo demanda para no mandar 60 líneas de golpe
    if (query.trim()) {
      const selected = resolveClass(query);
      if (!selected) return usageError(ctx, clasesPlugin, `Clase no válida. Clases disponibles:\n${classListForErrors()}`);
      const info = CLASSES[selected];
      return m.reply(
        `${info.emoji} *${info.name}*${user.playerClass === selected ? ' ← Tu clase' : ''}\n━━━━━━━━━━━━━━━━━━━━━\n` +
        `📖 _${info.description}_\n\n` +
        `📊 *Bonus de stats:*\n${formatClassStats(info)}\n\n` +
        `✨ *Habilidades:*\n${formatClassSkills(info, true)}\n\n` +
        `📝 *${usedPrefix}clase ${selected}* para elegirla` +
        (user.playerClass && user.playerClass !== selected ? ` (cambiar cuesta *${formatNumber(CLASS.CHANGE_COST)}* monedas)` : '')
      );
    }

    let text = `🎭 *CLASES DISPONIBLES*\n━━━━━━━━━━━━━━━━━━━━━\n`;
    CLASS_IDS.forEach((classId, index) => {
      const info = CLASSES[classId];
      text += `${index + 1}. ${info.emoji} *${info.name}*${user.playerClass === classId ? ' ← Tu clase' : ''} — _${info.description}_\n`;
      text += `   ${formatClassStatsInline(info)}\n`;
      text += `   ✨ ${formatClassSkills(info, false, '').split('\n').join(' · ')}\n`;
    });

    text += `━━━━━━━━━━━━━━━━━━━━━\n`;
    text += `📝 *${usedPrefix}clases <n>* detalle · *${usedPrefix}clase <nombre o número>* elegir\n`;
    text += `📊 Nivel mínimo: *${CLASS.MIN_LEVEL}*`;
    if (user.playerClass) text += ` · 💰 cambiar cuesta *${formatNumber(CLASS.CHANGE_COST)}*`;

    await m.reply(text);
  }
};

export const clasePlugin: PluginHandler = {
  command: ['clase', 'class', 'elegirclase', 'selectclass'],
  tags: ['rpg'],
  help: [
    'clase - Ver tu clase actual y habilidades',
    'clase <guerrero|mago|ladron|arquero|1-4> - Elegir clase',
    `Cambiar de clase cuesta ${formatNumber(CLASS.CHANGE_COST)} monedas`
  ],
  usage: ['clase', 'clase <nombre o número>'],
  register: true,

  handler: async (ctx: MessageContext) => {
    const { m, text, usedPrefix } = ctx;
    const db = getDatabase();
    const user = db.getUser(m.sender);

    if (!text.trim()) {
      if (!user.playerClass) {
        return m.reply(
          `${EMOJI.info} Aún no has elegido una clase.\n\n` +
          `📝 Usa *${usedPrefix}clases* para ver las opciones y *${usedPrefix}clase <nombre>* para elegir.\n\n` +
          `📊 Nivel requerido: *${CLASS.MIN_LEVEL}* · Tu nivel: *${user.level}*`
        );
      }

      const info = CLASSES[user.playerClass];
      return m.reply(
        `${info.emoji} *Tu clase: ${info.name}*\n━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `📖 _${info.description}_\n\n` +
        `📊 *Tus bonus de clase:*\n${formatClassStats(info)}\n\n` +
        `✨ *Tus habilidades:*\n${formatClassSkills(info, true)}\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━\n💡 Las habilidades se usan automáticamente en combate.`
      );
    }

    const selected = resolveClass(text);
    if (!selected) {
      return usageError(ctx, clasePlugin, `Clase no válida. Clases disponibles:\n${classListForErrors()}`);
    }

    if (user.level < CLASS.MIN_LEVEL) {
      return m.reply(
        `${EMOJI.error} Necesitas nivel *${CLASS.MIN_LEVEL}* para elegir una clase.\n\n` +
        `📊 Tu nivel actual: *${user.level}*`
      );
    }

    if (user.playerClass === selected) {
      return m.reply(`${EMOJI.warning} ¡Ya eres ${CLASSES[selected].name}!`);
    }

    const previous = user.playerClass;
    let paid = 0;
    if (previous) {
      if (user.money < CLASS.CHANGE_COST) {
        return m.reply(
          `${EMOJI.error} Cambiar de clase cuesta *${formatNumber(CLASS.CHANGE_COST)}* monedas.\n\n` +
          `💰 Tu dinero: *${formatNumber(user.money)}*\n` +
          `❌ Te faltan: *${formatNumber(CLASS.CHANGE_COST - user.money)}*`
        );
      }
      paid = CLASS.CHANGE_COST;
    }

    // La clase solo se aplica en calculateTotalStats; aquí solo se recortan los stats actuales al nuevo máximo
    user.playerClass = selected;
    user.money -= paid;
    const total = calculateTotalStats(user);
    db.updateUser(m.sender, {
      playerClass: selected,
      money: user.money,
      health: Math.min(user.health, total.maxHealth),
      mana: Math.min(user.mana, total.maxMana),
      stamina: Math.min(user.stamina, total.maxStamina)
    });

    const questLines = paid > 0 ? updateQuestProgress(db, m.sender, 'spend', paid).lines : [];
    const info = CLASSES[selected];

    let response = `${info.emoji} *¡Ahora eres ${info.name}!*\n━━━━━━━━━━━━━━━━━━━━━\n\n`;
    if (previous) {
      response += `🔄 Cambiaste desde ${CLASSES[previous].emoji} ${CLASSES[previous].name}\n`;
      response += `💰 Pagaste: *${formatNumber(paid)}* monedas\n\n`;
    }
    response += `📊 *Stats totales:*\n`;
    response += `   ❤️ Vida: *${total.maxHealth}*\n`;
    response += `   💠 Maná: *${total.maxMana}*\n`;
    response += `   ⚡ Energía: *${total.maxStamina}*\n`;
    response += `   ⚔️ Ataque: *${total.attack}*\n`;
    response += `   🛡️ Defensa: *${total.defense}*\n\n`;
    response += `✨ *Habilidades desbloqueadas:*\n${formatClassSkills(info)}\n\n`;
    response += `💡 _Tus habilidades se activan automáticamente en combate._`;
    if (questLines.length) response += `\n\n${questLines.join('\n')}`;

    await m.reply(response);
    await m.react('✨');
  }
};

export const habilidadesPlugin: PluginHandler = {
  command: ['habilidades', 'skills', 'spells', 'poderes'],
  tags: ['rpg'],
  help: ['habilidades - Ver tus habilidades de clase (se usan automáticamente en combate)'],
  usage: ['habilidades'],
  register: true,

  handler: async (ctx: MessageContext) => {
    const { m, usedPrefix } = ctx;
    const user = getDatabase().getUser(m.sender);

    if (!user.playerClass) {
      return m.reply(
        `${EMOJI.info} No tienes habilidades porque no has elegido una clase.\n\n` +
        `📝 Usa *${usedPrefix}clases* para ver las opciones (nivel mínimo *${CLASS.MIN_LEVEL}*).`
      );
    }

    const info = CLASSES[user.playerClass];
    let text = `✨ *TUS HABILIDADES*\n━━━━━━━━━━━━━━━━━━━━━\n🎭 Clase: ${info.emoji} ${info.name}\n\n`;

    for (const skillId of info.skills) {
      const skill = SKILLS[skillId];
      if (!skill) continue;
      text += `${skill.emoji} *${skill.name}*\n`;
      text += `   📖 _${skill.description}_\n`;
      text += `   💠 Maná: *${skill.manaCost}* · ⚡ Energía: *${skill.staminaCost}* · ⏱️ ${skill.cooldown} turnos\n`;
      if (skill.effect.damageMultiplier) text += `   💥 Daño: *${Math.floor(skill.effect.damageMultiplier * 100)}%*\n`;
      if (skill.effect.heal) text += `   💚 Cura: *${skill.effect.heal}%* del daño\n`;
      if (skill.effect.buff) text += `   ⬆️ Buff: +${skill.effect.buff.value}% ${skill.effect.buff.stat}\n`;
      if (skill.effect.debuff) text += `   ⬇️ Debuff: -${skill.effect.debuff.value}% ${skill.effect.debuff.stat} al enemigo\n`;
      text += '\n';
    }

    text += `━━━━━━━━━━━━━━━━━━━━━\n💡 Se activan automáticamente en combate cuando tienes recursos suficientes.`;
    await m.reply(text);
  }
};

export default clasePlugin;
