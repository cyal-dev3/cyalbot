import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import { copyFile, readFile, rename, stat } from 'node:fs/promises';
import type { DatabaseSchema, ChatSettings, UserWarning, BettingSystem, TipsterStats, BettingPick, Guild } from '../types/database.js';
import { DEFAULT_DATABASE, DEFAULT_CHAT_SETTINGS } from '../types/database.js';
import { DEFAULT_USER, type UserRPG, type UserBetting } from '../types/user.js';
import { CLASSES } from '../types/rpg.js';
import { BettingStore } from './betting-store.js';
import { createLogger } from './logger.js';

const log = createLogger('db');

const AUTOSAVE_INTERVAL_MS = 30_000;
const BACKUP_MIN_INTERVAL_MS = 60_000;
const MAX_WARNINGS_PER_GROUP = 1000;

/** Versión actual del esquema; subirla implica añadir una migración en runMigrations */
export const SCHEMA_VERSION = 2;

/**
 * La migración a schemaVersion 2 resta los baseStats de clase que rpg-clase.ts
 * sumaba a los stats base del usuario (desde entonces la clase se aplica solo en
 * calculateTotalStats). Debe activarse en el mismo cambio en que rpg-clase.ts
 * deje de sumar/restar baseStats; hasta entonces queda apagada.
 */
export const CLASS_STATS_MIGRATION_ENABLED = false;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Decide si un campo debe recibir su valor por defecto */
function needsDefault(value: unknown, defaultValue: unknown): boolean {
  if (value === undefined) return true;
  if (typeof defaultValue === 'number') return typeof value !== 'number' || !Number.isFinite(value);
  if (Array.isArray(defaultValue)) return !Array.isArray(value);
  if (isPlainObject(defaultValue)) return !isPlainObject(value);
  return false;
}

/** Rellena con copias de los defaults los campos que faltan o están corruptos */
function applyDefaults<T extends object>(target: T, defaults: T): boolean {
  let changed = false;
  const record = target as unknown as Record<string, unknown>;
  for (const [key, defaultValue] of Object.entries(defaults)) {
    if (needsDefault(record[key], defaultValue)) {
      record[key] = structuredClone(defaultValue);
      changed = true;
    }
  }
  return changed;
}

/** Items retirados de ITEMS que se funden en su equivalente actual */
const RENAMED_ITEMS: Record<string, string> = {
  elixir_experiencia: 'elixir_exp'
};

/**
 * Migración tabular de un usuario: cada clave de DEFAULT_USER que falte, o cuyo
 * valor numérico no sea finito, recibe un clon del default. Devuelve si cambió algo.
 */
export function migrateUser(user: UserRPG): boolean {
  let changed = applyDefaults(user, DEFAULT_USER);

  for (const item of user.inventory) {
    const renamed = RENAMED_ITEMS[item.itemId];
    if (!renamed) continue;
    const existing = user.inventory.find(i => i.itemId === renamed);
    if (existing) {
      existing.quantity += item.quantity;
      item.quantity = 0;
    } else {
      item.itemId = renamed;
    }
    changed = true;
  }
  if (changed && user.inventory.some(i => i.quantity <= 0)) {
    user.inventory = user.inventory.filter(i => i.quantity > 0);
  }

  return changed;
}

export function migrateChatSettings(chat: ChatSettings): boolean {
  return applyDefaults(chat, DEFAULT_CHAT_SETTINGS);
}

/**
 * Resta los baseStats de la clase a los stats base del usuario (ver
 * CLASS_STATS_MIGRATION_ENABLED). Clampa a los mínimos de DEFAULT_USER y
 * recorta los stats actuales al nuevo máximo. Devuelve si cambió algo.
 */
export function removeClassBaseStats(user: UserRPG): boolean {
  if (!user.playerClass || !CLASSES[user.playerClass]) return false;
  const base = CLASSES[user.playerClass].baseStats;

  user.maxHealth = Math.max(DEFAULT_USER.maxHealth, user.maxHealth - base.healthBonus);
  user.maxMana = Math.max(DEFAULT_USER.maxMana, user.maxMana - base.manaBonus);
  user.maxStamina = Math.max(DEFAULT_USER.maxStamina, user.maxStamina - base.staminaBonus);
  user.attack = Math.max(DEFAULT_USER.attack, user.attack - base.attackBonus);
  user.defense = Math.max(DEFAULT_USER.defense, user.defense - base.defenseBonus);

  user.health = Math.min(user.health, user.maxHealth);
  user.mana = Math.min(user.mana, user.maxMana);
  user.stamina = Math.min(user.stamina, user.maxStamina);
  return true;
}

/**
 * Persistencia JSON tipada sobre LowDB: usuarios, chats, gremios y configuración.
 * El betting delega en BettingStore; los wrappers de aquí existen para que los
 * plugins antiguos compilen sin cambios.
 */
export class Database {
  private db: Low<DatabaseSchema>;
  private saveInterval: NodeJS.Timeout | null = null;
  private dirty = false;
  private saving: Promise<boolean> | null = null;
  private lastBackupAt = 0;
  readonly betting: BettingStore;

  constructor(private readonly filepath: string = 'database.json') {
    const adapter = new JSONFile<DatabaseSchema>(filepath);
    this.db = new Low(adapter, structuredClone(DEFAULT_DATABASE));
    this.betting = new BettingStore(this);
  }

  /** Carga el archivo (o su .bak si está corrupto), valida la estructura y arranca el autoguardado */
  async init(): Promise<void> {
    await this.load();
    this.ensureStructure();
    this.runMigrations();

    this.saveInterval = setInterval(() => {
      if (this.dirty) void this.save();
    }, AUTOSAVE_INTERVAL_MS);

    const size = await this.fileSize();
    log.info(`base de datos inicializada (${this.filepath}, ${(size / 1024).toFixed(1)} KB, ${Object.keys(this.db.data.users).length} usuarios)`);
  }

  private async fileSize(): Promise<number> {
    try {
      return (await stat(this.filepath)).size;
    } catch {
      return 0;
    }
  }

  private async load(): Promise<void> {
    try {
      await this.db.read();
      return;
    } catch (error) {
      log.error(`no se pudo leer ${this.filepath}:`, error);
    }

    const backupPath = `${this.filepath}.bak`;
    try {
      const raw = await readFile(backupPath, 'utf-8');
      this.db.data = JSON.parse(raw) as DatabaseSchema;
      log.warn(`datos restaurados desde ${backupPath}`);
    } catch (backupError) {
      log.error(`tampoco se pudo usar ${backupPath}:`, backupError);
      this.db.data = structuredClone(DEFAULT_DATABASE);
    }

    const corruptPath = `${this.filepath}.corrupt-${Date.now()}`;
    try {
      await rename(this.filepath, corruptPath);
      log.warn(`archivo corrupto renombrado a ${corruptPath}`);
    } catch {
      // Si no existe no hay nada que apartar
    }
    this.dirty = true;
  }

  /** Garantiza que cada sección raíz sea un objeto plano; lo que no lo sea se reemplaza por el default */
  private ensureStructure(): void {
    if (!isPlainObject(this.db.data)) {
      this.db.data = structuredClone(DEFAULT_DATABASE);
      this.dirty = true;
    }
    const data = this.db.data as unknown as Record<string, unknown>;
    const sections: Record<string, unknown> = {
      users: {},
      chats: {},
      guilds: {},
      stats: {},
      settings: DEFAULT_DATABASE.settings
    };
    for (const [key, fallback] of Object.entries(sections)) {
      if (!isPlainObject(data[key])) {
        if (data[key] !== undefined) log.warn(`sección ${key} inválida, se reemplaza por el valor por defecto`);
        data[key] = structuredClone(fallback);
        this.dirty = true;
      }
    }
    if (applyDefaults(this.db.data.settings, DEFAULT_DATABASE.settings)) {
      this.dirty = true;
    }
  }

  private runMigrations(): void {
    const settings = this.db.data.settings;
    const current = settings.schemaVersion ?? 1;
    if (current >= SCHEMA_VERSION) return;

    if (current < 2) {
      if (!CLASS_STATS_MIGRATION_ENABLED) {
        log.debug('migración de stats de clase pendiente (CLASS_STATS_MIGRATION_ENABLED=false)');
        return;
      }
      let migrated = 0;
      for (const user of Object.values(this.db.data.users)) {
        if (removeClassBaseStats(user)) migrated++;
      }
      log.info(`migración schemaVersion 2: stats de clase corregidos en ${migrated} usuarios`);
    }

    settings.schemaVersion = SCHEMA_VERSION;
    this.dirty = true;
  }

  /** Marca que hay cambios sin guardar (para quien muta objetos obtenidos por referencia) */
  markDirty(): void {
    this.dirty = true;
  }

  get isDirty(): boolean {
    return this.dirty;
  }

  // ==================== USUARIOS ====================

  /** Devuelve el usuario, creándolo o completando campos faltantes con copias de DEFAULT_USER */
  getUser(jid: string): UserRPG {
    const existing = this.db.data.users[jid];
    if (!existing || !isPlainObject(existing)) {
      this.db.data.users[jid] = structuredClone(DEFAULT_USER);
      this.dirty = true;
    } else if (migrateUser(existing)) {
      this.dirty = true;
    }
    return this.db.data.users[jid];
  }

  /** Reemplaza al usuario por un clon limpio de DEFAULT_USER */
  resetUser(jid: string): UserRPG {
    this.db.data.users[jid] = structuredClone(DEFAULT_USER);
    this.dirty = true;
    return this.db.data.users[jid];
  }

  /**
   * Actualiza campos del usuario. Los stats numéricos críticos ignoran
   * null/undefined/NaN para no pisar valores válidos.
   */
  updateUser(jid: string, updates: Partial<UserRPG>): void {
    const user = this.getUser(jid);

    const criticalNumericFields = [
      'health', 'maxHealth', 'stamina', 'maxStamina', 'mana', 'maxMana',
      'attack', 'defense', 'critChance', 'level', 'exp', 'money', 'limit', 'potion'
    ];

    const safeUpdates = { ...updates } as Record<string, unknown>;
    for (const field of criticalNumericFields) {
      if (field in safeUpdates) {
        const value = safeUpdates[field];
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          delete safeUpdates[field];
        }
      }
    }

    Object.assign(user, safeUpdates);
    this.dirty = true;
  }

  hasUser(jid: string): boolean {
    return jid in this.db.data.users;
  }

  getRegisteredUsers(): [string, UserRPG][] {
    return Object.entries(this.db.data.users).filter(([, user]) => user.registered);
  }

  getTopUsers(limit: number = 10): [string, UserRPG][] {
    return this.getRegisteredUsers()
      .sort(([, a], [, b]) => b.exp - a.exp)
      .slice(0, limit);
  }

  // ==================== PERSISTENCIA ====================

  /**
   * Guarda en disco. Devuelve true si se escribió. isDirty se baja antes de
   * escribir y se vuelve a subir si falla, para no perder cambios hechos durante
   * la escritura ni repetir escrituras innecesarias.
   */
  async save(): Promise<boolean> {
    if (this.saving) return this.saving;
    this.saving = this.doSave().finally(() => {
      this.saving = null;
    });
    return this.saving;
  }

  private async doSave(): Promise<boolean> {
    this.dirty = false;
    try {
      await this.backupIfDue();
      await this.db.write();
      return true;
    } catch (error) {
      this.dirty = true;
      log.error('error guardando base de datos:', error);
      return false;
    }
  }

  /** Copia el archivo actual a .bak como máximo una vez por minuto */
  private async backupIfDue(): Promise<void> {
    const now = Date.now();
    if (now - this.lastBackupAt < BACKUP_MIN_INTERVAL_MS) return;
    try {
      await copyFile(this.filepath, `${this.filepath}.bak`);
      this.lastBackupAt = now;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') log.warn('no se pudo crear el respaldo .bak:', error);
    }
  }

  get data(): DatabaseSchema {
    return this.db.data;
  }

  /** Detiene el autoguardado y hace flush final a disco */
  async stop(): Promise<void> {
    if (this.saveInterval) {
      clearInterval(this.saveInterval);
      this.saveInterval = null;
    }
    if (this.dirty) {
      await this.save();
    }
  }

  // ==================== CHATS ====================

  getChatSettings(chatId: string): ChatSettings {
    const existing = this.db.data.chats[chatId];
    if (!existing || !isPlainObject(existing)) {
      this.db.data.chats[chatId] = structuredClone(DEFAULT_CHAT_SETTINGS);
      this.dirty = true;
    } else if (migrateChatSettings(existing)) {
      this.dirty = true;
    }
    return this.db.data.chats[chatId];
  }

  updateChatSettings(chatId: string, updates: Partial<ChatSettings>): void {
    Object.assign(this.getChatSettings(chatId), updates);
    this.dirty = true;
  }

  getAllChatIds(): string[] {
    return Object.keys(this.db.data.chats);
  }

  // ==================== ADVERTENCIAS ====================

  /** Agrega una advertencia y devuelve cuántas acumula ese usuario en el grupo */
  addWarning(chatId: string, warning: UserWarning): number {
    const chat = this.getChatSettings(chatId);
    chat.warnings.push(warning);
    // Cap duro para evitar crecimiento ilimitado en grupos longevos
    if (chat.warnings.length > MAX_WARNINGS_PER_GROUP) {
      chat.warnings.splice(0, chat.warnings.length - MAX_WARNINGS_PER_GROUP);
    }
    this.dirty = true;
    return chat.warnings.filter(w => w.odTo === warning.odTo).length;
  }

  getWarnings(chatId: string, userId: string): UserWarning[] {
    return this.getChatSettings(chatId).warnings.filter(w => w.odTo === userId);
  }

  /** Quita la advertencia más antigua del usuario */
  removeWarning(chatId: string, userId: string): boolean {
    const chat = this.getChatSettings(chatId);
    const index = chat.warnings.findIndex(w => w.odTo === userId);
    if (index === -1) return false;
    chat.warnings.splice(index, 1);
    this.dirty = true;
    return true;
  }

  clearWarnings(chatId: string, userId: string): number {
    const chat = this.getChatSettings(chatId);
    const before = chat.warnings.length;
    chat.warnings = chat.warnings.filter(w => w.odTo !== userId);
    const removed = before - chat.warnings.length;
    if (removed > 0) this.dirty = true;
    return removed;
  }

  getAllWarnings(chatId: string): UserWarning[] {
    return this.getChatSettings(chatId).warnings;
  }

  // ==================== GREMIOS ====================

  private guilds(): Record<string, Guild> {
    if (!this.db.data.guilds) {
      this.db.data.guilds = {};
      this.dirty = true;
    }
    return this.db.data.guilds;
  }

  getGuild(id: string): Guild | null {
    return this.guilds()[id] ?? null;
  }

  /** Inserta o reemplaza el gremio por su id */
  saveGuild(guild: Guild): void {
    this.guilds()[guild.id] = guild;
    this.dirty = true;
  }

  deleteGuild(id: string): boolean {
    const guilds = this.guilds();
    if (!(id in guilds)) return false;
    delete guilds[id];
    this.dirty = true;
    return true;
  }

  listGuilds(): Guild[] {
    return Object.values(this.guilds());
  }

  // ==================== CONFIGURACIÓN GLOBAL ====================

  getSettings(): DatabaseSchema['settings'] {
    return this.db.data.settings;
  }

  updateSettings(settings: Partial<DatabaseSchema['settings']>): void {
    Object.assign(this.db.data.settings, settings);
    this.dirty = true;
  }

  // ==================== BETTING (wrappers de compatibilidad) ====================

  /** @deprecated Usa db.betting.normalizeTipsterName */
  normalizeTipsterName(name: string): string {
    return this.betting.normalizeTipsterName(name);
  }

  /** @deprecated Usa db.betting.getBettingSystem */
  getBettingSystem(chatId: string): BettingSystem {
    return this.betting.getBettingSystem(chatId);
  }

  /** @deprecated Usa db.betting.updateBettingSystem */
  updateBettingSystem(chatId: string, updates: Partial<BettingSystem>): void {
    this.betting.updateBettingSystem(chatId, updates);
  }

  /** @deprecated Usa db.betting.getOrCreateTipster */
  getOrCreateTipster(chatId: string, tipsterName: string): TipsterStats {
    return this.betting.getOrCreateTipster(chatId, tipsterName);
  }

  /** @deprecated Usa db.betting.getTipster */
  getTipster(chatId: string, tipsterName: string): TipsterStats | null {
    return this.betting.getTipster(chatId, tipsterName);
  }

  /** @deprecated Usa db.betting.registerPick */
  registerPick(chatId: string, pick: Omit<BettingPick, 'id'>): BettingPick {
    return this.betting.registerPick(chatId, pick);
  }

  /** @deprecated Usa db.betting.resolvePick */
  resolvePick(chatId: string, pickId: string, won: boolean, resolvedBy: string): BettingPick | null {
    return this.betting.resolvePick(chatId, pickId, won, resolvedBy);
  }

  /** @deprecated Usa db.betting.cancelPick */
  cancelPick(chatId: string, pickId: string, cancelledBy: string): BettingPick | null {
    return this.betting.cancelPick(chatId, pickId, cancelledBy);
  }

  /** @deprecated Usa db.betting.getPendingPicks */
  getPendingPicks(chatId: string, tipsterName?: string): BettingPick[] {
    return this.betting.getPendingPicks(chatId, tipsterName);
  }

  /** @deprecated Usa db.betting.getPickByMessageId */
  getPickByMessageId(chatId: string, messageId: string): BettingPick | null {
    return this.betting.getPickByMessageId(chatId, messageId);
  }

  /** @deprecated Usa db.betting.setPickMessageId */
  setPickMessageId(chatId: string, pickId: string, messageId: string): boolean {
    return this.betting.setPickMessageId(chatId, pickId, messageId);
  }

  /** @deprecated Usa db.betting.clearPendingPicks */
  clearPendingPicks(chatId: string): number {
    return this.betting.clearPendingPicks(chatId);
  }

  /** @deprecated Usa db.betting.getPickById */
  getPickById(chatId: string, pickId: string): BettingPick | null {
    return this.betting.getPickById(chatId, pickId);
  }

  /** @deprecated Usa db.betting.getLastPendingPick */
  getLastPendingPick(chatId: string, tipsterName?: string): BettingPick | null {
    return this.betting.getLastPendingPick(chatId, tipsterName);
  }

  /** @deprecated Usa db.betting.followPick */
  followPick(chatId: string, pickId: string, userJid: string): boolean {
    return this.betting.followPick(chatId, pickId, userJid);
  }

  /** @deprecated Usa db.betting.getTipsterFollowers */
  getTipsterFollowers(chatId: string, tipsterName: string): string[] {
    return this.betting.getTipsterFollowers(chatId, tipsterName);
  }

  /** @deprecated Usa db.betting.followTipster */
  followTipster(chatId: string, tipsterName: string, userJid: string): boolean {
    return this.betting.followTipster(chatId, tipsterName, userJid);
  }

  /** @deprecated Usa db.betting.unfollowTipster */
  unfollowTipster(chatId: string, tipsterName: string, userJid: string): boolean {
    return this.betting.unfollowTipster(chatId, tipsterName, userJid);
  }

  /** @deprecated Usa db.betting.getUserBetting */
  getUserBetting(userJid: string): UserBetting {
    return this.betting.getUserBetting(userJid);
  }

  /** @deprecated Usa db.betting.getTipsterRanking */
  getTipsterRanking(chatId: string, sortBy: 'winrate' | 'roi' | 'wins' | 'streak' = 'winrate', limit: number = 10): TipsterStats[] {
    return this.betting.getTipsterRanking(chatId, sortBy, limit);
  }

  /** @deprecated Usa db.betting.getPickHistory */
  getPickHistory(chatId: string, tipsterName?: string, limit: number = 100): BettingPick[] {
    return this.betting.getPickHistory(chatId, tipsterName, limit);
  }
}

let database: Database | null = null;

export function getDatabase(): Database {
  if (!database) {
    throw new Error('Base de datos no inicializada');
  }
  return database;
}

export async function initDatabase(filepath: string = 'database.json'): Promise<Database> {
  database = new Database(filepath);
  await database.init();
  return database;
}
