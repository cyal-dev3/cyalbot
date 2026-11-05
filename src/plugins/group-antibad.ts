import type { PluginHandler, MessageContext } from '../types/message.js';
import { getDatabase } from '../lib/database.js';
import { foldText } from '../lib/moderation.js';

/** @deprecated El interruptor vive en group-toggles.ts; plugins/index.ts debe importarlo de ahí. */
export { antiBadPlugin } from './group-toggles.js';

/** Las palabras se guardan plegadas (minúsculas, sin acentos) porque así compara findBadWord. */
function normalizeWord(text: string): string {
  return foldText(text).trim().replace(/\s+/g, ' ');
}

export const addBadWordPlugin: PluginHandler = {
  command: ['addbadword', 'agregargroserias'],
  description: 'Agregar palabra prohibida',
  category: 'group',
  help: ['addbadword <palabra o frase> - Agrega al filtro de groserías'],
  group: true,
  admin: true,

  async handler(ctx: MessageContext) {
    const { m, text, usedPrefix } = ctx;
    const db = getDatabase();

    const word = normalizeWord(text);
    if (!word) {
      await m.reply(`❌ Escribe la palabra que quieres agregar.\n\n📝 Uso: ${usedPrefix}addbadword <palabra>`);
      return;
    }

    const badWords = [...(db.getChatSettings(m.chat).badWords ?? [])];
    if (badWords.some((w) => normalizeWord(w) === word)) {
      await m.reply(`⚠️ La palabra "*${word}*" ya está en la lista.`);
      return;
    }

    badWords.push(word);
    db.updateChatSettings(m.chat, { badWords });
    await m.reply(`✅ Palabra "*${word}*" agregada.\n\n📊 Total: ${badWords.length} palabras`);
  },
};

export const delBadWordPlugin: PluginHandler = {
  command: ['delbadword', 'quitargroserias'],
  description: 'Quitar palabra prohibida',
  category: 'group',
  help: ['delbadword <palabra> - Quita del filtro de groserías'],
  group: true,
  admin: true,

  async handler(ctx: MessageContext) {
    const { m, text, usedPrefix } = ctx;
    const db = getDatabase();

    const word = normalizeWord(text);
    if (!word) {
      await m.reply(`❌ Escribe la palabra que quieres quitar.\n\n📝 Uso: ${usedPrefix}delbadword <palabra>`);
      return;
    }

    const current = db.getChatSettings(m.chat).badWords ?? [];
    const badWords = current.filter((w) => normalizeWord(w) !== word);
    if (badWords.length === current.length) {
      await m.reply(`⚠️ La palabra "*${word}*" no está en la lista.`);
      return;
    }

    db.updateChatSettings(m.chat, { badWords });
    await m.reply(`✅ Palabra "*${word}*" eliminada.\n\n📊 Total: ${badWords.length} palabras`);
  },
};

export const listBadWordsPlugin: PluginHandler = {
  command: ['listbadwords', 'vergroserías', 'vergroserias', 'badwords'],
  description: 'Ver lista de palabras prohibidas',
  category: 'group',
  help: ['listbadwords - Muestra el filtro de groserías'],
  group: true,
  admin: true,

  async handler(ctx: MessageContext) {
    const { m, usedPrefix } = ctx;
    const badWords = getDatabase().getChatSettings(m.chat).badWords ?? [];

    if (badWords.length === 0) {
      await m.reply(`📋 No hay palabras prohibidas configuradas.\n\n💡 ${usedPrefix}antibad on carga la lista por defecto.`);
      return;
    }

    await m.reply(
      `🤬 *PALABRAS PROHIBIDAS* (${badWords.length})\n\n` +
      badWords.map((w, i) => `${i + 1}. ${w}`).join('\n') +
      `\n\n💡 ${usedPrefix}addbadword <palabra> · ${usedPrefix}delbadword <palabra>`,
    );
  },
};
