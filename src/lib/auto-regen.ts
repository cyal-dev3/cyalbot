/**
 * 🔄 Sistema de Regeneración Pasiva - CYALTRONIC
 *
 * Regenera vida y energía de los jugadores automáticamente con el tiempo.
 * - Vida: +10 HP cada hora (máximo: maxHealth)
 * - Energía: +10 stamina cada hora (máximo: maxStamina)
 */

import { getDatabase } from './database.js';

// ==================== CONFIGURACIÓN ====================

interface RegenConfig {
  healthPerHour: number;      // Vida regenerada por hora
  staminaPerHour: number;     // Energía regenerada por hora
  checkIntervalMs: number;    // Cada cuánto revisar (en ms)
}

// Configuración por defecto
export const regenConfig: RegenConfig = {
  healthPerHour: 10,
  staminaPerHour: 10,
  checkIntervalMs: 60 * 1000  // Revisar cada minuto
};

// Intervalo de regeneración
let regenTimer: NodeJS.Timeout | null = null;

// ==================== FUNCIONES PRINCIPALES ====================

/**
 * Calcula cuánto regenerar basado en el tiempo transcurrido
 * @param lastRegen - Timestamp de la última regeneración
 * @param regenPerHour - Cantidad a regenerar por hora
 * @returns Cantidad a regenerar y nuevo timestamp
 */
function calculateRegen(lastRegen: number, regenPerHour: number): { amount: number; newTimestamp: number } {
  const now = Date.now();
  const hourInMs = 60 * 60 * 1000;

  // Si nunca ha regenerado, inicializar timestamp
  if (!lastRegen || lastRegen === 0) {
    return { amount: 0, newTimestamp: now };
  }

  const timePassed = now - lastRegen;
  const hoursPassed = timePassed / hourInMs;

  // Solo regenerar si ha pasado al menos algo de tiempo significativo
  if (hoursPassed < 0.01) { // ~36 segundos mínimo
    return { amount: 0, newTimestamp: lastRegen };
  }

  // Calcular regeneración proporcional al tiempo
  const amount = Math.floor(hoursPassed * regenPerHour);

  // Calcular el nuevo timestamp (solo avanzar por las horas completas usadas)
  const hoursUsed = amount / regenPerHour;
  const newTimestamp = lastRegen + (hoursUsed * hourInMs);

  return { amount, newTimestamp };
}

/**
 * Aplica la regeneración a todos los usuarios registrados
 */
function applyRegenToAllUsers(): void {
  try {
    const db = getDatabase();
    const registeredUsers = db.getRegisteredUsers();

    let usersRegenerated = 0;

    for (const [jid, user] of registeredUsers) {
      let needsUpdate = false;
      const updates: {
        health?: number;
        stamina?: number;
        lastHealthRegen?: number;
        lastStaminaRegen?: number
      } = {};

      // Regenerar vida si no está al máximo
      if (user.health < user.maxHealth) {
        const healthRegen = calculateRegen(user.lastHealthRegen, regenConfig.healthPerHour);

        if (healthRegen.amount > 0) {
          const newHealth = Math.min(user.health + healthRegen.amount, user.maxHealth);
          updates.health = newHealth;
          updates.lastHealthRegen = healthRegen.newTimestamp;
          needsUpdate = true;
        }
      } else if (!user.lastHealthRegen) {
        // Inicializar timestamp si no existe
        updates.lastHealthRegen = Date.now();
        needsUpdate = true;
      }

      // Regenerar energía si no está al máximo
      if (user.stamina < user.maxStamina) {
        const staminaRegen = calculateRegen(user.lastStaminaRegen, regenConfig.staminaPerHour);

        if (staminaRegen.amount > 0) {
          const newStamina = Math.min(user.stamina + staminaRegen.amount, user.maxStamina);
          updates.stamina = newStamina;
          updates.lastStaminaRegen = staminaRegen.newTimestamp;
          needsUpdate = true;
        }
      } else if (!user.lastStaminaRegen) {
        // Inicializar timestamp si no existe
        updates.lastStaminaRegen = Date.now();
        needsUpdate = true;
      }

      // Aplicar actualizaciones
      if (needsUpdate) {
        db.updateUser(jid, updates);
        usersRegenerated++;
      }
    }

    if (usersRegenerated > 0) {
      console.log(`[AutoRegen] 🔄 Regeneración aplicada a ${usersRegenerated} usuarios`);
    }
  } catch (error) {
    console.error('[AutoRegen] ❌ Error al aplicar regeneración:', error);
  }
}

/**
 * Aplica regeneración a un usuario específico (útil al consultar perfil)
 * @param jid - JID del usuario
 * @returns Objeto con la cantidad regenerada de cada stat
 */
export function applyRegenToUser(jid: string): { healthRegen: number; staminaRegen: number } {
  try {
    const db = getDatabase();
    const user = db.getUser(jid);

    if (!user.registered) {
      return { healthRegen: 0, staminaRegen: 0 };
    }

    let healthRegenAmount = 0;
    let staminaRegenAmount = 0;
    const updates: {
      health?: number;
      stamina?: number;
      lastHealthRegen?: number;
      lastStaminaRegen?: number
    } = {};

    // Regenerar vida
    if (user.health < user.maxHealth) {
      const healthRegen = calculateRegen(user.lastHealthRegen, regenConfig.healthPerHour);

      if (healthRegen.amount > 0) {
        healthRegenAmount = Math.min(healthRegen.amount, user.maxHealth - user.health);
        updates.health = user.health + healthRegenAmount;
        updates.lastHealthRegen = healthRegen.newTimestamp;
      }
    }

    // Inicializar timestamp de vida si no existe
    if (!user.lastHealthRegen) {
      updates.lastHealthRegen = Date.now();
    }

    // Regenerar energía
    if (user.stamina < user.maxStamina) {
      const staminaRegen = calculateRegen(user.lastStaminaRegen, regenConfig.staminaPerHour);

      if (staminaRegen.amount > 0) {
        staminaRegenAmount = Math.min(staminaRegen.amount, user.maxStamina - user.stamina);
        updates.stamina = user.stamina + staminaRegenAmount;
        updates.lastStaminaRegen = staminaRegen.newTimestamp;
      }
    }

    // Inicializar timestamp de energía si no existe
    if (!user.lastStaminaRegen) {
      updates.lastStaminaRegen = Date.now();
    }

    // Aplicar actualizaciones si hay cambios
    if (Object.keys(updates).length > 0) {
      db.updateUser(jid, updates);
    }

    return { healthRegen: healthRegenAmount, staminaRegen: staminaRegenAmount };
  } catch (error) {
    console.error('[AutoRegen] ❌ Error al regenerar usuario:', error);
    return { healthRegen: 0, staminaRegen: 0 };
  }
}

/**
 * Obtiene información de regeneración pendiente para un usuario
 * @param jid - JID del usuario
 * @returns Información sobre la próxima regeneración
 */
export function getRegenInfo(jid: string): {
  nextHealthRegen: number;
  nextStaminaRegen: number;
  healthPerHour: number;
  staminaPerHour: number;
} {
  try {
    const db = getDatabase();
    const user = db.getUser(jid);

    const now = Date.now();
    const hourInMs = 60 * 60 * 1000;

    // Calcular tiempo hasta próxima regeneración
    const timeSinceHealthRegen = user.lastHealthRegen ? now - user.lastHealthRegen : 0;
    const timeSinceStaminaRegen = user.lastStaminaRegen ? now - user.lastStaminaRegen : 0;

    const nextHealthRegen = Math.max(0, hourInMs - timeSinceHealthRegen);
    const nextStaminaRegen = Math.max(0, hourInMs - timeSinceStaminaRegen);

    return {
      nextHealthRegen,
      nextStaminaRegen,
      healthPerHour: regenConfig.healthPerHour,
      staminaPerHour: regenConfig.staminaPerHour
    };
  } catch {
    return {
      nextHealthRegen: 0,
      nextStaminaRegen: 0,
      healthPerHour: regenConfig.healthPerHour,
      staminaPerHour: regenConfig.staminaPerHour
    };
  }
}

// ==================== CONTROL DEL SISTEMA ====================

/**
 * Inicia el sistema de regeneración automática
 */
export function startAutoRegen(): void {
  if (regenTimer) {
    console.log('[AutoRegen] ⚠️ Sistema ya está activo');
    return;
  }

  console.log('[AutoRegen] 🔄 Sistema de regeneración pasiva ACTIVADO');
  console.log(`[AutoRegen]    ❤️ +${regenConfig.healthPerHour} vida/hora`);
  console.log(`[AutoRegen]    ⚡ +${regenConfig.staminaPerHour} energía/hora`);

  // Aplicar regeneración inmediatamente al iniciar
  applyRegenToAllUsers();

  // Configurar intervalo de verificación
  regenTimer = setInterval(() => {
    applyRegenToAllUsers();
  }, regenConfig.checkIntervalMs);
}

/**
 * Detiene el sistema de regeneración automática
 */
export function stopAutoRegen(): void {
  if (regenTimer) {
    clearInterval(regenTimer);
    regenTimer = null;
    console.log('[AutoRegen] ⏹️ Sistema de regeneración DETENIDO');
  }
}

/**
 * Configura los valores de regeneración
 */
export function setRegenValues(healthPerHour: number, staminaPerHour: number): void {
  regenConfig.healthPerHour = healthPerHour;
  regenConfig.staminaPerHour = staminaPerHour;
  console.log(`[AutoRegen] ⚙️ Configuración actualizada: ❤️ +${healthPerHour}/h, ⚡ +${staminaPerHour}/h`);
}

/**
 * Obtiene el estado actual del sistema
 */
export function getAutoRegenStatus(): {
  active: boolean;
  healthPerHour: number;
  staminaPerHour: number;
  checkInterval: string;
} {
  return {
    active: regenTimer !== null,
    healthPerHour: regenConfig.healthPerHour,
    staminaPerHour: regenConfig.staminaPerHour,
    checkInterval: `${regenConfig.checkIntervalMs / 1000}s`
  };
}
