import SQLite from 'better-sqlite3';
import { readFile, rename, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { DatabaseSchema, ChatSettings, UserWarning, Guild } from '../types/database.js';
import { DEFAULT_DATABASE, DEFAULT_CHAT_SETTINGS } from '../types/database.js';
import { DEFAULT_USER, DEFAULT_USER_BETTING, type UserRPG } from '../types/user.js';
import { CLASSES } from '../types/rpg.js';
import { BettingStore } from './betting-store.js';
import { createLogger } from './logger.js';
import * as scheduler from './scheduler.js';

const log = createLogger('db');

/** Con SQLite cada guardado escribe solo las filas que cambiaron, así que puede ser frecuente. */
const AUTOSAVE_INTERVAL_MS = 10_000;
/** Cada instancia tiene su propia tarea de autoguardado (los tests abren varias a la vez). */
let instanceCounter = 0;
const BACKUP_INTERVAL_MS = 24 * 60 * 60_000;
const MAX_WARNINGS_PER_GROUP = 1000;
const MAX_STOP_SAVE_ATTEMPTS = 3;

/** Versión actual del esquema; subirla implica añadir una migración en runMigrations */
export const SCHEMA_VERSION = 2;

/**
 * La migración a schemaVersion 2 resta los baseStats de clase que rpg-clase.ts
 * sumaba a los stats base del usuario (desde entonces la clase se aplica solo en
 * calculateTotalStats). Debe activarse en el mismo cambio en que rpg-clase.ts
 * deje de sumar/restar baseStats; hasta entonces queda apagada.
 */
export const CLASS_STATS_MIGRATION_ENABLED = true;

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

/** Stats actuales y el máximo con el que se reponen si llegan corruptos */
const CURRENT_STAT_MAX = { health: 'maxHealth', mana: 'maxMana', stamina: 'maxStamina' } as const;

function isInventoryEntry(entry: unknown): entry is UserRPG['inventory'][number] {
  return isPlainObject(entry)
    && typeof entry.itemId === 'string'
    && typeof entry.quantity === 'number'
    && Number.isFinite(entry.quantity);
}

/** Quita entradas corruptas del inventario y funde los items renombrados; devuelve si cambió algo */
function sanitizeInventory(user: UserRPG): boolean {
  let changed = false;
  const valid = user.inventory.filter(isInventoryEntry);
  if (valid.length !== user.inventory.length) {
    user.inventory = valid;
    changed = true;
  }

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

/**
 * Repara la estructura de user.betting solo si existe (no está en DEFAULT_USER,
 * así que la tabla general no lo cubre); nunca lo crea.
 */
function migrateBetting(user: UserRPG): boolean {
  if (user.betting === undefined) return false;
  if (!isPlainObject(user.betting)) {
    user.betting = structuredClone(DEFAULT_USER_BETTING);
    return true;
  }
  let changed = applyDefaults(user.betting, DEFAULT_USER_BETTING);
  if (applyDefaults(user.betting.stats, DEFAULT_USER_BETTING.stats)) changed = true;
  return changed;
}

/**
 * Migración tabular de un usuario: cada clave de DEFAULT_USER que falte, o cuyo
 * valor numérico no sea finito, recibe un clon del default. Devuelve si cambió algo.
 */
export function migrateUser(user: UserRPG): boolean {
  const record = user as unknown as Record<string, unknown>;
  // Un stat actual corrupto se repone con el máximo del propio usuario, no con el default absoluto,
  // para no dejar health > maxHealth
  const invalidCurrent = (Object.keys(CURRENT_STAT_MAX) as (keyof typeof CURRENT_STAT_MAX)[])
    .filter(key => needsDefault(record[key], DEFAULT_USER[key]));

  let changed = applyDefaults(user, DEFAULT_USER);
  for (const key of invalidCurrent) {
    user[key] = user[CURRENT_STAT_MAX[key]];
  }
  if (sanitizeInventory(user)) changed = true;
  if (migrateBetting(user)) changed = true;

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
  // Usuarios de BD antigua pueden llegar sin estos campos; se tratan como el default
  const finite = (value: number, fallback: number): number => (Number.isFinite(value) ? value : fallback);

  user.maxHealth = Math.max(DEFAULT_USER.maxHealth, finite(user.maxHealth, DEFAULT_USER.maxHealth) - base.healthBonus);
  user.maxMana = Math.max(DEFAULT_USER.maxMana, finite(user.maxMana, DEFAULT_USER.maxMana) - base.manaBonus);
  user.maxStamina = Math.max(DEFAULT_USER.maxStamina, finite(user.maxStamina, DEFAULT_USER.maxStamina) - base.staminaBonus);
  user.attack = Math.max(DEFAULT_USER.attack, finite(user.attack, DEFAULT_USER.attack) - base.attackBonus);
  user.defense = Math.max(DEFAULT_USER.defense, finite(user.defense, DEFAULT_USER.defense) - base.defenseBonus);

  user.health = Math.min(finite(user.health, user.maxHealth), user.maxHealth);
  user.mana = Math.min(finite(user.mana, user.maxMana), user.maxMana);
  user.stamina = Math.min(finite(user.stamina, user.maxStamina), user.maxStamina);
  return true;
}

// ==================== ALMACENAMIENTO SQLITE ====================

/**
 * Secciones raíz que son colecciones (una fila por clave). El resto de claves de
 * DatabaseSchema (settings, reminders, birthdays...) van a la tabla `kv`, una
 * fila por clave raíz.
 */
const COLLECTIONS = ['users', 'chats', 'guilds', 'stats'] as const;
type Collection = (typeof COLLECTIONS)[number];
const KV_TABLE = 'kv';

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS users  (key TEXT PRIMARY KEY, data TEXT NOT NULL) WITHOUT ROWID;
  CREATE TABLE IF NOT EXISTS chats  (key TEXT PRIMARY KEY, data TEXT NOT NULL) WITHOUT ROWID;
  CREATE TABLE IF NOT EXISTS guilds (key TEXT PRIMARY KEY, data TEXT NOT NULL) WITHOUT ROWID;
  CREATE TABLE IF NOT EXISTS stats  (key TEXT PRIMARY KEY, data TEXT NOT NULL) WITHOUT ROWID;
  CREATE TABLE IF NOT EXISTS kv     (key TEXT PRIMARY KEY, data TEXT NOT NULL) WITHOUT ROWID;
`;

interface Row {
  key: string;
  data: string;
}

/**
 * Rutas de almacenamiento. Si la ruta configurada termina en .json se trata
 * como la base de datos antigua: el archivo SQLite se crea al lado con la misma
 * base de nombre y el JSON se importa una sola vez.
 */
export function resolveStoragePaths(filepath: string): { sqlitePath: string; legacyJson: string } {
  if (/\.json$/i.test(filepath)) {
    return { sqlitePath: filepath.replace(/\.json$/i, '.sqlite'), legacyJson: filepath };
  }
  return { sqlitePath: filepath, legacyJson: join(dirname(filepath), 'database.json') };
}

/**
 * Persistencia tipada sobre SQLite (better-sqlite3): usuarios, chats, gremios,
 * estadísticas y configuración. El modelo en memoria sigue siendo `data`
 * (DatabaseSchema), que los plugins leen y mutan directamente marcando `dirty`;
 * cada guardado compara la serialización de cada entrada con la última escrita
 * y solo toca en disco las filas que cambiaron, dentro de una transacción.
 */
export class Database {
  private sqlite: SQLite.Database | null = null;
  private store: DatabaseSchema = structuredClone(DEFAULT_DATABASE);
  private readonly sqlitePath: string;
  private readonly legacyJson: string;
  private readonly autosaveTask = `db:autosave:${++instanceCounter}`;
  private dirty = false;
  private saving: Promise<boolean> | null = null;
  private lastBackupAt = 0;
  /** Última serialización escrita por tabla y clave; sirve para detectar qué filas cambiaron. */
  private readonly written: Record<Collection | typeof KV_TABLE, Map<string, string>> = {
    users: new Map(), chats: new Map(), guilds: new Map(), stats: new Map(), kv: new Map(),
  };
  readonly betting: BettingStore;

  constructor(filepath: string = 'database.sqlite') {
    const paths = resolveStoragePaths(filepath);
    this.sqlitePath = paths.sqlitePath;
    this.legacyJson = paths.legacyJson;
    this.betting = new BettingStore(this);
  }

  /** Abre (o crea) el archivo SQLite, importa la BD JSON antigua si procede, valida la estructura y arranca el autoguardado */
  async init(): Promise<void> {
    const sqlite = new SQLite(this.sqlitePath);
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('synchronous = NORMAL');
    sqlite.exec(SCHEMA_SQL);
    this.sqlite = sqlite;

    try {
      const loaded = this.loadFromSqlite();
      if (!loaded) await this.importLegacyJson();
      this.ensureStructure();
      this.runMigrations();
    } catch (error) {
      sqlite.close();
      this.sqlite = null;
      throw error;
    }

    scheduler.every(this.autosaveTask, AUTOSAVE_INTERVAL_MS, () => {
      if (this.dirty) void this.save();
    });

    const size = await this.fileSize();
    log.info(`base de datos inicializada (${this.sqlitePath}, ${(size / 1024).toFixed(1)} KB, ${Object.keys(this.store.users).length} usuarios)`);
  }

  private async fileSize(): Promise<number> {
    try {
      return (await stat(this.sqlitePath)).size;
    } catch {
      return 0;
    }
  }

  private db(): SQLite.Database {
    if (!this.sqlite) throw new Error('Base de datos no inicializada');
    return this.sqlite;
  }

  /** Carga todas las tablas en memoria. Devuelve false si el archivo estaba vacío (recién creado). */
  private loadFromSqlite(): boolean {
    const sqlite = this.db();
    let rows = 0;
    const data = this.store as unknown as Record<string, unknown>;

    for (const table of COLLECTIONS) {
      const section: Record<string, unknown> = {};
      for (const row of sqlite.prepare(`SELECT key, data FROM ${table}`).iterate() as IterableIterator<Row>) {
        rows++;
        try {
          section[row.key] = JSON.parse(row.data);
          this.written[table].set(row.key, row.data);
        } catch (error) {
          log.error(`fila corrupta en ${table}/${row.key}, se descarta:`, error);
          this.dirty = true;
        }
      }
      data[table] = section;
    }
    for (const row of sqlite.prepare(`SELECT key, data FROM ${KV_TABLE}`).iterate() as IterableIterator<Row>) {
      rows++;
      try {
        data[row.key] = JSON.parse(row.data);
        this.written.kv.set(row.key, row.data);
      } catch (error) {
        log.error(`fila corrupta en ${KV_TABLE}/${row.key}, se descarta:`, error);
        this.dirty = true;
      }
    }
    return rows > 0;
  }

  /**
   * Importa la base de datos JSON anterior (lowdb) si existe junto al archivo
   * SQLite y este acaba de crearse. El JSON se renombra a .migrated para no
   * importarlo dos veces; si no es JSON válido se aparta como .corrupt y se
   * arranca vacío. Un error de E/S distinto se propaga.
   */
  private async importLegacyJson(): Promise<void> {
    if (!existsSync(this.legacyJson)) return;
    let raw: string;
    try {
      raw = await readFile(this.legacyJson, 'utf-8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      log.error(`${this.legacyJson} no contiene JSON válido; se arranca con una base vacía:`, error);
      await this.setAside(this.legacyJson, `.corrupt-${Date.now()}`);
      this.dirty = true;
      return;
    }

    if (isPlainObject(parsed)) {
      this.store = parsed as unknown as DatabaseSchema;
    }
    this.dirty = true;
    const users = isPlainObject(parsed) && isPlainObject(parsed.users) ? Object.keys(parsed.users).length : 0;
    log.info(`importada la base de datos JSON (${users} usuarios) a ${this.sqlitePath}`);
    this.ensureStructure();
    await this.save();
    await this.setAside(this.legacyJson, '.migrated');
  }

  private async setAside(path: string, suffix: string): Promise<void> {
    try {
      await rename(path, `${path}${suffix}`);
      log.warn(`${path} renombrado a ${path}${suffix}`);
    } catch (error) {
      log.warn(`no se pudo renombrar ${path}:`, error);
    }
  }

  /** Garantiza que cada sección raíz sea un objeto plano; lo que no lo sea se reemplaza por el default */
  private ensureStructure(): void {
    if (!isPlainObject(this.store)) {
      this.store = structuredClone(DEFAULT_DATABASE);
      this.dirty = true;
    }
    const data = this.store as unknown as Record<string, unknown>;
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
    if (applyDefaults(this.store.settings, DEFAULT_DATABASE.settings)) {
      this.dirty = true;
    }
  }

  private runMigrations(): void {
    const settings = this.store.settings;
    const current = settings.schemaVersion ?? 1;
    if (current >= SCHEMA_VERSION) return;

    if (current < 2) {
      if (!CLASS_STATS_MIGRATION_ENABLED) {
        log.debug('migración de stats de clase pendiente (CLASS_STATS_MIGRATION_ENABLED=false)');
        return;
      }
      let migrated = 0;
      for (const user of Object.values(this.store.users)) {
        if (!isPlainObject(user)) continue;
        // Primero se sanea el usuario: sobre campos ausentes la resta daría NaN
        migrateUser(user);
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
    const existing = this.store.users[jid];
    if (!existing || !isPlainObject(existing)) {
      this.store.users[jid] = structuredClone(DEFAULT_USER);
      this.dirty = true;
    } else if (migrateUser(existing)) {
      this.dirty = true;
    }
    return this.store.users[jid];
  }

  /** Reemplaza al usuario por un clon limpio de DEFAULT_USER */
  resetUser(jid: string): UserRPG {
    this.store.users[jid] = structuredClone(DEFAULT_USER);
    this.dirty = true;
    return this.store.users[jid];
  }

  /**
   * Actualiza campos del usuario. Los stats numéricos críticos ignoran
   * null/undefined/NaN para no pisar valores válidos. Los valores objeto que no
   * sean ya los del propio usuario se clonan, para que un spread de DEFAULT_USER
   * (u otro usuario) no deje objetos anidados compartidos.
   */
  updateUser(jid: string, updates: Partial<UserRPG>): void {
    const user = this.getUser(jid);
    const current = user as unknown as Record<string, unknown>;

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
    for (const [key, value] of Object.entries(safeUpdates)) {
      if (typeof value === 'object' && value !== null && value !== current[key]) {
        safeUpdates[key] = structuredClone(value);
      }
    }

    Object.assign(user, safeUpdates);
    this.dirty = true;
  }

  hasUser(jid: string): boolean {
    return jid in this.store.users;
  }

  getRegisteredUsers(): [string, UserRPG][] {
    return Object.entries(this.store.users).filter(([, user]) => user.registered);
  }

  getTopUsers(limit: number = 10): [string, UserRPG][] {
    return this.getRegisteredUsers()
      .sort(([, a], [, b]) => b.exp - a.exp)
      .slice(0, limit);
  }

  // ==================== PERSISTENCIA ====================

  /**
   * Guarda en disco las filas que cambiaron desde el último guardado. Devuelve
   * true si terminó bien. isDirty se baja antes de escribir y se vuelve a subir
   * si falla. La escritura es síncrona (better-sqlite3), pero la firma sigue
   * siendo asíncrona por compatibilidad con quien la espera.
   */
  async save(): Promise<boolean> {
    if (this.saving) {
      return this.saving.then(() => (this.dirty ? this.save() : true));
    }
    this.saving = this.doSave().finally(() => {
      this.saving = null;
    });
    return this.saving;
  }

  private async doSave(): Promise<boolean> {
    this.dirty = false;
    try {
      const changed = this.flush();
      if (changed > 0) log.debug(`${changed} filas escritas`);
      await this.backupIfDue();
      return true;
    } catch (error) {
      this.dirty = true;
      log.error('error guardando base de datos:', error);
      return false;
    }
  }

  /** Escribe en una transacción solo las filas cuya serialización cambió y borra las que desaparecieron. */
  private flush(): number {
    const sqlite = this.db();
    const data = this.store as unknown as Record<string, unknown>;
    let changed = 0;

    const run = sqlite.transaction(() => {
      for (const table of COLLECTIONS) {
        const section = isPlainObject(data[table]) ? (data[table] as Record<string, unknown>) : {};
        changed += this.syncTable(table, section);
      }
      const kv: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(data)) {
        if ((COLLECTIONS as readonly string[]).includes(key) || value === undefined) continue;
        kv[key] = value;
      }
      changed += this.syncTable(KV_TABLE, kv);
    });
    run();
    return changed;
  }

  private syncTable(table: Collection | typeof KV_TABLE, section: Record<string, unknown>): number {
    const sqlite = this.db();
    const written = this.written[table];
    const upsert = sqlite.prepare(`INSERT INTO ${table} (key, data) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET data = excluded.data`);
    const remove = sqlite.prepare(`DELETE FROM ${table} WHERE key = ?`);
    let changed = 0;

    for (const [key, value] of Object.entries(section)) {
      const json = JSON.stringify(value);
      if (json === undefined || written.get(key) === json) continue;
      upsert.run(key, json);
      written.set(key, json);
      changed++;
    }
    for (const key of [...written.keys()]) {
      if (key in section) continue;
      remove.run(key);
      written.delete(key);
      changed++;
    }
    return changed;
  }

  /** Copia consistente del archivo a .bak como máximo una vez al día */
  private async backupIfDue(): Promise<void> {
    const now = Date.now();
    if (now - this.lastBackupAt < BACKUP_INTERVAL_MS) return;
    this.lastBackupAt = now;
    try {
      await this.db().backup(`${this.sqlitePath}.bak`);
    } catch (error) {
      log.warn('no se pudo crear el respaldo .bak:', error);
    }
  }

  get data(): DatabaseSchema {
    return this.store;
  }

  /**
   * Detiene el autoguardado, hace el flush final y cierra el archivo. Repite
   * mientras queden cambios sin escribir (con tope, por si el disco falla).
   */
  async stop(): Promise<void> {
    scheduler.stop(this.autosaveTask);
    if (!this.sqlite) return;
    if (this.saving) await this.saving;
    for (let attempt = 0; attempt < MAX_STOP_SAVE_ATTEMPTS && this.dirty; attempt++) {
      if (!(await this.save())) break;
    }
    if (this.dirty) log.error('la base de datos se detiene con cambios sin guardar');
    try {
      this.sqlite.close();
    } catch (error) {
      log.warn('error al cerrar la base de datos:', error);
    }
    this.sqlite = null;
  }

  // ==================== CHATS ====================

  getChatSettings(chatId: string): ChatSettings {
    const existing = this.store.chats[chatId];
    if (!existing || !isPlainObject(existing)) {
      this.store.chats[chatId] = structuredClone(DEFAULT_CHAT_SETTINGS);
      this.dirty = true;
    } else if (migrateChatSettings(existing)) {
      this.dirty = true;
    }
    return this.store.chats[chatId];
  }

  updateChatSettings(chatId: string, updates: Partial<ChatSettings>): void {
    Object.assign(this.getChatSettings(chatId), updates);
    this.dirty = true;
  }

  getAllChatIds(): string[] {
    return Object.keys(this.store.chats);
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
    if (!this.store.guilds) {
      this.store.guilds = {};
      this.dirty = true;
    }
    return this.store.guilds;
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
    return this.store.settings;
  }

  updateSettings(settings: Partial<DatabaseSchema['settings']>): void {
    Object.assign(this.store.settings, settings);
    this.dirty = true;
  }
}

let database: Database | null = null;

export function getDatabase(): Database {
  if (!database) {
    throw new Error('Base de datos no inicializada');
  }
  return database;
}

export async function initDatabase(filepath: string = 'database.sqlite'): Promise<Database> {
  database = new Database(filepath);
  await database.init();
  return database;
}
