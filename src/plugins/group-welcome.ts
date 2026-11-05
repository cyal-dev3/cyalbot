/**
 * Plugin de Bienvenida y Despedida
 * Comandos: /setwelcome, /setbye, /welcome, /bye
 */

import type { PluginHandler, MessageContext } from '../types/message.js';
import { getDatabase } from '../lib/database.js';

/**
 * Comando /setwelcome - Configurar mensaje de bienvenida
 */
export const setWelcomePlugin: PluginHandler = {
  command: ['setwelcome', 'bienvenida'],
  description: 'Configurar mensaje de bienvenida personalizado',
  category: 'group',
  group: true,
  admin: true,

  async handler(ctx: MessageContext) {
    const { m, text } = ctx;
    const db = getDatabase();

    if (!text) {
      const chatSettings = db.getChatSettings(m.chat);
      await m.reply(
        `👋 *CONFIGURAR BIENVENIDA*\n\n` +
        `📝 Uso: /setwelcome <mensaje>\n\n` +
        `📌 Variables disponibles:\n` +
        `• {user} - Menciona al usuario\n` +
        `• {group} - Nombre del grupo\n` +
        `• {desc} - Descripción del grupo\n\n` +
        `📄 Mensaje actual:\n${chatSettings.sWelcome}`
      );
      return;
    }

    db.updateChatSettings(m.chat, { sWelcome: text });
    await m.reply(`✅ Mensaje de bienvenida actualizado:\n\n${text}`);
  }
};

/**
 * Comando /setbye - Configurar mensaje de despedida
 */
export const setByePlugin: PluginHandler = {
  command: ['setbye', 'despedida'],
  description: 'Configurar mensaje de despedida personalizado',
  category: 'group',
  group: true,
  admin: true,

  async handler(ctx: MessageContext) {
    const { m, text } = ctx;
    const db = getDatabase();

    if (!text) {
      const chatSettings = db.getChatSettings(m.chat);
      await m.reply(
        `👋 *CONFIGURAR DESPEDIDA*\n\n` +
        `📝 Uso: /setbye <mensaje>\n\n` +
        `📌 Variables disponibles:\n` +
        `• {user} - Nombre del usuario\n` +
        `• {group} - Nombre del grupo\n\n` +
        `📄 Mensaje actual:\n${chatSettings.sBye}`
      );
      return;
    }

    db.updateChatSettings(m.chat, { sBye: text });
    await m.reply(`✅ Mensaje de despedida actualizado:\n\n${text}`);
  }
};

/**
 * Comando /welcome - Activar/desactivar bienvenidas
 */
export const welcomeTogglePlugin: PluginHandler = {
  command: ['welcome'],
  description: 'Activar/desactivar mensajes de bienvenida',
  category: 'group',
  group: true,
  admin: true,

  async handler(ctx: MessageContext) {
    const { m, text } = ctx;
    const db = getDatabase();
    const chatSettings = db.getChatSettings(m.chat);

    const option = text.toLowerCase().trim();

    if (option === 'on' || option === '1' || option === 'activar') {
      if (chatSettings.welcome) {
        await m.reply('⚠️ Las bienvenidas ya están activadas.');
        return;
      }
      db.updateChatSettings(m.chat, { welcome: true });
      await m.reply('✅ *Bienvenidas activadas*\n\n👋 Se enviará un mensaje cuando alguien entre al grupo.');
    } else if (option === 'off' || option === '0' || option === 'desactivar') {
      if (!chatSettings.welcome) {
        await m.reply('⚠️ Las bienvenidas ya están desactivadas.');
        return;
      }
      db.updateChatSettings(m.chat, { welcome: false });
      await m.reply('✅ *Bienvenidas desactivadas*');
    } else {
      const status = chatSettings.welcome ? '🟢 Activadas' : '🔴 Desactivadas';
      await m.reply(`👋 *BIENVENIDAS*\n\nEstado: ${status}\n\n📝 Uso:\n• /welcome on - Activar\n• /welcome off - Desactivar\n• /setwelcome <mensaje> - Personalizar`);
    }
  }
};

/**
 * Comando /bye - Activar/desactivar despedidas
 */
export const byeTogglePlugin: PluginHandler = {
  command: ['bye'],
  description: 'Activar/desactivar mensajes de despedida',
  category: 'group',
  group: true,
  admin: true,

  async handler(ctx: MessageContext) {
    const { m, text } = ctx;
    const db = getDatabase();
    const chatSettings = db.getChatSettings(m.chat);

    // Usamos el mismo campo 'detect' para bye (o podemos agregar uno nuevo)
    const option = text.toLowerCase().trim();

    if (option === 'on' || option === '1' || option === 'activar') {
      if (chatSettings.detect) {
        await m.reply('⚠️ Las despedidas ya están activadas.');
        return;
      }
      db.updateChatSettings(m.chat, { detect: true });
      await m.reply('✅ *Despedidas activadas*\n\n👋 Se enviará un mensaje cuando alguien salga del grupo.');
    } else if (option === 'off' || option === '0' || option === 'desactivar') {
      if (!chatSettings.detect) {
        await m.reply('⚠️ Las despedidas ya están desactivadas.');
        return;
      }
      db.updateChatSettings(m.chat, { detect: false });
      await m.reply('✅ *Despedidas desactivadas*');
    } else {
      const status = chatSettings.detect ? '🟢 Activadas' : '🔴 Desactivadas';
      await m.reply(`👋 *DESPEDIDAS*\n\nEstado: ${status}\n\n📝 Uso:\n• /bye on - Activar\n• /bye off - Desactivar\n• /setbye <mensaje> - Personalizar`);
    }
  }
};
