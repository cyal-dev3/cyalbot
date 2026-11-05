import type { proto, WASocket, GroupMetadata, AnyMessageContent, MiscMessageGenerationOptions } from 'baileys';
import type { ChatSettings } from './database.js';
import type { UserRPG } from './user.js';

/** Alias registrado por dos plugins: gana el primero, el segundo queda sombreado. */
export interface AliasCollision {
  alias: string;
  winner: string;
  loser: string;
}

/**
 * Lo que un plugin puede pedirle al handler. Es una interfaz aparte para que
 * los plugins no importen la clase y se evite la dependencia circular.
 */
export interface MessageHandlerInterface {
  getTrackedMessages(chatId: string): { key: proto.IMessageKey; timestamp: number; isCommand?: boolean }[];
  clearTrackedMessages(chatId: string): void;
  trackMessage(chatId: string, key: proto.IMessageKey, isCommand?: boolean): void;
  isAutoMuteEnabled(groupId: string): boolean;
  setAutoMute(groupId: string, enabled: boolean): void;
  muteUser(groupId: string, userId: string): void;
  unmuteUser(groupId: string, userId: string): boolean;
  isUserMuted(groupId: string, userId: string): boolean;
  isAutoClearEnabled(chatId: string): boolean;
  setAutoClear(chatId: string, enabled: boolean): void;
  isCompactMode(chatId: string): boolean;
  setCompactMode(chatId: string, enabled: boolean): void;
  /** Registra un contexto de juego: sus plugins tienen prioridad mientras isActive sea true. */
  registerContext(context: CommandContext): void;
  getContexts(): readonly CommandContext[];
  /** Plugins del registro global por nombre de registro. */
  getPlugins(): PluginRegistry;
  /** Alias que dos plugins intentaron registrar; el menú oculta los perdedores. */
  getAliasCollisions(): readonly AliasCollision[];
  /** Plugin del registro global que responde a un alias (índice O(1)), o null. */
  findPlugin(alias: string): { name: string; plugin: PluginHandler } | null;
}

/**
 * Contexto de comandos con prioridad: mientras `isActive(m)` devuelva true para
 * un mensaje, el handler busca el comando primero entre `plugins` (y, si
 * `noPrefix` es true, también acepta el texto sin prefijo). Sirve para que
 * "a", "pedir" o "huir" vayan al juego en curso y no a otro plugin con el
 * mismo alias. Los plugins de un contexto NO entran en el registro global
 * salvo que el autor también los registre con registerPlugin.
 */
export interface CommandContext {
  name: string;
  isActive: (m: SerializedMessage) => boolean;
  plugins: PluginHandler[];
  /** Aceptar el texto sin prefijo (cada plugin puede vetarlo con noPrefix: false). */
  noPrefix?: boolean;
}

export interface TargetOptions {
  /** Aceptar un número de teléfono escrito en los argumentos. */
  args?: string[];
  /** Permitir que el objetivo sea el propio remitente. */
  allowSelf?: boolean;
}

/**
 * Contexto que recibe cada plugin al ejecutarse
 */
export interface MessageContext {
  conn: WASocket;
  m: SerializedMessage;
  text: string;
  args: string[];
  command: string;
  usedPrefix: string;
  isOwner: boolean;
  isAdmin: boolean;
  isBotAdmin: boolean;
  isGroup: boolean;
  /** Solo se rellena cuando el plugin pide admin/botAdmin/group (lectura perezosa). */
  groupMetadata?: GroupMetadata;
  participants?: string[];
  groupAdmins?: string[];
  /** Handler de mensajes para acceso a funciones avanzadas */
  handler: MessageHandlerInterface;
  /** Ajustes del chat leídos una vez por mensaje. En privado son los defaults (no se crea entrada en la BD). */
  chatSettings: ChatSettings;
  /** Usuario del remitente; se lee de la BD la primera vez que se accede. */
  readonly user: UserRPG;
  /** Envía un mensaje al chat y lo rastrea para /clear (solo en grupos). */
  send: (content: AnyMessageContent, options?: MiscMessageGenerationOptions) => Promise<proto.WebMessageInfo | undefined>;
  /** Objetivo de la acción: mención, cita o número en los argumentos. Nunca un grupo. */
  target: (options?: TargetOptions) => string | null;
}

/**
 * Mensaje serializado con métodos de utilidad
 */
export interface SerializedMessage {
  key: proto.IMessageKey;
  sender: string;
  chat: string;
  text: string;
  fromMe: boolean;
  isGroup: boolean;
  pushName: string;
  mentionedJid: string[];
  quoted?: QuotedMessage;
  /** Mensaje original de Baileys (para descargar media) */
  rawMessage?: proto.IWebMessageInfo;
  /** Contenido real del mensaje, ya desenvuelto (efímero, ver una vez...). */
  message?: proto.IMessage;
  reply: (text: string) => Promise<proto.WebMessageInfo | undefined>;
  react: (emoji: string) => Promise<void>;
}

/**
 * Mensaje citado/respondido
 */
export interface QuotedMessage {
  key: proto.IMessageKey;
  sender: string;
  text: string;
  message: proto.IMessage;
}

/**
 * Estructura de un plugin/comando
 */
export interface PluginHandler {
  /** Comando(s) que activan el plugin */
  command: RegExp | string[];

  /** Descripción del comando */
  description?: string;

  /** Categoría del comando (rpg, group, download, tools, fun, etc.) */
  category?: string;

  /** Categorías del comando (legacy) */
  tags?: string[];

  /** Texto de ayuda */
  help?: string[];

  /** Ejemplos de uso, sin prefijo: ['ia <pregunta>', 'ia reset'] */
  usage?: string[];

  /** Acepta el comando sin prefijo (solo dentro de un CommandContext activo). */
  noPrefix?: boolean;

  /** No rastrear el mensaje del comando para /clear (p. ej. el propio clear). */
  untracked?: boolean;

  /** Solo para el dueño */
  owner?: boolean;

  /** Solo en grupos */
  group?: boolean;

  /** Requiere ser admin del grupo */
  admin?: boolean;

  /** Requiere que el bot sea admin */
  botAdmin?: boolean;

  /** Requiere estar registrado */
  register?: boolean;

  /** Función que ejecuta el comando */
  handler: (ctx: MessageContext) => Promise<void | unknown>;
}

/**
 * Registro de plugins cargados
 */
export type PluginRegistry = Map<string, PluginHandler>;

/**
 * Configuración de mute por grupo
 */
export interface MuteConfig {
  enabled: boolean;
  mutedUsers: Set<string>;
}

/**
 * Registro de mutes por grupo
 */
export type MuteRegistry = Map<string, MuteConfig>;
