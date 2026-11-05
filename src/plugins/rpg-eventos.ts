import type { PluginHandler, MessageContext } from '../types/message.js';
import { msToTime } from '../lib/utils.js';
import { globalModes, getActiveModes, AUTO_ACTIVATOR, type GlobalModeKey } from '../lib/global-modes.js';
import { getAutoEventStatus } from '../lib/auto-events.js';

/** Nombre y detalle de cada modo para el jugador */
const MODE_DETAILS: Record<GlobalModeKey, { title: string; detail: () => string }> = {
  bonusMode: {
    title: '🎁 Modo Bonus',
    detail: () => `x${globalModes.bonusMode.expMultiplier} XP · x${globalModes.bonusMode.moneyMultiplier} dinero · x${globalModes.bonusMode.manaMultiplier} maná`
  },
  freeRobMode: {
    title: '🦹 Robo Libre',
    detail: () => 'Robar sin cooldown'
  },
  eventMode: {
    title: '🎉 Evento',
    detail: () => `${globalModes.eventMode.eventName || 'Evento especial'} · x${globalModes.eventMode.dropMultiplier} recompensas`
  },
  pvpMode: {
    title: '⚔️ Modo PvP',
    detail: () => `x${globalModes.pvpMode.damageMultiplier} daño en combate PvP`
  },
  chaosMode: {
    title: '🌀 Modo Caos',
    detail: () => `x${globalModes.chaosMode.multiplier} XP y dinero · robos más fáciles y jugosos`
  }
};

export function renderActiveEvents(now: number = Date.now()): string {
  const active = getActiveModes(now);
  const status = getAutoEventStatus();

  let text = `🎪 *EVENTOS ACTIVOS*\n━━━━━━━━━━━━━━━━━━━━━\n\n`;

  if (active.length === 0) {
    text += `😴 No hay eventos activos.\n`;
  } else {
    for (const { key, remainingMs, activatedBy } of active) {
      const info = MODE_DETAILS[key];
      text += `${info.title}\n`;
      text += `   ${info.detail()}\n`;
      text += `   ⏳ Termina en: *${msToTime(remainingMs)}*`;
      text += activatedBy === AUTO_ACTIVATOR ? ' · _evento automático_\n\n' : '\n\n';
    }
  }

  if (status.enabled) {
    text += `\n🤖 Próximo evento automático: *${status.nextEventIn ?? 'por programar'}*`;
  }

  return text.trimEnd();
}

export const eventosPlugin: PluginHandler = {
  command: /^(eventos|events|modos|evento)$/i,
  tags: ['rpg'],
  help: ['eventos - Ver los eventos y modos globales activos y cuánto les queda'],
  usage: ['eventos'],

  handler: async (ctx: MessageContext) => {
    await ctx.m.reply(renderActiveEvents());
  }
};

export default eventosPlugin;
