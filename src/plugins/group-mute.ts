/**
 * Plugin de Mute para Grupos
 * Comandos: mute, unmute, automute, listmute
 */

import type { MessageHandler } from '../handler.js';
import type { PluginHandler } from '../types/message.js';

// Referencia al handler para acceder a los métodos de mute
let handlerRef: MessageHandler;

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
 * Plugin: Mute - Silenciar a un usuario (eliminar sus mensajes automáticamente)
 */
const mutePlugin: PluginHandler = {
  command: ['mute', 'silenciar', 'callar'],
  tags: ['grupo', 'admin'],
  help: ['mute @usuario - Silencia a un usuario (se eliminan sus mensajes)'],
  group: true,
  admin: true,
  botAdmin: true,

  handler: async (ctx) => {
    const targetUser = getTargetUser(ctx);

    if (!targetUser) {
      await ctx.m.reply('❌ Menciona o responde al mensaje de alguien para silenciarlo.\n\n📝 Ejemplo: /mute @usuario');
      return;
    }

    // Verificar que no sea el mismo
    if (targetUser === ctx.m.sender) {
      await ctx.m.reply('❌ No puedes silenciarte a ti mismo.');
      return;
    }

    // Verificar que esté en el grupo
    if (!ctx.participants?.includes(targetUser)) {
      await ctx.m.reply('❌ Ese usuario no está en el grupo.');
      return;
    }

    // No permitir mutear admins (a menos que sea owner)
    if (ctx.groupAdmins?.includes(targetUser) && !ctx.isOwner) {
      await ctx.m.reply('❌ No puedes silenciar a un administrador.');
      return;
    }

    // Verificar si automute está activado
    if (!handlerRef.isAutoMuteEnabled(ctx.m.chat)) {
      await ctx.m.reply('⚠️ El modo automute no está activado en este grupo.\n\n📝 Un admin debe activarlo primero con: /automute on');
      return;
    }

    // Verificar si ya está muteado
    if (handlerRef.isUserMuted(ctx.m.chat, targetUser)) {
      await ctx.m.reply('⚠️ Ese usuario ya está silenciado.');
      return;
    }

    // Mutear al usuario
    handlerRef.muteUser(ctx.m.chat, targetUser);

    // Modo compacto: solo reacción
    if (ctx.handler.isCompactMode(ctx.m.chat)) {
      await ctx.m.react('🔇');
    } else {
      const userName = targetUser.split('@')[0];
      await ctx.m.reply(`🔇 @${userName} ha sido silenciado.\n\n⚠️ Sus mensajes serán eliminados automáticamente hasta que se le quite el mute.`);
    }
  }
};

/**
 * Plugin: Unmute - Quitar silencio a un usuario
 */
const unmutePlugin: PluginHandler = {
  command: ['unmute', 'desilenciar', 'hablar'],
  tags: ['grupo', 'admin'],
  help: ['unmute @usuario - Quita el silencio a un usuario'],
  group: true,
  admin: true,

  handler: async (ctx) => {
    const targetUser = getTargetUser(ctx);

    if (!targetUser) {
      await ctx.m.reply('❌ Menciona o responde al mensaje de alguien para quitarle el silencio.\n\n📝 Ejemplo: /unmute @usuario');
      return;
    }

    // Verificar si está muteado
    if (!handlerRef.isUserMuted(ctx.m.chat, targetUser)) {
      await ctx.m.reply('⚠️ Ese usuario no está silenciado.');
      return;
    }

    // Quitar mute
    const removed = handlerRef.unmuteUser(ctx.m.chat, targetUser);

    if (removed) {
      // Modo compacto: solo reacción
      if (ctx.handler.isCompactMode(ctx.m.chat)) {
        await ctx.m.react('🔊');
      } else {
        const userName = targetUser.split('@')[0];
        await ctx.m.reply(`🔊 @${userName} ya puede hablar de nuevo.`);
      }
    } else {
      await ctx.m.react('❌');
    }
  }
};

/**
 * Plugin: Automute - Activar/desactivar el sistema de mute automático
 * Solo el owner puede activarlo
 */
const automutePlugin: PluginHandler = {
  command: ['automute', 'autosilencio'],
  tags: ['grupo', 'owner'],
  help: ['automute on/off - Activa/desactiva el sistema de mute automático'],
  group: true,
  owner: true,
  botAdmin: true,

  handler: async (ctx) => {
    const option = ctx.args[0]?.toLowerCase();

    if (!option || !['on', 'off', 'activar', 'desactivar'].includes(option)) {
      const currentStatus = handlerRef.isAutoMuteEnabled(ctx.m.chat) ? '✅ Activado' : '❌ Desactivado';
      await ctx.m.reply(
        `🔇 *Sistema de Auto-Mute*\n\n` +
        `Estado actual: ${currentStatus}\n\n` +
        `📝 Uso:\n` +
        `• /automute on - Activar\n` +
        `• /automute off - Desactivar\n\n` +
        `ℹ️ Cuando está activado, los mensajes de usuarios silenciados serán eliminados automáticamente.`
      );
      return;
    }

    const enable = option === 'on' || option === 'activar';
    handlerRef.setAutoMute(ctx.m.chat, enable);

    if (enable) {
      await ctx.m.reply(
        `✅ *Sistema de Auto-Mute ACTIVADO*\n\n` +
        `🔇 A partir de ahora:\n` +
        `• Los admins pueden usar /mute @usuario\n` +
        `• Los mensajes de usuarios silenciados serán eliminados\n` +
        `• Usa /unmute @usuario para quitar el silencio\n` +
        `• Usa /listmute para ver los silenciados`
      );
    } else {
      await ctx.m.reply(
        `❌ *Sistema de Auto-Mute DESACTIVADO*\n\n` +
        `Los usuarios silenciados ya no tendrán sus mensajes eliminados automáticamente.`
      );
    }
  }
};

/**
 * Plugin: Listmute - Ver usuarios silenciados
 */
const listmutePlugin: PluginHandler = {
  command: ['listmute', 'mutelist', 'silenciados'],
  tags: ['grupo', 'admin'],
  help: ['listmute - Muestra los usuarios silenciados'],
  group: true,
  admin: true,

  handler: async (ctx) => {
    const muteRegistry = handlerRef.getMuteRegistry();
    const groupConfig = muteRegistry.get(ctx.m.chat);
    const isEnabled = handlerRef.isAutoMuteEnabled(ctx.m.chat);

    if (!groupConfig || groupConfig.mutedUsers.size === 0) {
      await ctx.m.reply(
        `🔇 *Lista de Silenciados*\n\n` +
        `Estado: ${isEnabled ? '✅ Activo' : '❌ Inactivo'}\n\n` +
        `No hay usuarios silenciados en este grupo.`
      );
      return;
    }

    const mutedList = Array.from(groupConfig.mutedUsers)
      .map((jid, i) => `${i + 1}. @${jid.split('@')[0]}`)
      .join('\n');

    await ctx.m.reply(
      `🔇 *Lista de Silenciados*\n\n` +
      `Estado: ${isEnabled ? '✅ Activo' : '❌ Inactivo'}\n\n` +
      `${mutedList}`
    );
  }
};

/**
 * Registra los plugins de mute
 */
export function registerGroupMutePlugins(handler: MessageHandler): void {
  handlerRef = handler;
  handler.registerPlugin('mute', mutePlugin);
  handler.registerPlugin('unmute', unmutePlugin);
  handler.registerPlugin('automute', automutePlugin);
  handler.registerPlugin('listmute', listmutePlugin);
}
