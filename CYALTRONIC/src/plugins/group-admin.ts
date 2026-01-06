/**
 * 👑 Plugin de Administración de Grupo
 * Comandos: promote, demote, kick
 */

import type { MessageHandler } from '../handler.js';
import type { PluginHandler } from '../types/message.js';

/**
 * Obtiene el JID del usuario objetivo (mencionado o citado)
 */
function getTargetUser(ctx: { m: { mentionedJid: string[]; quoted?: { sender: string } }; args: string[] }): string | null {
  // Primero verificar menciones
  if (ctx.m.mentionedJid.length > 0) {
    return ctx.m.mentionedJid[0];
  }

  // Luego verificar mensaje citado
  if (ctx.m.quoted?.sender) {
    return ctx.m.quoted.sender;
  }

  // Finalmente verificar si pasaron un número
  if (ctx.args[0]) {
    const number = ctx.args[0].replace(/[^0-9]/g, '');
    if (number.length >= 10) {
      return `${number}@s.whatsapp.net`;
    }
  }

  return null;
}

/**
 * Plugin: Promote - Hacer admin a un usuario
 */
const promotePlugin: PluginHandler = {
  command: ['promote', 'admin', 'haceradmin'],
  tags: ['grupo', 'admin'],
  help: ['promote @usuario - Hace admin a un usuario'],
  group: true,
  admin: true,
  botAdmin: true,

  handler: async (ctx) => {
    const targetUser = getTargetUser(ctx);

    if (!targetUser) {
      await ctx.m.reply('❌ Menciona o responde al mensaje de alguien para hacerlo admin.\n\n📝 Ejemplo: /promote @usuario');
      return;
    }

    // Verificar que no sea el mismo
    if (targetUser === ctx.m.sender) {
      await ctx.m.reply('❌ No puedes hacerte admin a ti mismo.');
      return;
    }

    // Verificar que esté en el grupo
    if (!ctx.participants?.includes(targetUser)) {
      await ctx.m.reply('❌ Ese usuario no está en el grupo.');
      return;
    }

    // Verificar que no sea ya admin
    if (ctx.groupAdmins?.includes(targetUser)) {
      await ctx.m.reply('⚠️ Ese usuario ya es administrador.');
      return;
    }

    try {
      await ctx.conn.groupParticipantsUpdate(ctx.m.chat, [targetUser], 'promote');
      const userName = targetUser.split('@')[0];
      await ctx.m.reply(`✅ @${userName} ahora es administrador del grupo! 👑`);
    } catch (error) {
      console.error('Error en promote:', error);
      await ctx.m.reply('❌ No pude hacer admin a ese usuario. Verifica que tengo permisos.');
    }
  }
};

/**
 * Plugin: Demote - Quitar admin a un usuario
 */
const demotePlugin: PluginHandler = {
  command: ['demote', 'quitaradmin', 'removeadmin'],
  tags: ['grupo', 'admin'],
  help: ['demote @usuario - Quita admin a un usuario'],
  group: true,
  admin: true,
  botAdmin: true,

  handler: async (ctx) => {
    const targetUser = getTargetUser(ctx);

    if (!targetUser) {
      await ctx.m.reply('❌ Menciona o responde al mensaje de alguien para quitarle admin.\n\n📝 Ejemplo: /demote @usuario');
      return;
    }

    // Verificar que esté en el grupo
    if (!ctx.participants?.includes(targetUser)) {
      await ctx.m.reply('❌ Ese usuario no está en el grupo.');
      return;
    }

    // Verificar que sea admin
    if (!ctx.groupAdmins?.includes(targetUser)) {
      await ctx.m.reply('⚠️ Ese usuario no es administrador.');
      return;
    }

    try {
      await ctx.conn.groupParticipantsUpdate(ctx.m.chat, [targetUser], 'demote');
      const userName = targetUser.split('@')[0];
      await ctx.m.reply(`✅ @${userName} ya no es administrador. 📉`);
    } catch (error) {
      console.error('Error en demote:', error);
      await ctx.m.reply('❌ No pude quitar admin a ese usuario. Verifica que tengo permisos.');
    }
  }
};

/**
 * Plugin: Kick - Expulsar a un usuario del grupo
 */
const kickPlugin: PluginHandler = {
  command: ['kick', 'expulsar', 'ban', 'remove'],
  tags: ['grupo', 'admin'],
  help: ['kick @usuario - Expulsa a un usuario del grupo'],
  group: true,
  admin: true,
  botAdmin: true,

  handler: async (ctx) => {
    const targetUser = getTargetUser(ctx);

    if (!targetUser) {
      await ctx.m.reply('❌ Menciona o responde al mensaje de alguien para expulsarlo.\n\n📝 Ejemplo: /kick @usuario');
      return;
    }

    // Verificar que no sea el mismo
    if (targetUser === ctx.m.sender) {
      await ctx.m.reply('❌ No puedes expulsarte a ti mismo. Usa /leave si quieres salir.');
      return;
    }

    // Verificar que esté en el grupo
    if (!ctx.participants?.includes(targetUser)) {
      await ctx.m.reply('❌ Ese usuario no está en el grupo.');
      return;
    }

    // No permitir expulsar admins (a menos que sea owner)
    if (ctx.groupAdmins?.includes(targetUser) && !ctx.isOwner) {
      await ctx.m.reply('❌ No puedes expulsar a un administrador.');
      return;
    }

    try {
      await ctx.conn.groupParticipantsUpdate(ctx.m.chat, [targetUser], 'remove');
      const userName = targetUser.split('@')[0];
      await ctx.m.reply(`✅ @${userName} ha sido expulsado del grupo. 🚪`);
    } catch (error) {
      console.error('Error en kick:', error);
      await ctx.m.reply('❌ No pude expulsar a ese usuario. Verifica que tengo permisos.');
    }
  }
};

/**
 * Registra los plugins de administración
 */
export function registerGroupAdminPlugins(handler: MessageHandler): void {
  handler.registerPlugin('promote', promotePlugin);
  handler.registerPlugin('demote', demotePlugin);
  handler.registerPlugin('kick', kickPlugin);
}
