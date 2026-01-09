/**
 * 🏪 Plugin de Tienda - RPG
 * Comandos: tienda, comprar, vender
 */

import type { MessageHandler } from '../handler.js';
import type { PluginHandler, MessageContext } from '../types/message.js';
import { getDatabase } from '../lib/database.js';
import { EMOJI, formatNumber, matchesIgnoreAccents } from '../lib/utils.js';
import { ITEMS, RARITY_COLORS, type Item, type ItemType } from '../types/rpg.js';

/**
 * Items disponibles en la tienda (categorizados) - Con monedas
 */
const SHOP_ITEMS: Record<string, string[]> = {
  armas: [
    // Nivel bajo (1-10)
    'palo_madera', 'daga_oxidada', 'espada_madera',
    // Nivel medio (10-25)
    'espada_hierro', 'hacha_batalla', 'baston_aprendiz',
    // Nivel alto (25+)
    'espada_acero', 'baston_arcano', 'daga_sombras', 'arco_cazador'
  ],
  armaduras: [
    // Nivel bajo (1-10)
    'ropa_andrajos', 'chaleco_tela',
    // Nivel medio (10-25)
    'armadura_cuero', 'armadura_cuero_reforzado', 'cota_malla',
    // Nivel alto (25+)
    'armadura_hierro', 'tunica_mago'
  ],
  accesorios: [
    // Nivel bajo (1-10)
    'cuerda_vieja', 'pulsera_cuero', 'amuleto_principiante',
    // Nivel medio (10-25)
    'anillo_cobre', 'collar_plata',
    // Nivel alto (25+)
    'anillo_fuerza', 'amuleto_vida', 'collar_suerte'
  ],
  consumibles: [
    // Nivel bajo
    'vendaje', 'pocion_salud_menor',
    // Nivel medio-alto
    'pocion_salud', 'pocion_salud_mayor', 'pocion_mana', 'pocion_energia', 'elixir_exp'
  ],
  materiales: ['hierro', 'oro_material', 'cristal_mana']
};

/**
 * Items especiales comprables SOLO con diamantes
 * Precios equilibrados respecto a beneficios:
 * - Items ofensivos: mas caros por su impacto en otros
 * - Items defensivos: precio moderado, duran 24h
 * - Items de utilidad: precio bajo-medio
 * - Equipamiento legendario: muy caro pero permanente
 */
const DIAMOND_SHOP: Record<string, { itemId: string; diamonds: number; description: string }[]> = {
  especiales: [
    { itemId: 'ticket_muteo', diamonds: 1500, description: 'Mutea a alguien por 24h' },
    { itemId: 'ticket_kick', diamonds: 2500, description: 'Expulsa a alguien del grupo' },
    { itemId: 'bomba_dinero', diamonds: 800, description: 'Roba 500-2000 monedas a todos' },
    { itemId: 'cambio_nombre', diamonds: 200, description: 'Cambia tu nombre RPG' },
    { itemId: 'reset_clase', diamonds: 1500, description: 'Reinicia tu clase y stats' }
  ],
  proteccion: [
    { itemId: 'escudo_robo', diamonds: 600, description: 'Protege de robos por 24h' },
    { itemId: 'escudo_antibombas', diamonds: 750, description: 'Protege de bombardeos por 24h' },
    { itemId: 'seguro_vida', diamonds: 1200, description: 'Sin cuotas IMSS por 48h' }
  ],
  consumibles: [
    { itemId: 'pocion_resurrecion', diamonds: 500, description: 'Revive con 100% HP/MP/ST' },
    { itemId: 'caja_misteriosa', diamonds: 800, description: 'Item aleatorio raro+' },
    { itemId: 'cofre_oro', diamonds: 400, description: '5,000-15,000 monedas' },
    { itemId: 'pocion_suerte', diamonds: 350, description: '+20% drops raros por 1h' }
  ],
  boosts: [
    { itemId: 'boost_exp_24h', diamonds: 1000, description: '+50% EXP por 24 horas' },
    { itemId: 'doble_exp_permanente', diamonds: 3000, description: '+25% EXP permanente (max 3)' }
  ],
  legendarios: [
    { itemId: 'espada_celestial', diamonds: 4000, description: 'Arma legendaria +100 ATK' },
    { itemId: 'armadura_celestial', diamonds: 4000, description: 'Armadura legendaria +100 DEF' },
    { itemId: 'corona_reyes', diamonds: 6000, description: 'Accesorio +30ATK/DEF +100HP' }
  ]
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
    'tienda diamantes - Ver tienda de diamantes'
  ],
  register: true,

  handler: async (ctx: MessageContext) => {
    const { m, text } = ctx;
    const db = getDatabase();
    const user = db.getUser(m.sender);

    const category = text.toLowerCase().trim();

    // Si pide la tienda de diamantes
    if (category === 'diamantes' || category === 'diamonds' || category === 'premium') {
      let response = `💎 *TIENDA DE DIAMANTES*\n`;
      response += `━━━━━━━━━━━━━━━━━━━━━\n`;
      response += `💎 Tus diamantes: *${formatNumber(user.limit)}*\n\n`;

      const diamondCategories = ['especiales', 'proteccion', 'consumibles', 'boosts', 'legendarios'];
      const diamondEmojis: Record<string, string> = {
        especiales: '🎫',
        proteccion: '🛡️',
        consumibles: '🧪',
        boosts: '⚡',
        legendarios: '👑'
      };

      for (const cat of diamondCategories) {
        response += `${diamondEmojis[cat]} *${cat.charAt(0).toUpperCase() + cat.slice(1)}:*\n`;

        const items = DIAMOND_SHOP[cat];
        for (const { itemId, diamonds, description } of items) {
          const item = ITEMS[itemId];
          if (item) {
            response += `   ${item.emoji} *${item.name}* - 💎 ${formatNumber(diamonds)}\n`;
            response += `      _${description}_\n`;
          }
        }
        response += '\n';
      }

      response += `━━━━━━━━━━━━━━━━━━━━━\n`;
      response += `📝 */comprard [item]* - Comprar con diamantes\n`;
      response += `💡 Gana diamantes con */daily*, */misiones* y */ranking*`;

      await m.reply(response);
      return;
    }

    let response = `🏪 *TIENDA*\n`;
    response += `━━━━━━━━━━━━━━━━━━━━━\n`;
    response += `💰 Tu dinero: *${formatNumber(user.money)}* monedas\n`;
    response += `💎 Tus diamantes: *${formatNumber(user.limit)}*\n\n`;

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
          const rarity = RARITY_COLORS[item.rarity];
          const stats: string[] = [];
          if (item.stats) {
            if (item.stats.attack) stats.push(`+${item.stats.attack} ATK`);
            if (item.stats.defense) stats.push(`+${item.stats.defense} DEF`);
            if (item.stats.health) stats.push(`+${item.stats.health} HP`);
            if (item.stats.mana) stats.push(`+${item.stats.mana} MP`);
          }
          const statsStr = stats.length > 0 ? ` (${stats.join(', ')})` : '';
          const levelStr = item.requiredLevel ? ` Nv.${item.requiredLevel}` : '';
          response += `${rarity} ${item.emoji} *${item.name}* - ${formatNumber(item.price)}💰${statsStr}${levelStr}\n`;
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
            response += `   ${rarity} ${item.emoji} ${item.name} - ${formatNumber(item.price)}💰\n`;
          }
        }
        response += '\n';
      }

      // Mostrar preview de tienda de diamantes
      response += `💎 *Tienda Premium:* usa */tienda diamantes*\n\n`;
    }

    response += `━━━━━━━━━━━━━━━━━━━━━\n`;
    response += `📝 */comprar [item]* - Comprar con monedas\n`;
    response += `📝 */comprard [item]* - Comprar con diamantes\n`;
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

    // Buscar item en la tienda (sin importar tildes)
    let foundItem: Item | null = null;

    for (const itemIds of Object.values(SHOP_ITEMS)) {
      for (const itemId of itemIds) {
        const item = ITEMS[itemId];
        if (item && matchesIgnoreAccents(item.name, searchTerm)) {
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
 * Plugin: Comprar con Diamantes - Comprar items premium
 */
const comprarDiamantesPlugin: PluginHandler = {
  command: ['comprard', 'buyd', 'comprardiamantes', 'buydiamonds'],
  tags: ['rpg'],
  help: [
    'comprard [item] - Compra un item con diamantes',
    'comprard [item] [cantidad] - Comprar varios',
    'comprard ticket muteo - Comprar ticket de muteo'
  ],
  register: true,

  handler: async (ctx: MessageContext) => {
    const { m, text, args } = ctx;
    const db = getDatabase();
    const user = db.getUser(m.sender);

    if (!text.trim()) {
      await m.reply(
        `${EMOJI.error} Especifica qué quieres comprar.\n\n` +
        `📝 *Uso:* /comprard ticket muteo\n` +
        `📝 *Uso:* /comprard pocion resurrecion 3\n\n` +
        `💎 Tus diamantes: *${formatNumber(user.limit)}*\n` +
        `💡 Usa */tienda diamantes* para ver items disponibles.`
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

    // Buscar item en la tienda de diamantes (sin importar tildes)
    let foundItem: Item | null = null;
    let foundDiamondCost = 0;

    for (const items of Object.values(DIAMOND_SHOP)) {
      for (const { itemId, diamonds } of items) {
        const item = ITEMS[itemId];
        if (item && matchesIgnoreAccents(item.name, searchTerm)) {
          foundItem = item;
          foundDiamondCost = diamonds;
          break;
        }
      }
      if (foundItem) break;
    }

    if (!foundItem) {
      await m.reply(
        `${EMOJI.error} Ese item no está en la tienda de diamantes.\n\n` +
        `💡 Usa */tienda diamantes* para ver los items disponibles.`
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
    const totalCost = foundDiamondCost * quantity;

    // Verificar diamantes
    if (user.limit < totalCost) {
      await m.reply(
        `${EMOJI.error} No tienes suficientes diamantes.\n\n` +
        `💎 Costo: *${formatNumber(totalCost)}* diamantes\n` +
        `💎 Tus diamantes: *${formatNumber(user.limit)}*\n` +
        `❌ Te faltan: *${formatNumber(totalCost - user.limit)}* diamantes\n\n` +
        `💡 Gana diamantes con */daily*, */misiones* y */ranking*`
      );
      return;
    }

    // Realizar compra
    user.limit -= totalCost;

    // Agregar al inventario
    const existingItem = user.inventory.find(i => i.itemId === foundItem!.id);
    if (existingItem) {
      existingItem.quantity += quantity;
    } else {
      user.inventory.push({ itemId: foundItem.id, quantity });
    }

    db.updateUser(m.sender, {
      limit: user.limit,
      inventory: user.inventory
    });

    let response = `💎 ¡Compra con diamantes exitosa!\n\n`;
    response += `🛒 Compraste: ${foundItem.emoji} *${foundItem.name}*`;
    if (quantity > 1) response += ` x${quantity}`;
    response += `\n💎 Pagaste: *${formatNumber(totalCost)}* diamantes\n`;
    response += `💎 Te quedan: *${formatNumber(user.limit)}* diamantes\n\n`;

    // Instrucciones de uso para items especiales
    if (foundItem.id === 'ticket_muteo') {
      response += `💡 *Uso:* /usar ticket muteo @usuario`;
    } else if (foundItem.id === 'ticket_kick') {
      response += `💡 *Uso:* /usar ticket kick @usuario`;
    } else if (foundItem.id === 'bomba_dinero') {
      response += `💡 *Uso:* /usar bomba dinero`;
    } else if (foundItem.id === 'escudo_robo') {
      response += `💡 *Uso:* /usar escudo robo`;
    } else if (foundItem.id === 'escudo_antibombas') {
      response += `💡 *Uso:* /usar escudo antibombas`;
    } else if (foundItem.id === 'seguro_vida') {
      response += `💡 *Uso:* /usar seguro vida`;
    } else if (foundItem.id === 'boost_exp_24h') {
      response += `💡 *Uso:* /usar boost exp`;
    } else if (foundItem.id === 'doble_exp_permanente') {
      response += `💡 *Uso:* /usar runa exp`;
    } else if (foundItem.id === 'cofre_oro') {
      response += `💡 *Uso:* /usar cofre oro`;
    } else if (foundItem.id === 'pocion_suerte') {
      response += `💡 *Uso:* /usar pocion suerte`;
    } else if (foundItem.id === 'cambio_nombre') {
      response += `💡 *Uso:* /usar cambio nombre [nuevo nombre]`;
    } else if (foundItem.id === 'reset_clase') {
      response += `💡 *Uso:* /usar reset clase`;
    } else if (foundItem.type === 'weapon' || foundItem.type === 'armor' || foundItem.type === 'accessory') {
      response += `💡 *Uso:* /equipar ${foundItem.name.toLowerCase()}`;
    }

    await m.reply(response);
    await m.react('💎');
  }
};

/**
 * Registra los plugins de tienda
 */
export function registerShopPlugins(handler: MessageHandler): void {
  handler.registerPlugin('tienda', tiendaPlugin);
  handler.registerPlugin('comprar', comprarPlugin);
  handler.registerPlugin('comprard', comprarDiamantesPlugin);
  handler.registerPlugin('vender', venderPlugin);
}
