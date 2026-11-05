import type { PluginHandler, MessageContext, SerializedMessage, CommandContext } from '../types/message.js';
import { getDatabase } from '../lib/database.js';
import { EMOJI, formatNumber, pickRandom, randomInt } from '../lib/utils.js';
import { ITEMS, FORGE_MATERIALS, type Item, type ItemRarity } from '../types/rpg.js';
import type { InventoryItem, UserRPG } from '../types/user.js';
import { FORGE, LIMITS, SHOP, SLOT_ALIASES, type EquipmentSlot } from '../constants/rpg.js';
import {
  addItem, addMaterial, consumeMaterials, findEquippedEntry, formatAmbiguous, freeInventorySpace, getMaterialCount,
  inventoryItems, isEquipable, isEquipped, listMaterials, migrateLegacyMaterials, missingMaterials, removeMaterial,
  resolveItem, type MaterialRequirement
} from '../lib/rpg-inventory.js';
import { activeBuffs } from '../lib/rpg-combat.js';
import { updateQuestProgress } from './rpg-misiones.js';

export type { ForgeMaterial } from '../types/rpg.js';
export { FORGE_MATERIALS } from '../types/rpg.js';

// ==================== RECETAS ====================

export interface ForgeRecipe {
  id: string;
  name: string;
  emoji: string;
  description: string;
  resultItemId: string;
  materials: MaterialRequirement[];
  goldCost: number;
  requiredLevel: number;
  /** Probabilidad base de éxito (0-100); la Poción del Herrero la sube */
  successRate: number;
  category: 'weapon' | 'armor' | 'accessory' | 'consumable';
}

export const FORGE_RECIPES: ForgeRecipe[] = [
  // Armas básicas
  {
    id: 'craft_espada_hierro', name: 'Espada de Hierro', emoji: '🗡️', description: 'Una espada básica pero confiable',
    resultItemId: 'espada_hierro',
    materials: [{ materialId: 'hierro', quantity: 5 }, { materialId: 'carbon', quantity: 3 }, { materialId: 'cuero', quantity: 1 }],
    goldCost: 200, requiredLevel: 5, successRate: 95, category: 'weapon'
  },
  {
    id: 'craft_espada_acero', name: 'Espada de Acero', emoji: '⚔️', description: 'Forjada por herreros expertos',
    resultItemId: 'espada_acero',
    materials: [{ materialId: 'acero', quantity: 5 }, { materialId: 'hierro', quantity: 3 }, { materialId: 'carbon', quantity: 5 }, { materialId: 'cuero', quantity: 2 }],
    goldCost: 800, requiredLevel: 10, successRate: 85, category: 'weapon'
  },
  {
    id: 'craft_hacha_batalla', name: 'Hacha de Batalla', emoji: '🪓', description: 'Pesada pero devastadora',
    resultItemId: 'hacha_batalla',
    materials: [{ materialId: 'hierro', quantity: 8 }, { materialId: 'carbon', quantity: 4 }, { materialId: 'cuero', quantity: 2 }],
    goldCost: 500, requiredLevel: 8, successRate: 90, category: 'weapon'
  },
  {
    id: 'craft_martillo_guerra', name: 'Martillo de Guerra', emoji: '🔨', description: 'Pesado pero devastador, aplasta enemigos',
    resultItemId: 'martillo_guerra',
    materials: [{ materialId: 'hierro', quantity: 10 }, { materialId: 'acero', quantity: 2 }, { materialId: 'cuero', quantity: 2 }],
    goldCost: 700, requiredLevel: 12, successRate: 85, category: 'weapon'
  },
  // Armas épicas
  {
    id: 'craft_espada_titan', name: 'Espada del Titán', emoji: '🗡️', description: 'Una espada colosal de poder inmenso',
    resultItemId: 'espada_titan',
    materials: [{ materialId: 'titanio', quantity: 10 }, { materialId: 'acero', quantity: 8 }, { materialId: 'rubi', quantity: 2 }, { materialId: 'fragmento_alma', quantity: 3 }],
    goldCost: 10000, requiredLevel: 40, successRate: 60, category: 'weapon'
  },
  {
    id: 'craft_katana_sombria', name: 'Katana Sombría', emoji: '⚔️', description: 'Forjada en las sombras, corta el alma',
    resultItemId: 'katana_sombria',
    materials: [{ materialId: 'acero', quantity: 8 }, { materialId: 'zafiro', quantity: 2 }, { materialId: 'fragmento_alma', quantity: 5 }, { materialId: 'esencia_hielo', quantity: 2 }],
    goldCost: 5000, requiredLevel: 25, successRate: 65, category: 'weapon'
  },
  {
    id: 'craft_baculo_tormenta', name: 'Báculo de la Tormenta', emoji: '⛈️', description: 'Canaliza el poder de las tormentas',
    resultItemId: 'baculo_tormenta',
    materials: [{ materialId: 'cristal', quantity: 10 }, { materialId: 'plata', quantity: 5 }, { materialId: 'esencia_rayo', quantity: 3 }, { materialId: 'zafiro', quantity: 2 }],
    goldCost: 6000, requiredLevel: 30, successRate: 60, category: 'weapon'
  },
  {
    id: 'craft_arco_elfico', name: 'Arco Élfico', emoji: '🏹', description: 'Elaborado por elfos antiguos',
    resultItemId: 'arco_elfico',
    materials: [{ materialId: 'mithril', quantity: 3 }, { materialId: 'cristal', quantity: 5 }, { materialId: 'esmeralda', quantity: 2 }, { materialId: 'cuero', quantity: 5 }],
    goldCost: 5500, requiredLevel: 28, successRate: 55, category: 'weapon'
  },
  // Armas legendarias
  {
    id: 'craft_espada_dragon', name: 'Espada del Dragón', emoji: '🐉', description: 'Forjada con fuego de dragón ancestral',
    resultItemId: 'espada_dragon',
    materials: [{ materialId: 'escama_dragon', quantity: 5 }, { materialId: 'adamantita', quantity: 8 }, { materialId: 'esencia_fuego', quantity: 5 }, { materialId: 'nucleo_elemental', quantity: 2 }],
    goldCost: 25000, requiredLevel: 50, successRate: 35, category: 'weapon'
  },
  {
    id: 'craft_guadana_muerte', name: 'Guadaña de la Muerte', emoji: '⚰️', description: 'El arma del segador de almas',
    resultItemId: 'guadana_muerte',
    materials: [{ materialId: 'adamantita', quantity: 10 }, { materialId: 'fragmento_alma', quantity: 10 }, { materialId: 'polvo_estelar', quantity: 5 }, { materialId: 'nucleo_elemental', quantity: 3 }],
    goldCost: 40000, requiredLevel: 60, successRate: 25, category: 'weapon'
  },
  // Armaduras
  {
    id: 'craft_armadura_cuero', name: 'Armadura de Cuero', emoji: '🥋', description: 'Protección básica y ligera',
    resultItemId: 'armadura_cuero',
    materials: [{ materialId: 'cuero', quantity: 8 }, { materialId: 'hierro', quantity: 2 }],
    goldCost: 150, requiredLevel: 3, successRate: 95, category: 'armor'
  },
  {
    id: 'craft_cota_malla', name: 'Cota de Malla', emoji: '⛓️', description: 'Anillos de metal entrelazados',
    resultItemId: 'cota_malla',
    materials: [{ materialId: 'hierro', quantity: 15 }, { materialId: 'carbon', quantity: 5 }, { materialId: 'cuero', quantity: 3 }],
    goldCost: 600, requiredLevel: 10, successRate: 85, category: 'armor'
  },
  {
    id: 'craft_armadura_hierro', name: 'Armadura de Hierro', emoji: '🛡️', description: 'Sólida protección metálica',
    resultItemId: 'armadura_hierro',
    materials: [{ materialId: 'hierro', quantity: 20 }, { materialId: 'acero', quantity: 5 }, { materialId: 'carbon', quantity: 8 }, { materialId: 'cuero', quantity: 5 }],
    goldCost: 1000, requiredLevel: 15, successRate: 80, category: 'armor'
  },
  {
    id: 'craft_armadura_sombras', name: 'Armadura de Sombras', emoji: '🖤', description: 'Ligera como las sombras, perfecta para sigilo',
    resultItemId: 'armadura_sombras',
    materials: [{ materialId: 'cuero', quantity: 15 }, { materialId: 'plata', quantity: 5 }, { materialId: 'fragmento_alma', quantity: 2 }],
    goldCost: 3500, requiredLevel: 20, successRate: 70, category: 'armor'
  },
  {
    id: 'craft_tunica_archimago', name: 'Túnica del Archimago', emoji: '🔮', description: 'Vestimenta de los magos más poderosos',
    resultItemId: 'tunica_archimago',
    materials: [{ materialId: 'cristal', quantity: 12 }, { materialId: 'plata', quantity: 6 }, { materialId: 'esencia_rayo', quantity: 2 }, { materialId: 'zafiro', quantity: 2 }],
    goldCost: 6000, requiredLevel: 35, successRate: 55, category: 'armor'
  },
  {
    id: 'craft_armadura_titan', name: 'Armadura del Titán', emoji: '🛡️', description: 'Forjada para gigantes, resistencia absoluta',
    resultItemId: 'armadura_titan',
    materials: [{ materialId: 'titanio', quantity: 15 }, { materialId: 'acero', quantity: 10 }, { materialId: 'rubi', quantity: 3 }, { materialId: 'esencia_fuego', quantity: 2 }],
    goldCost: 8000, requiredLevel: 35, successRate: 55, category: 'armor'
  },
  {
    id: 'craft_armadura_obsidiana', name: 'Armadura de Obsidiana', emoji: '⬛', description: 'Negra como la noche, dura como el diamante',
    resultItemId: 'armadura_obsidiana',
    materials: [{ materialId: 'adamantita', quantity: 12 }, { materialId: 'diamante', quantity: 5 }, { materialId: 'fragmento_alma', quantity: 5 }, { materialId: 'esencia_hielo', quantity: 3 }],
    goldCost: 20000, requiredLevel: 50, successRate: 40, category: 'armor'
  },
  {
    id: 'craft_armadura_dragon', name: 'Armadura de Escamas de Dragón', emoji: '🐲', description: 'Forjada con escamas de dragón',
    resultItemId: 'armadura_dragon',
    materials: [{ materialId: 'escama_dragon', quantity: 10 }, { materialId: 'mithril', quantity: 8 }, { materialId: 'esencia_fuego', quantity: 5 }, { materialId: 'nucleo_elemental', quantity: 2 }],
    goldCost: 30000, requiredLevel: 55, successRate: 30, category: 'armor'
  },
  // Accesorios
  {
    id: 'craft_anillo_plata', name: 'Anillo de Plata', emoji: '💍', description: 'Un anillo simple pero elegante',
    resultItemId: 'anillo_plata',
    materials: [{ materialId: 'plata', quantity: 3 }, { materialId: 'cristal', quantity: 1 }],
    goldCost: 300, requiredLevel: 5, successRate: 90, category: 'accessory'
  },
  {
    id: 'craft_amuleto_rubi', name: 'Amuleto de Rubí', emoji: '📿', description: 'Aumenta tu poder de ataque',
    resultItemId: 'amuleto_rubi',
    materials: [{ materialId: 'oro', quantity: 5 }, { materialId: 'rubi', quantity: 3 }, { materialId: 'esencia_fuego', quantity: 1 }],
    goldCost: 2500, requiredLevel: 20, successRate: 70, category: 'accessory'
  },
  {
    id: 'craft_collar_zafiro', name: 'Collar de Zafiro', emoji: '📿', description: 'Aumenta tu maná máximo',
    resultItemId: 'collar_zafiro',
    materials: [{ materialId: 'oro', quantity: 5 }, { materialId: 'zafiro', quantity: 3 }, { materialId: 'esencia_hielo', quantity: 1 }],
    goldCost: 2500, requiredLevel: 20, successRate: 70, category: 'accessory'
  },
  {
    id: 'craft_anillo_vampiro', name: 'Anillo del Vampiro', emoji: '🩸', description: 'Absorbe la esencia vital de los enemigos',
    resultItemId: 'anillo_vampiro',
    materials: [{ materialId: 'oro', quantity: 6 }, { materialId: 'rubi', quantity: 2 }, { materialId: 'fragmento_alma', quantity: 3 }],
    goldCost: 5000, requiredLevel: 25, successRate: 65, category: 'accessory'
  },
  {
    id: 'craft_amuleto_mana_infinito', name: 'Amuleto de Maná Infinito', emoji: '💫', description: 'Regenera maná constantemente',
    resultItemId: 'amuleto_mana_infinito',
    materials: [{ materialId: 'cristal', quantity: 10 }, { materialId: 'zafiro', quantity: 3 }, { materialId: 'esencia_rayo', quantity: 2 }],
    goldCost: 6000, requiredLevel: 30, successRate: 60, category: 'accessory'
  },
  {
    id: 'craft_cinturon_titan', name: 'Cinturón del Titán', emoji: '🥋', description: 'Otorga la fuerza de un titán',
    resultItemId: 'cinturon_titan',
    materials: [{ materialId: 'titanio', quantity: 6 }, { materialId: 'cuero', quantity: 10 }, { materialId: 'rubi', quantity: 2 }],
    goldCost: 7000, requiredLevel: 35, successRate: 55, category: 'accessory'
  },
  {
    id: 'craft_capa_invisibilidad', name: 'Capa de Invisibilidad', emoji: '👻', description: 'Te vuelve prácticamente invisible',
    resultItemId: 'capa_invisibilidad',
    materials: [{ materialId: 'mithril', quantity: 4 }, { materialId: 'fragmento_alma', quantity: 6 }, { materialId: 'polvo_estelar', quantity: 2 }],
    goldCost: 15000, requiredLevel: 40, successRate: 40, category: 'accessory'
  },
  {
    id: 'craft_pendiente_dragon', name: 'Pendiente del Dragón', emoji: '🐉', description: 'Contiene la esencia de un dragón ancestral',
    resultItemId: 'pendiente_dragon',
    materials: [{ materialId: 'escama_dragon', quantity: 3 }, { materialId: 'oro', quantity: 10 }, { materialId: 'nucleo_elemental', quantity: 1 }],
    goldCost: 25000, requiredLevel: 55, successRate: 35, category: 'accessory'
  },
  {
    id: 'craft_corona_diamante', name: 'Corona de Diamante', emoji: '👑', description: 'La joya más codiciada del reino',
    resultItemId: 'corona_diamante',
    materials: [{ materialId: 'diamante', quantity: 5 }, { materialId: 'oro', quantity: 10 }, { materialId: 'polvo_estelar', quantity: 3 }, { materialId: 'nucleo_elemental', quantity: 1 }],
    goldCost: 50000, requiredLevel: 50, successRate: 25, category: 'accessory'
  },
  // Consumibles
  {
    id: 'craft_pocion_forja', name: 'Poción del Herrero', emoji: '🧪', description: 'Aumenta la probabilidad de éxito en forja',
    resultItemId: 'pocion_forja',
    materials: [{ materialId: 'cristal', quantity: 2 }, { materialId: 'esencia_fuego', quantity: 1 }],
    goldCost: 500, requiredLevel: 10, successRate: 100, category: 'consumable'
  },
  {
    id: 'craft_elixir_exp', name: 'Elixir de Experiencia', emoji: '✨', description: 'Duplica la XP ganada por 30 minutos',
    resultItemId: 'elixir_exp',
    materials: [{ materialId: 'cristal', quantity: 5 }, { materialId: 'polvo_estelar', quantity: 1 }, { materialId: 'esmeralda', quantity: 1 }],
    goldCost: 2000, requiredLevel: 15, successRate: 80, category: 'consumable'
  }
];

const RECIPE_CATEGORY_ALIASES: Record<string, ForgeRecipe['category']> = {
  armas: 'weapon', arma: 'weapon', weapon: 'weapon',
  armaduras: 'armor', armadura: 'armor', armor: 'armor',
  accesorios: 'accessory', accesorio: 'accessory', accessory: 'accessory',
  consumibles: 'consumable', consumible: 'consumable', consumable: 'consumable'
};

// ==================== MEJORA (+1 a +10) ====================

/** Probabilidad base de éxito para llegar a cada nivel */
const ENHANCE_SUCCESS_RATES: Record<number, number> = { 1: 95, 2: 90, 3: 80, 4: 70, 5: 60, 6: 45, 7: 30, 8: 20, 9: 10, 10: 5 };

const ENHANCE_MATERIALS: Record<number, MaterialRequirement[]> = {
  1: [{ materialId: 'hierro', quantity: 3 }],
  2: [{ materialId: 'hierro', quantity: 5 }],
  3: [{ materialId: 'acero', quantity: 3 }, { materialId: 'carbon', quantity: 5 }],
  4: [{ materialId: 'acero', quantity: 5 }, { materialId: 'cristal', quantity: 2 }],
  5: [{ materialId: 'titanio', quantity: 3 }, { materialId: 'cristal', quantity: 3 }],
  6: [{ materialId: 'titanio', quantity: 5 }, { materialId: 'rubi', quantity: 1 }],
  7: [{ materialId: 'mithril', quantity: 3 }, { materialId: 'fragmento_alma', quantity: 2 }],
  8: [{ materialId: 'mithril', quantity: 5 }, { materialId: 'fragmento_alma', quantity: 3 }],
  9: [{ materialId: 'adamantita', quantity: 3 }, { materialId: 'polvo_estelar', quantity: 2 }],
  10: [{ materialId: 'adamantita', quantity: 5 }, { materialId: 'nucleo_elemental', quantity: 1 }]
};

const ENHANCE_GOLD_COST: Record<number, number> = {
  1: 100, 2: 250, 3: 500, 4: 1000, 5: 2500, 6: 5000, 7: 10000, 8: 25000, 9: 50000, 10: 100000
};

/** A partir de este nivel la mejora pide confirmación */
const DANGEROUS_LEVEL = 6;
/** A partir de este nivel un fallo puede destruir el item */
const DESTROY_LEVEL = 8;
const DESTROY_CHANCE = 30;
const CONFIRM_TIMEOUT = 60 * 1000;

interface PendingEnhance {
  slot: EquipmentSlot;
  itemId: string;
  fromLevel: number;
  chat: string;
  expiresAt: number;
}

const pendingConfirm = new Map<string, PendingEnhance>();

/**
 * Confirmación pendiente del jugador en este chat. Un mensaje suyo en otro chat
 * no la toca (el handler evalúa isActive de todos los contextos con cada
 * mensaje); solo caduca por tiempo.
 */
function getPending(jid: string, chat: string, now: number = Date.now()): PendingEnhance | null {
  const pending = pendingConfirm.get(jid);
  if (!pending) return null;
  if (pending.expiresAt <= now) {
    pendingConfirm.delete(jid);
    return null;
  }
  return pending.chat === chat ? pending : null;
}

/** Bonus de la Poción del Herrero (puntos porcentuales) */
function forgeBoost(user: UserRPG, now: number = Date.now()): number {
  return activeBuffs(user, now).filter(b => b.type === 'forgeBoost').reduce((sum, b) => sum + b.value, 0);
}

function effectiveRate(base: number, user: UserRPG): number {
  return Math.min(100, base + forgeBoost(user));
}

function materialsLine(materials: readonly MaterialRequirement[]): string {
  return materials.map(m => `${FORGE_MATERIALS[m.materialId]?.emoji ?? '?'}x${m.quantity}`).join(', ');
}

function missingMaterialsText(user: UserRPG, materials: readonly MaterialRequirement[]): string {
  let text = '';
  for (const req of materials) {
    const material = FORGE_MATERIALS[req.materialId];
    const have = getMaterialCount(user, req.materialId);
    text += `${have < req.quantity ? '❌' : '✅'} ${material?.emoji ?? '?'} ${material?.name ?? req.materialId}: ${have}/${req.quantity}\n`;
  }
  return text;
}

function paginate<T>(items: T[], page: number): { slice: T[]; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(items.length / SHOP.PAGE_SIZE));
  const safePage = Math.min(pages, Math.max(1, page));
  const start = (safePage - 1) * SHOP.PAGE_SIZE;
  return { slice: items.slice(start, start + SHOP.PAGE_SIZE), page: safePage, pages };
}

// ==================== PLUGINS ====================

export const forjaMenuPlugin: PluginHandler = {
  command: ['forja', 'forge', 'herreria', 'blacksmith'],
  tags: ['rpg'],
  help: [
    'forja - Ver menú de la herrería',
    'forja recetas [categoría] [página] - Ver recetas',
    'forja craftear [item o id] - Crear un item',
    'forja mejorar [arma|armadura|accesorio] - Mejorar el equipo (+1 a +10)',
    'forja materiales - Ver tus materiales',
    'forja fundir [item] - Convertir un item en materiales',
    'forja vender [material] [cantidad] - Vender materiales'
  ],
  register: true,

  handler: async (ctx: MessageContext) => {
    const { m, args, usedPrefix } = ctx;
    const db = getDatabase();
    const user = db.getUser(m.sender);
    if (migrateLegacyMaterials(user)) db.updateUser(m.sender, { inventory: user.inventory, forgeMaterials: user.forgeMaterials });

    const sub = args[0]?.toLowerCase();
    const rest = args.slice(1);

    switch (sub) {
      case 'recetas': case 'recipes': return handleRecetas(ctx, user, rest);
      case 'craftear': case 'craft': case 'crear': return handleCraftear(ctx, user, rest);
      case 'mejorar': case 'enhance': case 'upgrade': return handleMejorar(ctx, user, rest);
      case 'materiales': case 'materials': case 'mats': return handleMateriales(ctx, user);
      case 'fundir': case 'smelt': case 'melt': return handleFundir(ctx, user, rest);
      case 'vender': case 'sell': return handleVender(ctx, user, rest);
      // Con prefijo, para cuando el contexto de confirmación no está registrado
      case 'confirmar': case 'si': case 'sí': return confirmPending(ctx);
      case 'cancelar': case 'no': return cancelPendingEnhance(ctx);
    }

    const totalMaterials = listMaterials(user).reduce((sum, entry) => sum + entry.quantity, 0);
    const boost = forgeBoost(user);

    let response = `⚒️ *HERRERÍA* ⚒️\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    response += `👤 Herrero: *${user.name}*\n`;
    response += `📊 Nivel: *${user.level}*\n`;
    response += `💰 Oro: *$${formatNumber(user.money)}*\n`;
    response += `📦 Materiales: *${totalMaterials}*\n`;
    if (boost > 0) response += `🧪 Poción del Herrero activa: *+${boost}%* de éxito\n`;
    response += `\n📋 *SERVICIOS:*\n\n`;
    response += `🔧 *${usedPrefix}forja recetas [categoría]*\n   _Ver recetas (armas, armaduras, accesorios, consumibles)_\n\n`;
    response += `⚒️ *${usedPrefix}forja craftear [item o id]*\n   _Crear un item con materiales_\n\n`;
    response += `⬆️ *${usedPrefix}forja mejorar [arma|armadura|accesorio]*\n   _Mejorar tu equipo (+1 a +10, +${FORGE.ENHANCE_BONUS_PER_LEVEL}% stats por nivel)_\n\n`;
    response += `📦 *${usedPrefix}forja materiales*\n   _Ver tus materiales de forja_\n\n`;
    response += `🔥 *${usedPrefix}forja fundir [item]*\n   _Convertir equipo en materiales_\n\n`;
    response += `💵 *${usedPrefix}forja vender [material] [n]*\n   _Vender materiales sobrantes_\n\n`;
    response += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    response += `💡 _Consigue materiales con ${usedPrefix}minar, en dungeons o en ${usedPrefix}tienda materiales_`;

    await m.reply(response);
  }
};

async function handleRecetas(ctx: MessageContext, user: UserRPG, args: string[]): Promise<void> {
  const { m, usedPrefix } = ctx;
  const words = [...args];
  let page = 1;
  if (words.length && /^\d+$/.test(words[words.length - 1])) page = parseInt(words.pop() as string, 10);
  const categoryWord = words.join(' ').toLowerCase();
  const category = RECIPE_CATEGORY_ALIASES[categoryWord];

  const recipes = category ? FORGE_RECIPES.filter(r => r.category === category) : FORGE_RECIPES;
  const sorted = [...recipes].sort((a, b) => a.requiredLevel - b.requiredLevel);
  const result = paginate(sorted, page);
  const title = category ? categoryWord.toUpperCase() : 'TODAS';

  let response = `📜 *RECETAS DE FORJA - ${title}* (${result.page}/${result.pages})\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  for (const recipe of result.slice) {
    const unlocked = user.level >= recipe.requiredLevel;
    const missing = missingMaterials(user, recipe.materials).length === 0;
    const status = !unlocked ? '🔒' : missing ? '✅' : '📦';
    response += `${status} ${recipe.emoji} *${recipe.name}* \`${recipe.resultItemId}\`\n`;
    response += `   Nv.${recipe.requiredLevel} | Éxito: ${effectiveRate(recipe.successRate, user)}% | $${formatNumber(recipe.goldCost)}\n`;
    response += `   ${materialsLine(recipe.materials)}\n\n`;
  }
  response += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  if (result.pages > 1) response += `📄 *${usedPrefix}forja recetas ${categoryWord || ''}${categoryWord ? ' ' : ''}${result.page + 1}* para la siguiente página\n`;
  response += `⚒️ *${usedPrefix}forja craftear [nombre o id]*\n`;
  response += `📂 Filtros: armas, armaduras, accesorios, consumibles\n`;
  response += `✅ tienes los materiales · 📦 te faltan · 🔒 nivel insuficiente`;

  await m.reply(response);
}

async function handleCraftear(ctx: MessageContext, user: UserRPG, args: string[]): Promise<void> {
  const { m, usedPrefix } = ctx;
  const db = getDatabase();
  const term = args.join(' ').trim();

  if (!term) {
    await m.reply(`${EMOJI.error} Especifica qué quieres craftear.\n\n📝 *Uso:* ${usedPrefix}forja craftear espada de acero\n💡 Usa *${usedPrefix}forja recetas* para ver opciones.`);
    return;
  }

  const candidates = FORGE_RECIPES.map(r => ({ id: r.resultItemId, name: r.name, emoji: r.emoji, recipe: r }));
  const result = resolveItem(term, candidates);
  if (result.status === 'none') {
    await m.reply(`${EMOJI.error} No encontré esa receta.\n\n🔍 Buscaste: "${term}"\n💡 Usa *${usedPrefix}forja recetas* para ver opciones.`);
    return;
  }
  if (result.status === 'ambiguous') {
    await m.reply(formatAmbiguous(result.candidates));
    return;
  }
  const recipe = result.item.recipe;

  if (user.level < recipe.requiredLevel) {
    await m.reply(`${EMOJI.error} Nivel insuficiente.\n\n📊 Tu nivel: *${user.level}*\n🎯 Nivel requerido: *${recipe.requiredLevel}*`);
    return;
  }
  if (user.money < recipe.goldCost) {
    await m.reply(`${EMOJI.error} No tienes suficiente oro.\n\n💰 Tu oro: *$${formatNumber(user.money)}*\n💵 Costo: *$${formatNumber(recipe.goldCost)}*`);
    return;
  }
  if (missingMaterials(user, recipe.materials).length > 0) {
    await m.reply(`${EMOJI.error} *Materiales insuficientes*\n\n📋 *Necesitas:*\n${missingMaterialsText(user, recipe.materials)}\n💡 _Consigue materiales con ${usedPrefix}minar o en ${usedPrefix}tienda materiales_`);
    return;
  }
  const resultItem = ITEMS[recipe.resultItemId];
  if (!resultItem) {
    await m.reply(`${EMOJI.error} Esa receta apunta a un item que no existe (${recipe.resultItemId}).`);
    return;
  }
  if (freeInventorySpace(user) < 1) {
    await m.reply(`${EMOJI.error} Tu inventario está lleno (${LIMITS.MAX_INVENTORY_SIZE}). Vende o funde algo antes de forjar.`);
    return;
  }

  await m.react('⚒️');

  const rate = effectiveRate(recipe.successRate, user);
  const roll = randomInt(1, 100);
  const success = roll <= rate;

  // Materiales y oro se consumen siempre; es el riesgo de la forja
  if (!consumeMaterials(user, recipe.materials)) {
    await m.reply(`${EMOJI.error} Te faltan materiales.`);
    return;
  }
  user.money -= recipe.goldCost;
  updateQuestProgress(db, m.sender, 'spend', recipe.goldCost);

  if (success) {
    addItem(user, recipe.resultItemId, 1);
    db.updateUser(m.sender, { money: user.money, forgeMaterials: user.forgeMaterials, inventory: user.inventory });

    let response = `⚒️ *¡FORJA EXITOSA!* ⚒️\n\n🎉 Has creado:\n${resultItem.emoji} *${resultItem.name}*\n\n`;
    if (resultItem.stats) {
      response += `📊 *Estadísticas:*\n`;
      if (resultItem.stats.attack) response += `   ⚔️ Ataque: +${resultItem.stats.attack}\n`;
      if (resultItem.stats.defense) response += `   🛡️ Defensa: +${resultItem.stats.defense}\n`;
      if (resultItem.stats.health) response += `   ❤️ Vida: +${resultItem.stats.health}\n`;
      if (resultItem.stats.mana) response += `   💠 Maná: +${resultItem.stats.mana}\n`;
      if (resultItem.stats.critChance) response += `   🎯 Crítico: +${resultItem.stats.critChance}%\n`;
    }
    response += `\n🎲 Tiraste *${roll}* (necesitabas ≤${rate})\n`;
    response += `💰 Gastaste: *$${formatNumber(recipe.goldCost)}*\n`;
    response += `📦 _El item está en tu inventario_`;
    await m.reply(response);
    await m.react('✅');
    return;
  }

  db.updateUser(m.sender, { money: user.money, forgeMaterials: user.forgeMaterials });
  await m.reply(
    `⚒️ *¡FORJA FALLIDA!* 💔\n\n😔 La forja no salió bien...\n${recipe.emoji} *${recipe.name}* se destruyó.\n\n` +
    `💸 Perdiste:\n   💰 $${formatNumber(recipe.goldCost)}\n   📦 ${materialsLine(recipe.materials)}\n\n` +
    `🎲 Tiraste *${roll}* (necesitabas ≤${rate})\n💡 _¡Inténtalo de nuevo!_`
  );
  await m.react('💔');
}

async function handleMateriales(ctx: MessageContext, user: UserRPG): Promise<void> {
  const { m, usedPrefix } = ctx;
  const materials = listMaterials(user);

  if (materials.length === 0) {
    await m.reply(`📦 *TUS MATERIALES*\n\nNo tienes materiales de forja.\n\n💡 Consíguelos con *${usedPrefix}minar*, en dungeons o en *${usedPrefix}tienda materiales*`);
    return;
  }

  const titles: Record<ItemRarity, string> = { legendario: '🟨 *LEGENDARIOS:*', epico: '🟪 *ÉPICOS:*', raro: '🟦 *RAROS:*', comun: '⬜ *COMUNES:*' };
  let response = `📦 *TUS MATERIALES DE FORJA*\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  let current: ItemRarity | null = null;
  let totalValue = 0;
  for (const { material, quantity } of materials) {
    if (material.rarity !== current) {
      current = material.rarity;
      response += `${titles[current]}\n`;
    }
    response += `   ${material.emoji} ${material.name}: x${quantity} (\`${material.id}\`)\n`;
    totalValue += material.sellPrice * quantity;
  }
  response += `\n💵 Valor de venta total: *$${formatNumber(totalValue)}*\n`;
  response += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  response += `💡 *${usedPrefix}forja recetas* para ver qué puedes crear\n`;
  response += `💡 *${usedPrefix}forja vender [material] [n]* para vender`;

  await m.reply(response);
}

/** Separa del montón la unidad que se va a mejorar para que el +N no se herede */
function splitEnhanceEntry(user: UserRPG, entry: InventoryItem): InventoryItem {
  if (entry.quantity <= 1) return entry;
  entry.quantity--;
  const single: InventoryItem = { itemId: entry.itemId, quantity: 1, enhanceLevel: entry.enhanceLevel || 0 };
  const index = user.inventory.indexOf(entry);
  user.inventory.splice(index, 0, single);
  return single;
}

/** Una entrada que vuelve a +0 se funde con el montón sin mejorar si existe */
function mergePlainEntry(user: UserRPG, entry: InventoryItem): void {
  if ((entry.enhanceLevel || 0) > 0) return;
  const plain = user.inventory.find(e => e !== entry && e.itemId === entry.itemId && !(e.enhanceLevel && e.enhanceLevel > 0));
  if (!plain) return;
  plain.quantity += entry.quantity;
  user.inventory = user.inventory.filter(e => e !== entry);
}

async function handleMejorar(ctx: MessageContext, user: UserRPG, args: string[]): Promise<void> {
  const { m, usedPrefix } = ctx;
  const slot = SLOT_ALIASES[args[0]?.toLowerCase() ?? ''];

  if (!slot) {
    await m.reply(
      `⬆️ *SISTEMA DE MEJORA*\n\n` +
      `Mejora tu equipo de +0 a +${FORGE.MAX_ENHANCE_LEVEL}.\nCada nivel da *+${FORGE.ENHANCE_BONUS_PER_LEVEL}%* a los stats del item.\n\n` +
      `📝 *Uso:*\n   ${usedPrefix}forja mejorar arma\n   ${usedPrefix}forja mejorar armadura\n   ${usedPrefix}forja mejorar accesorio\n\n` +
      `⚠️ *Advertencia:* si fallas, el item puede perder un nivel o destruirse (+${DESTROY_LEVEL} en adelante).`
    );
    return;
  }

  const equippedId = user.equipment[slot];
  if (!equippedId) {
    await m.reply(`${EMOJI.error} No tienes nada equipado en ese slot.`);
    return;
  }
  const entry = findEquippedEntry(user, slot);
  const itemData = ITEMS[equippedId];
  if (!entry || !itemData) {
    await m.reply(`${EMOJI.error} No encuentro el item equipado en tu inventario.`);
    return;
  }

  const currentLevel = entry.enhanceLevel || 0;
  const nextLevel = currentLevel + 1;
  if (nextLevel > FORGE.MAX_ENHANCE_LEVEL) {
    await m.reply(`${EMOJI.error} Este item ya está al máximo (+${FORGE.MAX_ENHANCE_LEVEL}).\n\n${itemData.emoji} *${itemData.name} +${FORGE.MAX_ENHANCE_LEVEL}*\n_¡Has alcanzado la perfección!_`);
    return;
  }

  const check = checkEnhanceRequirements(user, nextLevel);
  if (check) {
    await m.reply(check);
    return;
  }

  if (nextLevel >= DANGEROUS_LEVEL) {
    const now = Date.now();
    pendingConfirm.set(m.sender, { slot, itemId: equippedId, fromLevel: currentLevel, chat: m.chat, expiresAt: now + CONFIRM_TIMEOUT });
    const rate = effectiveRate(ENHANCE_SUCCESS_RATES[nextLevel], user);
    let response = `⚠️ *MEJORA PELIGROSA*\n\n`;
    response += `${itemData.emoji} *${itemData.name} +${currentLevel}* → *+${nextLevel}*\n\n`;
    response += `🎲 Probabilidad de éxito: *${rate}%*\n\n`;
    response += `❌ *Si fallas:*\n`;
    if (nextLevel >= DESTROY_LEVEL) response += `   • El item puede DESTRUIRSE (${DESTROY_CHANCE}%)\n`;
    response += `   • El item bajará a +${Math.max(0, currentLevel - 1)}\n\n`;
    response += `💰 Costo: *$${formatNumber(ENHANCE_GOLD_COST[nextLevel])}*\n`;
    response += `📦 Materiales: ${materialsLine(ENHANCE_MATERIALS[nextLevel])}\n\n`;
    response += `✍️ Responde *si* para continuar o *no* para cancelar (${CONFIRM_TIMEOUT / 1000} s).\n_También: ${usedPrefix}forja confirmar / ${usedPrefix}forja cancelar_`;
    await m.reply(response);
    return;
  }

  await performEnhance(ctx, user, slot);
}

/** Mensaje de error si no se puede pagar la mejora, o null */
function checkEnhanceRequirements(user: UserRPG, nextLevel: number): string | null {
  const goldCost = ENHANCE_GOLD_COST[nextLevel];
  const materials = ENHANCE_MATERIALS[nextLevel];
  if (user.money < goldCost) {
    return `${EMOJI.error} No tienes suficiente oro.\n\n💰 Tu oro: *$${formatNumber(user.money)}*\n💵 Costo: *$${formatNumber(goldCost)}*`;
  }
  if (missingMaterials(user, materials).length > 0) {
    return `${EMOJI.error} *Materiales insuficientes para +${nextLevel}*\n\n${missingMaterialsText(user, materials)}`;
  }
  return null;
}

async function performEnhance(ctx: MessageContext, user: UserRPG, slot: EquipmentSlot): Promise<void> {
  const { m } = ctx;
  const db = getDatabase();
  const equippedId = user.equipment[slot];
  const equipped = equippedId ? findEquippedEntry(user, slot) : null;
  const itemData = equippedId ? ITEMS[equippedId] : undefined;
  if (!equippedId || !equipped || !itemData) {
    await m.reply(`${EMOJI.error} Ya no tienes ese item equipado.`);
    return;
  }

  const currentLevel = equipped.enhanceLevel || 0;
  const nextLevel = currentLevel + 1;
  if (nextLevel > FORGE.MAX_ENHANCE_LEVEL) {
    await m.reply(`${EMOJI.error} Este item ya está al máximo.`);
    return;
  }
  const check = checkEnhanceRequirements(user, nextLevel);
  if (check) {
    await m.reply(check);
    return;
  }

  await m.react('⬆️');

  const rate = effectiveRate(ENHANCE_SUCCESS_RATES[nextLevel], user);
  const goldCost = ENHANCE_GOLD_COST[nextLevel];
  const roll = randomInt(1, 100);
  const success = roll <= rate;

  if (!consumeMaterials(user, ENHANCE_MATERIALS[nextLevel])) {
    await m.reply(`${EMOJI.error} Te faltan materiales.`);
    return;
  }
  user.money -= goldCost;
  updateQuestProgress(db, m.sender, 'spend', goldCost);

  const entry = splitEnhanceEntry(user, equipped);

  if (success) {
    entry.enhanceLevel = nextLevel;
    db.updateUser(m.sender, { money: user.money, forgeMaterials: user.forgeMaterials, inventory: user.inventory });

    let response = `⬆️ *¡MEJORA EXITOSA!* ⬆️\n\n${itemData.emoji} *${itemData.name}*\n+${currentLevel} → *+${nextLevel}* ✨\n\n`;
    response += `📊 *Bonus de mejora:* +${nextLevel * FORGE.ENHANCE_BONUS_PER_LEVEL}% a los stats del item\n`;
    response += `🎲 Tiraste: *${roll}* (necesitabas ≤${rate})\n\n`;
    response += nextLevel === FORGE.MAX_ENHANCE_LEVEL
      ? `🎉 *¡FELICIDADES!* ¡Has alcanzado +${FORGE.MAX_ENHANCE_LEVEL}!`
      : `💡 Siguiente mejora: +${nextLevel + 1} (${effectiveRate(ENHANCE_SUCCESS_RATES[nextLevel + 1], user)}%)`;
    await m.reply(response);
    await m.react('✅');
    return;
  }

  const destroyed = nextLevel >= DESTROY_LEVEL && randomInt(1, 100) <= DESTROY_CHANCE;
  const newLevel = destroyed ? 0 : Math.max(0, currentLevel - 1);

  if (destroyed) {
    // Solo se destruye la unidad mejorada; si quedan otras del mismo item siguen equipadas
    user.inventory = user.inventory.filter(e => e !== entry);
    if (!user.inventory.some(e => e.itemId === equippedId)) user.equipment[slot] = null;
  } else {
    entry.enhanceLevel = newLevel;
    mergePlainEntry(user, entry);
  }

  db.updateUser(m.sender, { money: user.money, forgeMaterials: user.forgeMaterials, inventory: user.inventory, equipment: user.equipment });

  let response = `⬆️ *¡MEJORA FALLIDA!* 💔\n\n${itemData.emoji} *${itemData.name}*\n\n`;
  if (destroyed) response += `💥 *¡EL ITEM SE DESTRUYÓ!* 💥\n\nEl item no soportó la presión y se hizo añicos.\n`;
  else if (newLevel < currentLevel) response += `📉 El item bajó de +${currentLevel} a *+${newLevel}*\n\n`;
  else response += `El item se mantuvo en +${currentLevel}\n\n`;
  response += `🎲 Tiraste: *${roll}* (necesitabas ≤${rate})\n`;
  response += `💸 Perdiste: $${formatNumber(goldCost)} + ${materialsLine(ENHANCE_MATERIALS[nextLevel])}`;
  await m.reply(response);
  await m.react('💔');
}

const SMELT_TABLE: Record<ItemRarity, { materials: string[]; min: number; max: number }> = {
  comun: { materials: ['hierro', 'carbon', 'cobre', 'piedra'], min: 1, max: 3 },
  raro: { materials: ['acero', 'plata', 'cristal', 'cuero'], min: 3, max: 5 },
  epico: { materials: ['titanio', 'rubi', 'esmeralda', 'zafiro', 'fragmento_alma'], min: 5, max: 8 },
  legendario: { materials: ['mithril', 'adamantita', 'diamante', 'polvo_estelar', 'nucleo_elemental'], min: 8, max: 12 }
};

async function handleFundir(ctx: MessageContext, user: UserRPG, args: string[]): Promise<void> {
  const { m, usedPrefix } = ctx;
  const db = getDatabase();
  const term = args.join(' ').trim();

  if (!term) {
    await m.reply(
      `🔥 *FUNDICIÓN*\n\nConvierte equipo en materiales de forja.\n\n📝 *Uso:* ${usedPrefix}forja fundir espada de hierro\n\n` +
      `💡 Materiales según la rareza del item:\n   ⬜ Común: 1-3\n   🟦 Raro: 3-5\n   🟪 Épico: 5-8\n   🟨 Legendario: 8-12`
    );
    return;
  }

  const candidates = inventoryItems(user).filter(isEquipable);
  const result = resolveItem(term, candidates);
  if (result.status === 'none') {
    await m.reply(`${EMOJI.error} No encontré ese equipo en tu inventario.\n\n💡 Solo se funden armas, armaduras y accesorios. Usa *${usedPrefix}inventario*.`);
    return;
  }
  if (result.status === 'ambiguous') {
    await m.reply(formatAmbiguous(result.candidates));
    return;
  }
  const item: Item = result.item;
  if (isEquipped(user, item.id)) {
    await m.reply(`${EMOJI.error} No puedes fundir un item equipado. Usa *${usedPrefix}desequipar* primero.`);
    return;
  }

  // Se funde la unidad sin mejorar si la hay; si no, la de menor nivel
  const entries = user.inventory.filter(e => e.itemId === item.id).sort((a, b) => (a.enhanceLevel || 0) - (b.enhanceLevel || 0));
  const entry = entries[0];
  if (!entry) {
    await m.reply(`${EMOJI.error} No tienes ese item.`);
    return;
  }
  entry.quantity--;
  if (entry.quantity <= 0) user.inventory = user.inventory.filter(e => e !== entry);

  const table = SMELT_TABLE[item.rarity];
  const total = randomInt(table.min, table.max);
  const obtained = new Map<string, number>();
  for (let i = 0; i < total; i++) {
    const id = pickRandom(table.materials);
    obtained.set(id, (obtained.get(id) || 0) + 1);
  }
  for (const [id, qty] of obtained) addMaterial(user, id, qty);

  db.updateUser(m.sender, { inventory: user.inventory, forgeMaterials: user.forgeMaterials });

  let response = `🔥 *¡FUNDICIÓN COMPLETA!* 🔥\n\n${item.emoji} *${item.name}*${entry.enhanceLevel ? ` +${entry.enhanceLevel}` : ''} se ha fundido.\n\n📦 *Materiales obtenidos:*\n`;
  for (const [id, qty] of obtained) {
    const material = FORGE_MATERIALS[id];
    response += `   ${material.emoji} ${material.name}: x${qty}\n`;
  }
  response += `\n💡 Usa *${usedPrefix}forja materiales* para ver tu almacén.`;

  await m.reply(response);
  await m.react('🔥');
}

async function handleVender(ctx: MessageContext, user: UserRPG, args: string[]): Promise<void> {
  const { m, usedPrefix } = ctx;
  const db = getDatabase();
  const words = [...args];
  let quantity = 1;
  if (words.length > 1 && /^\d+$/.test(words[words.length - 1])) quantity = Math.max(1, parseInt(words.pop() as string, 10));
  const term = words.join(' ').trim();

  if (!term) {
    await m.reply(`${EMOJI.error} Especifica qué material vender.\n\n📝 *Uso:* ${usedPrefix}forja vender hierro 10\n💡 *${usedPrefix}forja materiales* muestra lo que tienes.`);
    return;
  }

  const owned = listMaterials(user).map(entry => entry.material);
  const result = resolveItem(term, owned);
  if (result.status === 'none') {
    await m.reply(`${EMOJI.error} No tienes ese material.\n\n💡 *${usedPrefix}forja materiales* muestra lo que tienes.`);
    return;
  }
  if (result.status === 'ambiguous') {
    await m.reply(formatAmbiguous(result.candidates));
    return;
  }
  const material = result.item;
  const have = getMaterialCount(user, material.id);
  if (!removeMaterial(user, material.id, quantity)) {
    await m.reply(`${EMOJI.error} No tienes tantos.\n\n📦 Tienes: *${have}* ${material.name}`);
    return;
  }

  const total = material.sellPrice * quantity;
  db.updateUser(m.sender, { money: user.money + total, totalEarned: user.totalEarned + total, forgeMaterials: user.forgeMaterials });
  updateQuestProgress(db, m.sender, 'earn', total);

  await m.reply(
    `${EMOJI.success} ¡Venta exitosa!\n\n📦 Vendiste: ${material.emoji} *${material.name}* x${quantity}\n` +
    `💰 Ganaste: *${formatNumber(total)}* monedas\n💵 Total: *${formatNumber(user.money + total)}* monedas\n` +
    `📦 Te quedan: *${have - quantity}* ${material.name}`
  );
  await m.react('💰');
}

// ==================== CONTEXTO DE CONFIRMACIÓN ====================

/** Sin prefijo solo cuenta "si"/"no" a secas: "si claro que no" no confirma nada */
function isBareAnswer(ctx: MessageContext): boolean {
  return Boolean(ctx.usedPrefix) || ctx.args.length === 0;
}

async function confirmPending(ctx: MessageContext): Promise<void> {
  const { m, usedPrefix } = ctx;
  const pending = getPending(m.sender, m.chat);
  if (!pending) {
    if (usedPrefix) await m.reply(`${EMOJI.info} No tienes ninguna mejora pendiente de confirmar.`);
    return;
  }
  pendingConfirm.delete(m.sender);

  const db = getDatabase();
  const user = db.getUser(m.sender);
  const entry = findEquippedEntry(user, pending.slot);
  if (user.equipment[pending.slot] !== pending.itemId || !entry || (entry.enhanceLevel || 0) !== pending.fromLevel) {
    await m.reply(`${EMOJI.warning} El item cambió desde que pediste la mejora. Vuelve a usar la forja.`);
    return;
  }
  await performEnhance(ctx, user, pending.slot);
}

async function cancelPendingEnhance(ctx: MessageContext): Promise<void> {
  const { m, usedPrefix } = ctx;
  if (!getPending(m.sender, m.chat)) {
    if (usedPrefix) await m.reply(`${EMOJI.info} No tienes ninguna mejora pendiente.`);
    return;
  }
  pendingConfirm.delete(m.sender);
  await m.reply(`${EMOJI.info} Mejora cancelada. Tu equipo sigue intacto.`);
}

const confirmarForjaPlugin: PluginHandler = {
  command: ['si', 'sí', 'yes', 'confirmar', 'confirm'],
  tags: ['rpg'],
  help: ['si - Confirma la mejora peligrosa pendiente'],
  noPrefix: true,
  handler: async (ctx: MessageContext) => {
    if (isBareAnswer(ctx)) await confirmPending(ctx);
  }
};

const cancelarForjaPlugin: PluginHandler = {
  command: ['no', 'cancelar', 'cancel'],
  tags: ['rpg'],
  help: ['no - Cancela la mejora pendiente'],
  noPrefix: true,
  handler: async (ctx: MessageContext) => {
    if (isBareAnswer(ctx)) await cancelPendingEnhance(ctx);
  }
};

/** Mientras haya una mejora peligrosa pendiente, "si"/"no" sin prefijo la resuelven */
export const forgeContext: CommandContext = {
  name: 'forja',
  isActive: (m: SerializedMessage) => getPending(m.sender, m.chat) !== null,
  plugins: [confirmarForjaPlugin, cancelarForjaPlugin],
  noPrefix: true
};

export default forjaMenuPlugin;
