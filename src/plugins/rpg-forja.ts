/**
 * ⚒️ Sistema de Forja - CYALTRONIC RPG
 * Craftear items, mejorar equipamiento, fundir materiales
 *
 * Comandos:
 * - /forja - Ver menú de forja
 * - /forja recetas - Ver recetas disponibles
 * - /forja craftear [item] - Crear un item
 * - /forja mejorar - Mejorar item equipado
 * - /forja fundir [item] - Convertir items en materiales
 */

import type { PluginHandler, MessageContext } from '../types/message.js';
import { getDatabase } from '../lib/database.js';
import { EMOJI, formatNumber, pickRandom, randomInt } from '../lib/utils.js';
import { ITEMS, RARITY_COLORS, type Item, type ItemRarity } from '../types/rpg.js';

// ==================== MATERIALES DE FORJA ====================

export interface ForgeMaterial {
  id: string;
  name: string;
  emoji: string;
  rarity: ItemRarity;
  description: string;
  sellPrice: number;
}

export const FORGE_MATERIALS: Record<string, ForgeMaterial> = {
  // Minerales básicos (se obtienen minando)
  carbon: { id: 'carbon', name: 'Carbón', emoji: '⬛', rarity: 'comun', description: 'Combustible para la forja', sellPrice: 5 },
  piedra: { id: 'piedra', name: 'Piedra', emoji: '🪨', rarity: 'comun', description: 'Material de construcción básico', sellPrice: 3 },
  cobre: { id: 'cobre', name: 'Cobre', emoji: '🟤', rarity: 'comun', description: 'Metal maleable y conductor', sellPrice: 10 },
  hierro: { id: 'hierro', name: 'Hierro', emoji: '⚪', rarity: 'comun', description: 'Metal versátil y resistente', sellPrice: 15 },

  // Minerales raros
  plata: { id: 'plata', name: 'Plata', emoji: '🩶', rarity: 'raro', description: 'Metal precioso y conductor mágico', sellPrice: 40 },
  oro: { id: 'oro', name: 'Oro', emoji: '🟡', rarity: 'raro', description: 'Metal noble de gran valor', sellPrice: 60 },
  cristal: { id: 'cristal', name: 'Cristal', emoji: '🔷', rarity: 'raro', description: 'Cristal mágico puro', sellPrice: 50 },
  acero: { id: 'acero', name: 'Acero', emoji: '⬜', rarity: 'raro', description: 'Aleación superior al hierro', sellPrice: 75 },

  // Minerales épicos
  rubi: { id: 'rubi', name: 'Rubí', emoji: '🔴', rarity: 'epico', description: 'Gema de fuego interior', sellPrice: 150 },
  esmeralda: { id: 'esmeralda', name: 'Esmeralda', emoji: '🟢', rarity: 'epico', description: 'Gema de la naturaleza', sellPrice: 150 },
  zafiro: { id: 'zafiro', name: 'Zafiro', emoji: '🔵', rarity: 'epico', description: 'Gema del océano profundo', sellPrice: 150 },
  titanio: { id: 'titanio', name: 'Titanio', emoji: '🔘', rarity: 'epico', description: 'Metal ligero y ultra resistente', sellPrice: 200 },

  // Minerales legendarios
  diamante: { id: 'diamante', name: 'Diamante', emoji: '💎', rarity: 'legendario', description: 'La gema más dura y valiosa', sellPrice: 500 },
  mithril: { id: 'mithril', name: 'Mithril', emoji: '✨', rarity: 'legendario', description: 'Metal élfico legendario', sellPrice: 600 },
  adamantita: { id: 'adamantita', name: 'Adamantita', emoji: '💠', rarity: 'legendario', description: 'El metal más resistente conocido', sellPrice: 800 },

  // Materiales especiales (drops de monstruos/dungeons)
  cuero: { id: 'cuero', name: 'Cuero', emoji: '🟫', rarity: 'comun', description: 'Piel curtida de bestias', sellPrice: 20 },
  escama_dragon: { id: 'escama_dragon', name: 'Escama de Dragón', emoji: '🐉', rarity: 'legendario', description: 'Escama de un dragón ancestral', sellPrice: 1000 },
  esencia_fuego: { id: 'esencia_fuego', name: 'Esencia de Fuego', emoji: '🔥', rarity: 'epico', description: 'Fuego elemental condensado', sellPrice: 250 },
  esencia_hielo: { id: 'esencia_hielo', name: 'Esencia de Hielo', emoji: '❄️', rarity: 'epico', description: 'Hielo elemental condensado', sellPrice: 250 },
  esencia_rayo: { id: 'esencia_rayo', name: 'Esencia de Rayo', emoji: '⚡', rarity: 'epico', description: 'Electricidad elemental condensada', sellPrice: 250 },
  fragmento_alma: { id: 'fragmento_alma', name: 'Fragmento de Alma', emoji: '👻', rarity: 'epico', description: 'Esencia espiritual pura', sellPrice: 300 },
  polvo_estelar: { id: 'polvo_estelar', name: 'Polvo Estelar', emoji: '⭐', rarity: 'legendario', description: 'Polvo de estrellas caídas', sellPrice: 750 },
  nucleo_elemental: { id: 'nucleo_elemental', name: 'Núcleo Elemental', emoji: '🌀', rarity: 'legendario', description: 'Núcleo de poder elemental puro', sellPrice: 1200 },
};

// ==================== RECETAS DE FORJA ====================

export interface ForgeRecipe {
  id: string;
  name: string;
  emoji: string;
  description: string;
  resultItemId: string;  // ID del item que se crea (de ITEMS o nuevo)
  materials: { materialId: string; quantity: number }[];
  goldCost: number;
  requiredLevel: number;
  successRate: number;  // 0-100
  category: 'weapon' | 'armor' | 'accessory' | 'consumable';
}

export const FORGE_RECIPES: ForgeRecipe[] = [
  // ==================== ARMAS BÁSICAS ====================
  {
    id: 'craft_espada_hierro',
    name: 'Espada de Hierro',
    emoji: '🗡️',
    description: 'Una espada básica pero confiable',
    resultItemId: 'espada_hierro',
    materials: [
      { materialId: 'hierro', quantity: 5 },
      { materialId: 'carbon', quantity: 3 },
      { materialId: 'cuero', quantity: 1 }
    ],
    goldCost: 200,
    requiredLevel: 5,
    successRate: 95,
    category: 'weapon'
  },
  {
    id: 'craft_espada_acero',
    name: 'Espada de Acero',
    emoji: '⚔️',
    description: 'Forjada por herreros expertos',
    resultItemId: 'espada_acero',
    materials: [
      { materialId: 'acero', quantity: 5 },
      { materialId: 'hierro', quantity: 3 },
      { materialId: 'carbon', quantity: 5 },
      { materialId: 'cuero', quantity: 2 }
    ],
    goldCost: 800,
    requiredLevel: 10,
    successRate: 85,
    category: 'weapon'
  },
  {
    id: 'craft_hacha_batalla',
    name: 'Hacha de Batalla',
    emoji: '🪓',
    description: 'Pesada pero devastadora',
    resultItemId: 'hacha_batalla',
    materials: [
      { materialId: 'hierro', quantity: 8 },
      { materialId: 'carbon', quantity: 4 },
      { materialId: 'cuero', quantity: 2 }
    ],
    goldCost: 500,
    requiredLevel: 8,
    successRate: 90,
    category: 'weapon'
  },

  // ==================== ARMAS ÉPICAS ====================
  {
    id: 'craft_espada_titan',
    name: 'Espada del Titán',
    emoji: '🗡️',
    description: 'Una espada colosal de poder inmenso',
    resultItemId: 'espada_titan',
    materials: [
      { materialId: 'titanio', quantity: 10 },
      { materialId: 'acero', quantity: 8 },
      { materialId: 'rubi', quantity: 2 },
      { materialId: 'fragmento_alma', quantity: 3 }
    ],
    goldCost: 10000,
    requiredLevel: 40,
    successRate: 60,
    category: 'weapon'
  },
  {
    id: 'craft_katana_sombria',
    name: 'Katana Sombría',
    emoji: '⚔️',
    description: 'Forjada en las sombras, corta el alma',
    resultItemId: 'katana_sombria',
    materials: [
      { materialId: 'acero', quantity: 8 },
      { materialId: 'zafiro', quantity: 2 },
      { materialId: 'fragmento_alma', quantity: 5 },
      { materialId: 'esencia_hielo', quantity: 2 }
    ],
    goldCost: 5000,
    requiredLevel: 25,
    successRate: 65,
    category: 'weapon'
  },
  {
    id: 'craft_baculo_tormenta',
    name: 'Báculo de la Tormenta',
    emoji: '⛈️',
    description: 'Canaliza el poder de las tormentas',
    resultItemId: 'baculo_tormenta',
    materials: [
      { materialId: 'cristal', quantity: 10 },
      { materialId: 'plata', quantity: 5 },
      { materialId: 'esencia_rayo', quantity: 3 },
      { materialId: 'zafiro', quantity: 2 }
    ],
    goldCost: 6000,
    requiredLevel: 30,
    successRate: 60,
    category: 'weapon'
  },
  {
    id: 'craft_arco_elfico',
    name: 'Arco Élfico',
    emoji: '🏹',
    description: 'Elaborado por elfos antiguos',
    resultItemId: 'arco_elfico',
    materials: [
      { materialId: 'mithril', quantity: 3 },
      { materialId: 'cristal', quantity: 5 },
      { materialId: 'esmeralda', quantity: 2 },
      { materialId: 'cuero', quantity: 5 }
    ],
    goldCost: 5500,
    requiredLevel: 28,
    successRate: 55,
    category: 'weapon'
  },

  // ==================== ARMAS LEGENDARIAS ====================
  {
    id: 'craft_espada_dragon',
    name: 'Espada del Dragón',
    emoji: '🐉',
    description: 'Forjada con fuego de dragón ancestral',
    resultItemId: 'espada_dragon',
    materials: [
      { materialId: 'escama_dragon', quantity: 5 },
      { materialId: 'adamantita', quantity: 8 },
      { materialId: 'esencia_fuego', quantity: 5 },
      { materialId: 'nucleo_elemental', quantity: 2 }
    ],
    goldCost: 25000,
    requiredLevel: 50,
    successRate: 35,
    category: 'weapon'
  },
  {
    id: 'craft_guadana_muerte',
    name: 'Guadaña de la Muerte',
    emoji: '⚰️',
    description: 'El arma del segador de almas',
    resultItemId: 'guadana_muerte',
    materials: [
      { materialId: 'adamantita', quantity: 10 },
      { materialId: 'fragmento_alma', quantity: 10 },
      { materialId: 'polvo_estelar', quantity: 5 },
      { materialId: 'nucleo_elemental', quantity: 3 }
    ],
    goldCost: 40000,
    requiredLevel: 60,
    successRate: 25,
    category: 'weapon'
  },

  // ==================== ARMADURAS ====================
  {
    id: 'craft_armadura_cuero',
    name: 'Armadura de Cuero',
    emoji: '🥋',
    description: 'Protección básica y ligera',
    resultItemId: 'armadura_cuero',
    materials: [
      { materialId: 'cuero', quantity: 8 },
      { materialId: 'hierro', quantity: 2 }
    ],
    goldCost: 150,
    requiredLevel: 3,
    successRate: 95,
    category: 'armor'
  },
  {
    id: 'craft_cota_malla',
    name: 'Cota de Malla',
    emoji: '⛓️',
    description: 'Anillos de metal entrelazados',
    resultItemId: 'cota_malla',
    materials: [
      { materialId: 'hierro', quantity: 15 },
      { materialId: 'carbon', quantity: 5 },
      { materialId: 'cuero', quantity: 3 }
    ],
    goldCost: 600,
    requiredLevel: 10,
    successRate: 85,
    category: 'armor'
  },
  {
    id: 'craft_armadura_hierro',
    name: 'Armadura de Hierro',
    emoji: '🛡️',
    description: 'Sólida protección metálica',
    resultItemId: 'armadura_hierro',
    materials: [
      { materialId: 'hierro', quantity: 20 },
      { materialId: 'acero', quantity: 5 },
      { materialId: 'carbon', quantity: 8 },
      { materialId: 'cuero', quantity: 5 }
    ],
    goldCost: 1000,
    requiredLevel: 15,
    successRate: 80,
    category: 'armor'
  },
  {
    id: 'craft_armadura_titan',
    name: 'Armadura del Titán',
    emoji: '🛡️',
    description: 'Forjada para gigantes, resistencia absoluta',
    resultItemId: 'armadura_titan',
    materials: [
      { materialId: 'titanio', quantity: 15 },
      { materialId: 'acero', quantity: 10 },
      { materialId: 'rubi', quantity: 3 },
      { materialId: 'esencia_fuego', quantity: 2 }
    ],
    goldCost: 8000,
    requiredLevel: 35,
    successRate: 55,
    category: 'armor'
  },
  {
    id: 'craft_armadura_obsidiana',
    name: 'Armadura de Obsidiana',
    emoji: '⬛',
    description: 'Negra como la noche, dura como el diamante',
    resultItemId: 'armadura_obsidiana',
    materials: [
      { materialId: 'adamantita', quantity: 12 },
      { materialId: 'diamante', quantity: 5 },
      { materialId: 'fragmento_alma', quantity: 5 },
      { materialId: 'esencia_hielo', quantity: 3 }
    ],
    goldCost: 20000,
    requiredLevel: 50,
    successRate: 40,
    category: 'armor'
  },
  {
    id: 'craft_armadura_dragon',
    name: 'Armadura de Escamas de Dragón',
    emoji: '🐲',
    description: 'Forjada con escamas de dragón',
    resultItemId: 'armadura_dragon',
    materials: [
      { materialId: 'escama_dragon', quantity: 10 },
      { materialId: 'mithril', quantity: 8 },
      { materialId: 'esencia_fuego', quantity: 5 },
      { materialId: 'nucleo_elemental', quantity: 2 }
    ],
    goldCost: 30000,
    requiredLevel: 55,
    successRate: 30,
    category: 'armor'
  },

  // ==================== ACCESORIOS ====================
  {
    id: 'craft_anillo_plata',
    name: 'Anillo de Plata',
    emoji: '💍',
    description: 'Un anillo simple pero elegante',
    resultItemId: 'anillo_plata',
    materials: [
      { materialId: 'plata', quantity: 3 },
      { materialId: 'cristal', quantity: 1 }
    ],
    goldCost: 300,
    requiredLevel: 5,
    successRate: 90,
    category: 'accessory'
  },
  {
    id: 'craft_amuleto_rubi',
    name: 'Amuleto de Rubí',
    emoji: '📿',
    description: 'Aumenta tu poder de ataque',
    resultItemId: 'amuleto_rubi',
    materials: [
      { materialId: 'oro', quantity: 5 },
      { materialId: 'rubi', quantity: 3 },
      { materialId: 'esencia_fuego', quantity: 1 }
    ],
    goldCost: 2500,
    requiredLevel: 20,
    successRate: 70,
    category: 'accessory'
  },
  {
    id: 'craft_collar_zafiro',
    name: 'Collar de Zafiro',
    emoji: '📿',
    description: 'Aumenta tu maná máximo',
    resultItemId: 'collar_zafiro',
    materials: [
      { materialId: 'oro', quantity: 5 },
      { materialId: 'zafiro', quantity: 3 },
      { materialId: 'esencia_hielo', quantity: 1 }
    ],
    goldCost: 2500,
    requiredLevel: 20,
    successRate: 70,
    category: 'accessory'
  },
  {
    id: 'craft_corona_diamante',
    name: 'Corona de Diamante',
    emoji: '👑',
    description: 'La joya más codiciada del reino',
    resultItemId: 'corona_diamante',
    materials: [
      { materialId: 'diamante', quantity: 5 },
      { materialId: 'oro', quantity: 10 },
      { materialId: 'polvo_estelar', quantity: 3 },
      { materialId: 'nucleo_elemental', quantity: 1 }
    ],
    goldCost: 50000,
    requiredLevel: 50,
    successRate: 25,
    category: 'accessory'
  },

  // ==================== CONSUMIBLES ====================
  {
    id: 'craft_pocion_forja',
    name: 'Poción del Herrero',
    emoji: '🧪',
    description: 'Aumenta la probabilidad de éxito en forja',
    resultItemId: 'pocion_forja',
    materials: [
      { materialId: 'cristal', quantity: 2 },
      { materialId: 'esencia_fuego', quantity: 1 }
    ],
    goldCost: 500,
    requiredLevel: 10,
    successRate: 100,
    category: 'consumable'
  },
  {
    id: 'craft_elixir_exp',
    name: 'Elixir de Experiencia',
    emoji: '✨',
    description: 'Duplica la XP ganada por 30 minutos',
    resultItemId: 'elixir_experiencia',
    materials: [
      { materialId: 'cristal', quantity: 5 },
      { materialId: 'polvo_estelar', quantity: 1 },
      { materialId: 'esmeralda', quantity: 1 }
    ],
    goldCost: 2000,
    requiredLevel: 15,
    successRate: 80,
    category: 'consumable'
  }
];

// ==================== SISTEMA DE MEJORA (+1 a +10) ====================

export interface EnhanceResult {
  success: boolean;
  newLevel: number;
  destroyed: boolean;
  message: string;
}

// Probabilidades de éxito por nivel de mejora
const ENHANCE_SUCCESS_RATES: Record<number, number> = {
  1: 95,   // +0 -> +1: 95%
  2: 90,   // +1 -> +2: 90%
  3: 80,   // +2 -> +3: 80%
  4: 70,   // +3 -> +4: 70%
  5: 60,   // +4 -> +5: 60%
  6: 45,   // +5 -> +6: 45%
  7: 30,   // +6 -> +7: 30%
  8: 20,   // +7 -> +8: 20%
  9: 10,   // +8 -> +9: 10%
  10: 5    // +9 -> +10: 5%
};

// Materiales requeridos por nivel de mejora
const ENHANCE_MATERIALS: Record<number, { materialId: string; quantity: number }[]> = {
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

// Costo de oro por nivel de mejora
const ENHANCE_GOLD_COST: Record<number, number> = {
  1: 100,
  2: 250,
  3: 500,
  4: 1000,
  5: 2500,
  6: 5000,
  7: 10000,
  8: 25000,
  9: 50000,
  10: 100000
};

// ==================== FUNCIONES AUXILIARES ====================

/**
 * Obtiene los materiales del usuario en formato legible
 */
export function getUserMaterials(user: any): Map<string, number> {
  const materials = new Map<string, number>();

  if (!user.forgeMaterials) {
    return materials;
  }

  for (const [materialId, quantity] of Object.entries(user.forgeMaterials)) {
    if (typeof quantity === 'number' && quantity > 0) {
      materials.set(materialId, quantity);
    }
  }

  return materials;
}

/**
 * Verifica si el usuario tiene los materiales necesarios
 */
export function hasRequiredMaterials(
  user: any,
  required: { materialId: string; quantity: number }[]
): { has: boolean; missing: { materialId: string; have: number; need: number }[] } {
  const userMaterials = getUserMaterials(user);
  const missing: { materialId: string; have: number; need: number }[] = [];

  for (const req of required) {
    const have = userMaterials.get(req.materialId) || 0;
    if (have < req.quantity) {
      missing.push({
        materialId: req.materialId,
        have,
        need: req.quantity
      });
    }
  }

  return {
    has: missing.length === 0,
    missing
  };
}

/**
 * Consume materiales del usuario
 */
export function consumeMaterials(
  user: any,
  materials: { materialId: string; quantity: number }[]
): void {
  if (!user.forgeMaterials) {
    user.forgeMaterials = {};
  }

  for (const mat of materials) {
    if (user.forgeMaterials[mat.materialId]) {
      user.forgeMaterials[mat.materialId] -= mat.quantity;
      if (user.forgeMaterials[mat.materialId] <= 0) {
        delete user.forgeMaterials[mat.materialId];
      }
    }
  }
}

/**
 * Agrega materiales al usuario
 */
export function addMaterial(user: any, materialId: string, quantity: number): void {
  if (!user.forgeMaterials) {
    user.forgeMaterials = {};
  }

  user.forgeMaterials[materialId] = (user.forgeMaterials[materialId] || 0) + quantity;
}

// ==================== PLUGINS ====================

/**
 * Plugin principal: Menú de forja
 */
export const forjaMenuPlugin: PluginHandler = {
  command: ['forja', 'forge', 'herreria', 'blacksmith'],
  tags: ['rpg'],
  help: [
    'forja - Ver menú de la herrería',
    'forja recetas - Ver recetas disponibles',
    'forja craftear [item] - Crear un item',
    'forja mejorar - Mejorar item equipado',
    'forja materiales - Ver tus materiales',
    'forja fundir - Convertir items en materiales'
  ],
  register: true,

  handler: async (ctx: MessageContext) => {
    const { m, args } = ctx;
    const db = getDatabase();
    const user = db.getUser(m.sender);

    const subcommand = args[0]?.toLowerCase();

    // Si hay subcomando, redirigir
    if (subcommand === 'recetas' || subcommand === 'recipes') {
      return handleRecetas(ctx);
    }
    if (subcommand === 'craftear' || subcommand === 'craft' || subcommand === 'crear') {
      return handleCraftear(ctx);
    }
    if (subcommand === 'mejorar' || subcommand === 'enhance' || subcommand === 'upgrade') {
      return handleMejorar(ctx);
    }
    if (subcommand === 'materiales' || subcommand === 'materials' || subcommand === 'mats') {
      return handleMateriales(ctx);
    }
    if (subcommand === 'fundir' || subcommand === 'smelt' || subcommand === 'melt') {
      return handleFundir(ctx);
    }

    // Menú principal
    const materials = getUserMaterials(user);
    const totalMaterials = Array.from(materials.values()).reduce((a, b) => a + b, 0);

    let response = `⚒️ *HERRERÍA DE CYALTRONIC* ⚒️\n`;
    response += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    response += `👤 Herrero: *${user.name}*\n`;
    response += `📊 Nivel: *${user.level}*\n`;
    response += `💰 Oro: *$${formatNumber(user.money)}*\n`;
    response += `📦 Materiales: *${totalMaterials}* items\n\n`;

    response += `📋 *SERVICIOS DISPONIBLES:*\n\n`;
    response += `🔧 */forja recetas*\n`;
    response += `   _Ver todas las recetas de crafteo_\n\n`;
    response += `⚒️ */forja craftear [item]*\n`;
    response += `   _Crear un item con materiales_\n\n`;
    response += `⬆️ */forja mejorar*\n`;
    response += `   _Mejorar tu equipo (+1 a +10)_\n\n`;
    response += `📦 */forja materiales*\n`;
    response += `   _Ver tus materiales de forja_\n\n`;
    response += `🔥 */forja fundir [item]*\n`;
    response += `   _Convertir items en materiales_\n\n`;

    response += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    response += `💡 _Obtén materiales minando con /minar_`;

    await m.reply(response);
  }
};

/**
 * Manejador: Ver recetas
 */
async function handleRecetas(ctx: MessageContext) {
  const { m, args } = ctx;
  const db = getDatabase();
  const user = db.getUser(m.sender);

  // Filtrar por categoría si se especifica
  const category = args[1]?.toLowerCase();
  let recipes = FORGE_RECIPES;
  let categoryName = 'TODAS';

  if (category === 'armas' || category === 'weapon') {
    recipes = recipes.filter(r => r.category === 'weapon');
    categoryName = 'ARMAS';
  } else if (category === 'armaduras' || category === 'armor') {
    recipes = recipes.filter(r => r.category === 'armor');
    categoryName = 'ARMADURAS';
  } else if (category === 'accesorios' || category === 'accessory') {
    recipes = recipes.filter(r => r.category === 'accessory');
    categoryName = 'ACCESORIOS';
  } else if (category === 'consumibles' || category === 'consumable') {
    recipes = recipes.filter(r => r.category === 'consumable');
    categoryName = 'CONSUMIBLES';
  }

  // Filtrar por nivel del usuario
  const availableRecipes = recipes.filter(r => r.requiredLevel <= user.level);
  const lockedRecipes = recipes.filter(r => r.requiredLevel > user.level);

  let response = `📜 *RECETAS DE FORJA - ${categoryName}*\n`;
  response += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  if (availableRecipes.length > 0) {
    response += `✅ *DISPONIBLES (${availableRecipes.length}):*\n\n`;

    for (const recipe of availableRecipes.slice(0, 10)) {
      response += `${recipe.emoji} *${recipe.name}*\n`;
      response += `   Nivel: ${recipe.requiredLevel} | Éxito: ${recipe.successRate}%\n`;
      response += `   Costo: $${formatNumber(recipe.goldCost)}\n`;
      response += `   Materiales: `;
      response += recipe.materials.map(m => {
        const mat = FORGE_MATERIALS[m.materialId];
        return `${mat?.emoji || '?'}x${m.quantity}`;
      }).join(', ');
      response += `\n\n`;
    }

    if (availableRecipes.length > 10) {
      response += `_...y ${availableRecipes.length - 10} más_\n\n`;
    }
  }

  if (lockedRecipes.length > 0) {
    response += `🔒 *BLOQUEADAS (${lockedRecipes.length}):*\n`;
    for (const recipe of lockedRecipes.slice(0, 5)) {
      response += `   ${recipe.emoji} ${recipe.name} (Nivel ${recipe.requiredLevel})\n`;
    }
    if (lockedRecipes.length > 5) {
      response += `   _...y ${lockedRecipes.length - 5} más_\n`;
    }
  }

  response += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  response += `💡 Usa: /forja craftear [nombre del item]\n`;
  response += `📂 Filtros: armas, armaduras, accesorios, consumibles`;

  await m.reply(response);
}

/**
 * Manejador: Craftear item
 */
async function handleCraftear(ctx: MessageContext) {
  const { m, args } = ctx;
  const db = getDatabase();
  const user = db.getUser(m.sender);

  // Obtener nombre del item a craftear
  const itemName = args.slice(1).join(' ').toLowerCase().trim();

  if (!itemName) {
    await m.reply(
      `${EMOJI.error} Especifica qué quieres craftear.\n\n` +
      `📝 *Uso:* /forja craftear espada de acero\n` +
      `💡 Usa /forja recetas para ver opciones.`
    );
    return;
  }

  // Buscar receta
  const recipe = FORGE_RECIPES.find(r =>
    r.name.toLowerCase().includes(itemName) ||
    r.id.toLowerCase().includes(itemName.replace(/\s+/g, '_'))
  );

  if (!recipe) {
    await m.reply(
      `${EMOJI.error} No encontré esa receta.\n\n` +
      `🔍 Buscaste: "${itemName}"\n` +
      `💡 Usa /forja recetas para ver opciones.`
    );
    return;
  }

  // Verificar nivel
  if (user.level < recipe.requiredLevel) {
    await m.reply(
      `${EMOJI.error} Nivel insuficiente.\n\n` +
      `📊 Tu nivel: *${user.level}*\n` +
      `🎯 Nivel requerido: *${recipe.requiredLevel}*`
    );
    return;
  }

  // Verificar oro
  if (user.money < recipe.goldCost) {
    await m.reply(
      `${EMOJI.error} No tienes suficiente oro.\n\n` +
      `💰 Tu oro: *$${formatNumber(user.money)}*\n` +
      `💵 Costo: *$${formatNumber(recipe.goldCost)}*`
    );
    return;
  }

  // Verificar materiales
  const materialsCheck = hasRequiredMaterials(user, recipe.materials);
  if (!materialsCheck.has) {
    let response = `${EMOJI.error} *Materiales insuficientes*\n\n`;
    response += `📋 *Necesitas:*\n`;

    for (const mat of recipe.materials) {
      const material = FORGE_MATERIALS[mat.materialId];
      const have = getUserMaterials(user).get(mat.materialId) || 0;
      const isMissing = have < mat.quantity;
      response += `${isMissing ? '❌' : '✅'} ${material?.emoji || '?'} ${material?.name || mat.materialId}: ${have}/${mat.quantity}\n`;
    }

    response += `\n💡 _Obtén materiales minando con /minar_`;
    await m.reply(response);
    return;
  }

  // ¡Craftear!
  await m.react('⚒️');

  // Determinar éxito
  const roll = randomInt(1, 100);
  const success = roll <= recipe.successRate;

  // Consumir materiales y oro (siempre se consumen)
  consumeMaterials(user, recipe.materials);
  user.money -= recipe.goldCost;

  if (success) {
    // Agregar item al inventario
    const existingItem = user.inventory.find((i: any) => i.itemId === recipe.resultItemId);
    if (existingItem) {
      existingItem.quantity += 1;
    } else {
      user.inventory.push({
        itemId: recipe.resultItemId,
        quantity: 1,
        enhanceLevel: 0
      });
    }

    db.updateUser(m.sender, {
      money: user.money,
      forgeMaterials: user.forgeMaterials,
      inventory: user.inventory
    });

    const resultItem = ITEMS[recipe.resultItemId];

    let response = `⚒️ *¡FORJA EXITOSA!* ⚒️\n\n`;
    response += `🎉 Has creado:\n`;
    response += `${recipe.emoji} *${recipe.name}*\n\n`;

    if (resultItem?.stats) {
      response += `📊 *Estadísticas:*\n`;
      if (resultItem.stats.attack) response += `   ⚔️ Ataque: +${resultItem.stats.attack}\n`;
      if (resultItem.stats.defense) response += `   🛡️ Defensa: +${resultItem.stats.defense}\n`;
      if (resultItem.stats.health) response += `   ❤️ Vida: +${resultItem.stats.health}\n`;
      if (resultItem.stats.mana) response += `   💠 Maná: +${resultItem.stats.mana}\n`;
      if (resultItem.stats.critChance) response += `   🎯 Crítico: +${resultItem.stats.critChance}%\n`;
    }

    response += `\n💰 Gastaste: *$${formatNumber(recipe.goldCost)}*\n`;
    response += `📦 _El item está en tu inventario_`;

    await m.reply(response);
    await m.react('✅');

  } else {
    db.updateUser(m.sender, {
      money: user.money,
      forgeMaterials: user.forgeMaterials
    });

    let response = `⚒️ *¡FORJA FALLIDA!* 💔\n\n`;
    response += `😔 La forja no salió bien...\n`;
    response += `${recipe.emoji} *${recipe.name}* se destruyó.\n\n`;
    response += `💸 Perdiste:\n`;
    response += `   💰 $${formatNumber(recipe.goldCost)}\n`;
    response += `   📦 Todos los materiales\n\n`;
    response += `🎲 Probabilidad era: *${recipe.successRate}%*\n`;
    response += `💡 _¡Inténtalo de nuevo!_`;

    await m.reply(response);
    await m.react('💔');
  }
}

/**
 * Manejador: Ver materiales
 */
async function handleMateriales(ctx: MessageContext) {
  const { m } = ctx;
  const db = getDatabase();
  const user = db.getUser(m.sender);

  const materials = getUserMaterials(user);

  if (materials.size === 0) {
    await m.reply(
      `📦 *TUS MATERIALES*\n\n` +
      `No tienes materiales de forja.\n\n` +
      `💡 Obtén materiales minando con */minar*`
    );
    return;
  }

  let response = `📦 *TUS MATERIALES DE FORJA*\n`;
  response += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  // Agrupar por rareza
  const byRarity: Record<string, { name: string; emoji: string; quantity: number }[]> = {
    legendario: [],
    epico: [],
    raro: [],
    comun: []
  };

  for (const [matId, quantity] of materials) {
    const mat = FORGE_MATERIALS[matId];
    if (mat) {
      byRarity[mat.rarity].push({
        name: mat.name,
        emoji: mat.emoji,
        quantity
      });
    }
  }

  if (byRarity.legendario.length > 0) {
    response += `🟣 *LEGENDARIOS:*\n`;
    for (const mat of byRarity.legendario) {
      response += `   ${mat.emoji} ${mat.name}: x${mat.quantity}\n`;
    }
    response += `\n`;
  }

  if (byRarity.epico.length > 0) {
    response += `🟠 *ÉPICOS:*\n`;
    for (const mat of byRarity.epico) {
      response += `   ${mat.emoji} ${mat.name}: x${mat.quantity}\n`;
    }
    response += `\n`;
  }

  if (byRarity.raro.length > 0) {
    response += `🔵 *RAROS:*\n`;
    for (const mat of byRarity.raro) {
      response += `   ${mat.emoji} ${mat.name}: x${mat.quantity}\n`;
    }
    response += `\n`;
  }

  if (byRarity.comun.length > 0) {
    response += `⚪ *COMUNES:*\n`;
    for (const mat of byRarity.comun) {
      response += `   ${mat.emoji} ${mat.name}: x${mat.quantity}\n`;
    }
  }

  response += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  response += `💡 Usa */forja recetas* para ver qué puedes crear`;

  await m.reply(response);
}

/**
 * Manejador: Mejorar item
 */
async function handleMejorar(ctx: MessageContext) {
  const { m, args } = ctx;
  const db = getDatabase();
  const user = db.getUser(m.sender);

  // Determinar qué slot mejorar
  const slot = args[1]?.toLowerCase();
  const slotMap: Record<string, 'weapon' | 'armor' | 'accessory'> = {
    'arma': 'weapon',
    'weapon': 'weapon',
    'armadura': 'armor',
    'armor': 'armor',
    'accesorio': 'accessory',
    'accessory': 'accessory'
  };

  if (!slot || !slotMap[slot]) {
    await m.reply(
      `⬆️ *SISTEMA DE MEJORA*\n\n` +
      `Mejora tu equipo de +0 a +10.\n` +
      `Cada nivel aumenta las estadísticas.\n\n` +
      `📝 *Uso:*\n` +
      `   /forja mejorar arma\n` +
      `   /forja mejorar armadura\n` +
      `   /forja mejorar accesorio\n\n` +
      `⚠️ *Advertencia:*\n` +
      `Si fallas, el item puede perder un nivel o destruirse (+6 en adelante).`
    );
    return;
  }

  const targetSlot = slotMap[slot];
  const equippedItemId = user.equipment[targetSlot];

  if (!equippedItemId) {
    await m.reply(`${EMOJI.error} No tienes nada equipado en ese slot.`);
    return;
  }

  // Buscar el item en el inventario
  const invItem = user.inventory.find((i: any) => i.itemId === equippedItemId);
  if (!invItem) {
    await m.reply(`${EMOJI.error} Error: item no encontrado en inventario.`);
    return;
  }

  const itemData = ITEMS[equippedItemId];
  if (!itemData) {
    await m.reply(`${EMOJI.error} Error: datos del item no encontrados.`);
    return;
  }

  const currentLevel = invItem.enhanceLevel || 0;
  const nextLevel = currentLevel + 1;

  if (nextLevel > 10) {
    await m.reply(
      `${EMOJI.error} Este item ya está al máximo (+10).\n\n` +
      `${itemData.emoji} *${itemData.name} +10*\n` +
      `_¡Felicidades! Has alcanzado la perfección._`
    );
    return;
  }

  // Obtener requisitos
  const successRate = ENHANCE_SUCCESS_RATES[nextLevel];
  const materials = ENHANCE_MATERIALS[nextLevel];
  const goldCost = ENHANCE_GOLD_COST[nextLevel];

  // Verificar oro
  if (user.money < goldCost) {
    await m.reply(
      `${EMOJI.error} No tienes suficiente oro.\n\n` +
      `💰 Tu oro: *$${formatNumber(user.money)}*\n` +
      `💵 Costo: *$${formatNumber(goldCost)}*`
    );
    return;
  }

  // Verificar materiales
  const matsCheck = hasRequiredMaterials(user, materials);
  if (!matsCheck.has) {
    let response = `${EMOJI.error} *Materiales insuficientes para +${nextLevel}*\n\n`;

    for (const mat of materials) {
      const material = FORGE_MATERIALS[mat.materialId];
      const have = getUserMaterials(user).get(mat.materialId) || 0;
      const isMissing = have < mat.quantity;
      response += `${isMissing ? '❌' : '✅'} ${material?.emoji || '?'} ${material?.name}: ${have}/${mat.quantity}\n`;
    }

    await m.reply(response);
    return;
  }

  // Mostrar confirmación si es nivel peligroso
  if (nextLevel >= 6 && !args.includes('confirmar')) {
    let response = `⚠️ *MEJORA PELIGROSA*\n\n`;
    response += `${itemData.emoji} *${itemData.name} +${currentLevel}* → *+${nextLevel}*\n\n`;
    response += `🎲 Probabilidad de éxito: *${successRate}%*\n\n`;
    response += `❌ *Si fallas:*\n`;
    if (nextLevel >= 8) {
      response += `   • El item puede DESTRUIRSE\n`;
    }
    response += `   • El item bajará a +${Math.max(0, currentLevel - 1)}\n\n`;
    response += `💰 Costo: *$${formatNumber(goldCost)}*\n`;
    response += `📦 Materiales: `;
    response += materials.map(m => {
      const mat = FORGE_MATERIALS[m.materialId];
      return `${mat?.emoji}x${m.quantity}`;
    }).join(', ');
    response += `\n\n`;
    response += `⚠️ _Escribe /forja mejorar ${slot} confirmar para proceder_`;

    await m.reply(response);
    return;
  }

  // ¡Mejorar!
  await m.react('⬆️');

  const roll = randomInt(1, 100);
  const success = roll <= successRate;

  // Consumir materiales y oro
  consumeMaterials(user, materials);
  user.money -= goldCost;

  if (success) {
    invItem.enhanceLevel = nextLevel;

    db.updateUser(m.sender, {
      money: user.money,
      forgeMaterials: user.forgeMaterials,
      inventory: user.inventory
    });

    // Calcular bonus de mejora (cada nivel da +5% a stats)
    const bonusPercent = nextLevel * 5;

    let response = `⬆️ *¡MEJORA EXITOSA!* ⬆️\n\n`;
    response += `${itemData.emoji} *${itemData.name}*\n`;
    response += `+${currentLevel} → *+${nextLevel}* ✨\n\n`;
    response += `📊 *Bonus de mejora:* +${bonusPercent}% stats\n`;
    response += `🎲 Tiraste: *${roll}* (necesitabas ≤${successRate})\n\n`;

    if (nextLevel === 10) {
      response += `🎉 *¡FELICIDADES!* ¡Has alcanzado +10!\n`;
      response += `_Tu item ahora es legendario._`;
    } else {
      response += `💡 Siguiente mejora: +${nextLevel + 1} (${ENHANCE_SUCCESS_RATES[nextLevel + 1]}%)`;
    }

    await m.reply(response);
    await m.react('✅');

  } else {
    // Fallo
    let destroyed = false;
    let newLevel = currentLevel;

    // +8 en adelante puede destruirse
    if (nextLevel >= 8 && randomInt(1, 100) <= 30) {
      destroyed = true;
    } else if (currentLevel > 0) {
      newLevel = currentLevel - 1;
    }

    if (destroyed) {
      // Remover item
      const invIndex = user.inventory.findIndex((i: any) => i.itemId === equippedItemId);
      if (invIndex !== -1) {
        user.inventory.splice(invIndex, 1);
      }
      user.equipment[targetSlot] = null;
    } else {
      invItem.enhanceLevel = newLevel;
    }

    db.updateUser(m.sender, {
      money: user.money,
      forgeMaterials: user.forgeMaterials,
      inventory: user.inventory,
      equipment: user.equipment
    });

    let response = `⬆️ *¡MEJORA FALLIDA!* 💔\n\n`;
    response += `${itemData.emoji} *${itemData.name}*\n\n`;

    if (destroyed) {
      response += `💥 *¡EL ITEM SE DESTRUYÓ!* 💥\n\n`;
      response += `El item no soportó la presión y se hizo añicos.\n`;
    } else if (newLevel < currentLevel) {
      response += `📉 El item bajó de +${currentLevel} a *+${newLevel}*\n\n`;
    } else {
      response += `El item se mantuvo en +${currentLevel}\n\n`;
    }

    response += `🎲 Tiraste: *${roll}* (necesitabas ≤${successRate})\n`;
    response += `💸 Perdiste: $${formatNumber(goldCost)} + materiales`;

    await m.reply(response);
    await m.react('💔');
  }
}

/**
 * Manejador: Fundir items
 */
async function handleFundir(ctx: MessageContext) {
  const { m, args } = ctx;
  const db = getDatabase();
  const user = db.getUser(m.sender);

  const itemName = args.slice(1).join(' ').toLowerCase().trim();

  if (!itemName) {
    await m.reply(
      `🔥 *FUNDICIÓN*\n\n` +
      `Convierte items en materiales de forja.\n\n` +
      `📝 *Uso:* /forja fundir espada de hierro\n\n` +
      `💡 Obtendrás materiales según la rareza del item:\n` +
      `   ⚪ Común: 1-3 materiales\n` +
      `   🔵 Raro: 3-5 materiales\n` +
      `   🟠 Épico: 5-8 materiales\n` +
      `   🟣 Legendario: 8-12 materiales`
    );
    return;
  }

  // Buscar item en inventario
  let foundIndex = -1;
  let foundItem: any = null;
  let itemData: Item | null = null;

  for (let i = 0; i < user.inventory.length; i++) {
    const invItem = user.inventory[i];
    const item = ITEMS[invItem.itemId];
    if (item && item.name.toLowerCase().includes(itemName)) {
      // No fundir items equipados
      if (user.equipment.weapon === invItem.itemId ||
          user.equipment.armor === invItem.itemId ||
          user.equipment.accessory === invItem.itemId) {
        continue;
      }
      foundIndex = i;
      foundItem = invItem;
      itemData = item;
      break;
    }
  }

  if (foundIndex === -1 || !itemData) {
    await m.reply(
      `${EMOJI.error} No encontré ese item en tu inventario.\n\n` +
      `💡 Asegúrate de que no esté equipado.\n` +
      `Usa /inventario para ver tus items.`
    );
    return;
  }

  // Determinar materiales obtenidos según rareza
  const materialsByRarity: Record<ItemRarity, { materials: string[]; min: number; max: number }> = {
    comun: {
      materials: ['hierro', 'carbon', 'cobre', 'piedra'],
      min: 1, max: 3
    },
    raro: {
      materials: ['acero', 'plata', 'cristal', 'cuero'],
      min: 3, max: 5
    },
    epico: {
      materials: ['titanio', 'rubi', 'esmeralda', 'zafiro', 'fragmento_alma'],
      min: 5, max: 8
    },
    legendario: {
      materials: ['mithril', 'adamantita', 'diamante', 'polvo_estelar', 'nucleo_elemental'],
      min: 8, max: 12
    }
  };

  const rarityConfig = materialsByRarity[itemData.rarity];
  const totalMats = randomInt(rarityConfig.min, rarityConfig.max);

  // Generar materiales aleatorios
  const obtainedMaterials: { materialId: string; quantity: number }[] = [];
  for (let i = 0; i < totalMats; i++) {
    const matId = pickRandom(rarityConfig.materials);
    const existing = obtainedMaterials.find(m => m.materialId === matId);
    if (existing) {
      existing.quantity++;
    } else {
      obtainedMaterials.push({ materialId: matId, quantity: 1 });
    }
  }

  // Remover item del inventario
  if (foundItem.quantity > 1) {
    foundItem.quantity--;
  } else {
    user.inventory.splice(foundIndex, 1);
  }

  // Agregar materiales
  for (const mat of obtainedMaterials) {
    addMaterial(user, mat.materialId, mat.quantity);
  }

  db.updateUser(m.sender, {
    inventory: user.inventory,
    forgeMaterials: user.forgeMaterials
  });

  let response = `🔥 *¡FUNDICIÓN COMPLETA!* 🔥\n\n`;
  response += `${itemData.emoji} *${itemData.name}* se ha fundido.\n\n`;
  response += `📦 *Materiales obtenidos:*\n`;

  for (const mat of obtainedMaterials) {
    const material = FORGE_MATERIALS[mat.materialId];
    response += `   ${material?.emoji || '?'} ${material?.name}: x${mat.quantity}\n`;
  }

  response += `\n💡 Usa /forja materiales para ver tu inventario.`;

  await m.reply(response);
  await m.react('🔥');
}

export default forjaMenuPlugin;
