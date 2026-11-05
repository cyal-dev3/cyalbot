import type { MessageHandler } from '../handler.js';
import type { PluginHandler, MessageContext } from '../types/message.js';
import { getDatabase } from '../lib/database.js';
import { EMOJI, formatNumber } from '../lib/utils.js';
import { ITEMS, RARITY_COLORS, FORGE_MATERIALS, type ForgeMaterial, type Item, type ItemRarity, type ItemType } from '../types/rpg.js';
import type { UserRPG } from '../types/user.js';
import { ITEM_TYPE_ALIASES, ITEM_TYPE_EMOJI, ITEM_TYPE_NAMES, LIMITS, SHOP } from '../constants/rpg.js';
import {
  addItem, addMaterial, countItem, formatAmbiguous, freeInventorySpace, inventoryItems, isEquipable, isEquipped,
  listMaterials, migrateLegacyMaterials, removeItem, removeMaterial, resolveItem
} from '../lib/rpg-inventory.js';
import { updateQuestProgress } from './rpg-misiones.js';
import { SPECIAL_ITEM_USAGE, permanentExpStacks } from './rpg-items-especiales.js';

/** Items de ITEMS que se venden por monedas, por categoría */
const SHOP_ITEMS: Record<string, string[]> = {
  armas: [
    'palo_madera', 'daga_oxidada', 'espada_madera',
    'espada_hierro', 'hacha_batalla', 'baston_aprendiz',
    'espada_acero', 'baston_arcano', 'daga_sombras', 'arco_cazador', 'martillo_guerra'
  ],
  armaduras: [
    'ropa_andrajos', 'chaleco_tela',
    'armadura_cuero', 'armadura_cuero_reforzado', 'cota_malla',
    'armadura_hierro', 'tunica_mago', 'capa_cazador'
  ],
  accesorios: [
    'cuerda_vieja', 'pulsera_cuero', 'amuleto_principiante',
    'anillo_cobre', 'collar_plata',
    'anillo_fuerza', 'amuleto_vida', 'collar_suerte'
  ],
  consumibles: [
    'vendaje', 'pocion_salud_menor',
    'pocion_salud', 'pocion_salud_mayor', 'pocion_mana', 'pocion_energia', 'elixir_exp', 'pocion_forja'
  ]
};

/** Materiales básicos de forja que la tienda vende directamente a forgeMaterials */
const SHOP_MATERIALS: string[] = Object.values(FORGE_MATERIALS).filter(m => m.price && m.price > 0).map(m => m.id);

interface DiamondOffer {
  itemId: string;
  diamonds: number;
  description: string;
}

/**
 * Items solo por diamantes. Los ofensivos son más caros por su impacto en otros;
 * las protecciones duran 24 h; el equipo legendario es caro pero permanente.
 */
const DIAMOND_SHOP: Record<string, DiamondOffer[]> = {
  especiales: [
    { itemId: 'ticket_muteo', diamonds: 1500, description: 'Mutea a alguien por 24h' },
    { itemId: 'ticket_kick', diamonds: 2500, description: 'Expulsa a alguien del grupo' },
    { itemId: 'bomba_dinero', diamonds: 800, description: 'Roba 500-2000 monedas a todos' },
    { itemId: 'cambio_nombre', diamonds: 200, description: 'Cambia tu nombre RPG' },
    { itemId: 'reset_clase', diamonds: 1500, description: 'Reinicia tu clase sin costo' }
  ],
  proteccion: [
    { itemId: 'escudo_robo', diamonds: 600, description: 'Protege de robos por 24h' },
    { itemId: 'escudo_antibombas', diamonds: 750, description: 'Protege de bombardeos por 24h' },
    { itemId: 'seguro_vida', diamonds: 1200, description: 'Sin cuotas IMSS por 48h' }
  ],
  consumibles: [
    { itemId: 'pocion_resurrecion', diamonds: 500, description: 'Restaura 100% HP/MP/ST' },
    { itemId: 'caja_misteriosa', diamonds: 800, description: 'Equipo aleatorio raro+' },
    { itemId: 'cofre_oro', diamonds: 400, description: '5,000-15,000 monedas' },
    { itemId: 'pocion_suerte', diamonds: 350, description: '+20% drops por 1h' }
  ],
  boosts: [
    { itemId: 'boost_exp_24h', diamonds: 1000, description: 'XP x2 por 24 horas' },
    { itemId: 'doble_exp_permanente', diamonds: 3000, description: '+25% XP permanente (max 3)' }
  ],
  legendarios: [
    { itemId: 'espada_celestial', diamonds: 4000, description: 'Arma legendaria +100 ATK' },
    { itemId: 'armadura_celestial', diamonds: 4000, description: 'Armadura legendaria +100 DEF' },
    { itemId: 'corona_reyes', diamonds: 6000, description: 'Accesorio +30ATK/DEF +100HP' }
  ]
};

const DIAMOND_CATEGORY_EMOJI: Record<string, string> = {
  especiales: '🎫', proteccion: '🛡️', consumibles: '🧪', boosts: '⚡', legendarios: '👑'
};

const COIN_CATEGORY_TYPE: Record<string, ItemType> = {
  armas: 'weapon', armaduras: 'armor', accesorios: 'accessory', consumibles: 'consumable', materiales: 'material'
};

type OfferKind = 'coin' | 'diamond' | 'material';

interface ShopOffer {
  id: string;
  name: string;
  emoji: string;
  rarity: ItemRarity;
  kind: OfferKind;
  /** Monedas o diamantes según kind */
  price: number;
  requiredLevel?: number;
  description?: string;
}

function coinOffer(itemId: string): ShopOffer | null {
  const item = ITEMS[itemId];
  if (!item) return null;
  return { id: item.id, name: item.name, emoji: item.emoji, rarity: item.rarity, kind: 'coin', price: item.price, requiredLevel: item.requiredLevel };
}

function materialOffer(materialId: string): ShopOffer | null {
  const material = FORGE_MATERIALS[materialId];
  if (!material || !material.price) return null;
  return { id: material.id, name: material.name, emoji: material.emoji, rarity: material.rarity, kind: 'material', price: material.price, description: material.description };
}

function diamondOffer(offer: DiamondOffer): ShopOffer | null {
  const item = ITEMS[offer.itemId];
  if (!item) return null;
  return { id: item.id, name: item.name, emoji: item.emoji, rarity: item.rarity, kind: 'diamond', price: offer.diamonds, requiredLevel: item.requiredLevel, description: offer.description };
}

function allOffers(): ShopOffer[] {
  const offers: ShopOffer[] = [];
  for (const ids of Object.values(SHOP_ITEMS)) for (const id of ids) {
    const offer = coinOffer(id);
    if (offer) offers.push(offer);
  }
  for (const id of SHOP_MATERIALS) {
    const offer = materialOffer(id);
    if (offer) offers.push(offer);
  }
  for (const list of Object.values(DIAMOND_SHOP)) for (const entry of list) {
    const offer = diamondOffer(entry);
    if (offer) offers.push(offer);
  }
  return offers;
}

function statsSummary(itemId: string): string {
  const stats = ITEMS[itemId]?.stats;
  if (!stats) return '';
  const parts: string[] = [];
  if (stats.attack) parts.push(`+${stats.attack} ATK`);
  if (stats.defense) parts.push(`+${stats.defense} DEF`);
  if (stats.health) parts.push(`+${stats.health} HP`);
  if (stats.mana) parts.push(`+${stats.mana} MP`);
  if (stats.critChance) parts.push(`+${stats.critChance}% CRIT`);
  return parts.length ? ` (${parts.join(', ')})` : '';
}

function formatOffer(offer: ShopOffer, userLevel: number): string {
  const price = offer.kind === 'diamond' ? `💎 ${formatNumber(offer.price)}` : `${formatNumber(offer.price)}💰`;
  const level = offer.requiredLevel ? (userLevel >= offer.requiredLevel ? ` Nv.${offer.requiredLevel}` : ` 🔒Nv.${offer.requiredLevel}`) : '';
  let line = `${RARITY_COLORS[offer.rarity]} ${offer.emoji} *${offer.name}* - ${price}${statsSummary(offer.id)}${level}\n`;
  line += `      \`${offer.id}\`${offer.description ? ` · _${offer.description}_` : ''}\n`;
  return line;
}

function paginate<T>(items: T[], page: number): { slice: T[]; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(items.length / SHOP.PAGE_SIZE));
  const safePage = Math.min(pages, Math.max(1, page));
  const start = (safePage - 1) * SHOP.PAGE_SIZE;
  return { slice: items.slice(start, start + SHOP.PAGE_SIZE), page: safePage, pages };
}

function parseCategoryArgs(args: string[]): { category: string; page: number } {
  const words = [...args];
  let page = 1;
  const last = words[words.length - 1];
  if (words.length > 0 && /^\d+$/.test(last)) {
    page = parseInt(words.pop() as string, 10);
  }
  return { category: words.join(' ').toLowerCase().trim(), page };
}

const tiendaPlugin: PluginHandler = {
  command: ['tienda', 'shop', 'store', 'mercado'],
  tags: ['rpg'],
  help: [
    'tienda - Ver las categorías de la tienda',
    'tienda armas [página] - Ver una categoría',
    'tienda materiales - Materiales de forja básicos',
    'tienda diamantes [página] - Tienda de diamantes'
  ],
  register: true,

  handler: async (ctx: MessageContext) => {
    const { m, args, usedPrefix } = ctx;
    const db = getDatabase();
    const user = db.getUser(m.sender);
    const { category, page } = parseCategoryArgs(args);

    const header = `💰 Tu dinero: *${formatNumber(user.money)}* monedas\n💎 Tus diamantes: *${formatNumber(user.limit)}*\n\n`;

    if (['diamantes', 'diamonds', 'premium'].includes(category)) {
      const offers: ShopOffer[] = [];
      for (const [cat, list] of Object.entries(DIAMOND_SHOP)) {
        for (const entry of list) {
          const offer = diamondOffer(entry);
          if (offer) offers.push({ ...offer, description: `${DIAMOND_CATEGORY_EMOJI[cat]} ${offer.description}` });
        }
      }
      const result = paginate(offers, page);
      let response = `💎 *TIENDA DE DIAMANTES* (${result.page}/${result.pages})\n━━━━━━━━━━━━━━━━━━━━━\n${header}`;
      for (const offer of result.slice) response += formatOffer(offer, user.level);
      response += `\n━━━━━━━━━━━━━━━━━━━━━\n`;
      if (result.pages > 1) response += `📄 *${usedPrefix}tienda diamantes ${result.page + 1}* para la siguiente página\n`;
      response += `📝 *${usedPrefix}comprar [item o id] [cantidad]* - Se cobra en diamantes\n`;
      response += `💡 Gana diamantes con *${usedPrefix}daily*, *${usedPrefix}misiones* y *${usedPrefix}ranking*`;
      await m.reply(response);
      return;
    }

    const type = ITEM_TYPE_ALIASES[category];
    const categoryKey = type ? Object.keys(COIN_CATEGORY_TYPE).find(k => COIN_CATEGORY_TYPE[k] === type) : undefined;

    if (categoryKey) {
      const offers = categoryKey === 'materiales'
        ? SHOP_MATERIALS.map(materialOffer).filter((o): o is ShopOffer => o !== null)
        : SHOP_ITEMS[categoryKey].map(coinOffer).filter((o): o is ShopOffer => o !== null);
      const result = paginate(offers, page);
      const typeKey = COIN_CATEGORY_TYPE[categoryKey];
      let response = `🏪 *TIENDA - ${ITEM_TYPE_EMOJI[typeKey]} ${ITEM_TYPE_NAMES[typeKey].toUpperCase()}* (${result.page}/${result.pages})\n━━━━━━━━━━━━━━━━━━━━━\n${header}`;
      for (const offer of result.slice) response += formatOffer(offer, user.level);
      if (categoryKey === 'materiales') response += `\n_Los materiales van directo a tu almacén de forja (${usedPrefix}inventario materiales)._\n`;
      response += `\n━━━━━━━━━━━━━━━━━━━━━\n`;
      if (result.pages > 1) response += `📄 *${usedPrefix}tienda ${categoryKey} ${result.page + 1}* para la siguiente página\n`;
      response += `📝 *${usedPrefix}comprar [item o id] [cantidad]*\n`;
      response += `📝 *${usedPrefix}iteminfo [item]* para ver detalles`;
      await m.reply(response);
      return;
    }

    let response = `🏪 *TIENDA*\n━━━━━━━━━━━━━━━━━━━━━\n${header}`;
    response += `📂 *Categorías:*\n`;
    for (const [key, ids] of Object.entries(SHOP_ITEMS)) {
      const typeKey = COIN_CATEGORY_TYPE[key];
      response += `   ${ITEM_TYPE_EMOJI[typeKey]} *${usedPrefix}tienda ${key}* (${ids.length} items)\n`;
    }
    response += `   📦 *${usedPrefix}tienda materiales* (${SHOP_MATERIALS.length} materiales de forja)\n`;
    const diamondCount = Object.values(DIAMOND_SHOP).reduce((sum, list) => sum + list.length, 0);
    response += `   💎 *${usedPrefix}tienda diamantes* (${diamondCount} items premium)\n\n`;
    response += `━━━━━━━━━━━━━━━━━━━━━\n`;
    response += `📝 *${usedPrefix}comprar [item o id] [cantidad]*\n`;
    response += `📝 *${usedPrefix}vender [item] [cantidad]* | *${usedPrefix}vender todo consumibles*\n`;
    response += `💡 Cada item muestra su \`id\`: también puedes comprar con él`;

    await m.reply(response);
  }
};

const comprarPlugin: PluginHandler = {
  command: ['comprar', 'buy', 'purchase', 'comprard', 'buyd', 'comprardiamantes', 'buydiamonds'],
  tags: ['rpg'],
  help: [
    'comprar [item o id] - Compra un item (monedas o diamantes según la tienda)',
    'comprar [item] [cantidad] - Comprar varios',
    'comprar hierro 10 - Materiales de forja'
  ],
  register: true,

  handler: async (ctx: MessageContext) => {
    const { m, args, usedPrefix } = ctx;
    const db = getDatabase();
    const user = db.getUser(m.sender);

    if (args.length === 0) {
      await m.reply(
        `${EMOJI.error} Especifica qué quieres comprar.\n\n` +
        `📝 *Uso:* ${usedPrefix}comprar espada de hierro\n` +
        `📝 *Uso:* ${usedPrefix}comprar pocion_salud 5\n` +
        `📝 *Uso:* ${usedPrefix}comprar ticket muteo (se cobra en diamantes)`
      );
      return;
    }

    const words = [...args];
    let quantity = 1;
    if (words.length > 1 && /^\d+$/.test(words[words.length - 1])) {
      quantity = Math.min(SHOP.MAX_PER_PURCHASE, Math.max(1, parseInt(words.pop() as string, 10)));
    }

    const result = resolveItem(words.join(' '), allOffers());
    if (result.status === 'none') {
      await m.reply(`${EMOJI.error} Ese item no está en la tienda.\n\n💡 Usa *${usedPrefix}tienda* para ver las categorías.`);
      return;
    }
    if (result.status === 'ambiguous') {
      await m.reply(formatAmbiguous(result.candidates));
      return;
    }
    const offer = result.item;

    if (offer.requiredLevel && user.level < offer.requiredLevel) {
      await m.reply(`${EMOJI.error} Necesitas nivel *${offer.requiredLevel}* para comprar esto.\n\n📊 Tu nivel: *${user.level}*`);
      return;
    }

    if (offer.kind !== 'material') {
      const maxStack = SHOP.MAX_STACK[offer.id];
      // Las runas ya usadas viven como buff permanente y cuentan igual que las del inventario
      const owned = countItem(user, offer.id) + (offer.id === 'doble_exp_permanente' ? permanentExpStacks(user) : 0);
      if (maxStack !== undefined) {
        if (owned >= maxStack) {
          await m.reply(`${EMOJI.error} Solo puedes tener *${maxStack}* de *${offer.name}* (contando las ya activas) y ya tienes ${owned}.`);
          return;
        }
        quantity = Math.min(quantity, maxStack - owned);
      }
      const space = freeInventorySpace(user);
      if (space <= 0) {
        await m.reply(`${EMOJI.error} Tu inventario está lleno (${LIMITS.MAX_INVENTORY_SIZE}). Vende o usa algo antes de comprar.`);
        return;
      }
      quantity = Math.min(quantity, space);
    }

    const totalCost = offer.price * quantity;
    const wallet = offer.kind === 'diamond' ? user.limit : user.money;
    const currency = offer.kind === 'diamond' ? 'diamantes' : 'monedas';
    if (wallet < totalCost) {
      await m.reply(
        `${EMOJI.error} No tienes suficientes ${currency}.\n\n` +
        `💰 Costo: *${formatNumber(totalCost)}* ${currency}${quantity > 1 ? ` (x${quantity})` : ''}\n` +
        `💵 Tienes: *${formatNumber(wallet)}* ${currency}\n` +
        `❌ Te faltan: *${formatNumber(totalCost - wallet)}* ${currency}` +
        (offer.kind === 'diamond' ? `\n\n💡 Gana diamantes con *${usedPrefix}daily*, *${usedPrefix}misiones* y *${usedPrefix}ranking*` : '')
      );
      return;
    }

    if (offer.kind === 'material') {
      addMaterial(user, offer.id, quantity);
    } else {
      addItem(user, offer.id, quantity);
    }

    if (offer.kind === 'diamond') {
      db.updateUser(m.sender, { limit: user.limit - totalCost, inventory: user.inventory });
    } else {
      db.updateUser(m.sender, { money: user.money - totalCost, inventory: user.inventory, forgeMaterials: user.forgeMaterials });
      updateQuestProgress(db, m.sender, 'spend', totalCost);
    }

    const left = offer.kind === 'diamond' ? user.limit - totalCost : user.money - totalCost;
    let response = offer.kind === 'diamond' ? `💎 ¡Compra con diamantes exitosa!\n\n` : `${EMOJI.success} ¡Compra exitosa!\n\n`;
    response += `🛒 Compraste: ${offer.emoji} *${offer.name}*${quantity > 1 ? ` x${quantity}` : ''}\n`;
    response += `💰 Pagaste: *${formatNumber(totalCost)}* ${currency}\n`;
    response += `💵 Te quedan: *${formatNumber(left)}* ${currency}`;

    if (offer.kind === 'material') {
      response += `\n\n📦 Guardado en tu almacén de forja (*${usedPrefix}inventario materiales*).`;
    } else if (SPECIAL_ITEM_USAGE[offer.id]) {
      response += `\n\n💡 *Uso:* ${usedPrefix}${SPECIAL_ITEM_USAGE[offer.id].slice(1)}`;
    } else if (ITEMS[offer.id] && isEquipable(ITEMS[offer.id])) {
      response += `\n\n💡 *Uso:* ${usedPrefix}equipar ${offer.name.toLowerCase()}`;
    } else if (ITEMS[offer.id]?.type === 'consumable') {
      response += `\n\n💡 *Uso:* ${usedPrefix}usar ${offer.name.toLowerCase()}`;
    }

    await m.reply(response);
    await m.react(offer.kind === 'diamond' ? '💎' : '✅');
  }
};

type SellCandidate =
  | { id: string; name: string; emoji: string; kind: 'item'; item: Item }
  | { id: string; name: string; emoji: string; kind: 'material'; material: ForgeMaterial };

/** Items del inventario y materiales poseídos en una sola lista para resolveItem */
export function sellableCandidates(user: UserRPG): SellCandidate[] {
  const items: SellCandidate[] = inventoryItems(user).map(item => ({ id: item.id, name: item.name, emoji: item.emoji, kind: 'item', item }));
  const materials: SellCandidate[] = listMaterials(user).map(({ material }) => ({ id: material.id, name: material.name, emoji: material.emoji, kind: 'material', material }));
  return [...items, ...materials];
}

/** Los items de la tienda de diamantes tienen sellPrice 0 y no se venden */
export function isSellable(item: Item): boolean {
  return item.sellPrice > 0;
}

const venderPlugin: PluginHandler = {
  command: ['vender', 'sell', 'vendedor'],
  tags: ['rpg'],
  help: [
    'vender [item] - Vende un item de tu inventario',
    'vender [item] [cantidad] - Vender varios',
    'vender [material] [cantidad] - Vender materiales de forja',
    'vender todo [consumibles|materiales] - Vender todos de un tipo'
  ],
  register: true,

  handler: async (ctx: MessageContext) => {
    const { m, args, usedPrefix } = ctx;
    const db = getDatabase();
    const user = db.getUser(m.sender);
    migrateLegacyMaterials(user);

    if (args.length === 0) {
      await m.reply(
        `${EMOJI.error} Especifica qué quieres vender.\n\n` +
        `📝 *Uso:* ${usedPrefix}vender espada de hierro\n` +
        `📝 *Uso:* ${usedPrefix}vender hierro 10\n` +
        `📝 *Uso:* ${usedPrefix}vender todo consumibles`
      );
      return;
    }

    if (['todo', 'all'].includes(args[0].toLowerCase())) {
      const type = ITEM_TYPE_ALIASES[args[1]?.toLowerCase() ?? ''];
      if (type === 'material') {
        const materials = listMaterials(user);
        if (materials.length === 0) {
          await m.reply(`${EMOJI.warning} No tienes materiales para vender.`);
          return;
        }
        let total = 0;
        let count = 0;
        for (const { material, quantity } of materials) {
          total += material.sellPrice * quantity;
          count += quantity;
          removeMaterial(user, material.id, quantity);
        }
        db.updateUser(m.sender, { money: user.money + total, totalEarned: user.totalEarned + total, forgeMaterials: user.forgeMaterials });
        updateQuestProgress(db, m.sender, 'earn', total);
        await m.reply(`${EMOJI.success} ¡Vendiste todos tus materiales!\n\n📦 Unidades: *${count}*\n💰 Ganaste: *${formatNumber(total)}* monedas\n💵 Total: *${formatNumber(user.money + total)}* monedas`);
        await m.react('💰');
        return;
      }
      if (type !== 'consumable') {
        await m.reply(`${EMOJI.error} Especifica el tipo a vender.\n\n📝 *Uso:* ${usedPrefix}vender todo consumibles\n📝 *Uso:* ${usedPrefix}vender todo materiales`);
        return;
      }
      let total = 0;
      let count = 0;
      const kept: string[] = [];
      user.inventory = user.inventory.filter(entry => {
        const item = ITEMS[entry.itemId];
        if (!item || item.type !== 'consumable') return true;
        // Tickets, runas, cajas... no tienen precio de venta: destruirlos por 0 sería un error
        if (!isSellable(item)) {
          kept.push(item.name);
          return true;
        }
        total += item.sellPrice * entry.quantity;
        count += entry.quantity;
        return false;
      });
      if (count === 0) {
        await m.reply(`${EMOJI.warning} No tienes consumibles que se puedan vender.${kept.length ? `\n\n🔒 Sin precio de venta: ${kept.join(', ')}` : ''}`);
        return;
      }
      db.updateUser(m.sender, { money: user.money + total, totalEarned: user.totalEarned + total, inventory: user.inventory });
      updateQuestProgress(db, m.sender, 'earn', total);
      let response = `${EMOJI.success} ¡Vendiste todo!\n\n📦 Items vendidos: *${count}*\n💰 Ganaste: *${formatNumber(total)}* monedas\n💵 Total: *${formatNumber(user.money + total)}* monedas`;
      if (kept.length > 0) response += `\n\n🔒 Se conservaron (sin precio de venta): ${kept.join(', ')}`;
      await m.reply(response);
      await m.react('💰');
      return;
    }

    const words = [...args];
    let quantity = 1;
    if (words.length > 1 && /^\d+$/.test(words[words.length - 1])) {
      quantity = Math.max(1, parseInt(words.pop() as string, 10));
    }
    const term = words.join(' ');

    // Items y materiales se resuelven juntos: "hierro" debe dar el material, no la espada_hierro
    const result = resolveItem(term, sellableCandidates(user));
    if (result.status === 'ambiguous') {
      await m.reply(formatAmbiguous(result.candidates));
      return;
    }
    if (result.status === 'none') {
      await m.reply(`${EMOJI.error} No tienes ese item ni ese material.\n\n💡 Usa *${usedPrefix}inventario* para ver tus items.`);
      return;
    }

    if (result.item.kind === 'material') {
      const mat = result.item.material;
      if (!removeMaterial(user, mat.id, quantity)) {
        await m.reply(`${EMOJI.error} No tienes tantos.\n\n📦 Tienes: *${user.forgeMaterials[mat.id] ?? 0}* ${mat.name}`);
        return;
      }
      const total = mat.sellPrice * quantity;
      db.updateUser(m.sender, { money: user.money + total, totalEarned: user.totalEarned + total, forgeMaterials: user.forgeMaterials });
      updateQuestProgress(db, m.sender, 'earn', total);
      await m.reply(`${EMOJI.success} ¡Venta exitosa!\n\n📦 Vendiste: ${mat.emoji} *${mat.name}* x${quantity}\n💰 Ganaste: *${formatNumber(total)}* monedas\n💵 Total: *${formatNumber(user.money + total)}* monedas`);
      await m.react('💰');
      return;
    }

    const item = result.item.item;
    if (!isSellable(item)) {
      await m.reply(`${EMOJI.error} *${item.name}* no se puede vender (no tiene precio de venta).\n\n💡 Úsalo con *${usedPrefix}usar ${item.name.toLowerCase()}*.`);
      return;
    }
    const available = countItem(user, item.id);
    if (quantity > available) {
      await m.reply(`${EMOJI.error} No tienes tantos.\n\n📦 Tienes: *${available}* ${item.name}`);
      return;
    }
    if (isEquipped(user, item.id)) {
      await m.reply(`${EMOJI.error} No puedes vender un item equipado.\n\n💡 Usa *${usedPrefix}desequipar* primero.`);
      return;
    }

    const total = item.sellPrice * quantity;
    removeItem(user, item.id, quantity);
    db.updateUser(m.sender, { money: user.money + total, totalEarned: user.totalEarned + total, inventory: user.inventory });
    updateQuestProgress(db, m.sender, 'earn', total);

    await m.reply(
      `${EMOJI.success} ¡Venta exitosa!\n\n` +
      `📦 Vendiste: ${item.emoji} *${item.name}*${quantity > 1 ? ` x${quantity}` : ''}\n` +
      `💰 Ganaste: *${formatNumber(total)}* monedas\n` +
      `💵 Total: *${formatNumber(user.money + total)}* monedas`
    );
    await m.react('💰');
  }
};

export const shopPlugins: [string, PluginHandler][] = [
  ['rpg-tienda', tiendaPlugin],
  ['rpg-comprar', comprarPlugin],
  ['rpg-vender', venderPlugin]
];

export function registerShopPlugins(handler: MessageHandler): void {
  for (const [name, plugin] of shopPlugins) handler.registerPlugin(name, plugin);
}
