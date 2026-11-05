/**
 * Plugin de Modo Compacto
 * Reduce el spam del bot usando reacciones en lugar de mensajes
 */

import type { MessageHandler } from '../handler.js';
import type { PluginHandler } from '../types/message.js';

/**
 * Plugin: Compacto - Activar/desactivar modo compacto
 * En modo compacto el bot usa reacciones en lugar de mensajes de confirmación
 */
const compactPlugin: PluginHandler = {
  command: ['compacto', 'compact', 'silencioso', 'quiet'],
  tags: ['grupo', 'admin'],
  help: [
    'compacto - Activa/desactiva modo compacto',
    'compacto on/off - Activar o desactivar explícitamente',
    'En modo compacto:',
    '  - Confirmaciones usan reacciones (emojis)',
    '  - Solo se envían mensajes importantes',
    '  - Reduce significativamente el spam del bot'
  ],
  group: true,
  admin: true,

  handler: async (ctx) => {
    const { m, conn, handler, text } = ctx;

    // Determinar nuevo estado
    let newState: boolean;
    const arg = text.trim().toLowerCase();

    if (arg === 'on' || arg === 'activar' || arg === '1' || arg === 'si') {
      newState = true;
    } else if (arg === 'off' || arg === 'desactivar' || arg === '0' || arg === 'no') {
      newState = false;
    } else {
      // Toggle
      newState = !handler.isCompactMode(m.chat);
    }

    // Cambiar estado
    handler.setCompactMode(m.chat, newState);

    // En modo compacto, solo reaccionar
    if (newState) {
      await m.react('🔇');

      // Un mensaje breve que se auto-elimina
      const statusMsg = await conn.sendMessage(m.chat, {
        text: `🔇 *Modo Compacto ACTIVADO*\n_El bot usará reacciones en lugar de mensajes._`
      });

      // Auto-eliminar
      if (statusMsg?.key) {
        setTimeout(async () => {
          try {
            await conn.sendMessage(m.chat, { delete: statusMsg.key });
            await conn.sendMessage(m.chat, { delete: m.key });
          } catch {
            // Ignorar
          }
        }, 5000);
      }
    } else {
      await m.react('🔊');
      await m.reply(
        `🔊 *Modo Compacto DESACTIVADO*\n\n` +
        `El bot enviará mensajes de confirmación normalmente.\n\n` +
        `💡 _Usa /compacto on para reducir el spam._`
      );
    }
  }
};

/**
 * Registra el plugin
 */
export function registerGroupCompactPlugin(handler: MessageHandler): void {
  handler.registerPlugin('compact', compactPlugin);
}
