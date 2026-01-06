/**
 * 🎮 Tipos del Sistema RPG Expandido - CYALTRONIC
 * Define items, clases, monstruos, dungeons, misiones y logros
 */

// ==================== CLASES ====================

export type PlayerClass = 'guerrero' | 'mago' | 'ladron' | 'arquero';

export interface ClassInfo {
  name: string;
  emoji: string;
  description: string;
  baseStats: {
    healthBonus: number;
    manaBonus: number;
    staminaBonus: number;
    attackBonus: number;
    defenseBonus: number;
  };
  skills: string[];
}

export const CLASSES: Record<PlayerClass, ClassInfo> = {
  guerrero: {
    name: 'Guerrero',
    emoji: '⚔️',
    description: 'Maestro del combate cuerpo a cuerpo. Alta vida y defensa.',
    baseStats: {
      healthBonus: 30,
      manaBonus: 0,
      staminaBonus: 20,
      attackBonus: 15,
      defenseBonus: 20
    },
    skills: ['golpe_brutal', 'escudo_defensor', 'grito_guerra']
  },
  mago: {
    name: 'Mago',
    emoji: '🔮',
    description: 'Domina las artes arcanas. Alto maná y daño mágico.',
    baseStats: {
      healthBonus: 0,
      manaBonus: 50,
      staminaBonus: 10,
      attackBonus: 25,
      defenseBonus: 5
    },
    skills: ['bola_fuego', 'rayo_arcano', 'escudo_magico']
  },
  ladron: {
    name: 'Ladrón',
    emoji: '🗡️',
    description: 'Ágil y astuto. Críticos devastadores y evasión.',
    baseStats: {
      healthBonus: 10,
      manaBonus: 15,
      staminaBonus: 30,
      attackBonus: 20,
      defenseBonus: 10
    },
    skills: ['ataque_furtivo', 'evadir', 'robo_vital']
  },
  arquero: {
    name: 'Arquero',
    emoji: '🏹',
    description: 'Precisión letal a distancia. Balance entre ataque y defensa.',
    baseStats: {
      healthBonus: 15,
      manaBonus: 20,
      staminaBonus: 25,
      attackBonus: 22,
      defenseBonus: 8
    },
    skills: ['disparo_preciso', 'lluvia_flechas', 'trampa_cazador']
  }
};

// ==================== ITEMS ====================

export type ItemType = 'weapon' | 'armor' | 'accessory' | 'consumable' | 'material';
export type ItemRarity = 'comun' | 'raro' | 'epico' | 'legendario';

export interface Item {
  id: string;
  name: string;
  emoji: string;
  type: ItemType;
  rarity: ItemRarity;
  description: string;
  price: number;
  sellPrice: number;
  stats?: {
    attack?: number;
    defense?: number;
    health?: number;
    mana?: number;
    stamina?: number;
    critChance?: number;
  };
  consumeEffect?: {
    health?: number;
    mana?: number;
    stamina?: number;
    expBoost?: number;
    duration?: number;
  };
  requiredLevel?: number;
  requiredClass?: PlayerClass[];
}

export const RARITY_COLORS: Record<ItemRarity, string> = {
  comun: '⬜',
  raro: '🟦',
  epico: '🟪',
  legendario: '🟨'
};

// Items del juego
export const ITEMS: Record<string, Item> = {
  // === ARMAS ===
  espada_hierro: {
    id: 'espada_hierro',
    name: 'Espada de Hierro',
    emoji: '🗡️',
    type: 'weapon',
    rarity: 'comun',
    description: 'Una espada básica pero confiable.',
    price: 500,
    sellPrice: 250,
    stats: { attack: 10 },
    requiredLevel: 1
  },
  espada_acero: {
    id: 'espada_acero',
    name: 'Espada de Acero',
    emoji: '⚔️',
    type: 'weapon',
    rarity: 'raro',
    description: 'Forjada por herreros expertos.',
    price: 2000,
    sellPrice: 1000,
    stats: { attack: 25, critChance: 5 },
    requiredLevel: 10
  },
  espada_dragon: {
    id: 'espada_dragon',
    name: 'Espada del Dragón',
    emoji: '🐉',
    type: 'weapon',
    rarity: 'legendario',
    description: 'Forjada con fuego de dragón ancestral.',
    price: 50000,
    sellPrice: 25000,
    stats: { attack: 75, critChance: 15, health: 50 },
    requiredLevel: 50
  },
  baston_aprendiz: {
    id: 'baston_aprendiz',
    name: 'Bastón de Aprendiz',
    emoji: '🪄',
    type: 'weapon',
    rarity: 'comun',
    description: 'El primer bastón de todo mago.',
    price: 500,
    sellPrice: 250,
    stats: { attack: 8, mana: 20 },
    requiredLevel: 1,
    requiredClass: ['mago']
  },
  baston_arcano: {
    id: 'baston_arcano',
    name: 'Bastón Arcano',
    emoji: '🔮',
    type: 'weapon',
    rarity: 'epico',
    description: 'Canaliza energía arcana pura.',
    price: 15000,
    sellPrice: 7500,
    stats: { attack: 45, mana: 80 },
    requiredLevel: 30,
    requiredClass: ['mago']
  },
  daga_sombras: {
    id: 'daga_sombras',
    name: 'Daga de las Sombras',
    emoji: '🔪',
    type: 'weapon',
    rarity: 'raro',
    description: 'Silenciosa y mortal.',
    price: 3000,
    sellPrice: 1500,
    stats: { attack: 20, critChance: 20 },
    requiredLevel: 15,
    requiredClass: ['ladron']
  },
  arco_cazador: {
    id: 'arco_cazador',
    name: 'Arco del Cazador',
    emoji: '🏹',
    type: 'weapon',
    rarity: 'raro',
    description: 'Preciso y ligero.',
    price: 2500,
    sellPrice: 1250,
    stats: { attack: 22, critChance: 10 },
    requiredLevel: 12,
    requiredClass: ['arquero']
  },

  // === ARMADURAS ===
  armadura_cuero: {
    id: 'armadura_cuero',
    name: 'Armadura de Cuero',
    emoji: '🥋',
    type: 'armor',
    rarity: 'comun',
    description: 'Protección básica y ligera.',
    price: 400,
    sellPrice: 200,
    stats: { defense: 8, stamina: 10 },
    requiredLevel: 1
  },
  armadura_hierro: {
    id: 'armadura_hierro',
    name: 'Armadura de Hierro',
    emoji: '🛡️',
    type: 'armor',
    rarity: 'raro',
    description: 'Sólida protección metálica.',
    price: 2500,
    sellPrice: 1250,
    stats: { defense: 25, health: 30 },
    requiredLevel: 15
  },
  armadura_dragon: {
    id: 'armadura_dragon',
    name: 'Armadura de Escamas de Dragón',
    emoji: '🐲',
    type: 'armor',
    rarity: 'legendario',
    description: 'Forjada con escamas de dragón.',
    price: 60000,
    sellPrice: 30000,
    stats: { defense: 80, health: 100, mana: 30 },
    requiredLevel: 55
  },
  tunica_mago: {
    id: 'tunica_mago',
    name: 'Túnica del Mago',
    emoji: '🧥',
    type: 'armor',
    rarity: 'raro',
    description: 'Mejora el flujo de maná.',
    price: 2000,
    sellPrice: 1000,
    stats: { defense: 10, mana: 50 },
    requiredLevel: 10,
    requiredClass: ['mago']
  },

  // === ACCESORIOS ===
  anillo_fuerza: {
    id: 'anillo_fuerza',
    name: 'Anillo de Fuerza',
    emoji: '💍',
    type: 'accessory',
    rarity: 'raro',
    description: 'Aumenta el poder de ataque.',
    price: 3000,
    sellPrice: 1500,
    stats: { attack: 15 },
    requiredLevel: 20
  },
  amuleto_vida: {
    id: 'amuleto_vida',
    name: 'Amuleto de Vida',
    emoji: '📿',
    type: 'accessory',
    rarity: 'epico',
    description: 'Otorga vitalidad extra.',
    price: 8000,
    sellPrice: 4000,
    stats: { health: 50, defense: 10 },
    requiredLevel: 25
  },
  collar_suerte: {
    id: 'collar_suerte',
    name: 'Collar de la Suerte',
    emoji: '🍀',
    type: 'accessory',
    rarity: 'epico',
    description: 'Aumenta la probabilidad de crítico.',
    price: 10000,
    sellPrice: 5000,
    stats: { critChance: 25 },
    requiredLevel: 30
  },

  // === CONSUMIBLES ===
  pocion_salud: {
    id: 'pocion_salud',
    name: 'Poción de Salud',
    emoji: '❤️‍🩹',
    type: 'consumable',
    rarity: 'comun',
    description: 'Restaura 50 puntos de salud.',
    price: 100,
    sellPrice: 50,
    consumeEffect: { health: 50 }
  },
  pocion_salud_mayor: {
    id: 'pocion_salud_mayor',
    name: 'Poción de Salud Mayor',
    emoji: '❤️',
    type: 'consumable',
    rarity: 'raro',
    description: 'Restaura 100 puntos de salud.',
    price: 300,
    sellPrice: 150,
    consumeEffect: { health: 100 }
  },
  pocion_mana: {
    id: 'pocion_mana',
    name: 'Poción de Maná',
    emoji: '💙',
    type: 'consumable',
    rarity: 'comun',
    description: 'Restaura 30 puntos de maná.',
    price: 150,
    sellPrice: 75,
    consumeEffect: { mana: 30 }
  },
  pocion_energia: {
    id: 'pocion_energia',
    name: 'Poción de Energía',
    emoji: '⚡',
    type: 'consumable',
    rarity: 'comun',
    description: 'Restaura 40 puntos de energía.',
    price: 120,
    sellPrice: 60,
    consumeEffect: { stamina: 40 }
  },
  elixir_exp: {
    id: 'elixir_exp',
    name: 'Elixir de Experiencia',
    emoji: '✨',
    type: 'consumable',
    rarity: 'epico',
    description: 'Duplica la XP por 30 minutos.',
    price: 5000,
    sellPrice: 2500,
    consumeEffect: { expBoost: 2, duration: 30 * 60 * 1000 }
  },

  // === MATERIALES ===
  hierro: {
    id: 'hierro',
    name: 'Mineral de Hierro',
    emoji: '🪨',
    type: 'material',
    rarity: 'comun',
    description: 'Material básico para forja.',
    price: 50,
    sellPrice: 25
  },
  oro_material: {
    id: 'oro_material',
    name: 'Pepita de Oro',
    emoji: '🥇',
    type: 'material',
    rarity: 'raro',
    description: 'Valioso material de forja.',
    price: 200,
    sellPrice: 100
  },
  escama_dragon: {
    id: 'escama_dragon',
    name: 'Escama de Dragón',
    emoji: '🐉',
    type: 'material',
    rarity: 'legendario',
    description: 'Extremadamente rara y valiosa.',
    price: 10000,
    sellPrice: 5000
  },
  cristal_mana: {
    id: 'cristal_mana',
    name: 'Cristal de Maná',
    emoji: '💎',
    type: 'material',
    rarity: 'epico',
    description: 'Concentrado de energía mágica.',
    price: 3000,
    sellPrice: 1500
  }
};

// ==================== MONSTRUOS ====================

export interface Monster {
  id: string;
  name: string;
  emoji: string;
  level: number;
  health: number;
  attack: number;
  defense: number;
  expReward: number;
  moneyReward: [number, number];
  drops: { itemId: string; chance: number }[];
  description: string;
}

export const MONSTERS: Record<string, Monster> = {
  slime: {
    id: 'slime',
    name: 'Slime',
    emoji: '🟢',
    level: 1,
    health: 30,
    attack: 5,
    defense: 2,
    expReward: 20,
    moneyReward: [10, 30],
    drops: [{ itemId: 'pocion_salud', chance: 0.3 }],
    description: 'Un pequeño slime gelatinoso.'
  },
  goblin: {
    id: 'goblin',
    name: 'Goblin',
    emoji: '👺',
    level: 5,
    health: 60,
    attack: 12,
    defense: 5,
    expReward: 50,
    moneyReward: [30, 80],
    drops: [
      { itemId: 'hierro', chance: 0.4 },
      { itemId: 'pocion_salud', chance: 0.2 }
    ],
    description: 'Criatura verde y maliciosa.'
  },
  lobo: {
    id: 'lobo',
    name: 'Lobo Salvaje',
    emoji: '🐺',
    level: 8,
    health: 80,
    attack: 18,
    defense: 8,
    expReward: 80,
    moneyReward: [50, 120],
    drops: [{ itemId: 'pocion_energia', chance: 0.25 }],
    description: 'Un lobo feroz del bosque.'
  },
  esqueleto: {
    id: 'esqueleto',
    name: 'Esqueleto',
    emoji: '💀',
    level: 12,
    health: 100,
    attack: 22,
    defense: 12,
    expReward: 120,
    moneyReward: [80, 200],
    drops: [
      { itemId: 'hierro', chance: 0.3 },
      { itemId: 'espada_hierro', chance: 0.1 }
    ],
    description: 'Guerrero no-muerto.'
  },
  orco: {
    id: 'orco',
    name: 'Orco',
    emoji: '👹',
    level: 18,
    health: 180,
    attack: 35,
    defense: 20,
    expReward: 200,
    moneyReward: [150, 400],
    drops: [
      { itemId: 'armadura_cuero', chance: 0.15 },
      { itemId: 'pocion_salud_mayor', chance: 0.2 }
    ],
    description: 'Bruto y peligroso.'
  },
  troll: {
    id: 'troll',
    name: 'Troll de las Cavernas',
    emoji: '🧌',
    level: 25,
    health: 300,
    attack: 45,
    defense: 30,
    expReward: 350,
    moneyReward: [300, 700],
    drops: [
      { itemId: 'oro_material', chance: 0.3 },
      { itemId: 'anillo_fuerza', chance: 0.1 }
    ],
    description: 'Gigante de las cavernas.'
  },
  demonio: {
    id: 'demonio',
    name: 'Demonio Menor',
    emoji: '👿',
    level: 35,
    health: 400,
    attack: 60,
    defense: 40,
    expReward: 500,
    moneyReward: [500, 1200],
    drops: [
      { itemId: 'cristal_mana', chance: 0.25 },
      { itemId: 'pocion_mana', chance: 0.4 }
    ],
    description: 'Criatura del inframundo.'
  },
  dragon_joven: {
    id: 'dragon_joven',
    name: 'Dragón Joven',
    emoji: '🐲',
    level: 50,
    health: 800,
    attack: 100,
    defense: 60,
    expReward: 1500,
    moneyReward: [2000, 5000],
    drops: [
      { itemId: 'escama_dragon', chance: 0.4 },
      { itemId: 'espada_dragon', chance: 0.05 }
    ],
    description: 'Un dragón aún joven pero letal.'
  }
};

// ==================== DUNGEONS ====================

export interface Dungeon {
  id: string;
  name: string;
  emoji: string;
  description: string;
  requiredLevel: number;
  staminaCost: number;
  monsters: string[];
  bossId: string;
  rewards: {
    expMultiplier: number;
    moneyMultiplier: number;
    guaranteedDrops: string[];
    bonusDrops: { itemId: string; chance: number }[];
  };
}

export const DUNGEONS: Record<string, Dungeon> = {
  cueva_slimes: {
    id: 'cueva_slimes',
    name: 'Cueva de los Slimes',
    emoji: '🕳️',
    description: 'Una cueva húmeda llena de slimes.',
    requiredLevel: 1,
    staminaCost: 20,
    monsters: ['slime', 'slime', 'slime'],
    bossId: 'slime', // Slime gigante
    rewards: {
      expMultiplier: 1.5,
      moneyMultiplier: 1.3,
      guaranteedDrops: ['pocion_salud'],
      bonusDrops: [{ itemId: 'hierro', chance: 0.3 }]
    }
  },
  bosque_maldito: {
    id: 'bosque_maldito',
    name: 'Bosque Maldito',
    emoji: '🌲',
    description: 'Un bosque oscuro habitado por criaturas.',
    requiredLevel: 10,
    staminaCost: 35,
    monsters: ['lobo', 'goblin', 'lobo'],
    bossId: 'orco',
    rewards: {
      expMultiplier: 1.8,
      moneyMultiplier: 1.5,
      guaranteedDrops: ['pocion_energia'],
      bonusDrops: [
        { itemId: 'espada_hierro', chance: 0.2 },
        { itemId: 'armadura_cuero', chance: 0.15 }
      ]
    }
  },
  catacumbas: {
    id: 'catacumbas',
    name: 'Catacumbas Antiguas',
    emoji: '⚰️',
    description: 'Ruinas subterráneas llenas de no-muertos.',
    requiredLevel: 20,
    staminaCost: 50,
    monsters: ['esqueleto', 'esqueleto', 'goblin', 'esqueleto'],
    bossId: 'troll',
    rewards: {
      expMultiplier: 2.0,
      moneyMultiplier: 1.8,
      guaranteedDrops: ['pocion_salud_mayor'],
      bonusDrops: [
        { itemId: 'espada_acero', chance: 0.15 },
        { itemId: 'oro_material', chance: 0.3 }
      ]
    }
  },
  torre_demoniaca: {
    id: 'torre_demoniaca',
    name: 'Torre Demoníaca',
    emoji: '🏰',
    description: 'Una torre corrupta por energía oscura.',
    requiredLevel: 35,
    staminaCost: 70,
    monsters: ['demonio', 'esqueleto', 'demonio', 'orco'],
    bossId: 'demonio',
    rewards: {
      expMultiplier: 2.5,
      moneyMultiplier: 2.0,
      guaranteedDrops: ['cristal_mana', 'pocion_mana'],
      bonusDrops: [
        { itemId: 'baston_arcano', chance: 0.1 },
        { itemId: 'amuleto_vida', chance: 0.15 }
      ]
    }
  },
  guarida_dragon: {
    id: 'guarida_dragon',
    name: 'Guarida del Dragón',
    emoji: '🐉',
    description: 'El hogar de un dragón ancestral.',
    requiredLevel: 50,
    staminaCost: 90,
    monsters: ['troll', 'demonio', 'demonio', 'troll'],
    bossId: 'dragon_joven',
    rewards: {
      expMultiplier: 3.0,
      moneyMultiplier: 3.0,
      guaranteedDrops: ['escama_dragon'],
      bonusDrops: [
        { itemId: 'espada_dragon', chance: 0.1 },
        { itemId: 'armadura_dragon', chance: 0.08 },
        { itemId: 'collar_suerte', chance: 0.12 }
      ]
    }
  }
};

// ==================== MISIONES ====================

export type QuestType = 'daily' | 'weekly';
export type QuestObjective = 'work' | 'combat' | 'dungeon' | 'rob' | 'spend' | 'earn';

export interface Quest {
  id: string;
  name: string;
  emoji: string;
  description: string;
  type: QuestType;
  objective: QuestObjective;
  target: number;
  rewards: {
    exp: number;
    money: number;
    items?: string[];
  };
}

export const DAILY_QUESTS: Quest[] = [
  {
    id: 'daily_work_3',
    name: 'Trabajador Dedicado',
    emoji: '🔨',
    description: 'Trabaja 3 veces',
    type: 'daily',
    objective: 'work',
    target: 3,
    rewards: { exp: 500, money: 300 }
  },
  {
    id: 'daily_combat_5',
    name: 'Cazador Novato',
    emoji: '⚔️',
    description: 'Derrota 5 monstruos',
    type: 'daily',
    objective: 'combat',
    target: 5,
    rewards: { exp: 800, money: 500 }
  },
  {
    id: 'daily_dungeon_1',
    name: 'Explorador',
    emoji: '🗺️',
    description: 'Completa 1 dungeon',
    type: 'daily',
    objective: 'dungeon',
    target: 1,
    rewards: { exp: 1000, money: 800 }
  },
  {
    id: 'daily_rob_2',
    name: 'Bandido',
    emoji: '🦹',
    description: 'Intenta robar 2 veces',
    type: 'daily',
    objective: 'rob',
    target: 2,
    rewards: { exp: 400, money: 600 }
  }
];

export const WEEKLY_QUESTS: Quest[] = [
  {
    id: 'weekly_work_15',
    name: 'Obrero del Mes',
    emoji: '🏆',
    description: 'Trabaja 15 veces esta semana',
    type: 'weekly',
    objective: 'work',
    target: 15,
    rewards: { exp: 3000, money: 2000, items: ['elixir_exp'] }
  },
  {
    id: 'weekly_combat_30',
    name: 'Guerrero Veterano',
    emoji: '⚔️',
    description: 'Derrota 30 monstruos esta semana',
    type: 'weekly',
    objective: 'combat',
    target: 30,
    rewards: { exp: 5000, money: 3000, items: ['pocion_salud_mayor', 'pocion_salud_mayor'] }
  },
  {
    id: 'weekly_dungeon_5',
    name: 'Aventurero Experto',
    emoji: '🗺️',
    description: 'Completa 5 dungeons esta semana',
    type: 'weekly',
    objective: 'dungeon',
    target: 5,
    rewards: { exp: 8000, money: 5000, items: ['cristal_mana'] }
  },
  {
    id: 'weekly_earn_10000',
    name: 'Mercader',
    emoji: '💰',
    description: 'Gana 10,000 monedas esta semana',
    type: 'weekly',
    objective: 'earn',
    target: 10000,
    rewards: { exp: 4000, money: 0, items: ['anillo_fuerza'] }
  }
];

// ==================== LOGROS ====================

export interface Achievement {
  id: string;
  name: string;
  emoji: string;
  description: string;
  requirement: {
    type: 'level' | 'money' | 'kills' | 'dungeons' | 'items' | 'class';
    value: number | string;
  };
  rewards: {
    exp: number;
    money: number;
    title?: string;
    items?: string[];
  };
}

export const ACHIEVEMENTS: Achievement[] = [
  // Nivel
  {
    id: 'level_10',
    name: 'Aprendiz',
    emoji: '📖',
    description: 'Alcanza el nivel 10',
    requirement: { type: 'level', value: 10 },
    rewards: { exp: 500, money: 1000, title: '📖 Aprendiz' }
  },
  {
    id: 'level_25',
    name: 'Aventurero',
    emoji: '🗺️',
    description: 'Alcanza el nivel 25',
    requirement: { type: 'level', value: 25 },
    rewards: { exp: 2000, money: 5000, title: '🗺️ Aventurero' }
  },
  {
    id: 'level_50',
    name: 'Héroe',
    emoji: '🦸',
    description: 'Alcanza el nivel 50',
    requirement: { type: 'level', value: 50 },
    rewards: { exp: 10000, money: 20000, title: '🦸 Héroe', items: ['elixir_exp'] }
  },
  {
    id: 'level_100',
    name: 'Leyenda Viviente',
    emoji: '👑',
    description: 'Alcanza el nivel 100',
    requirement: { type: 'level', value: 100 },
    rewards: { exp: 50000, money: 100000, title: '👑 Leyenda', items: ['espada_dragon'] }
  },

  // Dinero
  {
    id: 'rich_10k',
    name: 'Ahorrador',
    emoji: '💵',
    description: 'Acumula 10,000 monedas',
    requirement: { type: 'money', value: 10000 },
    rewards: { exp: 300, money: 500 }
  },
  {
    id: 'rich_100k',
    name: 'Rico',
    emoji: '💰',
    description: 'Acumula 100,000 monedas',
    requirement: { type: 'money', value: 100000 },
    rewards: { exp: 3000, money: 10000, title: '💰 Millonario' }
  },

  // Kills
  {
    id: 'kills_50',
    name: 'Cazador',
    emoji: '🎯',
    description: 'Derrota 50 monstruos',
    requirement: { type: 'kills', value: 50 },
    rewards: { exp: 1000, money: 500 }
  },
  {
    id: 'kills_500',
    name: 'Exterminador',
    emoji: '☠️',
    description: 'Derrota 500 monstruos',
    requirement: { type: 'kills', value: 500 },
    rewards: { exp: 10000, money: 5000, title: '☠️ Exterminador' }
  },

  // Dungeons
  {
    id: 'dungeons_10',
    name: 'Explorador de Mazmorras',
    emoji: '🏰',
    description: 'Completa 10 dungeons',
    requirement: { type: 'dungeons', value: 10 },
    rewards: { exp: 2000, money: 2000 }
  },
  {
    id: 'dungeons_50',
    name: 'Conquistador',
    emoji: '⚔️',
    description: 'Completa 50 dungeons',
    requirement: { type: 'dungeons', value: 50 },
    rewards: { exp: 15000, money: 15000, title: '⚔️ Conquistador', items: ['collar_suerte'] }
  },

  // Clases
  {
    id: 'class_warrior',
    name: 'Camino del Guerrero',
    emoji: '⚔️',
    description: 'Elige la clase Guerrero',
    requirement: { type: 'class', value: 'guerrero' },
    rewards: { exp: 200, money: 200 }
  },
  {
    id: 'class_mage',
    name: 'Camino del Mago',
    emoji: '🔮',
    description: 'Elige la clase Mago',
    requirement: { type: 'class', value: 'mago' },
    rewards: { exp: 200, money: 200 }
  },
  {
    id: 'class_thief',
    name: 'Camino del Ladrón',
    emoji: '🗡️',
    description: 'Elige la clase Ladrón',
    requirement: { type: 'class', value: 'ladron' },
    rewards: { exp: 200, money: 200 }
  },
  {
    id: 'class_archer',
    name: 'Camino del Arquero',
    emoji: '🏹',
    description: 'Elige la clase Arquero',
    requirement: { type: 'class', value: 'arquero' },
    rewards: { exp: 200, money: 200 }
  }
];

// ==================== SKILLS ====================

export interface Skill {
  id: string;
  name: string;
  emoji: string;
  description: string;
  manaCost: number;
  staminaCost: number;
  cooldown: number; // en turnos
  effect: {
    damage?: number;
    damageMultiplier?: number;
    heal?: number;
    defense?: number;
    buff?: { stat: string; value: number; duration: number };
    debuff?: { stat: string; value: number; duration: number };
  };
  requiredClass: PlayerClass[];
}

export const SKILLS: Record<string, Skill> = {
  // Guerrero
  golpe_brutal: {
    id: 'golpe_brutal',
    name: 'Golpe Brutal',
    emoji: '💥',
    description: 'Un golpe devastador que causa 150% de daño.',
    manaCost: 0,
    staminaCost: 20,
    cooldown: 2,
    effect: { damageMultiplier: 1.5 },
    requiredClass: ['guerrero']
  },
  escudo_defensor: {
    id: 'escudo_defensor',
    name: 'Escudo Defensor',
    emoji: '🛡️',
    description: 'Aumenta defensa en 50% por 3 turnos.',
    manaCost: 10,
    staminaCost: 10,
    cooldown: 4,
    effect: { buff: { stat: 'defense', value: 50, duration: 3 } },
    requiredClass: ['guerrero']
  },
  grito_guerra: {
    id: 'grito_guerra',
    name: 'Grito de Guerra',
    emoji: '📢',
    description: 'Aumenta ataque en 30% por 3 turnos.',
    manaCost: 15,
    staminaCost: 15,
    cooldown: 5,
    effect: { buff: { stat: 'attack', value: 30, duration: 3 } },
    requiredClass: ['guerrero']
  },

  // Mago
  bola_fuego: {
    id: 'bola_fuego',
    name: 'Bola de Fuego',
    emoji: '🔥',
    description: 'Lanza una bola de fuego que causa 200% de daño.',
    manaCost: 30,
    staminaCost: 5,
    cooldown: 2,
    effect: { damageMultiplier: 2.0 },
    requiredClass: ['mago']
  },
  rayo_arcano: {
    id: 'rayo_arcano',
    name: 'Rayo Arcano',
    emoji: '⚡',
    description: 'Un rayo de energía pura que causa 180% de daño.',
    manaCost: 25,
    staminaCost: 5,
    cooldown: 1,
    effect: { damageMultiplier: 1.8 },
    requiredClass: ['mago']
  },
  escudo_magico: {
    id: 'escudo_magico',
    name: 'Escudo Mágico',
    emoji: '✨',
    description: 'Crea un escudo que absorbe daño y aumenta defensa 40%.',
    manaCost: 40,
    staminaCost: 0,
    cooldown: 4,
    effect: { buff: { stat: 'defense', value: 40, duration: 3 } },
    requiredClass: ['mago']
  },

  // Ladrón
  ataque_furtivo: {
    id: 'ataque_furtivo',
    name: 'Ataque Furtivo',
    emoji: '🔪',
    description: 'Ataque sorpresa que causa 250% de daño si eres más rápido.',
    manaCost: 10,
    staminaCost: 25,
    cooldown: 3,
    effect: { damageMultiplier: 2.5 },
    requiredClass: ['ladron']
  },
  evadir: {
    id: 'evadir',
    name: 'Evadir',
    emoji: '💨',
    description: 'Esquiva el próximo ataque completamente.',
    manaCost: 5,
    staminaCost: 15,
    cooldown: 3,
    effect: { buff: { stat: 'evasion', value: 100, duration: 1 } },
    requiredClass: ['ladron']
  },
  robo_vital: {
    id: 'robo_vital',
    name: 'Robo Vital',
    emoji: '💚',
    description: 'Roba 50% del daño causado como vida.',
    manaCost: 20,
    staminaCost: 20,
    cooldown: 4,
    effect: { damageMultiplier: 1.2, heal: 50 },
    requiredClass: ['ladron']
  },

  // Arquero
  disparo_preciso: {
    id: 'disparo_preciso',
    name: 'Disparo Preciso',
    emoji: '🎯',
    description: 'Un disparo certero que causa 180% de daño.',
    manaCost: 10,
    staminaCost: 15,
    cooldown: 1,
    effect: { damageMultiplier: 1.8 },
    requiredClass: ['arquero']
  },
  lluvia_flechas: {
    id: 'lluvia_flechas',
    name: 'Lluvia de Flechas',
    emoji: '🌧️',
    description: 'Dispara múltiples flechas causando 220% de daño.',
    manaCost: 25,
    staminaCost: 30,
    cooldown: 3,
    effect: { damageMultiplier: 2.2 },
    requiredClass: ['arquero']
  },
  trampa_cazador: {
    id: 'trampa_cazador',
    name: 'Trampa de Cazador',
    emoji: '🪤',
    description: 'Coloca una trampa que reduce la defensa enemiga 30%.',
    manaCost: 20,
    staminaCost: 10,
    cooldown: 4,
    effect: { debuff: { stat: 'defense', value: 30, duration: 3 } },
    requiredClass: ['arquero']
  }
};
