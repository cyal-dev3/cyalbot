import type { PluginHandler } from '../types/message.js';
import { createLogger } from '../lib/logger.js';
import { invalidateGroupMetadata } from '../lib/group-events.js';

const log = createLogger('grupos');

export const closePlugin: PluginHandler = {
  command: ['close', 'cerrar', 'cerrargrupo'],
  tags: ['grupo', 'admin'],
  help: ['close - Cierra el grupo (solo admins pueden escribir)'],
  group: true,
  admin: true,
  botAdmin: true,

  handler: async (ctx) => {
    try {
      await ctx.conn.groupSettingUpdate(ctx.m.chat, 'announcement');
      invalidateGroupMetadata(ctx.m.chat);
      await ctx.m.reply('🔒 *Grupo cerrado*\n\nSolo los administradores pueden enviar mensajes.');
    } catch (error) {
      log.warn(`close en ${ctx.m.chat}:`, error instanceof Error ? error.message : error);
      await ctx.m.reply('❌ No pude cerrar el grupo. Verifica que sigo siendo administrador.');
    }
  },
};

export const openPlugin: PluginHandler = {
  command: ['open', 'abrir', 'abrirgrupo'],
  tags: ['grupo', 'admin'],
  help: ['open - Abre el grupo (todos pueden escribir)'],
  group: true,
  admin: true,
  botAdmin: true,

  handler: async (ctx) => {
    try {
      await ctx.conn.groupSettingUpdate(ctx.m.chat, 'not_announcement');
      invalidateGroupMetadata(ctx.m.chat);
      await ctx.m.reply('🔓 *Grupo abierto*\n\nTodos los participantes pueden enviar mensajes.');
    } catch (error) {
      log.warn(`open en ${ctx.m.chat}:`, error instanceof Error ? error.message : error);
      await ctx.m.reply('❌ No pude abrir el grupo. Verifica que sigo siendo administrador.');
    }
  },
};
