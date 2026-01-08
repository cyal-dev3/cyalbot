/**
 * ⚠️ Plugin de Sistema de Advertencias
 * Comandos: /warn, /unwarn, /listwarn, /clearwarn
 */

import type { PluginHandler, MessageContext } from '../types/message.js';
import { getDatabase } from '../lib/database.js';
import { CONFIG } from '../config.js';

/**
 * Comando /warn - Advertir a un usuario
 */
export const warnPlugin: PluginHandler = {
  command: ['warn', 'advertir'],
  description: 'Advertir a un usuario del grupo',
  category: 'group',
  group: true,
  admin: true,
  botAdmin: true,

  async handler(ctx: MessageContext) {
    const { m, text, conn } = ctx;
    const db = getDatabase();

    // Obtener usuario mencionado o citado
    let targetUser: string | null = null;
    let reason = text;

    if (m.mentionedJid && m.mentionedJid.length > 0) {
      targetUser = m.mentionedJid[0];
      reason = text.replace(/@\d+/g, '').trim();
    } else if (m.quoted) {
      targetUser = m.quoted.sender;
    }

    if (!targetUser) {
      await m.reply('⚠️ Debes mencionar o citar a un usuario.\n\n📝 Uso: /warn @usuario [razón]');
      return;
    }

    // No advertir a admins
    if (ctx.groupAdmins && ctx.groupAdmins.includes(targetUser)) {
      await m.reply('❌ No puedes advertir a un administrador.');
      return;
    }

    // Agregar advertencia
    const warningCount = db.addWarning(m.chat, {
      odBy: m.sender,
      odTo: targetUser,
      reason: reason || 'Sin razón especificada',
      timestamp: Date.now()
    });

    const targetNumber = targetUser.split('@')[0];

    // Verificar si alcanzó el máximo
    if (warningCount >= CONFIG.protection.maxWarnings) {
      try {
        await conn.groupParticipantsUpdate(m.chat, [targetUser], 'remove');
        await conn.sendMessage(m.chat, {
          text: `🚫 *USUARIO EXPULSADO*\n\n@${targetNumber} ha sido expulsado por acumular ${CONFIG.protection.maxWarnings} advertencias.`,
          mentions: [targetUser]
        });
        db.clearWarnings(m.chat, targetUser);
      } catch (error) {
        await m.reply('❌ Error al expulsar al usuario. Verifica que el bot tenga permisos.');
      }
    } else {
      await conn.sendMessage(m.chat, {
        text: `⚠️ *ADVERTENCIA ${warningCount}/${CONFIG.protection.maxWarnings}*\n\n👤 Usuario: @${targetNumber}\n📝 Razón: ${reason || 'Sin razón especificada'}\n\n⚡ ${CONFIG.protection.maxWarnings - warningCount} advertencia(s) más y será expulsado.`,
        mentions: [targetUser]
      });
    }
  }
};

/**
 * Comando /unwarn - Quitar advertencia a un usuario
 */
export const unwarnPlugin: PluginHandler = {
  command: ['unwarn', 'quitarwarn'],
  description: 'Quitar una advertencia a un usuario',
  category: 'group',
  group: true,
  admin: true,

  async handler(ctx: MessageContext) {
    const { m, conn } = ctx;
    const db = getDatabase();

    // Obtener usuario mencionado o citado
    let targetUser: string | null = null;

    if (m.mentionedJid && m.mentionedJid.length > 0) {
      targetUser = m.mentionedJid[0];
    } else if (m.quoted) {
      targetUser = m.quoted.sender;
    }

    if (!targetUser) {
      await m.reply('⚠️ Debes mencionar o citar a un usuario.\n\n📝 Uso: /unwarn @usuario');
      return;
    }

    const removed = db.removeWarning(m.chat, targetUser);
    const remainingWarnings = db.getWarnings(m.chat, targetUser).length;
    const targetNumber = targetUser.split('@')[0];

    if (removed) {
      await conn.sendMessage(m.chat, {
        text: `✅ Se quitó una advertencia a @${targetNumber}\n\n📊 Advertencias restantes: ${remainingWarnings}/${CONFIG.protection.maxWarnings}`,
        mentions: [targetUser]
      });
    } else {
      await conn.sendMessage(m.chat, {
        text: `ℹ️ @${targetNumber} no tiene advertencias.`,
        mentions: [targetUser]
      });
    }
  }
};

/**
 * Comando /listwarn - Ver usuarios con advertencias
 */
export const listWarnPlugin: PluginHandler = {
  command: ['listwarn', 'warns', 'advertencias'],
  description: 'Ver usuarios con advertencias en el grupo',
  category: 'group',
  group: true,
  admin: true,

  async handler(ctx: MessageContext) {
    const { m } = ctx;
    const db = getDatabase();

    const allWarnings = db.getAllWarnings(m.chat);

    if (allWarnings.length === 0) {
      await m.reply('✅ No hay usuarios con advertencias en este grupo.');
      return;
    }

    // Agrupar por usuario
    const warningsByUser = new Map<string, number>();
    for (const warning of allWarnings) {
      const count = warningsByUser.get(warning.odTo) || 0;
      warningsByUser.set(warning.odTo, count + 1);
    }

    let message = '⚠️ *USUARIOS CON ADVERTENCIAS*\n\n';
    const mentions: string[] = [];

    for (const [userId, count] of warningsByUser) {
      const userNumber = userId.split('@')[0];
      message += `👤 @${userNumber}: ${count}/${CONFIG.protection.maxWarnings} advertencias\n`;
      mentions.push(userId);
    }

    await ctx.conn.sendMessage(m.chat, {
      text: message,
      mentions
    });
  }
};

/**
 * Comando /clearwarn - Limpiar todas las advertencias de un usuario
 */
export const clearWarnPlugin: PluginHandler = {
  command: ['clearwarn', 'limpiarwarn'],
  description: 'Limpiar todas las advertencias de un usuario',
  category: 'group',
  group: true,
  admin: true,

  async handler(ctx: MessageContext) {
    const { m, conn } = ctx;
    const db = getDatabase();

    // Obtener usuario mencionado o citado
    let targetUser: string | null = null;

    if (m.mentionedJid && m.mentionedJid.length > 0) {
      targetUser = m.mentionedJid[0];
    } else if (m.quoted) {
      targetUser = m.quoted.sender;
    }

    if (!targetUser) {
      await m.reply('⚠️ Debes mencionar o citar a un usuario.\n\n📝 Uso: /clearwarn @usuario');
      return;
    }

    const removed = db.clearWarnings(m.chat, targetUser);
    const targetNumber = targetUser.split('@')[0];

    if (removed > 0) {
      await conn.sendMessage(m.chat, {
        text: `✅ Se eliminaron ${removed} advertencia(s) de @${targetNumber}`,
        mentions: [targetUser]
      });
    } else {
      await conn.sendMessage(m.chat, {
        text: `ℹ️ @${targetNumber} no tenía advertencias.`,
        mentions: [targetUser]
      });
    }
  }
};
