/**
 * 🎲 Sistema de Eventos Automáticos Aleatorios - CYALTRONIC
 *
 * Genera eventos aleatorios de bonificación (x2 a x10) con duraciones
 * variables (1m, 2m, 5m, 10m, 30m) de manera automática y aleatoria.
 */

import type { WASocket } from 'baileys';
import { globalModes } from '../plugins/owner-rpg.js';
import { msToTime, pickRandom, randomInt, weightedRandom } from './utils.js';

// ==================== CONFIGURACIÓN ====================

interface AutoEventConfig {
  enabled: boolean;
  minInterval: number;      // Mínimo tiempo entre eventos (ms)
  maxInterval: number;      // Máximo tiempo entre eventos (ms)
  announcementGroups: string[]; // Grupos donde anunciar eventos
}

// Configuración por defecto
export const autoEventConfig: AutoEventConfig = {
  enabled: false,
  minInterval: 30 * 60 * 1000,   // Mínimo 30 minutos
  maxInterval: 120 * 60 * 1000,  // Máximo 2 horas
  announcementGroups: []         // Grupos donde se anunciarán los eventos
};

// ==================== TIPOS DE EVENTOS ====================

interface EventType {
  id: string;
  name: string;
  emoji: string;
  description: string;
  color: string;
}

const EVENT_TYPES: EventType[] = [
  { id: 'xp', name: 'Lluvia de Experiencia', emoji: '✨', description: 'XP aumentada', color: '🟣' },
  { id: 'money', name: 'Fiebre del Oro', emoji: '💰', description: 'Dinero aumentado', color: '🟡' },
  { id: 'drops', name: 'Cazador de Tesoros', emoji: '📦', description: 'Drops aumentados', color: '🟤' },
  { id: 'pvp', name: 'Arena Sangrienta', emoji: '⚔️', description: 'Daño PvP aumentado', color: '🔴' },
  { id: 'all', name: 'Bendición Divina', emoji: '🌟', description: 'TODO aumentado', color: '⚪' },
  { id: 'rob', name: 'Noche de Ladrones', emoji: '🦹', description: 'Robo sin límites', color: '🟢' },
  { id: 'mana', name: 'Tormenta Arcana', emoji: '💠', description: 'Maná aumentado', color: '🔵' },
  { id: 'combo', name: 'Caos Total', emoji: '🌀', description: 'XP + Dinero combo', color: '🟠' }
];

// Multiplicadores posibles (más probabilidad a los bajos)
const MULTIPLIERS = [
  { value: 2, weight: 30 },   // x2 - 30% probabilidad
  { value: 3, weight: 25 },   // x3 - 25% probabilidad
  { value: 4, weight: 18 },   // x4 - 18% probabilidad
  { value: 5, weight: 12 },   // x5 - 12% probabilidad
  { value: 6, weight: 7 },    // x6 - 7% probabilidad
  { value: 7, weight: 4 },    // x7 - 4% probabilidad
  { value: 8, weight: 2 },    // x8 - 2% probabilidad
  { value: 10, weight: 2 }    // x10 - 2% probabilidad (ÉPICO)
];

// Duraciones posibles (en milisegundos)
const DURATIONS = [
  { ms: 1 * 60 * 1000, name: '1 minuto', weight: 15 },      // 1m - 15%
  { ms: 2 * 60 * 1000, name: '2 minutos', weight: 20 },     // 2m - 20%
  { ms: 5 * 60 * 1000, name: '5 minutos', weight: 30 },     // 5m - 30%
  { ms: 10 * 60 * 1000, name: '10 minutos', weight: 25 },   // 10m - 25%
  { ms: 30 * 60 * 1000, name: '30 minutos', weight: 10 }    // 30m - 10% (RARO)
];

// ==================== GENERADOR DE EVENTOS ====================

interface GeneratedEvent {
  type: EventType;
  multiplier: number;
  duration: number;
  durationName: string;
  isEpic: boolean;
  isLegendary: boolean;
}

/**
 * Genera un evento aleatorio
 */
function generateRandomEvent(): GeneratedEvent {
  const type = pickRandom(EVENT_TYPES);
  const multiplierData = weightedRandom(MULTIPLIERS);
  const durationData = weightedRandom(DURATIONS);

  // Determinar rareza
  const isEpic = multiplierData.value >= 7 || durationData.ms >= 30 * 60 * 1000;
  const isLegendary = multiplierData.value >= 10 && durationData.ms >= 10 * 60 * 1000;

  return {
    type,
    multiplier: multiplierData.value,
    duration: durationData.ms,
    durationName: durationData.name,
    isEpic,
    isLegendary
  };
}

/**
 * Aplica el evento al sistema de modos globales
 */
function applyEvent(event: GeneratedEvent): void {
  const expiresAt = Date.now() + event.duration;

  switch (event.type.id) {
    case 'xp':
      globalModes.bonusMode = {
        active: true,
        expMultiplier: event.multiplier,
        moneyMultiplier: 1,
        manaMultiplier: 1,
        expiresAt,
        activatedBy: 'SISTEMA_AUTO'
      };
      break;

    case 'money':
      globalModes.bonusMode = {
        active: true,
        expMultiplier: 1,
        moneyMultiplier: event.multiplier,
        manaMultiplier: 1,
        expiresAt,
        activatedBy: 'SISTEMA_AUTO'
      };
      break;

    case 'mana':
      globalModes.bonusMode = {
        active: true,
        expMultiplier: 1,
        moneyMultiplier: 1,
        manaMultiplier: event.multiplier,
        expiresAt,
        activatedBy: 'SISTEMA_AUTO'
      };
      break;

    case 'combo':
      globalModes.bonusMode = {
        active: true,
        expMultiplier: event.multiplier,
        moneyMultiplier: event.multiplier,
        manaMultiplier: 1,
        expiresAt,
        activatedBy: 'SISTEMA_AUTO'
      };
      break;

    case 'drops':
      globalModes.eventMode = {
        active: true,
        dropMultiplier: event.multiplier,
        eventName: event.type.name,
        expiresAt,
        activatedBy: 'SISTEMA_AUTO'
      };
      break;

    case 'pvp':
      globalModes.pvpMode = {
        active: true,
        damageMultiplier: event.multiplier,
        expiresAt,
        activatedBy: 'SISTEMA_AUTO'
      };
      break;

    case 'rob':
      globalModes.freeRobMode = {
        active: true,
        expiresAt,
        activatedBy: 'SISTEMA_AUTO'
      };
      break;

    case 'all':
      globalModes.chaosMode = {
        active: true,
        multiplier: event.multiplier,
        expiresAt,
        activatedBy: 'SISTEMA_AUTO'
      };
      break;
  }
}

/**
 * Genera el mensaje de anuncio del evento
 */
function generateEventAnnouncement(event: GeneratedEvent): string {
  let rarity = '📢';
  let rarityText = '';

  if (event.isLegendary) {
    rarity = '🏆';
    rarityText = '\n\n*¡¡¡EVENTO LEGENDARIO!!!*';
  } else if (event.isEpic) {
    rarity = '💎';
    rarityText = '\n\n*¡EVENTO ÉPICO!*';
  }

  const header = event.isLegendary
    ? '╔══════════════════════════════╗\n║  🏆 ¡¡EVENTO LEGENDARIO!! 🏆  ║\n╚══════════════════════════════╝'
    : event.isEpic
    ? '╔══════════════════════════════╗\n║    💎 ¡EVENTO ÉPICO! 💎      ║\n╚══════════════════════════════╝'
    : '╔══════════════════════════════╗\n║    🎲 ¡EVENTO ALEATORIO! 🎲   ║\n╚══════════════════════════════╝';

  const multiplierDisplay = event.type.id === 'rob'
    ? '¡SIN COOLDOWN!'
    : `x${event.multiplier}`;

  let bonusInfo = '';
  if (event.type.id === 'combo') {
    bonusInfo = `\n✨ XP: *x${event.multiplier}*\n💰 Dinero: *x${event.multiplier}*`;
  } else if (event.type.id === 'all') {
    bonusInfo = `\n✨ XP: *x${event.multiplier}*\n💰 Dinero: *x${event.multiplier}*\n⚔️ Daño: *x${event.multiplier}*\n📦 Drops: *x${event.multiplier}*`;
  }

  return `
${header}

${event.type.emoji} *${event.type.name}*
${event.type.color} ${event.type.description}

⚡ *Multiplicador:* ${multiplierDisplay}
⏰ *Duración:* ${event.durationName}
${bonusInfo}
${rarityText}

_¡Aprovecha el evento antes de que termine!_
_Usa .rpgowner para ver los modos activos_
`.trim();
}

// ==================== SISTEMA PRINCIPAL ====================

let eventTimer: NodeJS.Timeout | null = null;
let connInstance: WASocket | null = null;

/**
 * Programa el próximo evento aleatorio
 */
function scheduleNextEvent(): void {
  if (!autoEventConfig.enabled) return;

  // Calcular tiempo aleatorio hasta el próximo evento
  const nextEventIn = randomInt(
    autoEventConfig.minInterval,
    autoEventConfig.maxInterval
  );

  console.log(`[AutoEvents] Próximo evento en ${msToTime(nextEventIn)}`);

  eventTimer = setTimeout(async () => {
    await triggerRandomEvent();
    scheduleNextEvent(); // Programar siguiente evento
  }, nextEventIn);
}

/**
 * Dispara un evento aleatorio
 */
async function triggerRandomEvent(): Promise<void> {
  if (!connInstance) return;

  const event = generateRandomEvent();
  applyEvent(event);

  const announcement = generateEventAnnouncement(event);

  console.log(`[AutoEvents] 🎲 Evento activado: ${event.type.name} x${event.multiplier} por ${event.durationName}`);

  // Anunciar en todos los grupos configurados
  for (const groupId of autoEventConfig.announcementGroups) {
    try {
      await connInstance.sendMessage(groupId, { text: announcement });
    } catch (error) {
      console.error(`[AutoEvents] Error al anunciar en ${groupId}:`, error);
    }
  }
}

/**
 * Inicia el sistema de eventos automáticos
 */
export function startAutoEvents(conn: WASocket): void {
  connInstance = conn;

  if (autoEventConfig.enabled) {
    console.log('[AutoEvents] 🎲 Sistema de eventos automáticos ACTIVADO');
    scheduleNextEvent();
  } else {
    console.log('[AutoEvents] ⏸️ Sistema de eventos automáticos DESACTIVADO');
  }
}

/**
 * Detiene el sistema de eventos automáticos
 */
export function stopAutoEvents(): void {
  if (eventTimer) {
    clearTimeout(eventTimer);
    eventTimer = null;
  }
  console.log('[AutoEvents] ⏹️ Sistema de eventos automáticos DETENIDO');
}

/**
 * Activa/desactiva el sistema
 */
export function toggleAutoEvents(enabled: boolean): void {
  autoEventConfig.enabled = enabled;

  if (enabled) {
    scheduleNextEvent();
  } else {
    stopAutoEvents();
  }
}

/**
 * Agrega un grupo a la lista de anuncios
 */
export function addAnnouncementGroup(groupId: string): boolean {
  if (!autoEventConfig.announcementGroups.includes(groupId)) {
    autoEventConfig.announcementGroups.push(groupId);
    return true;
  }
  return false;
}

/**
 * Remueve un grupo de la lista de anuncios
 */
export function removeAnnouncementGroup(groupId: string): boolean {
  const index = autoEventConfig.announcementGroups.indexOf(groupId);
  if (index > -1) {
    autoEventConfig.announcementGroups.splice(index, 1);
    return true;
  }
  return false;
}

/**
 * Configura los intervalos de tiempo
 */
export function setEventIntervals(minMinutes: number, maxMinutes: number): void {
  autoEventConfig.minInterval = minMinutes * 60 * 1000;
  autoEventConfig.maxInterval = maxMinutes * 60 * 1000;

  // Reiniciar el timer si está activo
  if (autoEventConfig.enabled && eventTimer) {
    stopAutoEvents();
    scheduleNextEvent();
  }
}

/**
 * Fuerza un evento aleatorio inmediato
 */
export async function forceRandomEvent(): Promise<GeneratedEvent> {
  const event = generateRandomEvent();
  applyEvent(event);

  if (connInstance) {
    const announcement = generateEventAnnouncement(event);
    for (const groupId of autoEventConfig.announcementGroups) {
      try {
        await connInstance.sendMessage(groupId, { text: announcement });
      } catch (error) {
        console.error(`[AutoEvents] Error al anunciar en ${groupId}:`, error);
      }
    }
  }

  return event;
}

/**
 * Obtiene el estado actual del sistema
 */
export function getAutoEventStatus(): {
  enabled: boolean;
  minInterval: string;
  maxInterval: string;
  groups: number;
  nextEventIn: string | null;
} {
  return {
    enabled: autoEventConfig.enabled,
    minInterval: msToTime(autoEventConfig.minInterval),
    maxInterval: msToTime(autoEventConfig.maxInterval),
    groups: autoEventConfig.announcementGroups.length,
    nextEventIn: eventTimer ? 'Programado' : null
  };
}
