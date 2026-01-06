/**
 * 🗄️ Tipos de base de datos para CYALTRONIC
 * Define el esquema de la base de datos JSON
 */

import type { UserRPG } from './user.js';

/**
 * Configuración de un chat/grupo
 */
export interface ChatSettings {
  welcome: boolean;
  antiLink: boolean;
  detect: boolean;
  sWelcome: string;
  sBye: string;
}

/**
 * Estadísticas de comandos
 */
export interface CommandStats {
  total: number;
  success: number;
  failed: number;
  lastUsed: number;
}

/**
 * Esquema principal de la base de datos
 */
export interface DatabaseSchema {
  /** Datos de todos los usuarios indexados por JID */
  users: Record<string, UserRPG>;

  /** Configuración de chats/grupos indexados por JID */
  chats: Record<string, ChatSettings>;

  /** Estadísticas de uso de comandos */
  stats: Record<string, CommandStats>;

  /** Configuración global del bot */
  settings: {
    autoRead: boolean;
    selfMode: boolean;
    publicMode: boolean;
  };
}

/**
 * Valores por defecto de la base de datos
 */
export const DEFAULT_DATABASE: DatabaseSchema = {
  users: {},
  chats: {},
  stats: {},
  settings: {
    autoRead: false,
    selfMode: false,
    publicMode: true
  }
};
