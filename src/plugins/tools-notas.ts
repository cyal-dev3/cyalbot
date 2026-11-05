import type { PluginHandler } from '../types/message.js';
import type { ChatNote } from '../types/database.js';
import { getDatabase } from '../lib/database.js';
import { normalizeText, mentionTag } from '../lib/utils.js';

const MAX_NOTES = 50;
const MAX_NOTE_CHARS = 1000;
const MAX_KEY_CHARS = 30;

/** Clave en minúsculas, sin acentos ni símbolos; null si no queda nada útil. */
export function normalizeNoteKey(raw: string): string | null {
  const key = normalizeText(raw).replace(/[^a-z0-9_-]/g, '').slice(0, MAX_KEY_CHARS);
  return key || null;
}

function notesOf(chatId: string): Record<string, ChatNote> {
  const settings = getDatabase().getChatSettings(chatId);
  if (!settings.notes) {
    settings.notes = {};
    getDatabase().markDirty();
  }
  return settings.notes;
}

export const notaPlugin: PluginHandler = {
  command: ['nota', 'notas', 'note', 'notes'],
  description: 'Notas compartidas del grupo',
  category: 'herramientas',
  help: [
    'nota guardar <clave> <texto> - Guarda una nota en el grupo',
    'nota <clave> - Muestra una nota',
    'notas - Lista las notas guardadas',
    'nota borrar <clave> - Borra una nota (autor o admin)',
  ],
  usage: ['nota guardar reglas Nada de spam', 'nota reglas', 'notas', 'nota borrar reglas'],
  group: true,

  handler: async ({ m, command, args, usedPrefix, isAdmin, isOwner }) => {
    const db = getDatabase();
    const notes = notesOf(m.chat);
    const sub = args[0]?.toLowerCase() ?? '';
    const listing = command === 'notas' || command === 'notes' || sub === 'lista' || sub === 'list';

    if (listing && args.length <= 1) {
      const keys = Object.keys(notes).sort();
      if (keys.length === 0) {
        await m.reply(`No hay notas en este grupo. Crea una con *${usedPrefix}nota guardar <clave> <texto>*.`);
        return;
      }
      await m.reply(`📝 *Notas del grupo* (${keys.length}/${MAX_NOTES})\n${keys.map((k) => `• ${k}`).join('\n')}\n\n_${usedPrefix}nota <clave> para leer una._`);
      return;
    }

    if (['guardar', 'save', 'add', 'set'].includes(sub)) {
      const key = normalizeNoteKey(args[1] ?? '');
      const text = args.slice(2).join(' ').trim() || m.quoted?.text?.trim() || '';
      if (!key || !text) {
        await m.reply(`Uso: *${usedPrefix}nota guardar <clave> <texto>* (o cita un mensaje con la clave).`);
        return;
      }
      if (text.length > MAX_NOTE_CHARS) {
        await m.reply(`La nota es muy larga (${text.length} caracteres, máximo ${MAX_NOTE_CHARS}).`);
        return;
      }
      const existing = notes[key];
      if (existing && existing.author !== m.sender && !isAdmin && !isOwner) {
        await m.reply(`La nota *${key}* ya existe y es de otra persona. Solo su autor o un admin pueden cambiarla.`);
        return;
      }
      if (!existing && Object.keys(notes).length >= MAX_NOTES) {
        await m.reply(`Este grupo ya tiene ${MAX_NOTES} notas. Borra alguna con *${usedPrefix}nota borrar <clave>*.`);
        return;
      }
      notes[key] = { text, author: m.sender, createdAt: Date.now() };
      db.markDirty();
      await m.reply(`✅ Nota *${key}* ${existing ? 'actualizada' : 'guardada'}. Léela con *${usedPrefix}nota ${key}*.`);
      return;
    }

    if (['borrar', 'eliminar', 'del', 'delete', 'quitar'].includes(sub)) {
      const key = normalizeNoteKey(args[1] ?? '');
      const note = key ? notes[key] : undefined;
      if (!key || !note) {
        await m.reply(`No existe esa nota. Mira la lista con *${usedPrefix}notas*.`);
        return;
      }
      if (note.author !== m.sender && !isAdmin && !isOwner) {
        await m.reply('Solo quien la guardó o un admin pueden borrar esa nota.');
        return;
      }
      delete notes[key];
      db.markDirty();
      await m.reply(`🗑️ Nota *${key}* borrada.`);
      return;
    }

    const key = normalizeNoteKey(args.join(' '));
    if (!key) {
      await m.reply(`Uso: *${usedPrefix}nota <clave>*, *${usedPrefix}notas* o *${usedPrefix}nota guardar <clave> <texto>*.`);
      return;
    }
    const note = notes[key];
    if (!note) {
      await m.reply(`No hay ninguna nota llamada *${key}*. Mira la lista con *${usedPrefix}notas*.`);
      return;
    }
    const when = new Date(note.createdAt).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
    await m.reply(`📝 *${key}*\n${note.text}\n\n_Guardada por ${mentionTag(note.author)} el ${when}_`);
  },
};
