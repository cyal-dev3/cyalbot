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
 * Plugin: Clear - Limpiar mensajes del bot y comandos para evitar spam
 * Edita mensajes del bot a invisible y elimina comandos de usuarios
 */
const clearPlugin: PluginHandler = {
  command: ['clear', 'limpiar', 'clean'],
  tags: ['grupo', 'admin'],
  help: [
    'clear - Limpia mensajes recientes del bot y comandos',
    'Los mensajes del bot se vuelven invisibles',
    'Los comandos de usuarios se eliminan',
    'Funciona con mensajes de los últimos 30 minutos'
  ],
  group: true,
  admin: true,
  botAdmin: true,

  handler: async (ctx) => {
    const { m, conn, handler } = ctx;

    await m.react('🧹');

    try {
      // Obtener mensajes rastreados
      const trackedMessages = handler.getTrackedMessages(m.chat);

      if (trackedMessages.length === 0) {
        // Eliminar solo el comando
        await conn.sendMessage(m.chat, { delete: m.key });

        const infoMsg = await conn.sendMessage(m.chat, {
          text: `🧹 No hay mensajes recientes para limpiar.\n\n_Los mensajes se rastrean por 30 minutos._`
        });

        // Auto-eliminar mensaje de info
        if (infoMsg?.key) {
          setTimeout(async () => {
            try {
              await handler.makeMessageInvisible(m.chat, infoMsg.key);
            } catch {
              // Ignorar
            }
          }, 3000);
        }

        return;
      }

      let cleanedCount = 0;
      let errorCount = 0;

      // Eliminar el mensaje del comando .clear primero
      try {
        await conn.sendMessage(m.chat, { delete: m.key });
        cleanedCount++;
      } catch {
        errorCount++;
      }

      // Procesar todos los mensajes rastreados
      for (const tracked of trackedMessages) {
        try {
          if (tracked.isCommand) {
            // Comandos de usuarios: eliminar
            await conn.sendMessage(m.chat, { delete: tracked.key });
          } else {
            // Mensajes del bot: hacer invisibles (editar)
            await handler.makeMessageInvisible(m.chat, tracked.key);
          }
          cleanedCount++;
          // Pequeña pausa para evitar rate limiting
          await new Promise(resolve => setTimeout(resolve, 150));
        } catch {
          errorCount++;
        }
      }

      // Limpiar el rastreo después de procesar
      handler.clearTrackedMessages(m.chat);

      // Mensaje de confirmación que se auto-limpia
      const confirmMsg = await conn.sendMessage(m.chat, {
        text: `🧹 *Limpieza completada*\n\n` +
              `✅ Limpiados: *${cleanedCount}* mensajes\n` +
              (errorCount > 0 ? `⚠️ Errores: *${errorCount}* (mensajes muy antiguos)\n` : '') +
              `\n_Este mensaje desaparecerá en 3 segundos..._`
      });

      // Rastrear y auto-limpiar mensaje de confirmación
      if (confirmMsg?.key) {
        handler.trackMessage(m.chat, confirmMsg.key, false);

        // Auto-limpiar mensaje de confirmación
        setTimeout(async () => {
          try {
            await handler.makeMessageInvisible(m.chat, confirmMsg.key);
          } catch {
            // Ignorar
          }
        }, 3000);
      }

    } catch (error) {
      console.error('Error en clear:', error);
      await m.react('❌');
    }
  }
};

/**
 * Plugin: AutoClear - Activar/desactivar limpieza automática
 * Limpia mensajes del bot y comandos después de 3 minutos
 */
const autoClearPlugin: PluginHandler = {
  command: ['autoclear', 'autolimpiar', 'autoclean'],
  tags: ['grupo', 'admin'],
  help: [
    'autoclear - Activa/desactiva limpieza automática',
    'Cuando está activo, los mensajes del bot se vuelven',
    'invisibles después de 3 minutos automáticamente',
    'Los comandos de usuarios también se eliminan'
  ],
  group: true,
  admin: true,
  botAdmin: true,

  handler: async (ctx) => {
    const { m, conn, handler } = ctx;

    // Obtener estado actual
    const currentState = handler.isAutoClearEnabled(m.chat);
    const newState = !currentState;

    // Cambiar estado
    handler.setAutoClear(m.chat, newState);

    // Eliminar el comando
    try {
      await conn.sendMessage(m.chat, { delete: m.key });
    } catch {
      // Ignorar
    }

    // Mensaje de confirmación
    const statusMsg = await conn.sendMessage(m.chat, {
      text: newState
        ? `🧹 *AutoClear ACTIVADO*\n\n` +
          `✅ Los mensajes del bot se volverán invisibles automáticamente después de *3 minutos*.\n` +
          `✅ Los comandos de usuarios también se eliminarán.\n\n` +
          `_Esto ayuda a mantener el chat limpio sin spam del bot._`
        : `🧹 *AutoClear DESACTIVADO*\n\n` +
          `❌ Los mensajes del bot ya no se limpiarán automáticamente.\n\n` +
          `_Usa .clear para limpiar manualmente._`
    });

    // Rastrear y auto-limpiar mensaje de confirmación
    if (statusMsg?.key) {
      handler.trackMessage(m.chat, statusMsg.key, false);

      // Si autoclear está activo, este mensaje también se limpiará en 3 min
      // Pero para que vean la confirmación, lo limpiamos en 10 segundos
      setTimeout(async () => {
        try {
          await handler.makeMessageInvisible(m.chat, statusMsg.key);
        } catch {
          // Ignorar
        }
      }, 10000);
    }
  }
};

/**
 * Registra los plugins de eliminación
 */
export function registerGroupDeletePlugins(handler: MessageHandler): void {
  handler.registerPlugin('delete', deletePlugin);
  handler.registerPlugin('clear', clearPlugin);
  handler.registerPlugin('autoclear', autoClearPlugin);
}
