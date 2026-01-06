/**
 * 🗑️ Plugin para Eliminar Mensajes
 * Comandos: delete, del
 */

import type { MessageHandler } from '../handler.js';
import type { PluginHandler } from '../types/message.js';

/**
 * Plugin: Delete - Eliminar un mensaje citado
 */
const deletePlugin: PluginHandler = {
  command: ['delete', 'del', 'eliminar', 'borrar'],
  tags: ['grupo', 'admin'],
  help: ['delete - Responde a un mensaje para eliminarlo'],
  group: true,
  admin: true,
  botAdmin: true,

  handler: async (ctx) => {
    // Verificar que haya un mensaje citado
    if (!ctx.m.quoted) {
      await ctx.m.reply('❌ Responde al mensaje que quieres eliminar.\n\n📝 Ejemplo: Responde a un mensaje con /delete');
      return;
    }

    const quotedKey = ctx.m.quoted.key;

    // Verificar que tenemos la información necesaria
    if (!quotedKey.id || !quotedKey.remoteJid) {
      await ctx.m.reply('❌ No pude obtener información del mensaje.');
      return;
    }

    try {
      // Eliminar el mensaje citado
      await ctx.conn.sendMessage(ctx.m.chat, {
        delete: {
          remoteJid: ctx.m.chat,
          fromMe: quotedKey.fromMe || false,
          id: quotedKey.id,
          participant: quotedKey.participant
        }
      });

      // Confirmar eliminación con una reacción
      await ctx.m.react('✅');
    } catch (error) {
      console.error('Error eliminando mensaje:', error);
      await ctx.m.reply('❌ No pude eliminar ese mensaje. Puede que sea muy antiguo o no tenga permisos.');
    }
  }
};

/**
 * Plugin: Clear - Eliminar el mensaje del comando también
 */
const clearPlugin: PluginHandler = {
  command: ['clear', 'limpiar'],
  tags: ['grupo', 'admin'],
  help: ['clear - Elimina el mensaje del comando y el citado'],
  group: true,
  admin: true,
  botAdmin: true,

  handler: async (ctx) => {
    // Primero eliminar el mensaje citado si existe
    if (ctx.m.quoted) {
      const quotedKey = ctx.m.quoted.key;
      try {
        await ctx.conn.sendMessage(ctx.m.chat, {
          delete: {
            remoteJid: ctx.m.chat,
            fromMe: quotedKey.fromMe || false,
            id: quotedKey.id!,
            participant: quotedKey.participant
          }
        });
      } catch (error) {
        // Ignorar si no se puede eliminar
      }
    }

    // Eliminar el mensaje del comando
    try {
      await ctx.conn.sendMessage(ctx.m.chat, {
        delete: ctx.m.key
      });
    } catch (error) {
      console.error('Error eliminando mensaje del comando:', error);
    }
  }
};

/**
 * Registra los plugins de eliminación
 */
export function registerGroupDeletePlugins(handler: MessageHandler): void {
  handler.registerPlugin('delete', deletePlugin);
  handler.registerPlugin('clear', clearPlugin);
}
