/**
 * 🔒 Plugin de Cerrar/Abrir Grupo
 * Comandos: close, open, cerrar, abrir
 */

import type { MessageHandler } from '../handler.js';
import type { PluginHandler } from '../types/message.js';

/**
 * Plugin: Close - Cerrar el grupo (solo admins pueden enviar mensajes)
 */
const closePlugin: PluginHandler = {
  command: ['close', 'cerrar', 'cerrargrupo'],
  tags: ['grupo', 'admin'],
  help: ['close - Cierra el grupo (solo admins pueden escribir)'],
  group: true,
  admin: true,
  botAdmin: true,

  handler: async (ctx) => {
    try {
      await ctx.conn.groupSettingUpdate(ctx.m.chat, 'announcement');
      await ctx.m.reply('🔒 *Grupo cerrado*\n\nSolo los administradores pueden enviar mensajes.');
    } catch (error) {
      console.error('Error al cerrar grupo:', error);
      await ctx.m.reply('❌ No pude cerrar el grupo. Verifica que tengo permisos de administrador.');
    }
  }
};

/**
 * Plugin: Open - Abrir el grupo (todos pueden enviar mensajes)
 */
const openPlugin: PluginHandler = {
  command: ['open', 'abrir', 'abrirgrupo'],
  tags: ['grupo', 'admin'],
  help: ['open - Abre el grupo (todos pueden escribir)'],
  group: true,
  admin: true,
  botAdmin: true,

  handler: async (ctx) => {
    try {
      await ctx.conn.groupSettingUpdate(ctx.m.chat, 'not_announcement');
      await ctx.m.reply('🔓 *Grupo abierto*\n\nTodos los participantes pueden enviar mensajes.');
    } catch (error) {
      console.error('Error al abrir grupo:', error);
      await ctx.m.reply('❌ No pude abrir el grupo. Verifica que tengo permisos de administrador.');
    }
  }
};

/**
 * Registra los plugins de cerrar/abrir grupo
 */
export function registerGroupLockPlugins(handler: MessageHandler): void {
  handler.registerPlugin('group-close', closePlugin);
  handler.registerPlugin('group-open', openPlugin);
}
