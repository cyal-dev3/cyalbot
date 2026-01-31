/**
 * 💬 Tipos de mensajes para CYALTRONIC
 * Define interfaces para el manejo de mensajes y plugins
 */

import type { proto, WASocket, GroupMetadata } from 'baileys';

// Forward declaration para evitar dependencia circular
export interface MessageHandlerInterface {
  getTrackedMessages(chatId: string): { key: proto.IMessageKey; timestamp: number; isCommand?: boolean }[];
  clearTrackedMessages(chatId: string): void;
  trackMessage(chatId: string, key: proto.IMessageKey, isCommand?: boolean): void;
  isAutoMuteEnabled(groupId: string): boolean;
  setAutoMute(groupId: string, enabled: boolean): void;
  muteUser(groupId: string, userId: string): void;
  unmuteUser(groupId: string, userId: string): boolean;
  isUserMuted(groupId: string, userId: string): boolean;
  getMuteRegistry(): MuteRegistry;
  // Autoclear
  isAutoClearEnabled(chatId: string): boolean;
  setAutoClear(chatId: string, enabled: boolean): void;
  makeMessageInvisible(chatId: string, key: proto.IMessageKey): Promise<boolean>;
  // Modo compacto
  isCompactMode(chatId: string): boolean;
  setCompactMode(chatId: string, enabled: boolean): void;
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
  groupMetadata?: GroupMetadata;
  participants?: string[];
  groupAdmins?: string[];
  /** Handler de mensajes para acceso a funciones avanzadas */
  handler: MessageHandlerInterface;
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
