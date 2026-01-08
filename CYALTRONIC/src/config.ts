/**
 * ⚙️ Configuración Global de CYALTRONIC
 * Todas las constantes y ajustes del bot
 */

/**
 * Configuración principal del bot
 */
export const CONFIG = {
  // 🤖 Información del bot
  botName: 'CYALTRONIC',
  version: '1.0.0',

  // 📝 Prefijos de comandos aceptados
  prefix: /^[#!/.]/,

  // 📁 Carpeta de sesión de WhatsApp
  authFolder: 'CyaltronicSession',

  // 👑 Números de los dueños del bot (pueden ser números de teléfono o LIDs)
  owners: ['5213314429560', '174912593502302'],

  // ⏰ Cooldowns en milisegundos
  cooldowns: {
    daily: 24 * 60 * 60 * 1000,    // 24 horas (una vez al día)
    work: 10 * 60 * 1000,          // 10 minutos
    mine: 10 * 60 * 1000,          // 10 minutos (futuro)
    adventure: 25 * 60 * 1000,     // 25 minutos (futuro)
    hunt: 45 * 60 * 1000,          // 45 minutos (futuro)
    rob: 60 * 60 * 1000,           // 1 hora
    crime: 60 * 60 * 1000          // 1 hora (futuro)
  },

  // 💬 Mensajes del sistema
  messages: {
    wait: '⏳ _Procesando tu solicitud..._',
    error: '❌ ¡Ups! Ocurrió un error inesperado.',
    cooldown: (time: string) => `⏰ ¡Calma, aventurero! Debes esperar *${time}* para usar este comando de nuevo.`,
    notRegistered: '❌ ¡No estás registrado!\n\n📝 Usa */verificar nombre.edad* para comenzar tu aventura.',
    noPermission: '🚫 No tienes permiso para usar este comando.',
    ownerOnly: '👑 Este comando es solo para el dueño del bot.',
    groupOnly: '👥 Este comando solo funciona en grupos.',
    privateOnly: '📱 Este comando solo funciona en chat privado.'
  },

  // 🛡️ Configuración de protección
  protection: {
    maxMessagesPerInterval: 5,   // Máximo de mensajes permitidos
    intervalMs: 10000,           // Intervalo en ms (10 segundos)
    maxWarnings: 3,              // Advertencias antes de kick
    linkRegex: /chat\.whatsapp\.com\/[a-zA-Z0-9]{15,}/gi,
    telegramRegex: /t\.me\/[a-zA-Z0-9_]+/gi
  },

  // 🎮 Configuración del RPG
  rpg: {
    // Bonificación al registrarse
    registerBonus: {
      money: 5000,
      exp: 5000
    },

    // Recompensas diarias (mejoradas - una vez al día)
    dailyRewards: {
      exp: [2000, 2500, 3000, 3500, 4000, 4500, 5000, 6000],
      money: [1500, 2000, 2500, 3000, 3500, 4000, 5000],
      potion: [3, 4, 5, 6, 7, 8],
      diamonds: [5, 10, 15, 20, 25, 30]  // Diamantes aleatorios
    },

    // Recompensas de trabajo
    workRewards: {
      baseExp: 100,
      levelMultiplier: 50,
      bonusChance: 0.2,  // 20% probabilidad de bonus
      bonusMoney: { min: 50, max: 200 }
    },

    // Bonificación por subir de nivel
    levelUpBonus: {
      healthPerLevel: 5,
      staminaPerLevel: 3,
      manaPerLevel: 2,
      moneyPerLevel: 100
    }
  }
} as const;

/**
 * Tipo de la configuración (para TypeScript)
 */
export type Config = typeof CONFIG;
