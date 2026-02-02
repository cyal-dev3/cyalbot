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
  // Sistema de mute persistente
  autoMuteEnabled: boolean;     // Si automute está activo
  mutedUsers: string[];         // Lista de usuarios muteados (JIDs)
  // Sistema de autoclear
  autoClearEnabled: boolean;    // Si autoclear está activo (limpia mensajes del bot después de 2 min)
  // Modo compacto - reduce spam del bot
  compactMode: boolean;         // Si está activo, usa reacciones en lugar de mensajes
  // Anti-Delete: reenviar mensajes eliminados al grupo
  antiDelete: boolean;
  // Anti-Bad Words: filtro de groserías
  antiBad: boolean;
  badWords: string[];
  // Auto-Sticker: convertir imágenes automáticamente a stickers
  autoSticker: boolean;
  // Auto-Downloader: detectar URLs y descargar automáticamente
  autoDownload: boolean;
  // Frases personalizadas para comandos de diversión
  customPoka?: string[];        // Frases personalizadas para .poka
  customCtm?: string[];         // Frases personalizadas para .ctm
  // Sistema de Betting/Tipsters
  bettingSystem?: BettingSystem;
}

/**
 * Estadísticas de un tipster
 */
export interface TipsterStats {
  name: string;           // Nombre original del tipster
  normalized: string;     // Nombre normalizado para búsquedas
  wins: number;           // Picks ganados
  losses: number;         // Picks perdidos
  pending: number;        // Picks pendientes
  currentStreak: number;  // Racha actual (+wins/-losses)
  bestStreak: number;     // Mejor racha de wins
  worstStreak: number;    // Peor racha de losses (negativo)
  totalUnits: number;     // Total unidades apostadas
  wonUnits: number;       // Unidades ganadas
  lostUnits: number;      // Unidades perdidas
  lastPickDate: number;   // Timestamp del último pick
  followers: string[];    // JIDs de seguidores del tipster
}

/**
 * Pick individual de apuesta
 */
export interface BettingPick {
  id: string;             // ID único del pick
  tipster: string;        // Nombre normalizado del tipster
  tipsterOriginal: string; // Nombre original del tipster
  description: string;    // Caption/descripción del pick
  units: number;          // Unidades apostadas (default 1)
  status: 'pending' | 'won' | 'lost';
  createdAt: number;      // Timestamp de creación
  resolvedAt?: number;    // Timestamp de resolución
  resolvedBy?: string;    // JID de quien resolvió
  createdBy: string;      // JID de quien registró
  followers: string[];    // JIDs de usuarios que siguieron el pick
  messageId?: string;     // ID del mensaje original para referencia
}

/**
 * Sistema de betting por grupo
 */
export interface BettingSystem {
  enabled: boolean;           // Si el sistema está activo
  autoRegister: boolean;      // Registrar picks automáticamente al detectar 🎫
  tipsters: Record<string, TipsterStats>;  // Tipsters indexados por nombre normalizado
  picks: BettingPick[];       // Lista de picks
  maxPicks: number;           // Máximo de picks a guardar (default 500)
  maxHistory: number;         // Máximo de historial resuelto (default 100)
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
    /** Modo del bot: public, private (solo owner), group (solo grupos), inbox (solo privado) */
    botMode: 'public' | 'private' | 'group' | 'inbox';
    /** Configuración de eventos automáticos */
    autoEvents?: {
      enabled: boolean;
      minInterval: number;
      maxInterval: number;
      announcementGroups: string[];
    };
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
  warnings: [],
  autoMuteEnabled: false,
  mutedUsers: [],
  autoClearEnabled: false,
  compactMode: false,
  antiDelete: false,
  antiBad: false,
  badWords: [],
  autoSticker: false,
  autoDownload: false,
  bettingSystem: undefined
};

/**
 * Valores por defecto para el sistema de betting
 */
export const DEFAULT_BETTING_SYSTEM: BettingSystem = {
  enabled: false,
  autoRegister: false,
  tipsters: {},
  picks: [],
  maxPicks: 500,
  maxHistory: 100
};

/**
 * Valores por defecto para stats de tipster
 */
export const DEFAULT_TIPSTER_STATS: Omit<TipsterStats, 'name' | 'normalized'> = {
  wins: 0,
  losses: 0,
  pending: 0,
  currentStreak: 0,
  bestStreak: 0,
  worstStreak: 0,
  totalUnits: 0,
  wonUnits: 0,
  lostUnits: 0,
  lastPickDate: 0,
  followers: []
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
    publicMode: true,
    botMode: 'public'
  }
};
