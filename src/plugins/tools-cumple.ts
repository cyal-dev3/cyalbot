import type { PluginHandler } from '../types/message.js';
import { getDatabase } from '../lib/database.js';
import { findParticipant } from '../lib/participants.js';
import { mentionTag, normalizeText } from '../lib/utils.js';
import { zonedParts } from '../lib/reminders.js';

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** "25/12", "25-12" o "25 de diciembre" -> "12-25". Null si no es una fecha válida. */
export function parseBirthday(input: string): string | null {
  const text = normalizeText(input.trim());
  let day: number;
  let month: number;
  const numeric = text.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-]\d{2,4})?$/);
  const spoken = text.match(/^(\d{1,2})(?: de)? ([a-z]+)$/);
  if (numeric) {
    day = parseInt(numeric[1], 10);
    month = parseInt(numeric[2], 10);
  } else if (spoken) {
    day = parseInt(spoken[1], 10);
    month = MONTHS.indexOf(spoken[2]) + 1;
  } else {
    return null;
  }
  if (month < 1 || month > 12 || day < 1 || day > DAYS_IN_MONTH[month - 1]) return null;
  return `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function formatBirthday(key: string): string {
  const [month, day] = key.split('-').map((n) => parseInt(n, 10));
  return `${day} de ${MONTHS[month - 1] ?? '?'}`;
}

/** Días que faltan desde hoy (en la zona del bot) hasta la próxima vez que caiga "MM-DD". */
export function daysUntilBirthday(key: string, now = Date.now()): number {
  const today = zonedParts(now);
  const [month, day] = key.split('-').map((n) => parseInt(n, 10));
  const todayUtc = Date.UTC(today.year, today.month - 1, today.day);
  let next = Date.UTC(today.year, month - 1, day);
  // El 29/02 en año no bisiesto rueda al 1/03; se compara por fecha, no por timestamp.
  if (next < todayUtc) next = Date.UTC(today.year + 1, month - 1, day);
  return Math.round((next - todayUtc) / 86_400_000);
}

function birthdays(): Record<string, string> {
  const db = getDatabase();
  if (!db.data.birthdays) {
    db.data.birthdays = {};
    db.markDirty();
  }
  return db.data.birthdays;
}

export const cumplePlugin: PluginHandler = {
  command: ['cumple', 'cumpleaños', 'cumpleanos', 'birthday'],
  description: 'Guarda tu cumpleaños para que el grupo te felicite',
  category: 'herramientas',
  help: ['cumple <DD/MM> - Guarda tu cumpleaños (cumple quitar para borrarlo)'],
  usage: ['cumple 25/12', 'cumple 3 de mayo', 'cumple quitar'],

  handler: async ({ m, text, usedPrefix }) => {
    const all = birthdays();
    const arg = text.trim();
    if (!arg) {
      const mine = all[m.sender];
      await m.reply(mine
        ? `🎂 Tu cumpleaños está guardado: *${formatBirthday(mine)}* (faltan ${daysUntilBirthday(mine)} días).`
        : `Aún no tengo tu cumpleaños. Guárdalo con *${usedPrefix}cumple 25/12*.`);
      return;
    }
    if (/^(quitar|borrar|eliminar|remove)$/i.test(arg)) {
      if (!all[m.sender]) {
        await m.reply('No tenías cumpleaños guardado.');
        return;
      }
      delete all[m.sender];
      getDatabase().markDirty();
      await m.reply('Listo, borré tu cumpleaños.');
      return;
    }
    const key = parseBirthday(arg);
    if (!key) {
      await m.reply(`No entendí la fecha. Usa día/mes: *${usedPrefix}cumple 25/12*.`);
      return;
    }
    all[m.sender] = key;
    getDatabase().markDirty();
    await m.reply(`🎂 Guardado: cumples el *${formatBirthday(key)}*. Faltan ${daysUntilBirthday(key)} días.`);
  },
};

export const cumplesPlugin: PluginHandler = {
  command: ['cumples', 'cumpleanios', 'proximoscumples', 'birthdays'],
  description: 'Próximos cumpleaños del grupo',
  category: 'herramientas',
  help: ['cumples - Los 5 próximos cumpleaños entre los miembros del grupo', 'cumpleanios on|off - Felicitar automáticamente a las 09:00 (admin)'],
  usage: ['cumples', 'cumpleanios on'],
  group: true,

  handler: async ({ m, command, args, groupMetadata, usedPrefix, isAdmin, isOwner, chatSettings, send }) => {
    const toggle = args[0]?.toLowerCase();
    if (command === 'cumpleanios' && (toggle === 'on' || toggle === 'off')) {
      if (!isAdmin && !isOwner) {
        await m.reply('Solo los admins pueden activar o desactivar las felicitaciones.');
        return;
      }
      getDatabase().updateChatSettings(m.chat, { birthdayAnnounce: toggle === 'on' });
      await m.reply(toggle === 'on'
        ? '🎂 Felicitaciones automáticas activadas: avisaré a las 09:00 cuando alguien cumpla años.'
        : 'Felicitaciones automáticas desactivadas.');
      return;
    }

    const all = birthdays();
    // Número o LID según el grupo: se compara con findParticipant, no por igualdad de cadenas.
    const upcoming = Object.entries(all)
      .filter(([jid]) => findParticipant(groupMetadata, jid))
      .map(([jid, key]) => ({ jid, key, days: daysUntilBirthday(key) }))
      .sort((a, b) => a.days - b.days)
      .slice(0, 5);

    if (upcoming.length === 0) {
      await m.reply(`Nadie del grupo ha guardado su cumpleaños. Hazlo con *${usedPrefix}cumple 25/12*.`);
      return;
    }
    const lines = upcoming.map((u) => {
      const when = u.days === 0 ? '¡hoy! 🎉' : u.days === 1 ? 'mañana' : `en ${u.days} días`;
      return `• ${mentionTag(u.jid)}: ${formatBirthday(u.key)} (${when})`;
    });
    const announce = chatSettings.birthdayAnnounce ? 'activadas' : `desactivadas (*${usedPrefix}cumpleanios on*)`;
    await send(
      { text: `🎂 *Próximos cumpleaños*\n${lines.join('\n')}\n\n_Felicitaciones automáticas ${announce}_`, mentions: upcoming.map((u) => u.jid) },
      { quoted: m.rawMessage },
    );
  },
};
