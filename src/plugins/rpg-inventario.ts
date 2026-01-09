/**
 * 🎒 Plugin de Inventario - RPG
 * Comandos: inventario, equipar, desequipar, usar
 */

import type { MessageHandler } from '../handler.js';
import type { PluginHandler, MessageContext } from '../types/message.js';
import { getDatabase } from '../lib/database.js';
import { EMOJI, formatNumber, matchesIgnoreAccents } from '../lib/utils.js';
import { ITEMS, RARITY_COLORS, CLASSES, type Item, type ItemType } from '../types/rpg.js';
import { calculateTotalStats, type UserRPG } from '../types/user.js';

/**
 * Obtiene el emoji de tipo de item
 */
function getTypeEmoji(type: ItemType): string {
  const emojis: Record<ItemType, string> = {
    weapon: '⚔️',
    armor: '🛡️',
    accessory: '💍',
    consumable: '🧪',
    material: '📦'
  };
  return emojis[type];
}

/**
 * Calcula los stats máximos reales del jugador (incluyendo clase y equipamiento)
 */
function getRealMaxStats(user: UserRPG): { maxHealth: number; maxMana: number; maxStamina: number } {
  // Stats base
  let maxHealth = user.maxHealth;
  let maxMana = user.maxMana;
  let maxStamina = user.maxStamina;

  // Bonus de clase
  if (user.playerClass && CLASSES[user.playerClass]) {
    const classInfo = CLASSES[user.playerClass];
    maxHealth += classInfo.baseStats.healthBonus;
    maxMana += classInfo.baseStats.manaBonus;
    maxStamina += classInfo.baseStats.staminaBonus;
  }

  // Bonus de equipamiento
  const equipmentSlots = [user.equipment.weapon, user.equipment.armor, user.equipment.accessory];
  for (const itemId of equipmentSlots) {
    if (itemId && ITEMS[itemId]?.stats) {
      const stats = ITEMS[itemId].stats;
      if (stats.health) maxHealth += stats.health;
      if (stats.mana) maxMana += stats.mana;
      if (stats.stamina) maxStamina += stats.stamina;
    }
  }

  return { maxHealth, maxMana, maxStamina };
}

/**
 * Plugin: Inventario - Ver items
 */
const inventarioPlugin: PluginHandler = {
  command: ['inventario', 'inv', 'items', 'mochila', 'bag'],
  tags: ['rpg'],
  help: [
    'inventario - Ver tu inventario completo',
    'inventario armas - Ver solo armas',
    'inventario consumibles - Ver solo consumibles'
  ],
  register: true,

  handler: async (ctx: MessageContext) => {
    const { m, text } = ctx;
    const db = getDatabase();
    const user = db.getUser(m.sender);

    if (user.inventory.length === 0) {
      await m.reply(
        `${EMOJI.info} Tu inventario está vacío.\n\n` +
        `💡 Consigue items derrotando monstruos, completando dungeons o comprando en la tienda.`
      );
      return;
    }

    // Filtrar por tipo si se especifica
    const filter = text.toLowerCase().trim();
    let filteredItems = user.inventory;
    let filterName = 'completo';

    if (filter) {
      const typeMap: Record<string, ItemType> = {
        'armas': 'weapon',
        'arma': 'weapon',
        'weapon': 'weapon',
        'armadura': 'armor',
        'armaduras': 'armor',
        'armor': 'armor',
        'accesorios': 'accessory',
        'accesorio': 'accessory',
        'accessory': 'accessory',
        'consumibles': 'consumable',
        'consumible': 'consumable',
        'pociones': 'consumable',
        'consumable': 'consumable',
        'materiales': 'material',
        'material': 'material'
      };

      const targetType = typeMap[filter];
      if (targetType) {
        filteredItems = user.inventory.filter(inv => {
          const item = ITEMS[inv.itemId];
          return item && item.type === targetType;
        });
        filterName = filter;
      }
    }

    // Agrupar por tipo
    const grouped: Record<ItemType, { item: Item; quantity: number }[]> = {
      weapon: [],
      armor: [],
      accessory: [],
      consumable: [],
      material: []
    };

    for (const invItem of filteredItems) {
      const item = ITEMS[invItem.itemId];
      if (item) {
        grouped[item.type].push({ item, quantity: invItem.quantity });
      }
    }

    let response = `🎒 *INVENTARIO* ${filter ? `(${filterName})` : ''}\n`;
    response += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

    // Mostrar equipamiento actual
    response += `📌 *Equipado:*\n`;
    response += `   ⚔️ Arma: ${user.equipment.weapon ? ITEMS[user.equipment.weapon]?.name || 'Desconocido' : '_Ninguna_'}\n`;
    response += `   🛡️ Armadura: ${user.equipment.armor ? ITEMS[user.equipment.armor]?.name || 'Desconocido' : '_Ninguna_'}\n`;
    response += `   💍 Accesorio: ${user.equipment.accessory ? ITEMS[user.equipment.accessory]?.name || 'Desconocido' : '_Ninguno_'}\n\n`;

    // Mostrar items por tipo
    const typeOrder: ItemType[] = ['weapon', 'armor', 'accessory', 'consumable', 'material'];
    const typeNames: Record<ItemType, string> = {
      weapon: 'Armas',
      armor: 'Armaduras',
      accessory: 'Accesorios',
      consumable: 'Consumibles',
      material: 'Materiales'
    };

    for (const type of typeOrder) {
      if (grouped[type].length > 0) {
        response += `${getTypeEmoji(type)} *${typeNames[type]}:*\n`;

        for (const { item, quantity } of grouped[type]) {
          const rarity = RARITY_COLORS[item.rarity];
          const equipped = (type === 'weapon' && user.equipment.weapon === item.id) ||
                          (type === 'armor' && user.equipment.armor === item.id) ||
                          (type === 'accessory' && user.equipment.accessory === item.id);

          response += `   ${rarity} ${item.emoji} ${item.name}`;
          if (quantity > 1) response += ` x${quantity}`;
          if (equipped) response += ` ✓`;
          response += '\n';
        }
        response += '\n';
      }
    }

    response += `━━━━━━━━━━━━━━━━━━━━━\n`;
    response += `💡 Usa */equipar [item]* para equiparte\n`;
    response += `💡 Usa */usar [item]* para consumibles`;

    await m.reply(response);
  }
};

/**
 * Plugin: Equipar - Equipar un item
 */
const equiparPlugin: PluginHandler = {
  command: ['equipar', 'equip', 'poner', 'wear'],
  tags: ['rpg'],
  help: [
    'equipar [nombre del item] - Equipa un item de tu inventario',
    'Solo puedes equipar armas, armaduras y accesorios'
  ],
  register: true,

  handler: async (ctx: MessageContext) => {
    const { m, text } = ctx;
    const db = getDatabase();
    const user = db.getUser(m.sender);

    if (!text.trim()) {
      await m.reply(
        `${EMOJI.error} Especifica qué item quieres equipar.\n\n` +
        `📝 *Uso:* /equipar espada de hierro`
      );
      return;
    }

    const searchTerm = text.toLowerCase().trim();

    // Buscar item en inventario (sin importar tildes)
    let foundItem: Item | null = null;
    let foundInvIndex = -1;

    for (let i = 0; i < user.inventory.length; i++) {
      const invItem = user.inventory[i];
      const item = ITEMS[invItem.itemId];
      if (item && matchesIgnoreAccents(item.name, searchTerm)) {
        foundItem = item;
        foundInvIndex = i;
        break;
      }
    }

    if (!foundItem || foundInvIndex === -1) {
      await m.reply(
        `${EMOJI.error} No tienes ese item en tu inventario.\n\n` +
        `💡 Usa */inventario* para ver tus items.`
      );
      return;
    }

    // Verificar que sea equipable
    if (!['weapon', 'armor', 'accessory'].includes(foundItem.type)) {
      await m.reply(
        `${EMOJI.error} *${foundItem.name}* no se puede equipar.\n\n` +
        `💡 Solo puedes equipar armas, armaduras y accesorios.`
      );
      return;
    }

    // Verificar nivel requerido
    if (foundItem.requiredLevel && user.level < foundItem.requiredLevel) {
      await m.reply(
        `${EMOJI.error} Necesitas nivel *${foundItem.requiredLevel}* para equipar esto.\n\n` +
        `📊 Tu nivel actual: *${user.level}*`
      );
      return;
    }

    // Verificar clase requerida
    if (foundItem.requiredClass && foundItem.requiredClass.length > 0) {
      if (!user.playerClass || !foundItem.requiredClass.includes(user.playerClass)) {
        await m.reply(
          `${EMOJI.error} Este item requiere ser *${foundItem.requiredClass.join(' o ')}*.\n\n` +
          `🎭 Tu clase: *${user.playerClass || 'Sin clase'}*`
        );
        return;
      }
    }

    // Equipar el item
    const slot = foundItem.type as 'weapon' | 'armor' | 'accessory';
    const previousItem = user.equipment[slot];

    user.equipment[slot] = foundItem.id;
    db.updateUser(m.sender, { equipment: user.equipment });

    // Calcular nuevos stats
    const newStats = calculateTotalStats(user, ITEMS);

    let response = `${EMOJI.success} ¡Equipaste *${foundItem.name}*!\n\n`;

    if (previousItem) {
      const prevItemData = ITEMS[previousItem];
      if (prevItemData) {
        response += `🔄 Reemplazaste: ${prevItemData.emoji} ${prevItemData.name}\n\n`;
      }
    }

    response += `📈 *Stats con equipamiento:*\n`;
    response += `   ⚔️ Ataque: *${newStats.attack}*\n`;
    response += `   🛡️ Defensa: *${newStats.defense}*\n`;
    response += `   ❤️ Vida máx: *${newStats.maxHealth}*\n`;
    response += `   💠 Maná máx: *${newStats.maxMana}*\n`;
    response += `   🎯 Crítico: *${newStats.critChance}%*`;

    await m.reply(response);
    await m.react('✅');
  }
};

/**
 * Plugin: Desequipar - Quitar un item equipado
 */
const desequiparPlugin: PluginHandler = {
  command: ['desequipar', 'unequip', 'quitar', 'remove'],
  tags: ['rpg'],
  help: [
    'desequipar arma - Quita el arma equipada',
    'desequipar armadura - Quita la armadura',
    'desequipar accesorio - Quita el accesorio'
  ],
  register: true,

  handler: async (ctx: MessageContext) => {
    const { m, text } = ctx;
    const db = getDatabase();
    const user = db.getUser(m.sender);

    const slot = text.toLowerCase().trim();

    const slotMap: Record<string, 'weapon' | 'armor' | 'accessory'> = {
      'arma': 'weapon',
      'weapon': 'weapon',
      'armadura': 'armor',
      'armor': 'armor',
      'accesorio': 'accessory',
      'accessory': 'accessory'
    };

    const targetSlot = slotMap[slot];

    if (!targetSlot) {
      await m.reply(
        `${EMOJI.error} Especifica qué quieres desequipar.\n\n` +
        `📝 *Uso:*\n` +
        `   /desequipar arma\n` +
        `   /desequipar armadura\n` +
        `   /desequipar accesorio`
      );
      return;
    }

    const currentItem = user.equipment[targetSlot];

    if (!currentItem) {
      await m.reply(`${EMOJI.warning} No tienes nada equipado en ese slot.`);
      return;
    }

    const itemData = ITEMS[currentItem];
    user.equipment[targetSlot] = null;
    db.updateUser(m.sender, { equipment: user.equipment });

    await m.reply(
      `${EMOJI.success} Desequipaste *${itemData?.name || 'item desconocido'}*.\n\n` +
      `💡 El item sigue en tu inventario.`
    );
    await m.react('✅');
  }
};

/**
 * Plugin: Usar - Consumir un item
 */
const usarPlugin: PluginHandler = {
  command: ['usar', 'use', 'consumir', 'beber', 'drink'],
  tags: ['rpg'],
  help: [
    'usar [nombre del item] - Usa un item consumible',
    'Restaura salud, maná o energía'
  ],
  register: true,

  handler: async (ctx: MessageContext) => {
    const { m, text } = ctx;
    const db = getDatabase();
    const user = db.getUser(m.sender);

    if (!text.trim()) {
      await m.reply(
        `${EMOJI.error} Especifica qué item quieres usar.\n\n` +
        `📝 *Uso:* /usar pocion de salud`
      );
      return;
    }

    const searchTerm = text.toLowerCase().trim();

    // Buscar item en inventario (sin importar tildes)
    let foundItem: Item | null = null;
    let foundInvIndex = -1;

    for (let i = 0; i < user.inventory.length; i++) {
      const invItem = user.inventory[i];
      const item = ITEMS[invItem.itemId];
      if (item && matchesIgnoreAccents(item.name, searchTerm)) {
        foundItem = item;
        foundInvIndex = i;
        break;
      }
    }

    if (!foundItem || foundInvIndex === -1) {
      await m.reply(
        `${EMOJI.error} No tienes ese item en tu inventario.\n\n` +
        `💡 Usa */inventario consumibles* para ver tus pociones.`
      );
      return;
    }

    // Verificar que sea consumible
    if (foundItem.type !== 'consumable') {
      await m.reply(
        `${EMOJI.error} *${foundItem.name}* no se puede consumir.\n\n` +
        `💡 Solo puedes usar items consumibles como pociones.`
      );
      return;
    }

    const effect = foundItem.consumeEffect;
    if (!effect) {
      await m.reply(`${EMOJI.error} Este item no tiene efecto.`);
      return;
    }

    // Calcular stats máximos reales (incluyendo clase y equipamiento)
    const realMax = getRealMaxStats(user);

    // Verificar si el consumible tendría algún efecto útil
    const hasHealthEffect = effect.health && effect.health > 0;
    const hasManaEffect = effect.mana && effect.mana > 0;
    const hasStaminaEffect = effect.stamina && effect.stamina > 0;
    const hasExpBoost = effect.expBoost && effect.duration;

    const healthFull = user.health >= realMax.maxHealth;
    const manaFull = user.mana >= realMax.maxMana;
    const staminaFull = user.stamina >= realMax.maxStamina;

    // Si solo restaura stats y todas están al máximo, no consumir
    if (!hasExpBoost) {
      const onlyHealthEffect = hasHealthEffect && !hasManaEffect && !hasStaminaEffect;
      const onlyManaEffect = hasManaEffect && !hasHealthEffect && !hasStaminaEffect;
      const onlyStaminaEffect = hasStaminaEffect && !hasHealthEffect && !hasManaEffect;

      if (onlyHealthEffect && healthFull) {
        await m.reply(
          `${EMOJI.error} ¡Tu salud ya está al máximo!\n\n` +
          `❤️ Salud: *${user.health}/${realMax.maxHealth}*\n\n` +
          `💡 No necesitas usar *${foundItem.name}* ahora.`
        );
        return;
      }

      if (onlyManaEffect && manaFull) {
        await m.reply(
          `${EMOJI.error} ¡Tu maná ya está al máximo!\n\n` +
          `💠 Maná: *${user.mana}/${realMax.maxMana}*\n\n` +
          `💡 No necesitas usar *${foundItem.name}* ahora.`
        );
        return;
      }

      if (onlyStaminaEffect && staminaFull) {
        await m.reply(
          `${EMOJI.error} ¡Tu energía ya está al máximo!\n\n` +
          `⚡ Energía: *${user.stamina}/${realMax.maxStamina}*\n\n` +
          `💡 No necesitas usar *${foundItem.name}* ahora.`
        );
        return;
      }

      // Si restaura múltiples stats y todas están al máximo
      const allStatsFull =
        (!hasHealthEffect || healthFull) &&
        (!hasManaEffect || manaFull) &&
        (!hasStaminaEffect || staminaFull);

      if (allStatsFull && (hasHealthEffect || hasManaEffect || hasStaminaEffect)) {
        await m.reply(
          `${EMOJI.error} ¡Todas tus estadísticas ya están al máximo!\n\n` +
          `❤️ Salud: *${user.health}/${realMax.maxHealth}*\n` +
          `💠 Maná: *${user.mana}/${realMax.maxMana}*\n` +
          `⚡ Energía: *${user.stamina}/${realMax.maxStamina}*\n\n` +
          `💡 No necesitas usar *${foundItem.name}* ahora.`
        );
        return;
      }
    }

    // Aplicar efectos
    const updates: Partial<typeof user> = {};
    let effectMsg = '';

    if (effect.health) {
      const newHealth = Math.min(realMax.maxHealth, user.health + effect.health);
      const healed = newHealth - user.health;
      updates.health = newHealth;
      effectMsg += `❤️ +${healed} Salud (${newHealth}/${realMax.maxHealth})\n`;
    }

    if (effect.mana) {
      const newMana = Math.min(realMax.maxMana, user.mana + effect.mana);
      const restored = newMana - user.mana;
      updates.mana = newMana;
      effectMsg += `💠 +${restored} Maná (${newMana}/${realMax.maxMana})\n`;
    }

    if (effect.stamina) {
      const newStamina = Math.min(realMax.maxStamina, user.stamina + effect.stamina);
      const restored = newStamina - user.stamina;
      updates.stamina = newStamina;
      effectMsg += `⚡ +${restored} Energía (${newStamina}/${realMax.maxStamina})\n`;
    }

    if (effect.expBoost && effect.duration) {
      // Agregar buff de experiencia
      const newBuff = {
        type: 'expBoost' as const,
        value: effect.expBoost,
        expiresAt: Date.now() + effect.duration
      };
      user.activeBuffs = user.activeBuffs.filter(b => b.type !== 'expBoost');
      user.activeBuffs.push(newBuff);
      updates.activeBuffs = user.activeBuffs;
      effectMsg += `✨ XP x${effect.expBoost} por ${effect.duration / 60000} minutos\n`;
    }

    // Reducir cantidad del item
    user.inventory[foundInvIndex].quantity--;
    if (user.inventory[foundInvIndex].quantity <= 0) {
      user.inventory.splice(foundInvIndex, 1);
    }
    updates.inventory = user.inventory;

    db.updateUser(m.sender, updates);

    let response = `${EMOJI.success} Usaste *${foundItem.emoji} ${foundItem.name}*\n\n`;
    response += `✨ *Efectos:*\n`;
    response += effectMsg;

    await m.reply(response);
    await m.react('✨');
  }
};

/**
 * Plugin: Detalles - Ver detalles de un item
 */
const itemInfoPlugin: PluginHandler = {
  command: ['iteminfo', 'veritem', 'item', 'info'],
  tags: ['rpg'],
  help: ['iteminfo [nombre] - Ver información detallada de un item'],
  register: true,

  handler: async (ctx: MessageContext) => {
    const { m, text } = ctx;

    if (!text.trim()) {
      await m.reply(
        `${EMOJI.error} Especifica el nombre del item.\n\n` +
        `📝 *Uso:* /iteminfo espada de hierro`
      );
      return;
    }

    const searchTerm = text.toLowerCase().trim();

    // Buscar item (sin importar tildes)
    let foundItem: Item | null = null;

    for (const item of Object.values(ITEMS)) {
      if (matchesIgnoreAccents(item.name, searchTerm)) {
        foundItem = item;
        break;
      }
    }

    if (!foundItem) {
      await m.reply(`${EMOJI.error} No encontré ningún item con ese nombre.`);
      return;
    }

    let response = `${foundItem.emoji} *${foundItem.name}*\n`;
    response += `━━━━━━━━━━━━━━━━━━━━━\n\n`;
    response += `📖 ${foundItem.description}\n\n`;

    response += `📋 *Información:*\n`;
    response += `   ${RARITY_COLORS[foundItem.rarity]} Rareza: ${foundItem.rarity.charAt(0).toUpperCase() + foundItem.rarity.slice(1)}\n`;
    response += `   ${getTypeEmoji(foundItem.type)} Tipo: ${foundItem.type}\n`;
    response += `   💰 Precio: ${formatNumber(foundItem.price)} monedas\n`;
    response += `   💵 Venta: ${formatNumber(foundItem.sellPrice)} monedas\n`;

    if (foundItem.requiredLevel) {
      response += `   📊 Nivel requerido: ${foundItem.requiredLevel}\n`;
    }

    if (foundItem.requiredClass && foundItem.requiredClass.length > 0) {
      response += `   🎭 Clase: ${foundItem.requiredClass.join(', ')}\n`;
    }

    if (foundItem.stats) {
      response += `\n⚔️ *Estadísticas:*\n`;
      if (foundItem.stats.attack) response += `   Ataque: +${foundItem.stats.attack}\n`;
      if (foundItem.stats.defense) response += `   Defensa: +${foundItem.stats.defense}\n`;
      if (foundItem.stats.health) response += `   Vida: +${foundItem.stats.health}\n`;
      if (foundItem.stats.mana) response += `   Maná: +${foundItem.stats.mana}\n`;
      if (foundItem.stats.stamina) response += `   Energía: +${foundItem.stats.stamina}\n`;
      if (foundItem.stats.critChance) response += `   Crítico: +${foundItem.stats.critChance}%\n`;
    }

    if (foundItem.consumeEffect) {
      response += `\n✨ *Efecto al usar:*\n`;
      const e = foundItem.consumeEffect;
      if (e.health) response += `   ❤️ Restaura ${e.health} salud\n`;
      if (e.mana) response += `   💠 Restaura ${e.mana} maná\n`;
      if (e.stamina) response += `   ⚡ Restaura ${e.stamina} energía\n`;
      if (e.expBoost) response += `   ✨ XP x${e.expBoost} por ${(e.duration || 0) / 60000} min\n`;
    }

    await m.reply(response);
  }
};

/**
 * Registra los plugins de inventario
 */
export function registerInventoryPlugins(handler: MessageHandler): void {
  handler.registerPlugin('inventario', inventarioPlugin);
  handler.registerPlugin('equipar', equiparPlugin);
  handler.registerPlugin('desequipar', desequiparPlugin);
  handler.registerPlugin('usar', usarPlugin);
  handler.registerPlugin('iteminfo', itemInfoPlugin);
}
