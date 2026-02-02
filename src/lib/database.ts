/**
 * 💾 Sistema de Base de Datos para CYALTRONIC
 * Wrapper tipado sobre LowDB para persistencia JSON
 */

import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import type { DatabaseSchema, ChatSettings, UserWarning, BettingSystem, TipsterStats, BettingPick } from '../types/database.js';
import { DEFAULT_DATABASE, DEFAULT_CHAT_SETTINGS, DEFAULT_BETTING_SYSTEM, DEFAULT_TIPSTER_STATS } from '../types/database.js';
import { DEFAULT_USER, DEFAULT_USER_BETTING, type UserRPG, type UserBetting } from '../types/user.js';

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

      // Migrar timestamps de lowercase a camelCase
      const timestampMigrations: [string, string][] = [
        ['lastclaim', 'lastClaim'],
        ['lastwork', 'lastWork'],
        ['lastmine', 'lastMine'],
        ['lastrob', 'lastRob'],
        ['lastduel', 'lastDuel'],
        ['lastattack', 'lastAttack'],
        ['lastdungeon', 'lastDungeon'],
        ['lastbomb', 'lastBomb']
      ];

      for (const [oldKey, newKey] of timestampMigrations) {
        const userAny = user as unknown as Record<string, unknown>;
        if (oldKey in userAny && !(newKey in userAny)) {
          userAny[newKey] = userAny[oldKey];
          delete userAny[oldKey];
          needsMigration = true;
        }
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

  // ============================================
  // ⚙️ FUNCIONES DE CONFIGURACIÓN GLOBAL
  // ============================================

  /**
   * Obtiene la configuración global del bot
   */
  getSettings(): DatabaseSchema['settings'] {
    return this.db.data.settings;
  }

  /**
   * Actualiza la configuración global del bot
   */
  updateSettings(settings: Partial<DatabaseSchema['settings']>): void {
    Object.assign(this.db.data.settings, settings);
    this.isDirty = true;
  }

  // ============================================
  // 🎰 FUNCIONES DE BETTING/TIPSTERS
  // ============================================

  /**
   * Normaliza el nombre de un tipster para indexar
   * Elimina emojis, espacios extra, y convierte a minúsculas
   */
  normalizeTipsterName(name: string): string {
    return name
      .replace(/[\u{1F300}-\u{1F9FF}]/gu, '') // Eliminar emojis
      .replace(/[^\w\sáéíóúñÁÉÍÓÚÑ]/gi, '') // Solo letras, números, espacios y acentos
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_'); // Espacios a guiones bajos
  }

  /**
   * Obtiene el sistema de betting de un grupo
   * Lo crea si no existe
   */
  getBettingSystem(chatId: string): BettingSystem {
    const chat = this.getChatSettings(chatId);
    if (!chat.bettingSystem) {
      chat.bettingSystem = { ...DEFAULT_BETTING_SYSTEM, tipsters: {}, picks: [] };
      this.isDirty = true;
    }
    return chat.bettingSystem;
  }

  /**
   * Actualiza el sistema de betting
   */
  updateBettingSystem(chatId: string, updates: Partial<BettingSystem>): void {
    const system = this.getBettingSystem(chatId);
    Object.assign(system, updates);
    this.isDirty = true;
  }

  /**
   * Obtiene o crea un tipster
   */
  getOrCreateTipster(chatId: string, tipsterName: string): TipsterStats {
    const system = this.getBettingSystem(chatId);
    const normalized = this.normalizeTipsterName(tipsterName);

    if (!system.tipsters[normalized]) {
      system.tipsters[normalized] = {
        ...DEFAULT_TIPSTER_STATS,
        name: tipsterName.trim(),
        normalized,
        followers: []
      };
      this.isDirty = true;
    }

    return system.tipsters[normalized];
  }

  /**
   * Obtiene un tipster existente
   */
  getTipster(chatId: string, tipsterName: string): TipsterStats | null {
    const system = this.getBettingSystem(chatId);
    const normalized = this.normalizeTipsterName(tipsterName);
    return system.tipsters[normalized] || null;
  }

  /**
   * Registra un nuevo pick
   */
  registerPick(chatId: string, pick: Omit<BettingPick, 'id'>): BettingPick {
    const system = this.getBettingSystem(chatId);
    const tipster = this.getOrCreateTipster(chatId, pick.tipsterOriginal);

    // Generar ID único
    const id = `pick_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const newPick: BettingPick = {
      ...pick,
      id,
      tipster: tipster.normalized
    };

    // Agregar pick al inicio
    system.picks.unshift(newPick);

    // Actualizar stats del tipster
    tipster.pending++;
    tipster.totalUnits += pick.units;
    tipster.lastPickDate = Date.now();

    // Limpiar picks antiguos si excede el límite
    if (system.picks.length > system.maxPicks) {
      system.picks = system.picks.slice(0, system.maxPicks);
    }

    this.isDirty = true;
    return newPick;
  }

  /**
   * Resuelve un pick (marca como ganado o perdido)
   */
  resolvePick(chatId: string, pickId: string, won: boolean, resolvedBy: string): BettingPick | null {
    const system = this.getBettingSystem(chatId);
    const pick = system.picks.find(p => p.id === pickId);

    if (!pick || pick.status !== 'pending') return null;

    const tipster = system.tipsters[pick.tipster];
    if (!tipster) return null;

    // Actualizar pick
    pick.status = won ? 'won' : 'lost';
    pick.resolvedAt = Date.now();
    pick.resolvedBy = resolvedBy;

    // Actualizar stats del tipster
    tipster.pending--;

    if (won) {
      tipster.wins++;
      tipster.wonUnits += pick.units;
      tipster.currentStreak = tipster.currentStreak >= 0 ? tipster.currentStreak + 1 : 1;
      if (tipster.currentStreak > tipster.bestStreak) {
        tipster.bestStreak = tipster.currentStreak;
      }
    } else {
      tipster.losses++;
      tipster.lostUnits += pick.units;
      tipster.currentStreak = tipster.currentStreak <= 0 ? tipster.currentStreak - 1 : -1;
      if (tipster.currentStreak < tipster.worstStreak) {
        tipster.worstStreak = tipster.currentStreak;
      }
    }

    // Actualizar stats de seguidores
    for (const followerJid of pick.followers) {
      const user = this.getUser(followerJid);
      if (user.betting) {
        if (won) {
          user.betting.stats.wonFollowed++;
        } else {
          user.betting.stats.lostFollowed++;
        }
      }
    }

    this.isDirty = true;
    return pick;
  }

  /**
   * Obtiene picks pendientes de un grupo
   */
  getPendingPicks(chatId: string, tipsterName?: string): BettingPick[] {
    const system = this.getBettingSystem(chatId);
    let picks = system.picks.filter(p => p.status === 'pending');

    if (tipsterName) {
      const normalized = this.normalizeTipsterName(tipsterName);
      picks = picks.filter(p => p.tipster === normalized);
    }

    return picks;
  }

  /**
   * Obtiene un pick por ID de mensaje
   */
  getPickByMessageId(chatId: string, messageId: string): BettingPick | null {
    const system = this.getBettingSystem(chatId);
    return system.picks.find(p => p.messageId === messageId) || null;
  }

  /**
   * Obtiene un pick por ID
   */
  getPickById(chatId: string, pickId: string): BettingPick | null {
    const system = this.getBettingSystem(chatId);
    return system.picks.find(p => p.id === pickId) || null;
  }

  /**
   * Obtiene el último pick pendiente de un tipster
   */
  getLastPendingPick(chatId: string, tipsterName?: string): BettingPick | null {
    const pending = this.getPendingPicks(chatId, tipsterName);
    return pending.length > 0 ? pending[0] : null;
  }

  /**
   * Sigue un pick
   */
  followPick(chatId: string, pickId: string, userJid: string): boolean {
    const system = this.getBettingSystem(chatId);
    const pick = system.picks.find(p => p.id === pickId);

    if (!pick || pick.status !== 'pending') return false;
    if (pick.followers.includes(userJid)) return false;

    pick.followers.push(userJid);

    // Actualizar stats del usuario
    const user = this.getUser(userJid);
    if (!user.betting) {
      user.betting = { ...DEFAULT_USER_BETTING };
    }
    user.betting.stats.totalFollowed++;

    this.isDirty = true;
    return true;
  }

  /**
   * Obtiene seguidores de un tipster
   */
  getTipsterFollowers(chatId: string, tipsterName: string): string[] {
    const tipster = this.getTipster(chatId, tipsterName);
    return tipster?.followers || [];
  }

  /**
   * Agrega un seguidor a un tipster
   */
  followTipster(chatId: string, tipsterName: string, userJid: string): boolean {
    const tipster = this.getOrCreateTipster(chatId, tipsterName);

    if (tipster.followers.includes(userJid)) return false;

    tipster.followers.push(userJid);

    // Actualizar favoritos del usuario
    const user = this.getUser(userJid);
    if (!user.betting) {
      user.betting = { ...DEFAULT_USER_BETTING };
    }

    const normalized = this.normalizeTipsterName(tipsterName);
    if (!user.betting.favoriteTipsters.includes(normalized)) {
      if (user.betting.favoriteTipsters.length < 20) { // Máximo 20 favoritos
        user.betting.favoriteTipsters.push(normalized);
      }
    }

    this.isDirty = true;
    return true;
  }

  /**
   * Quita un seguidor de un tipster
   */
  unfollowTipster(chatId: string, tipsterName: string, userJid: string): boolean {
    const tipster = this.getTipster(chatId, tipsterName);
    if (!tipster) return false;

    const index = tipster.followers.indexOf(userJid);
    if (index === -1) return false;

    tipster.followers.splice(index, 1);

    // Quitar de favoritos del usuario
    const user = this.getUser(userJid);
    if (user.betting) {
      const normalized = this.normalizeTipsterName(tipsterName);
      const favIndex = user.betting.favoriteTipsters.indexOf(normalized);
      if (favIndex !== -1) {
        user.betting.favoriteTipsters.splice(favIndex, 1);
      }
    }

    this.isDirty = true;
    return true;
  }

  /**
   * Obtiene el betting del usuario
   */
  getUserBetting(userJid: string): UserBetting {
    const user = this.getUser(userJid);
    if (!user.betting) {
      user.betting = { ...DEFAULT_USER_BETTING };
      this.isDirty = true;
    }
    return user.betting;
  }

  /**
   * Obtiene todos los tipsters de un grupo ordenados por algún criterio
   */
  getTipsterRanking(
    chatId: string,
    sortBy: 'winrate' | 'roi' | 'wins' | 'streak' = 'winrate',
    limit: number = 10
  ): TipsterStats[] {
    const system = this.getBettingSystem(chatId);
    const tipsters = Object.values(system.tipsters);

    return tipsters
      .filter(t => t.wins + t.losses > 0) // Solo tipsters con historial
      .sort((a, b) => {
        switch (sortBy) {
          case 'winrate': {
            const wrA = a.wins / (a.wins + a.losses) || 0;
            const wrB = b.wins / (b.wins + b.losses) || 0;
            return wrB - wrA;
          }
          case 'roi': {
            const roiA = a.totalUnits > 0 ? ((a.wonUnits - a.lostUnits) / a.totalUnits) * 100 : 0;
            const roiB = b.totalUnits > 0 ? ((b.wonUnits - b.lostUnits) / b.totalUnits) * 100 : 0;
            return roiB - roiA;
          }
          case 'wins':
            return b.wins - a.wins;
          case 'streak':
            return b.bestStreak - a.bestStreak;
          default:
            return 0;
        }
      })
      .slice(0, limit);
  }

  /**
   * Obtiene historial de picks resueltos
   */
  getPickHistory(chatId: string, tipsterName?: string, limit: number = 100): BettingPick[] {
    const system = this.getBettingSystem(chatId);
    let picks = system.picks.filter(p => p.status !== 'pending');

    if (tipsterName) {
      const normalized = this.normalizeTipsterName(tipsterName);
      picks = picks.filter(p => p.tipster === normalized);
    }

    return picks
      .sort((a, b) => (b.resolvedAt || 0) - (a.resolvedAt || 0))
      .slice(0, limit);
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
