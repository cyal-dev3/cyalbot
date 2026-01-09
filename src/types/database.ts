/**
 * 🗄️ Tipos de base de datos para CYALTRONIC
 * Define el esquema de la base de datos JSON
 */

import type { UserRPG } from './user.js';

/**
 * Advertencia de usuario en un grupo
 */
export interface UserWarning {
  odBy: string;      // JID del admin que advirtió
  odTo: string;      // JID del usuario advertido
  reason: string;    // Razón de la advertencia
  timestamp: number; // Fecha de la advertencia
}

/**
 * Configuración de un chat/grupo
 */
export interface ChatSettings {
  welcome: boolean;
  antiLink: boolean;
  antiSpam: boolean;   // NUEVO: Sistema antispam
  detect: boolean;
  sWelcome: string;
  sBye: string;
  warnings: UserWarning[];  // NUEVO: Advertencias del grupo
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
 * Valores por defecto para configuración de chat
 */
export const DEFAULT_CHAT_SETTINGS: ChatSettings = {
  welcome: true,
  antiLink: false,
  antiSpam: false,
  detect: true,
  sWelcome: '👋 ¡Bienvenido/a {user} a {group}!\n\n📝 Usa /verificar nombre.edad para registrarte.',
  sBye: '👋 {user} ha abandonado el grupo.',
  warnings: []
};

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
