/**
 * 🚫 Plugin Anti-Bad Words - CYALTRONIC
 * Filtro de groserías/palabras prohibidas
 * Comandos: /antibad, /addbadword, /delbadword, /listbadwords
 */

import type { PluginHandler, MessageContext } from '../types/message.js';
import { getDatabase } from '../lib/database.js';
import { CONFIG } from '../config.js';

/**
 * Comando /antibad - Activar/desactivar filtro de groserías
 */
export const antiBadPlugin: PluginHandler = {
  command: ['antibad', 'antigroserias', 'antibadword'],
  description: 'Activar/desactivar filtro de groserías',
  category: 'group',
  group: true,
  admin: true,
  botAdmin: true,

  async handler(ctx: MessageContext) {
    const { m, text } = ctx;
    const db = getDatabase();
    const chatSettings = db.getChatSettings(m.chat);

    const option = text.toLowerCase().trim();

    if (option === 'on' || option === '1' || option === 'activar') {
      if (chatSettings.antiBad) {
        await m.reply('⚠️ El filtro de groserías ya está activado.');
        return;
      }
      // Si no hay palabras configuradas, usar las default
      if (!chatSettings.badWords || chatSettings.badWords.length === 0) {
        db.updateChatSettings(m.chat, { antiBad: true, badWords: [...CONFIG.defaultBadWords] });
      } else {
        db.updateChatSettings(m.chat, { antiBad: true });
      }
      await m.reply('✅ *Anti-Groserías activado*\n\n🚫 Los mensajes con groserías serán eliminados.');
    } else if (option === 'off' || option === '0' || option === 'desactivar') {
      if (!chatSettings.antiBad) {
        await m.reply('⚠️ El filtro de groserías ya está desactivado.');
        return;
      }
      db.updateChatSettings(m.chat, { antiBad: false });
      await m.reply('✅ *Anti-Groserías desactivado*\n\n🚫 El filtro de groserías ha sido desactivado.');
    } else {
      const status = chatSettings.antiBad ? '🟢 Activado' : '🔴 Desactivado';
      const wordCount = (chatSettings.badWords || []).length;
      await m.reply(`🚫 *ANTI-GROSERÍAS*\n\nEstado: ${status}\nPalabras: ${wordCount}\n\n📝 Uso:\n• /antibad on - Activar\n• /antibad off - Desactivar\n• /addbadword <palabra> - Agregar\n• /delbadword <palabra> - Quitar\n• /listbadwords - Ver lista`);
    }
  }
};

/**
 * Comando /addbadword - Agregar palabra prohibida
 */
export const addBadWordPlugin: PluginHandler = {
  command: ['addbadword', 'agregargroserias'],
  description: 'Agregar palabra prohibida',
  category: 'group',
  group: true,
  admin: true,

  async handler(ctx: MessageContext) {
    const { m, text } = ctx;
    const db = getDatabase();

    const word = text.toLowerCase().trim();
    if (!word) {
      await m.reply('❌ Escribe la palabra que quieres agregar.\n\n📝 Uso: /addbadword <palabra>');
      return;
    }

    const chatSettings = db.getChatSettings(m.chat);
    const badWords = chatSettings.badWords || [];

    if (badWords.includes(word)) {
      await m.reply(`⚠️ La palabra "*${word}*" ya está en la lista.`);
      return;
    }

    badWords.push(word);
    db.updateChatSettings(m.chat, { badWords });
    await m.reply(`✅ Palabra "*${word}*" agregada a la lista.\n\n📊 Total: ${badWords.length} palabras`);
  }
};

/**
 * Comando /delbadword - Quitar palabra prohibida
 */
export const delBadWordPlugin: PluginHandler = {
  command: ['delbadword', 'quitargroserias'],
  description: 'Quitar palabra prohibida',
  category: 'group',
  group: true,
  admin: true,

  async handler(ctx: MessageContext) {
    const { m, text } = ctx;
    const db = getDatabase();

    const word = text.toLowerCase().trim();
    if (!word) {
      await m.reply('❌ Escribe la palabra que quieres quitar.\n\n📝 Uso: /delbadword <palabra>');
      return;
    }

    const chatSettings = db.getChatSettings(m.chat);
    const badWords = chatSettings.badWords || [];
    const index = badWords.indexOf(word);

    if (index === -1) {
      await m.reply(`⚠️ La palabra "*${word}*" no está en la lista.`);
      return;
    }

    badWords.splice(index, 1);
    db.updateChatSettings(m.chat, { badWords });
    await m.reply(`✅ Palabra "*${word}*" eliminada de la lista.\n\n📊 Total: ${badWords.length} palabras`);
  }
};

/**
 * Comando /listbadwords - Ver palabras prohibidas
 */
export const listBadWordsPlugin: PluginHandler = {
  command: ['listbadwords', 'vergroserías', 'badwords'],
  description: 'Ver lista de palabras prohibidas',
  category: 'group',
  group: true,
  admin: true,

  async handler(ctx: MessageContext) {
    const { m } = ctx;
    const db = getDatabase();
    const chatSettings = db.getChatSettings(m.chat);
    const badWords = chatSettings.badWords || [];

    if (badWords.length === 0) {
      await m.reply('📋 No hay palabras prohibidas configuradas.\n\n💡 Usa /antibad on para cargar la lista default.');
      return;
    }

    let list = `🚫 *PALABRAS PROHIBIDAS*\n\n📊 Total: ${badWords.length}\n\n`;
    list += badWords.map((w, i) => `${i + 1}. ${w}`).join('\n');
    list += `\n\n💡 /addbadword <palabra> - Agregar\n💡 /delbadword <palabra> - Quitar`;

    await m.reply(list);
  }
};
