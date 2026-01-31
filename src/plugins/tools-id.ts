/**
 * Plugin: /id
 * Muestra el ID del chat actual (grupo o privado)
 */

import type { PluginHandler, MessageContext } from '../types/message.js';

export const idPlugin: PluginHandler = {
  command: ['id', 'chatid', 'groupid'],
  description: 'Muestra el ID del chat actual',
  category: 'tools',

  async handler(ctx: MessageContext) {
    const { m } = ctx;

    const chatId = m.chat;
    const senderId = m.sender;
    const isGroup = chatId.endsWith('@g.us');

    let response = `*ID del Chat:*\n\`${chatId}\`\n\n*Tu ID:*\n\`${senderId}\``;

    if (isGroup) {
      response += `\n\n_Copia el ID del chat para configurar WHATSAPP_GROUP_ID en tu .env_`;
    }

    await m.reply(response);
  }
};

export default idPlugin;
