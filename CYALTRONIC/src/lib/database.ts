/**
 * 💾 Sistema de Base de Datos para CYALTRONIC
 * Wrapper tipado sobre LowDB para persistencia JSON
 */

import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import type { DatabaseSchema, ChatSettings, UserWarning } from '../types/database.js';
import { DEFAULT_DATABASE, DEFAULT_CHAT_SETTINGS } from '../types/database.js';
import { DEFAULT_USER, type UserRPG } from '../types/user.js';

/**
 * Clase principal de base de datos
 * Maneja la persistencia de usuarios, chats y configuración
 */
export class Database {
  private db: Low<DatabaseSchema>;
  private saveInterval: NodeJS.Timeout | null = null;
  private isDirty: boolean = false;

  constructor(filepath: string = 'database.json') {
    const adapter = new JSONFile<DatabaseSchema>(filepath);
    this.db = new Low(adapter, { ...DEFAULT_DATABASE });
  }

  /**
   * Inicializa la base de datos
   * Carga datos existentes o crea una nueva
   */
  async init(): Promise<void> {
    await this.db.read();

    // Asegurar que existe la estructura básica
    if (!this.db.data) {
      this.db.data = { ...DEFAULT_DATABASE };
    }
    if (!this.db.data.users) this.db.data.users = {};
    if (!this.db.data.chats) this.db.data.chats = {};
    if (!this.db.data.stats) this.db.data.stats = {};
    if (!this.db.data.settings) this.db.data.settings = DEFAULT_DATABASE.settings;

    // Auto-guardado cada 30 segundos
    this.saveInterval = setInterval(async () => {
      if (this.isDirty) {
        await this.save();
        this.isDirty = false;
      }
    }, 30000);

    console.log('💾 Base de datos inicializada');
  }

  /**
   * Obtiene un usuario por su JID
   * Si no existe, lo crea con valores por defecto
   * Si existe pero le faltan campos, los agrega con valores por defecto
   */
  getUser(jid: string): UserRPG {
    if (!this.db.data.users[jid]) {
      this.db.data.users[jid] = { ...DEFAULT_USER };
      this.isDirty = true;
    } else {
      // Migrar usuarios existentes: agregar campos faltantes con valores por defecto
      const user = this.db.data.users[jid];
      let needsMigration = false;

      for (const [key, defaultValue] of Object.entries(DEFAULT_USER)) {
        if (!(key in user)) {
          (user as unknown as Record<string, unknown>)[key] = defaultValue;
          needsMigration = true;
        }
      }

      // Asegurar que los objetos anidados existan
      if (!user.equipment) {
        user.equipment = { weapon: null, armor: null, accessory: null };
        needsMigration = true;
      }
      if (!user.inventory) {
        user.inventory = [];
        needsMigration = true;
      }
      if (!user.combatStats) {
        user.combatStats = {
          totalKills: 0,
          dungeonsCompleted: 0,
          pvpWins: 0,
          pvpLosses: 0,
          totalDamageDealt: 0,
          totalDamageReceived: 0,
          bossesKilled: 0
        };
        needsMigration = true;
      }
      if (!user.achievements) {
        user.achievements = [];
        needsMigration = true;
      }
      if (!user.titles) {
        user.titles = ['🌱 Novato'];
        needsMigration = true;
      }
      if (!user.currentTitle) {
        user.currentTitle = '🌱 Novato';
        needsMigration = true;
      }
      if (!user.activeBuffs) {
        user.activeBuffs = [];
        needsMigration = true;
      }
      if (!user.dailyQuests) {
        user.dailyQuests = [];
        needsMigration = true;
      }
      if (!user.weeklyQuests) {
        user.weeklyQuests = [];
        needsMigration = true;
      }

      // Asegurar valores numéricos válidos para stats máximos
      if (typeof user.maxHealth !== 'number' || isNaN(user.maxHealth) || user.maxHealth === null) {
        user.maxHealth = 100;
        needsMigration = true;
      }
      if (typeof user.maxMana !== 'number' || isNaN(user.maxMana) || user.maxMana === null) {
        user.maxMana = 20;
        needsMigration = true;
      }
      if (typeof user.maxStamina !== 'number' || isNaN(user.maxStamina) || user.maxStamina === null) {
        user.maxStamina = 100;
        needsMigration = true;
      }

      // Asegurar valores numéricos válidos para stats actuales
      if (typeof user.health !== 'number' || isNaN(user.health) || user.health === null) {
        user.health = user.maxHealth;
        needsMigration = true;
      }
      if (typeof user.mana !== 'number' || isNaN(user.mana) || user.mana === null) {
        user.mana = user.maxMana;
        needsMigration = true;
      }
      if (typeof user.stamina !== 'number' || isNaN(user.stamina) || user.stamina === null) {
        user.stamina = user.maxStamina;
        needsMigration = true;
      }

      // Asegurar valores numéricos válidos para stats de combate
      if (typeof user.attack !== 'number' || isNaN(user.attack) || user.attack === null) {
        user.attack = 10;
        needsMigration = true;
      }
      if (typeof user.defense !== 'number' || isNaN(user.defense) || user.defense === null) {
        user.defense = 5;
        needsMigration = true;
      }
      if (typeof user.critChance !== 'number' || isNaN(user.critChance) || user.critChance === null) {
        user.critChance = 5;
        needsMigration = true;
      }

      // Asegurar valores numéricos válidos para economía y nivel
      if (typeof user.level !== 'number' || isNaN(user.level) || user.level === null) {
        user.level = 0;
        needsMigration = true;
      }
      if (typeof user.exp !== 'number' || isNaN(user.exp) || user.exp === null) {
        user.exp = 0;
        needsMigration = true;
      }
      if (typeof user.money !== 'number' || isNaN(user.money) || user.money === null) {
        user.money = 15;
        needsMigration = true;
      }
      if (typeof user.limit !== 'number' || isNaN(user.limit) || user.limit === null) {
        user.limit = 20;
        needsMigration = true;
      }
      if (typeof user.potion !== 'number' || isNaN(user.potion) || user.potion === null) {
        user.potion = 10;
        needsMigration = true;
      }

      if (needsMigration) {
        this.isDirty = true;
      }
    }
    return this.db.data.users[jid];
  }

  /**
   * Actualiza los datos de un usuario
   * @param jid - ID del usuario
   * @param updates - Campos a actualizar
   */
  updateUser(jid: string, updates: Partial<UserRPG>): void {
    const user = this.getUser(jid);

    // Filtrar valores undefined y null para stats críticos
    // Esto previene que se sobrescriban valores válidos con null/undefined
    const criticalNumericFields = [
      'health', 'maxHealth', 'stamina', 'maxStamina', 'mana', 'maxMana',
      'attack', 'defense', 'critChance', 'level', 'exp', 'money', 'limit', 'potion'
    ];

    const safeUpdates = { ...updates };
    for (const field of criticalNumericFields) {
      if (field in safeUpdates) {
        const value = (safeUpdates as Record<string, unknown>)[field];
        if (value === undefined || value === null || (typeof value === 'number' && isNaN(value))) {
          delete (safeUpdates as Record<string, unknown>)[field];
        }
      }
    }

    Object.assign(user, safeUpdates);
    this.isDirty = true;
  }

  /**
   * Verifica si un usuario existe
   */
  hasUser(jid: string): boolean {
    return jid in this.db.data.users;
  }

  /**
   * Obtiene todos los usuarios registrados
   */
  getRegisteredUsers(): [string, UserRPG][] {
    return Object.entries(this.db.data.users)
      .filter(([_, user]) => user.registered);
  }

  /**
   * Obtiene el top de usuarios por XP
   * @param limit - Cantidad de usuarios a retornar
   */
  getTopUsers(limit: number = 10): [string, UserRPG][] {
    return Object.entries(this.db.data.users)
      .filter(([_, user]) => user.registered)
      .sort(([, a], [, b]) => b.exp - a.exp)
      .slice(0, limit);
  }

  /**
   * Guarda la base de datos en disco
   */
  async save(): Promise<void> {
    try {
      await this.db.write();
    } catch (error) {
      console.error('❌ Error guardando base de datos:', error);
    }
  }

  /**
   * Acceso directo a los datos
   */
  get data(): DatabaseSchema {
    return this.db.data;
  }

  /**
   * Detiene el auto-guardado
   */
  stop(): void {
    if (this.saveInterval) {
      clearInterval(this.saveInterval);
      this.saveInterval = null;
    }
  }

  // ============================================
  // 🛡️ FUNCIONES DE CONFIGURACIÓN DE CHATS
  // ============================================

  /**
   * Obtiene la configuración de un chat/grupo
   * Si no existe, la crea con valores por defecto
   */
  getChatSettings(chatId: string): ChatSettings {
    if (!this.db.data.chats[chatId]) {
      this.db.data.chats[chatId] = { ...DEFAULT_CHAT_SETTINGS };
      this.isDirty = true;
    } else {
      // Migrar configuración existente: agregar campos faltantes
      const chat = this.db.data.chats[chatId];
      let needsMigration = false;

      for (const [key, defaultValue] of Object.entries(DEFAULT_CHAT_SETTINGS)) {
        if (!(key in chat)) {
          (chat as unknown as Record<string, unknown>)[key] = defaultValue;
          needsMigration = true;
        }
      }

      if (needsMigration) {
        this.isDirty = true;
      }
    }
    return this.db.data.chats[chatId];
  }

  /**
   * Actualiza la configuración de un chat
   */
  updateChatSettings(chatId: string, updates: Partial<ChatSettings>): void {
    const chat = this.getChatSettings(chatId);
    Object.assign(chat, updates);
    this.isDirty = true;
  }

  // ============================================
  // ⚠️ FUNCIONES DE ADVERTENCIAS
  // ============================================

  /**
   * Agrega una advertencia a un usuario en un grupo
   */
  addWarning(chatId: string, warning: UserWarning): number {
    const chat = this.getChatSettings(chatId);
    chat.warnings.push(warning);
    this.isDirty = true;
    // Retornar el número de advertencias del usuario
    return chat.warnings.filter(w => w.odTo === warning.odTo).length;
  }

  /**
   * Obtiene las advertencias de un usuario en un grupo
   */
  getWarnings(chatId: string, userId: string): UserWarning[] {
    const chat = this.getChatSettings(chatId);
    return chat.warnings.filter(w => w.odTo === userId);
  }

  /**
   * Quita una advertencia de un usuario (la más reciente)
   */
  removeWarning(chatId: string, userId: string): boolean {
    const chat = this.getChatSettings(chatId);
    const index = chat.warnings.findIndex(w => w.odTo === userId);
    if (index !== -1) {
      chat.warnings.splice(index, 1);
      this.isDirty = true;
      return true;
    }
    return false;
  }

  /**
   * Limpia todas las advertencias de un usuario
   */
  clearWarnings(chatId: string, userId: string): number {
    const chat = this.getChatSettings(chatId);
    const before = chat.warnings.length;
    chat.warnings = chat.warnings.filter(w => w.odTo !== userId);
    const removed = before - chat.warnings.length;
    if (removed > 0) {
      this.isDirty = true;
    }
    return removed;
  }

  /**
   * Obtiene todas las advertencias de un grupo
   */
  getAllWarnings(chatId: string): UserWarning[] {
    const chat = this.getChatSettings(chatId);
    return chat.warnings;
  }
}

/**
 * Instancia global de la base de datos
 */
let database: Database | null = null;

/**
 * Obtiene la instancia global de la base de datos
 */
export function getDatabase(): Database {
  if (!database) {
    throw new Error('❌ Base de datos no inicializada');
  }
  return database;
}

/**
 * Inicializa la base de datos global
 */
export async function initDatabase(filepath: string = 'database.json'): Promise<Database> {
  database = new Database(filepath);
  await database.init();
  return database;
}
