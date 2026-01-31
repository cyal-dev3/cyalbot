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
 * Elimina mensajes del bot y comandos de usuarios
 */
const clearPlugin: PluginHandler = {
  command: ['clear', 'limpiar', 'clean'],
  tags: ['grupo', 'admin'],
  help: [
    'clear - Limpia mensajes recientes del bot y comandos',
    'clear [cantidad] - Limpia los últimos N mensajes rastreados',
    'Los mensajes del bot y comandos se eliminan',
    'Funciona con mensajes de la última hora'
  ],
  group: true,
  admin: true,
  botAdmin: true,

  handler: async (ctx) => {
    const { m, conn, handler, text } = ctx;

    await m.react('🧹');

    try {
      // Obtener mensajes rastreados
      let trackedMessages = handler.getTrackedMessages(m.chat);

      // Si se especifica cantidad, limitar
      const cantidad = parseInt(text.trim());
      if (!isNaN(cantidad) && cantidad > 0) {
        // Tomar los últimos N mensajes
        trackedMessages = trackedMessages.slice(-cantidad);
      }

      // Eliminar el mensaje del comando .clear primero
      try {
        await conn.sendMessage(m.chat, { delete: m.key });
      } catch {
        // Ignorar
      }

      if (trackedMessages.length === 0) {
        const infoMsg = await conn.sendMessage(m.chat, {
          text: `🧹 No hay mensajes recientes para limpiar.\n\n_Los mensajes se rastrean por 1 hora._`
        });

        // Auto-eliminar mensaje de info
        if (infoMsg?.key) {
          setTimeout(async () => {
            try {
              await conn.sendMessage(m.chat, { delete: infoMsg.key });
            } catch {
              // Ignorar
            }
          }, 4000);
        }

        return;
      }

      let cleanedCount = 0;
      let errorCount = 0;

      // Procesar todos los mensajes rastreados (en lotes para evitar rate limit)
      const batchSize = 5;
      for (let i = 0; i < trackedMessages.length; i += batchSize) {
        const batch = trackedMessages.slice(i, i + batchSize);

        // Procesar lote en paralelo
        const results = await Promise.allSettled(
          batch.map(tracked =>
            conn.sendMessage(m.chat, { delete: tracked.key })
          )
        );

        // Contar resultados
        for (const result of results) {
          if (result.status === 'fulfilled') {
            cleanedCount++;
          } else {
            errorCount++;
          }
        }

        // Pausa entre lotes (500ms)
        if (i + batchSize < trackedMessages.length) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      // Limpiar el rastreo después de procesar
      handler.clearTrackedMessages(m.chat);

      // Mensaje de confirmación que se auto-limpia
      const confirmMsg = await conn.sendMessage(m.chat, {
        text: `🧹 *Limpieza completada*\n\n` +
              `✅ Eliminados: *${cleanedCount}* mensajes\n` +
              (errorCount > 0 ? `⚠️ No eliminados: *${errorCount}* (muy antiguos o ya borrados)\n` : '') +
              `\n_Este mensaje se eliminará en 4 segundos..._`
      });

      // Auto-eliminar mensaje de confirmación
      if (confirmMsg?.key) {
        setTimeout(async () => {
          try {
            await conn.sendMessage(m.chat, { delete: confirmMsg.key });
          } catch {
            // Ignorar
          }
        }, 4000);
      }

    } catch (error) {
      console.error('Error en clear:', error);
      await m.react('❌');
    }
  }
};

/**
 * Plugin: AutoClear - Activar/desactivar limpieza automática
 * Elimina mensajes del bot y comandos después de 2 minutos
 */
const autoClearPlugin: PluginHandler = {
  command: ['autoclear', 'autolimpiar', 'autoclean'],
  tags: ['grupo', 'admin'],
  help: [
    'autoclear - Activa/desactiva limpieza automática',
    'autoclear on/off - Activar o desactivar explícitamente',
    'Cuando está activo, los mensajes del bot se eliminan',
    'automáticamente después de 2 minutos',
    'Los comandos de usuarios también se eliminan'
  ],
  group: true,
  admin: true,
  botAdmin: true,

  handler: async (ctx) => {
    const { m, conn, handler, text } = ctx;

    // Determinar nuevo estado
    let newState: boolean;
    const arg = text.trim().toLowerCase();

    if (arg === 'on' || arg === 'activar' || arg === '1') {
      newState = true;
    } else if (arg === 'off' || arg === 'desactivar' || arg === '0') {
      newState = false;
    } else {
      // Toggle
      newState = !handler.isAutoClearEnabled(m.chat);
    }

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
          `✅ Los mensajes del bot se eliminarán automáticamente después de *2 minutos*.\n` +
          `✅ Los comandos de usuarios también se eliminarán.\n\n` +
          `💡 _Usa /autoclear off para desactivar._`
        : `🧹 *AutoClear DESACTIVADO*\n\n` +
          `❌ Los mensajes del bot ya no se eliminarán automáticamente.\n\n` +
          `💡 _Usa /clear para limpiar manualmente._`
    });

    // Auto-eliminar mensaje de confirmación en 8 segundos
    if (statusMsg?.key) {
      setTimeout(async () => {
        try {
          await conn.sendMessage(m.chat, { delete: statusMsg.key });
        } catch {
          // Ignorar
        }
      }, 8000);
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
