import type { PluginHandler } from '../types/message.js';
import {
  splitReminder, scheduleReminder, listReminders, cancelReminder, MAX_ACTIVE_REMINDERS, REMINDER_TIMEZONE,
} from '../lib/reminders.js';
import { msToTime } from '../lib/utils.js';

function formatAt(ts: number): string {
  return new Date(ts).toLocaleString('es-MX', { timeZone: REMINDER_TIMEZONE, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}

function listText(user: string, usedPrefix: string): string {
  const mine = listReminders(user);
  if (mine.length === 0) return `No tienes recordatorios pendientes. Crea uno con *${usedPrefix}recordar 30m texto*.`;
  const lines = mine.map((r) => `• *${r.id}* · ${formatAt(r.at)} · ${r.text.length > 60 ? `${r.text.slice(0, 57)}…` : r.text}`);
  return `⏰ *Tus recordatorios* (${mine.length}/${MAX_ACTIVE_REMINDERS})\n${lines.join('\n')}\n\n_${usedPrefix}recordar cancelar <id> para quitar uno._`;
}

export const recordarPlugin: PluginHandler = {
  command: ['recordar', 'recordatorio', 'remind', 'reminder'],
  description: 'Te recuerda algo en el chat cuando llegue la hora',
  category: 'herramientas',
  help: [
    'recordar <cuándo> <texto> - Ej: 10m, 2h, 1d, mañana 9:00, 15/12 18:30, en 30 min',
    'recordar cancelar <id> - Cancela un recordatorio tuyo',
  ],
  usage: ['recordar 30m sacar la pizza', 'recordar mañana 9:00 llamar al dentista', 'recordar cancelar ab12c'],

  handler: async ({ m, text, args, usedPrefix }) => {
    const sub = args[0]?.toLowerCase();
    if (sub === 'cancelar' || sub === 'cancel' || sub === 'borrar') {
      const id = args[1] ?? '';
      const removed = id ? cancelReminder(m.sender, id) : null;
      await m.reply(removed
        ? `🗑️ Recordatorio *${removed.id}* cancelado (${removed.text}).`
        : `No encontré ese recordatorio. Mira los tuyos con *${usedPrefix}recordatorios*.`);
      return;
    }
    if (sub === 'lista' || sub === 'list' || sub === 'ver') {
      await m.reply(listText(m.sender, usedPrefix));
      return;
    }

    const parsed = splitReminder(text);
    if (!parsed) {
      await m.reply(
        `No entendí cuándo. Ejemplos:\n` +
        `• *${usedPrefix}recordar 10m revisar el horno*\n` +
        `• *${usedPrefix}recordar mañana 9:00 llamar al dentista*\n` +
        `• *${usedPrefix}recordar 15/12 18:30 cena*\n` +
        `Mínimo 1 minuto, máximo 1 año.`,
      );
      return;
    }
    const result = scheduleReminder({ chat: m.chat, user: m.sender, text: parsed.text, at: parsed.at });
    if (result === 'limit') {
      await m.reply(`Ya tienes ${MAX_ACTIVE_REMINDERS} recordatorios activos. Cancela alguno con *${usedPrefix}recordar cancelar <id>*.`);
      return;
    }
    await m.reply(`⏰ Te lo recuerdo el ${formatAt(result.at)} (en ${msToTime(result.at - Date.now())}).\nID: *${result.id}*`);
  },
};

export const recordatoriosPlugin: PluginHandler = {
  command: ['recordatorios', 'misrecordatorios', 'reminders'],
  description: 'Tus recordatorios pendientes',
  category: 'herramientas',
  help: ['recordatorios - Lista tus recordatorios pendientes'],
  usage: ['recordatorios'],

  handler: async ({ m, usedPrefix }) => {
    await m.reply(listText(m.sender, usedPrefix));
  },
};
