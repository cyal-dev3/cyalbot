/**
 * 🏪 Plugin de Tienda - RPG
 * Comandos: tienda, comprar, vender
 */

import type { MessageHandler } from '../handler.js';
import type { PluginHandler, MessageContext } from '../types/message.js';
import { getDatabase } from '../lib/database.js';
import { EMOJI, formatNumber } from '../lib/utils.js';
import { ITEMS, RARITY_COLORS, type Item, type ItemType } from '../types/rpg.js';

/**
 * Items disponibles en la tienda (categorizados)
 */
const SHOP_ITEMS: Record<string, string[]> = {
  armas: ['espada_hierro', 'espada_acero', 'baston_aprendiz', 'daga_sombras', 'arco_cazador'],
  armaduras: ['armadura_cuero', 'armadura_hierro', 'tunica_mago'],
  accesorios: ['anillo_fuerza', 'amuleto_vida', 'collar_suerte'],
  consumibles: ['pocion_salud', 'pocion_salud_mayor', 'pocion_mana', 'pocion_energia', 'elixir_exp'],
  materiales: ['hierro', 'oro_material', 'cristal_mana']
};

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
 * Plugin: Tienda - Ver items disponibles
 */
const tiendaPlugin: PluginHandler = {
  command: ['tienda', 'shop', 'store', 'mercado'],
  tags: ['rpg'],
  help: [
    'tienda - Ver todos los items en venta',
    'tienda armas - Ver solo armas',
    'tienda consumibles - Ver pociones'
  ],
  register: true,

  handler: async (ctx: MessageContext) => {
    const { m, text } = ctx;
    const db = getDatabase();
    const user = db.getUser(m.sender);

    const category = text.toLowerCase().trim();

    let response = `🏪 *TIENDA*\n`;
    response += `━━━━━━━━━━━━━━━━━━━━━\n`;
    response += `💰 Tu dinero: *${formatNumber(user.money)}* monedas\n\n`;

    const categoryMap: Record<string, string> = {
      'armas': 'armas',
      'arma': 'armas',
      'weapons': 'armas',
      'armaduras': 'armaduras',
      'armadura': 'armaduras',
      'armor': 'armaduras',
      'accesorios': 'accesorios',
      'accesorio': 'accesorios',
      'accessory': 'accesorios',
      'consumibles': 'consumibles',
      'consumible': 'consumibles',
      'pociones': 'consumibles',
      'potions': 'consumibles',
      'materiales': 'materiales',
      'material': 'materiales'
    };

    const targetCategory = categoryMap[category];

    if (targetCategory) {
      // Mostrar solo una categoría
      const itemIds = SHOP_ITEMS[targetCategory];
      const categoryNames: Record<string, string> = {
        armas: '⚔️ Armas',
        armaduras: '🛡️ Armaduras',
        accesorios: '💍 Accesorios',
        consumibles: '🧪 Consumibles',
        materiales: '📦 Materiales'
      };

      response += `${categoryNames[targetCategory]}\n\n`;

      for (const itemId of itemIds) {
        const item = ITEMS[itemId];
        if (item) {
          const canBuy = user.money >= item.price;
          const rarity = RARITY_COLORS[item.rarity];
          response += `${rarity} ${item.emoji} *${item.name}*\n`;
          response += `   💰 ${formatNumber(item.price)} ${canBuy ? '✓' : '✗'}\n`;
          if (item.stats) {
            const stats: string[] = [];
            if (item.stats.attack) stats.push(`+${item.stats.attack} ATK`);
            if (item.stats.defense) stats.push(`+${item.stats.defense} DEF`);
            if (item.stats.health) stats.push(`+${item.stats.health} HP`);
            if (item.stats.mana) stats.push(`+${item.stats.mana} MP`);
            if (stats.length > 0) {
              response += `   📊 ${stats.join(', ')}\n`;
            }
          }
          if (item.requiredLevel) {
            response += `   📈 Nv.${item.requiredLevel} requerido\n`;
          }
          response += '\n';
        }
      }

    } else {
      // Mostrar todas las categorías con todos los items
      const categories = ['armas', 'armaduras', 'accesorios', 'consumibles', 'materiales'];
      const categoryEmojis: Record<string, string> = {
        armas: '⚔️',
        armaduras: '🛡️',
        accesorios: '💍',
        consumibles: '🧪',
        materiales: '📦'
      };

      for (const cat of categories) {
        response += `${categoryEmojis[cat]} *${cat.charAt(0).toUpperCase() + cat.slice(1)}:*\n`;

        const itemIds = SHOP_ITEMS[cat];
        for (const itemId of itemIds) {
          const item = ITEMS[itemId];
          if (item) {
            const rarity = RARITY_COLORS[item.rarity];
            const canBuy = user.money >= item.price ? '✓' : '✗';
            response += `   ${rarity} ${item.emoji} ${item.name} - ${formatNumber(item.price)}💰 ${canBuy}\n`;
          }
        }
        response += '\n';
      }
    }

    response += `━━━━━━━━━━━━━━━━━━━━━\n`;
    response += `📝 */comprar [item]* - Comprar\n`;
    response += `📝 */vender [item]* - Vender\n`;
    response += `📝 */tienda [categoría]* - Ver categoría`;

    await m.reply(response);
  }
};

/**
 * Plugin: Comprar - Comprar un item
 */
const comprarPlugin: PluginHandler = {
  command: ['comprar', 'buy', 'purchase'],
  tags: ['rpg'],
  help: [
    'comprar [item] - Compra un item de la tienda',
    'comprar [item] [cantidad] - Comprar varios'
  ],
  register: true,

  handler: async (ctx: MessageContext) => {
    const { m, text, args } = ctx;
    const db = getDatabase();
    const user = db.getUser(m.sender);

    if (!text.trim()) {
      await m.reply(
        `${EMOJI.error} Especifica qué quieres comprar.\n\n` +
        `📝 *Uso:* /comprar espada de hierro\n` +
        `📝 *Uso:* /comprar pocion de salud 5`
      );
      return;
    }

    // Parsear cantidad (último argumento si es número)
    let quantity = 1;
    let searchTerm = text.toLowerCase().trim();

    const lastArg = args[args.length - 1];
    if (/^\d+$/.test(lastArg)) {
      quantity = Math.min(99, Math.max(1, parseInt(lastArg)));
      searchTerm = args.slice(0, -1).join(' ').toLowerCase().trim();
    }

    // Buscar item en la tienda
    let foundItem: Item | null = null;

    for (const itemIds of Object.values(SHOP_ITEMS)) {
      for (const itemId of itemIds) {
        const item = ITEMS[itemId];
        if (item && item.name.toLowerCase().includes(searchTerm)) {
          foundItem = item;
          break;
        }
      }
      if (foundItem) break;
    }

    if (!foundItem) {
      await m.reply(
        `${EMOJI.error} Ese item no está en la tienda.\n\n` +
        `💡 Usa */tienda* para ver los items disponibles.`
      );
      return;
    }

    // Verificar nivel requerido
    if (foundItem.requiredLevel && user.level < foundItem.requiredLevel) {
      await m.reply(
        `${EMOJI.error} Necesitas nivel *${foundItem.requiredLevel}* para comprar esto.\n\n` +
        `📊 Tu nivel: *${user.level}*`
      );
      return;
    }

    // Calcular costo total
    const totalCost = foundItem.price * quantity;

    if (user.money < totalCost) {
      await m.reply(
        `${EMOJI.error} No tienes suficiente dinero.\n\n` +
        `💰 Costo: *${formatNumber(totalCost)}* monedas\n` +
        `💵 Tu dinero: *${formatNumber(user.money)}* monedas\n` +
        `❌ Te faltan: *${formatNumber(totalCost - user.money)}* monedas`
      );
      return;
    }

    // Realizar compra
    user.money -= totalCost;

    // Agregar al inventario
    const existingItem = user.inventory.find(i => i.itemId === foundItem!.id);
    if (existingItem) {
      existingItem.quantity += quantity;
    } else {
      user.inventory.push({ itemId: foundItem.id, quantity });
    }

    db.updateUser(m.sender, {
      money: user.money,
      inventory: user.inventory
    });

    let response = `${EMOJI.success} ¡Compra exitosa!\n\n`;
    response += `🛒 Compraste: ${foundItem.emoji} *${foundItem.name}*`;
    if (quantity > 1) response += ` x${quantity}`;
    response += `\n💰 Pagaste: *${formatNumber(totalCost)}* monedas\n`;
    response += `💵 Te quedan: *${formatNumber(user.money)}* monedas`;

    await m.reply(response);
    await m.react('✅');
  }
};

/**
 * Plugin: Vender - Vender un item
 */
const venderPlugin: PluginHandler = {
  command: ['vender', 'sell', 'vendedor'],
  tags: ['rpg'],
  help: [
    'vender [item] - Vende un item de tu inventario',
    'vender [item] [cantidad] - Vender varios',
    'vender todo [tipo] - Vender todos de un tipo'
  ],
  register: true,

  handler: async (ctx: MessageContext) => {
    const { m, text, args } = ctx;
    const db = getDatabase();
    const user = db.getUser(m.sender);

    if (!text.trim()) {
      await m.reply(
        `${EMOJI.error} Especifica qué quieres vender.\n\n` +
        `📝 *Uso:* /vender espada de hierro\n` +
        `📝 *Uso:* /vender hierro 10\n` +
        `📝 *Uso:* /vender todo materiales`
      );
      return;
    }

    // Verificar si quiere vender todo de una categoría
    if (args[0]?.toLowerCase() === 'todo') {
      const typeArg = args[1]?.toLowerCase();
      const typeMap: Record<string, ItemType> = {
        'materiales': 'material',
        'material': 'material',
        'consumibles': 'consumable',
        'consumible': 'consumable'
      };

      const targetType = typeMap[typeArg];

      if (!targetType) {
        await m.reply(
          `${EMOJI.error} Especifica el tipo a vender.\n\n` +
          `📝 *Uso:* /vender todo materiales\n` +
          `📝 *Uso:* /vender todo consumibles`
        );
        return;
      }

      // Calcular items a vender
      let totalValue = 0;
      let totalItems = 0;
      const newInventory = user.inventory.filter(inv => {
        const item = ITEMS[inv.itemId];
        if (item && item.type === targetType) {
          totalValue += item.sellPrice * inv.quantity;
          totalItems += inv.quantity;
          return false; // Remover del inventario
        }
        return true; // Mantener
      });

      if (totalItems === 0) {
        await m.reply(`${EMOJI.warning} No tienes items de ese tipo para vender.`);
        return;
      }

      user.money += totalValue;
      user.inventory = newInventory;

      db.updateUser(m.sender, {
        money: user.money,
        inventory: user.inventory
      });

      await m.reply(
        `${EMOJI.success} ¡Vendiste todo!\n\n` +
        `📦 Items vendidos: *${totalItems}*\n` +
        `💰 Ganaste: *${formatNumber(totalValue)}* monedas\n` +
        `💵 Total: *${formatNumber(user.money)}* monedas`
      );
      await m.react('💰');
      return;
    }

    // Venta individual
    let quantity = 1;
    let searchTerm = text.toLowerCase().trim();

    const lastArg = args[args.length - 1];
    if (/^\d+$/.test(lastArg)) {
      quantity = Math.max(1, parseInt(lastArg));
      searchTerm = args.slice(0, -1).join(' ').toLowerCase().trim();
    }

    // Buscar item en inventario
    let foundItem: Item | null = null;
    let foundInvIndex = -1;

    for (let i = 0; i < user.inventory.length; i++) {
      const invItem = user.inventory[i];
      const item = ITEMS[invItem.itemId];
      if (item && item.name.toLowerCase().includes(searchTerm)) {
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

    // Verificar cantidad
    const available = user.inventory[foundInvIndex].quantity;
    if (quantity > available) {
      await m.reply(
        `${EMOJI.error} No tienes tantos.\n\n` +
        `📦 Tienes: *${available}* ${foundItem.name}`
      );
      return;
    }

    // Verificar que no esté equipado
    if (user.equipment.weapon === foundItem.id ||
        user.equipment.armor === foundItem.id ||
        user.equipment.accessory === foundItem.id) {
      await m.reply(
        `${EMOJI.error} No puedes vender un item equipado.\n\n` +
        `💡 Usa */desequipar* primero.`
      );
      return;
    }

    // Realizar venta
    const totalValue = foundItem.sellPrice * quantity;
    user.money += totalValue;

    user.inventory[foundInvIndex].quantity -= quantity;
    if (user.inventory[foundInvIndex].quantity <= 0) {
      user.inventory.splice(foundInvIndex, 1);
    }

    db.updateUser(m.sender, {
      money: user.money,
      inventory: user.inventory
    });

    let response = `${EMOJI.success} ¡Venta exitosa!\n\n`;
    response += `📦 Vendiste: ${foundItem.emoji} *${foundItem.name}*`;
    if (quantity > 1) response += ` x${quantity}`;
    response += `\n💰 Ganaste: *${formatNumber(totalValue)}* monedas\n`;
    response += `💵 Total: *${formatNumber(user.money)}* monedas`;

    await m.reply(response);
    await m.react('💰');
  }
};

/**
 * Registra los plugins de tienda
 */
export function registerShopPlugins(handler: MessageHandler): void {
  handler.registerPlugin('tienda', tiendaPlugin);
  handler.registerPlugin('comprar', comprarPlugin);
  handler.registerPlugin('vender', venderPlugin);
}
