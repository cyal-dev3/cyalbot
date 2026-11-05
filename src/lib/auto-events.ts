import type { WASocket } from 'baileys';
import { globalModes, AUTO_ACTIVATOR, type GlobalModeKey, type GlobalModes } from './global-modes.js';
import { msToTime, pickRandom, randomInt, weightedRandom } from './utils.js';
import { getDatabase } from './database.js';
import { createLogger } from './logger.js';
import * as scheduler from './scheduler.js';

const log = createLogger('events');

interface AutoEventConfig {
  enabled: boolean;
  minInterval: number;
  maxInterval: number;
  announcementGroups: string[];
}

export const autoEventConfig: AutoEventConfig = {
  enabled: false,
  minInterval: 30 * 60 * 1000,
  maxInterval: 120 * 60 * 1000,
  announcementGroups: []
};

function saveConfig(): void {
  try {
    const db = getDatabase();
    db.updateSettings({
      autoEvents: {
        enabled: autoEventConfig.enabled,
        minInterval: autoEventConfig.minInterval,
        maxInterval: autoEventConfig.maxInterval,
        announcementGroups: [...autoEventConfig.announcementGroups]
      }
    });
  } catch (error) {
    log.error('error al guardar configuración:', error);
  }
}

export function loadConfig(): void {
  try {
    const saved = getDatabase().getSettings().autoEvents;
    if (!saved) {
      log.debug('sin configuración guardada, usando valores por defecto');
      return;
    }
    autoEventConfig.enabled = saved.enabled;
    autoEventConfig.minInterval = saved.minInterval;
    autoEventConfig.maxInterval = saved.maxInterval;
    autoEventConfig.announcementGroups = [...saved.announcementGroups];
    log.info(`configuración cargada: enabled=${autoEventConfig.enabled}, grupos=${autoEventConfig.announcementGroups.length}`);
  } catch (error) {
    log.error('error al cargar configuración:', error);
  }
}

// ==================== TIPOS DE EVENTOS ====================

interface EventType {
  id: string;
  name: string;
  emoji: string;
  description: string;
  color: string;
  /** Modo global que ocupa el evento */
  mode: GlobalModeKey;
}

const EVENT_TYPES: EventType[] = [
  { id: 'xp', name: 'Lluvia de Experiencia', emoji: '✨', description: 'XP aumentada', color: '🟣', mode: 'bonusMode' },
  { id: 'money', name: 'Fiebre del Oro', emoji: '💰', description: 'Dinero aumentado', color: '🟡', mode: 'bonusMode' },
  { id: 'drops', name: 'Cazador de Tesoros', emoji: '📦', description: 'Drops aumentados', color: '🟤', mode: 'eventMode' },
  { id: 'pvp', name: 'Arena Sangrienta', emoji: '⚔️', description: 'Daño PvP aumentado', color: '🔴', mode: 'pvpMode' },
  { id: 'all', name: 'Bendición Divina', emoji: '🌟', description: 'TODO aumentado', color: '⚪', mode: 'chaosMode' },
  { id: 'rob', name: 'Noche de Ladrones', emoji: '🦹', description: 'Robo sin límites', color: '🟢', mode: 'freeRobMode' },
  { id: 'mana', name: 'Tormenta Arcana', emoji: '💠', description: 'Maná aumentado', color: '🔵', mode: 'bonusMode' },
  { id: 'combo', name: 'Caos Total', emoji: '🌀', description: 'XP + Dinero combo', color: '🟠', mode: 'bonusMode' }
];

const MULTIPLIERS = [
  { value: 2, weight: 30 },
  { value: 3, weight: 25 },
  { value: 4, weight: 18 },
  { value: 5, weight: 12 },
  { value: 6, weight: 7 },
  { value: 7, weight: 4 },
  { value: 8, weight: 2 },
  { value: 10, weight: 2 }
];

const DURATIONS = [
  { ms: 1 * 60 * 1000, name: '1 minuto', weight: 15 },
  { ms: 2 * 60 * 1000, name: '2 minutos', weight: 20 },
  { ms: 5 * 60 * 1000, name: '5 minutos', weight: 30 },
  { ms: 10 * 60 * 1000, name: '10 minutos', weight: 25 },
  { ms: 30 * 60 * 1000, name: '30 minutos', weight: 10 }
];

// ==================== GENERADOR DE EVENTOS ====================

export interface GeneratedEvent {
  type: EventType;
  multiplier: number;
  duration: number;
  durationName: string;
  isEpic: boolean;
  isLegendary: boolean;
}

/** Un modo puede ser pisado por un evento automático solo si está libre o lo activó el propio sistema */
export function canAutoOverride(mode: GlobalModeKey, now: number = Date.now()): boolean {
  const current = globalModes[mode];
  if (!current.active || now >= current.expiresAt) return true;
  return current.activatedBy === AUTO_ACTIVATOR;
}

function availableEventTypes(now: number = Date.now()): EventType[] {
  return EVENT_TYPES.filter(t => canAutoOverride(t.mode, now));
}

/** Genera un evento aleatorio entre los tipos dados (por defecto, los que no ocupa un owner) */
function generateRandomEvent(candidates: EventType[] = availableEventTypes()): GeneratedEvent | null {
  if (candidates.length === 0) return null;

  const type = pickRandom(candidates);
  const multiplierData = weightedRandom(MULTIPLIERS);
  const durationData = weightedRandom(DURATIONS);

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

function buildModeState(event: GeneratedEvent, expiresAt: number): GlobalModes[GlobalModeKey] {
  const common = { active: true, expiresAt, activatedBy: AUTO_ACTIVATOR };
  switch (event.type.id) {
    case 'xp':
      return { ...common, expMultiplier: event.multiplier, moneyMultiplier: 1, manaMultiplier: 1 };
    case 'money':
      return { ...common, expMultiplier: 1, moneyMultiplier: event.multiplier, manaMultiplier: 1 };
    case 'mana':
      return { ...common, expMultiplier: 1, moneyMultiplier: 1, manaMultiplier: event.multiplier };
    case 'combo':
      return { ...common, expMultiplier: event.multiplier, moneyMultiplier: event.multiplier, manaMultiplier: 1 };
    case 'drops':
      return { ...common, dropMultiplier: event.multiplier, eventName: event.type.name };
    case 'pvp':
      return { ...common, damageMultiplier: event.multiplier };
    case 'rob':
      return common;
    case 'all':
      return { ...common, multiplier: event.multiplier };
    default:
      return common;
  }
}

const restoreTimers = new Set<NodeJS.Timeout>();

/**
 * Aplica el evento al modo global que le corresponde y programa la restauración
 * del estado previo al expirar (otro evento automático que seguía vigente).
 * Devuelve false si el modo está ocupado por un owner.
 */
export function applyEvent(event: GeneratedEvent, now: number = Date.now()): boolean {
  const key = event.type.mode;
  if (!canAutoOverride(key, now)) return false;

  const previous = structuredClone(globalModes[key]);
  const expiresAt = now + event.duration;
  (globalModes as unknown as Record<GlobalModeKey, GlobalModes[GlobalModeKey]>)[key] = buildModeState(event, expiresAt);

  const timer = setTimeout(() => {
    restoreTimers.delete(timer);
    const current = globalModes[key];
    // Si un owner tomó el modo mientras tanto, no se toca
    if (current.activatedBy !== AUTO_ACTIVATOR || current.expiresAt !== expiresAt) return;

    const restoreNow = Date.now();
    if (previous.active && previous.expiresAt > restoreNow) {
      (globalModes as unknown as Record<GlobalModeKey, GlobalModes[GlobalModeKey]>)[key] = previous;
      log.debug(`modo ${key} restaurado al estado previo`);
    } else {
      current.active = false;
    }
  }, event.duration);
  timer.unref();
  restoreTimers.add(timer);

  return true;
}

function generateEventAnnouncement(event: GeneratedEvent): string {
  let rarityText = '';
  if (event.isLegendary) {
    rarityText = '\n\n*¡¡¡EVENTO LEGENDARIO!!!*';
  } else if (event.isEpic) {
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
_Usa /eventos para ver los modos activos y su tiempo restante_
`.trim();
}

// ==================== SISTEMA PRINCIPAL ====================

const EVENT_TASK = 'rpg:auto-event';
let nextEventAt: number | null = null;
let connInstance: WASocket | null = null;

function clearEventTimer(): void {
  scheduler.stop(EVENT_TASK);
  nextEventAt = null;
}

function scheduleNextEvent(): void {
  clearEventTimer();
  if (!autoEventConfig.enabled) return;

  const nextEventIn = randomInt(autoEventConfig.minInterval, autoEventConfig.maxInterval);
  nextEventAt = Date.now() + nextEventIn;
  log.info(`próximo evento en ${msToTime(nextEventIn)}`);

  scheduler.after(EVENT_TASK, nextEventIn, async () => {
    nextEventAt = null;
    try {
      await triggerRandomEvent();
    } catch (error) {
      log.error('error al disparar evento:', error);
    }
    scheduleNextEvent();
  });
}

async function announce(event: GeneratedEvent): Promise<void> {
  if (!connInstance) return;
  const announcement = generateEventAnnouncement(event);
  for (const groupId of autoEventConfig.announcementGroups) {
    try {
      await connInstance.sendMessage(groupId, { text: announcement });
    } catch (error) {
      log.error(`error al anunciar en ${groupId}:`, error);
    }
  }
}

async function triggerRandomEvent(): Promise<void> {
  if (!connInstance) return;

  const event = generateRandomEvent();
  if (!event || !applyEvent(event)) {
    log.info('evento omitido: todos los modos están ocupados por un owner');
    return;
  }

  log.info(`evento activado: ${event.type.name} x${event.multiplier} por ${event.durationName}`);
  await announce(event);
}

export function startAutoEvents(conn: WASocket): void {
  connInstance = conn;
  loadConfig();

  if (autoEventConfig.enabled) {
    log.info('eventos automáticos activados');
    scheduleNextEvent();
  } else {
    log.info('eventos automáticos desactivados');
  }
}

export function stopAutoEvents(): void {
  clearEventTimer();
  log.info('eventos automáticos detenidos');
}

/** Tras una reconexión el socket anterior está cerrado; se cambia sin reprogramar el próximo evento. */
export function updateAutoEventsSocket(conn: WASocket): void {
  connInstance = conn;
}

/** Idempotente: activar dos veces no reprograma el evento pendiente */
export function toggleAutoEvents(enabled: boolean): void {
  const changed = autoEventConfig.enabled !== enabled;
  autoEventConfig.enabled = enabled;
  if (changed) saveConfig();

  if (enabled) {
    if (!scheduler.has(EVENT_TASK)) scheduleNextEvent();
  } else {
    stopAutoEvents();
  }
}

export function addAnnouncementGroup(groupId: string): boolean {
  if (autoEventConfig.announcementGroups.includes(groupId)) return false;
  autoEventConfig.announcementGroups.push(groupId);
  saveConfig();
  return true;
}

export function removeAnnouncementGroup(groupId: string): boolean {
  const index = autoEventConfig.announcementGroups.indexOf(groupId);
  if (index === -1) return false;
  autoEventConfig.announcementGroups.splice(index, 1);
  saveConfig();
  return true;
}

export function setEventIntervals(minMinutes: number, maxMinutes: number): void {
  autoEventConfig.minInterval = minMinutes * 60 * 1000;
  autoEventConfig.maxInterval = maxMinutes * 60 * 1000;
  saveConfig();

  if (autoEventConfig.enabled) {
    scheduleNextEvent();
  }
}

export type ForcedEventResult = GeneratedEvent & {
  /** false cuando todos los modos están ocupados por un owner y no se activó nada */
  applied: boolean;
};

/** Fuerza un evento inmediato; si ningún modo está libre lo devuelve con applied=false y no anuncia */
export async function forceRandomEvent(): Promise<ForcedEventResult> {
  const available = availableEventTypes();
  const event = generateRandomEvent(available.length > 0 ? available : EVENT_TYPES) as GeneratedEvent;
  const applied = available.length > 0 && applyEvent(event);
  if (applied) await announce(event);
  return { ...event, applied };
}

export function getAutoEventStatus(): {
  enabled: boolean;
  minInterval: string;
  maxInterval: string;
  groups: number;
  /** Texto legible del tiempo restante, o null si no hay evento programado */
  nextEventIn: string | null;
  /** Milisegundos hasta el próximo evento, o null si no hay evento programado */
  nextEventInMs: number | null;
} {
  const remaining = nextEventAt === null ? null : Math.max(0, nextEventAt - Date.now());
  return {
    enabled: autoEventConfig.enabled,
    minInterval: msToTime(autoEventConfig.minInterval),
    maxInterval: msToTime(autoEventConfig.maxInterval),
    groups: autoEventConfig.announcementGroups.length,
    nextEventIn: remaining === null ? null : msToTime(remaining),
    nextEventInMs: remaining
  };
}
