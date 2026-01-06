/**
 * 💾 Sistema de Base de Datos para CYALTRONIC
 * Wrapper tipado sobre LowDB para persistencia JSON
 */

import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import type { DatabaseSchema } from '../types/database.js';
import { DEFAULT_DATABASE } from '../types/database.js';
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

      // Asegurar valores numéricos válidos
      if (typeof user.maxHealth !== 'number' || isNaN(user.maxHealth)) {
        user.maxHealth = 100;
        needsMigration = true;
      }
      if (typeof user.maxMana !== 'number' || isNaN(user.maxMana)) {
        user.maxMana = 20;
        needsMigration = true;
      }
      if (typeof user.maxStamina !== 'number' || isNaN(user.maxStamina)) {
        user.maxStamina = 100;
        needsMigration = true;
      }
      if (typeof user.attack !== 'number' || isNaN(user.attack)) {
        user.attack = 10;
        needsMigration = true;
      }
      if (typeof user.defense !== 'number' || isNaN(user.defense)) {
        user.defense = 5;
        needsMigration = true;
      }
      if (typeof user.critChance !== 'number' || isNaN(user.critChance)) {
        user.critChance = 5;
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
    Object.assign(user, updates);
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
