import type { MessageHandler } from '../handler.js';
import type { PluginHandler, MessageContext } from '../types/message.js';
import { getDatabase } from '../lib/database.js';
import { EMOJI, formatNumber, msToTime } from '../lib/utils.js';
import { ITEMS, RARITY_COLORS, FORGE_MATERIALS, type ForgeMaterial, type Item, type ItemType } from '../types/rpg.js';
import type { ActiveBuff, UserRPG } from '../types/user.js';
import { calculateTotalStats } from '../lib/rpg-utils.js';
import { ITEM_TYPE_ALIASES, ITEM_TYPE_EMOJI, ITEM_TYPE_NAMES, SLOT_ALIASES, LIMITS } from '../constants/rpg.js';
import {
  EQUIPMENT_SLOTS, countItem, findEquippedEntry, formatAmbiguous, inventoryItems, inventorySize, isEquipable,
  migrateLegacyMaterials, removeItem, resolveItem, listMaterials, type ResolveResult
} from '../lib/rpg-inventory.js';
import { activeBuffs } from '../lib/rpg-combat.js';
import { isSpecialItem, useSpecialItem } from './rpg-items-especiales.js';

/**
 * Resuelve un item a partir de un texto que puede llevar palabras extra al final
 * (cantidad, "all", el nuevo nombre...). Prueba el texto completo y va quitando
 * palabras por el final; devuelve lo que sobró como `rest`.
 */
export function resolveItemWithRest(text: string, candidates: readonly Item[]): { result: ResolveResult<Item>; rest: string } {
  const words = text.trim().split(/\s+/).filter(Boolean);
  for (let end = words.length; end >= 1; end--) {
    const result = resolveItem(words.slice(0, end).join(' '), candidates);
    if (result.status !== 'none') return { result, rest: words.slice(end).join(' ') };
  }
  return { result: { status: 'none' }, rest: '' };
}

function typeFilter(text: string): ItemType | null {
  return ITEM_TYPE_ALIASES[text.toLowerCase().trim()] ?? null;
}

function formatBuffs(buffs: ActiveBuff[], now: number): string {
  if (buffs.length === 0) return '';
  const labels: Record<string, string> = { expBoost: '✨ XP', attackBoost: '⚔️ Ataque', defenseBoost: '🛡️ Defensa', forgeBoost: '⚒️ Forja', dropLuck: '🍀 Suerte' };
  let text = `✨ *Buffs activos:*\n`;
  for (const buff of buffs) {
    const label = labels[buff.type] ?? buff.type;
    const value = buff.type === 'expBoost' ? `x${Number(buff.value.toFixed(2))}` : `+${buff.value}%`;
    const time = buff.expiresAt === Number.MAX_SAFE_INTEGER ? 'permanente' : msToTime(buff.expiresAt - now);
    text += `   ${label} ${value} (${time})\n`;
  }
  return text + '\n';
}

const inventarioPlugin: PluginHandler = {
  command: ['inventario', 'inv', 'items', 'mochila', 'bag'],
  tags: ['rpg'],
  help: [
    'inventario - Ver tu inventario completo',
    'inventario armas - Ver solo armas',
    'inventario consumibles - Ver solo consumibles',
    'inventario materiales - Ver tus materiales de forja'
  ],
  register: true,

  handler: async (ctx: MessageContext) => {
    const { m, text, usedPrefix } = ctx;
    const db = getDatabase();
    const user = db.getUser(m.sender);
    if (migrateLegacyMaterials(user)) db.updateUser(m.sender, { inventory: user.inventory, forgeMaterials: user.forgeMaterials });

    const filter = typeFilter(text);

    if (filter === 'material') {
      const materials = listMaterials(user);
      if (materials.length === 0) {
        await m.reply(`${EMOJI.info} No tienes materiales de forja.\n\n💡 Consíguelos con *${usedPrefix}minar*, como drops o en *${usedPrefix}tienda materiales*.`);
        return;
      }
      let response = `📦 *MATERIALES DE FORJA*\n━━━━━━━━━━━━━━━━━━━━━\n\n`;
      for (const { material, quantity } of materials) {
        response += `   ${RARITY_COLORS[material.rarity]} ${material.emoji} ${material.name} x${quantity}\n`;
      }
      response += `\n💡 *${usedPrefix}forja recetas* para usarlos | *${usedPrefix}forja vender [material] [n]*`;
      await m.reply(response);
      return;
    }

    if (user.inventory.length === 0) {
      await m.reply(
        `${EMOJI.info} Tu inventario está vacío.\n\n` +
        `💡 Consigue items derrotando monstruos, completando dungeons o comprando en la tienda.`
      );
      return;
    }

    const equippedEntries = new Set(EQUIPMENT_SLOTS.map(slot => findEquippedEntry(user, slot)).filter(Boolean));
    const grouped: Record<ItemType, string[]> = { weapon: [], armor: [], accessory: [], consumable: [], material: [] };
    for (const entry of user.inventory) {
      const item = ITEMS[entry.itemId];
      if (!item || (filter && item.type !== filter)) continue;
      const level = entry.enhanceLevel ? ` +${entry.enhanceLevel}` : '';
      const qty = item.type === 'consumable' || entry.quantity > 1 ? ` x${entry.quantity}` : '';
      const equipped = equippedEntries.has(entry) ? ' ✓' : '';
      grouped[item.type].push(`   ${RARITY_COLORS[item.rarity]} ${item.emoji} ${item.name}${level}${qty}${equipped}`);
    }

    const now = Date.now();
    let response = `🎒 *INVENTARIO*${filter ? ` (${ITEM_TYPE_NAMES[filter]})` : ''}\n`;
    response += `━━━━━━━━━━━━━━━━━━━━━\n`;
    response += `📦 Ocupado: *${inventorySize(user)}/${LIMITS.MAX_INVENTORY_SIZE}*\n\n`;

    if (!filter) {
      const slotName = (id: string | null, empty: string) => (id ? ITEMS[id]?.name ?? 'Desconocido' : `_${empty}_`);
      response += `📌 *Equipado:*\n`;
      response += `   ⚔️ Arma: ${slotName(user.equipment.weapon, 'Ninguna')}\n`;
      response += `   🛡️ Armadura: ${slotName(user.equipment.armor, 'Ninguna')}\n`;
      response += `   💍 Accesorio: ${slotName(user.equipment.accessory, 'Ninguno')}\n\n`;
      response += formatBuffs(activeBuffs(user, now), now);
    }

    const order: ItemType[] = ['weapon', 'armor', 'accessory', 'consumable'];
    let shown = 0;
    for (const type of order) {
      if (grouped[type].length === 0) continue;
      shown += grouped[type].length;
      response += `${ITEM_TYPE_EMOJI[type]} *${ITEM_TYPE_NAMES[type]}:*\n${grouped[type].join('\n')}\n\n`;
    }
    if (shown === 0) {
      response += `_No tienes items de ese tipo._\n\n`;
    }

    const materialCount = listMaterials(user).reduce((sum, m) => sum + m.quantity, 0);
    if (!filter && materialCount > 0) {
      response += `📦 *Materiales:* ${materialCount} (ver con *${usedPrefix}inventario materiales*)\n\n`;
    }

    response += `━━━━━━━━━━━━━━━━━━━━━\n`;
    response += `💡 *${usedPrefix}equipar [item]* | *${usedPrefix}usar [item]* | *${usedPrefix}iteminfo [item]*`;

    await m.reply(response);
  }
};

const equiparPlugin: PluginHandler = {
  command: ['equipar', 'equip', 'poner', 'wear'],
  tags: ['rpg'],
  help: [
    'equipar [nombre o id del item] - Equipa un item de tu inventario',
    'Solo puedes equipar armas, armaduras y accesorios'
  ],
  register: true,

  handler: async (ctx: MessageContext) => {
    const { m, text, usedPrefix } = ctx;
    const db = getDatabase();
    const user = db.getUser(m.sender);

    if (!text.trim()) {
      await m.reply(`${EMOJI.error} Especifica qué item quieres equipar.\n\n📝 *Uso:* ${usedPrefix}equipar espada de hierro`);
      return;
    }

    const result = resolveItem(text, inventoryItems(user));
    if (result.status === 'none') {
      await m.reply(`${EMOJI.error} No tienes ese item en tu inventario.\n\n💡 Usa *${usedPrefix}inventario* para ver tus items.`);
      return;
    }
    if (result.status === 'ambiguous') {
      await m.reply(formatAmbiguous(result.candidates));
      return;
    }
    const item = result.item;

    if (!isEquipable(item)) {
      await m.reply(`${EMOJI.error} *${item.name}* no se puede equipar.\n\n💡 Solo puedes equipar armas, armaduras y accesorios.`);
      return;
    }
    if (item.requiredLevel && user.level < item.requiredLevel) {
      await m.reply(`${EMOJI.error} Necesitas nivel *${item.requiredLevel}* para equipar esto.\n\n📊 Tu nivel actual: *${user.level}*`);
      return;
    }
    if (item.requiredClass && item.requiredClass.length > 0 && (!user.playerClass || !item.requiredClass.includes(user.playerClass))) {
      await m.reply(`${EMOJI.error} Este item requiere ser *${item.requiredClass.join(' o ')}*.\n\n🎭 Tu clase: *${user.playerClass || 'Sin clase'}*`);
      return;
    }

    const slot = item.type as 'weapon' | 'armor' | 'accessory';
    const previous = user.equipment[slot];
    if (previous === item.id) {
      await m.reply(`${EMOJI.info} Ya tienes equipado *${item.name}*.`);
      return;
    }
    user.equipment[slot] = item.id;
    db.updateUser(m.sender, { equipment: user.equipment });

    const stats = calculateTotalStats(user);
    let response = `${EMOJI.success} ¡Equipaste *${item.name}*!\n\n`;
    if (previous && ITEMS[previous]) {
      response += `🔄 Reemplazaste: ${ITEMS[previous].emoji} ${ITEMS[previous].name}\n\n`;
    }
    response += `📈 *Stats con equipamiento:*\n`;
    response += `   ⚔️ Ataque: *${stats.attack}*\n`;
    response += `   🛡️ Defensa: *${stats.defense}*\n`;
    response += `   ❤️ Vida máx: *${stats.maxHealth}*\n`;
    response += `   💠 Maná máx: *${stats.maxMana}*\n`;
    response += `   🎯 Crítico: *${stats.critChance}%*`;

    await m.reply(response);
    await m.react('✅');
  }
};

const desequiparPlugin: PluginHandler = {
  command: ['desequipar', 'unequip'],
  tags: ['rpg'],
  help: [
    'desequipar arma - Quita el arma equipada',
    'desequipar armadura - Quita la armadura',
    'desequipar accesorio - Quita el accesorio'
  ],
  register: true,

  handler: async (ctx: MessageContext) => {
    const { m, text, usedPrefix } = ctx;
    const db = getDatabase();
    const user = db.getUser(m.sender);

    const slot = SLOT_ALIASES[text.toLowerCase().trim()];
    if (!slot) {
      await m.reply(
        `${EMOJI.error} Especifica qué quieres desequipar.\n\n` +
        `📝 *Uso:*\n   ${usedPrefix}desequipar arma\n   ${usedPrefix}desequipar armadura\n   ${usedPrefix}desequipar accesorio`
      );
      return;
    }

    const current = user.equipment[slot];
    if (!current) {
      await m.reply(`${EMOJI.warning} No tienes nada equipado en ese slot.`);
      return;
    }

    user.equipment[slot] = null;
    const stats = calculateTotalStats(user);
    db.updateUser(m.sender, {
      equipment: user.equipment,
      health: Math.min(user.health, stats.maxHealth),
      mana: Math.min(user.mana, stats.maxMana),
      stamina: Math.min(user.stamina, stats.maxStamina)
    });

    await m.reply(`${EMOJI.success} Desequipaste *${ITEMS[current]?.name || 'item desconocido'}*.\n\n💡 El item sigue en tu inventario.`);
    await m.react('✅');
  }
};

/** Lo que sobra tras el nombre del item: nada, "all" o una cantidad; null si no se entiende */
function parseQuantity(rest: string): { quantity: number; useAll: boolean } | null {
  const word = rest.trim().toLowerCase();
  if (!word) return { quantity: 1, useAll: false };
  if (['all', 'todo', 'todas', 'todos'].includes(word)) return { quantity: 1, useAll: true };
  if (/^\d+$/.test(word) && parseInt(word, 10) > 0) return { quantity: parseInt(word, 10), useAll: false };
  return null;
}

const usarPlugin: PluginHandler = {
  command: ['usar', 'use', 'consumir', 'beber', 'drink'],
  tags: ['rpg'],
  help: [
    'usar [item] - Usa un item consumible',
    'usar [item] all - Usa todas las pociones de ese tipo',
    'usar [item] [cantidad] - Usa una cantidad específica',
    'usar ticket muteo @usuario - Items especiales de la tienda de diamantes'
  ],
  register: true,

  handler: async (ctx: MessageContext) => {
    const { m, text, usedPrefix } = ctx;
    const db = getDatabase();
    const user = db.getUser(m.sender);

    if (!text.trim()) {
      await m.reply(
        `${EMOJI.error} Especifica qué item quieres usar.\n\n` +
        `📝 *Uso:* ${usedPrefix}usar pocion de salud\n` +
        `📝 *Uso:* ${usedPrefix}usar pocion all (usa todas)\n` +
        `📝 *Uso:* ${usedPrefix}usar pocion 5 (usa 5)`
      );
      return;
    }

    const consumables = inventoryItems(user).filter(i => i.type === 'consumable');
    // Las menciones llegan como @numero en el texto y no forman parte del nombre.
    // El item se resuelve primero: "cambio nombre Dark 99" lleva el 99 en el nombre, no es una cantidad.
    const cleanTerm = text.replace(/@\S+/g, ' ').trim();
    const { result, rest } = resolveItemWithRest(cleanTerm, consumables);

    if (result.status === 'none') {
      await m.reply(`${EMOJI.error} No tienes ese consumible en tu inventario.\n\n💡 Usa *${usedPrefix}inventario consumibles* para ver tus pociones.`);
      return;
    }
    if (result.status === 'ambiguous') {
      await m.reply(formatAmbiguous(result.candidates));
      return;
    }
    const item = result.item;

    if (isSpecialItem(item.id)) {
      const outcome = await useSpecialItem(ctx, db, user, item, rest);
      await m.reply(outcome.message);
      if (outcome.consumed) await m.react('✨');
      return;
    }

    const effect = item.consumeEffect;
    if (!effect || Object.keys(effect).length === 0) {
      await m.reply(`${EMOJI.error} *${item.name}* todavía no tiene efecto. No se consumió.`);
      return;
    }

    const parsed = parseQuantity(rest);
    if (!parsed) {
      await m.reply(`${EMOJI.error} No entiendo "${rest}".\n\n📝 *Uso:* ${usedPrefix}usar ${item.name.toLowerCase()} [cantidad|all]`);
      return;
    }

    const available = countItem(user, item.id);
    const stats = calculateTotalStats(user);
    const now = Date.now();
    const isBuff = Boolean(effect.duration && (effect.expBoost || effect.forgeBoost));
    let toUse = parsed.useAll ? available : Math.min(parsed.quantity, available);

    if (!isBuff) {
      const deficit = {
        health: effect.health ? stats.maxHealth - user.health : 0,
        mana: effect.mana ? stats.maxMana - user.mana : 0,
        stamina: effect.stamina ? stats.maxStamina - user.stamina : 0
      };
      if (deficit.health <= 0 && deficit.mana <= 0 && deficit.stamina <= 0) {
        await m.reply(
          `${EMOJI.error} ¡Tus estadísticas ya están al máximo!\n\n` +
          `❤️ Salud: *${user.health}/${stats.maxHealth}*\n` +
          `💠 Maná: *${user.mana}/${stats.maxMana}*\n` +
          `⚡ Energía: *${user.stamina}/${stats.maxStamina}*\n\n` +
          `💡 No necesitas usar *${item.name}* ahora.`
        );
        return;
      }
      if (parsed.useAll) {
        let needed = 0;
        if (effect.health && deficit.health > 0) needed = Math.max(needed, Math.ceil(deficit.health / effect.health));
        if (effect.mana && deficit.mana > 0) needed = Math.max(needed, Math.ceil(deficit.mana / effect.mana));
        if (effect.stamina && deficit.stamina > 0) needed = Math.max(needed, Math.ceil(deficit.stamina / effect.stamina));
        toUse = Math.min(needed, available);
      }
    } else {
      toUse = 1;
    }

    if (toUse <= 0) {
      await m.reply(`${EMOJI.error} No hay nada que restaurar.`);
      return;
    }

    const updates: Partial<UserRPG> = {};
    let effectMsg = '';

    if (effect.health) {
      const newHealth = Math.min(stats.maxHealth, user.health + effect.health * toUse);
      if (newHealth > user.health) effectMsg += `❤️ +${newHealth - user.health} Salud (${newHealth}/${stats.maxHealth})\n`;
      updates.health = newHealth;
    }
    if (effect.mana) {
      const newMana = Math.min(stats.maxMana, user.mana + effect.mana * toUse);
      if (newMana > user.mana) effectMsg += `💠 +${newMana - user.mana} Maná (${newMana}/${stats.maxMana})\n`;
      updates.mana = newMana;
    }
    if (effect.stamina) {
      const newStamina = Math.min(stats.maxStamina, user.stamina + effect.stamina * toUse);
      if (newStamina > user.stamina) effectMsg += `⚡ +${newStamina - user.stamina} Energía (${newStamina}/${stats.maxStamina})\n`;
      updates.stamina = newStamina;
    }
    if (isBuff && effect.duration) {
      const type: ActiveBuff['type'] = effect.expBoost ? 'expBoost' : 'forgeBoost';
      const value = effect.expBoost ?? effect.forgeBoost ?? 0;
      const buffs = activeBuffs(user, now).filter(b => !(b.type === type && b.expiresAt !== Number.MAX_SAFE_INTEGER));
      buffs.push({ type, value, expiresAt: now + effect.duration });
      updates.activeBuffs = buffs;
      effectMsg += type === 'expBoost'
        ? `✨ XP x${value} durante ${msToTime(effect.duration)}\n`
        : `⚒️ +${value}% de éxito en la forja durante ${msToTime(effect.duration)}\n`;
    }

    removeItem(user, item.id, toUse);
    updates.inventory = user.inventory;
    db.updateUser(m.sender, updates);

    let response = `${EMOJI.success} Usaste *${item.emoji} ${item.name}*${toUse > 1 ? ` x${toUse}` : ''}\n\n`;
    response += `✨ *Efectos:*\n${effectMsg}`;
    const remaining = countItem(user, item.id);
    response += remaining > 0 ? `\n📦 Restantes: *${remaining}*` : `\n📦 _No te quedan más de este item_`;

    await m.reply(response);
    await m.react('✨');
  }
};

interface InfoCandidate {
  id: string;
  name: string;
  emoji: string;
  item?: Item;
  material?: ForgeMaterial;
}

const itemInfoPlugin: PluginHandler = {
  command: ['iteminfo', 'veritem'],
  tags: ['rpg'],
  help: ['iteminfo [nombre o id] - Ver información detallada de un item o material'],
  register: true,

  handler: async (ctx: MessageContext) => {
    const { m, text, usedPrefix } = ctx;

    if (!text.trim()) {
      await m.reply(`${EMOJI.error} Especifica el nombre del item.\n\n📝 *Uso:* ${usedPrefix}iteminfo espada de hierro`);
      return;
    }

    // Items y materiales en una sola lista: "hierro" u "oro" son materiales, no espada_hierro ni cofre_oro
    const candidates: InfoCandidate[] = [
      ...Object.values(ITEMS).map((item): InfoCandidate => ({ id: item.id, name: item.name, emoji: item.emoji, item })),
      ...Object.values(FORGE_MATERIALS).map((material): InfoCandidate => ({ id: material.id, name: material.name, emoji: material.emoji, material }))
    ];
    const result = resolveItem(text, candidates);
    if (result.status === 'ambiguous') {
      await m.reply(formatAmbiguous(result.candidates));
      return;
    }
    if (result.status === 'none') {
      await m.reply(`${EMOJI.error} No encontré ningún item con ese nombre.`);
      return;
    }
    if (result.item.material) {
      const mat = result.item.material;
      await m.reply(
        `${mat.emoji} *${mat.name}* (material de forja)\n━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `📖 ${mat.description}\n\n` +
        `   ${RARITY_COLORS[mat.rarity]} Rareza: ${mat.rarity}\n` +
        `   💵 Venta: ${formatNumber(mat.sellPrice)} monedas\n` +
        (mat.price ? `   💰 Precio en tienda: ${formatNumber(mat.price)} monedas\n` : '') +
        `\n💡 Se usa en *${usedPrefix}forja* (id: \`${mat.id}\`)`
      );
      return;
    }

    const item = result.item.item as Item;
    let response = `${item.emoji} *${item.name}*\n━━━━━━━━━━━━━━━━━━━━━\n\n`;
    response += `📖 ${item.description}\n\n`;
    response += `📋 *Información:*\n`;
    response += `   🆔 Id: \`${item.id}\`\n`;
    response += `   ${RARITY_COLORS[item.rarity]} Rareza: ${item.rarity.charAt(0).toUpperCase() + item.rarity.slice(1)}\n`;
    response += `   ${ITEM_TYPE_EMOJI[item.type]} Tipo: ${ITEM_TYPE_NAMES[item.type]}\n`;
    if (item.price > 0) response += `   💰 Precio: ${formatNumber(item.price)} monedas\n`;
    response += `   💵 Venta: ${formatNumber(item.sellPrice)} monedas\n`;
    if (item.requiredLevel) response += `   📊 Nivel requerido: ${item.requiredLevel}\n`;
    if (item.requiredClass?.length) response += `   🎭 Clase: ${item.requiredClass.join(', ')}\n`;

    if (item.stats) {
      response += `\n⚔️ *Estadísticas:*\n`;
      if (item.stats.attack) response += `   Ataque: +${item.stats.attack}\n`;
      if (item.stats.defense) response += `   Defensa: +${item.stats.defense}\n`;
      if (item.stats.health) response += `   Vida: +${item.stats.health}\n`;
      if (item.stats.mana) response += `   Maná: +${item.stats.mana}\n`;
      if (item.stats.stamina) response += `   Energía: +${item.stats.stamina}\n`;
      if (item.stats.critChance) response += `   Crítico: +${item.stats.critChance}%\n`;
    }

    const e = item.consumeEffect;
    if (e && Object.keys(e).length > 0) {
      response += `\n✨ *Efecto al usar:*\n`;
      if (e.health) response += `   ❤️ Restaura ${e.health} salud\n`;
      if (e.mana) response += `   💠 Restaura ${e.mana} maná\n`;
      if (e.stamina) response += `   ⚡ Restaura ${e.stamina} energía\n`;
      if (e.expBoost) response += `   ✨ XP x${e.expBoost} durante ${msToTime(e.duration || 0)}\n`;
      if (e.forgeBoost) response += `   ⚒️ +${e.forgeBoost}% éxito en forja durante ${msToTime(e.duration || 0)}\n`;
    } else if (isSpecialItem(item.id)) {
      response += `\n✨ *Item especial:* se activa con *${usedPrefix}usar ${item.name.toLowerCase()}*\n`;
    }

    await m.reply(response);
  }
};

export const inventoryPlugins: [string, PluginHandler][] = [
  ['rpg-inventario', inventarioPlugin],
  ['rpg-equipar', equiparPlugin],
  ['rpg-desequipar', desequiparPlugin],
  ['rpg-usar', usarPlugin],
  ['rpg-iteminfo', itemInfoPlugin]
];

export function registerInventoryPlugins(handler: MessageHandler): void {
  for (const [name, plugin] of inventoryPlugins) handler.registerPlugin(name, plugin);
}
