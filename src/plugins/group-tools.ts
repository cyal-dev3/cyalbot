import type { PluginHandler, MessageContext } from '../types/message.js';
import { getDatabase } from '../lib/database.js';
import { createLogger } from '../lib/logger.js';
import { mentionTag } from '../lib/utils.js';
import { getQuotedOrOwnMedia, mediaInMessage, MediaTooLargeError } from '../lib/media.js';
import { getAdmins, findBotParticipant, getBotIds, isParticipantSuperAdmin } from '../lib/participants.js';
import { getMaxWarnings, getAntiLinkMode } from '../lib/moderation.js';
import { invalidateGroupMetadata } from '../lib/group-events.js';
import { TOGGLES, readToggle, statusIcon } from './group-toggles.js';

const log = createLogger('grupos');

const MAX_SUBJECT_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 2048;
// WhatsApp rechaza fotos de perfil grandes; por encima de esto ni se descarga.
const MAX_PIC_BYTES = 5 * 1024 * 1024;

async function sendMention(ctx: MessageContext, text: string, mentions: string[]): Promise<void> {
  const sent = await ctx.conn.sendMessage(ctx.m.chat, { text, mentions }, { quoted: ctx.m.rawMessage });
  if (sent?.key) ctx.handler.trackMessage(ctx.m.chat, sent.key);
}

export const grupoPlugin: PluginHandler = {
  command: ['grupo', 'config', 'ajustes', 'settings'],
  description: 'Panel con la configuración del grupo',
  category: 'group',
  help: ['grupo - Muestra todos los interruptores del grupo y el comando para cambiarlos'],
  group: true,
  admin: true,

  async handler(ctx: MessageContext) {
    const { m, usedPrefix, groupMetadata, isBotAdmin } = ctx;
    const settings = getDatabase().getChatSettings(m.chat);
    const members = groupMetadata?.participants.length ?? ctx.participants?.length ?? 0;
    const admins = groupMetadata ? getAdmins(groupMetadata).length : ctx.groupAdmins?.length ?? 0;

    const switches = TOGGLES.map((def) => {
      const detail = def.field === 'antiLink' ? ` (modo ${getAntiLinkMode(settings)})` : '';
      return `${statusIcon(readToggle(settings, def))} ${def.emoji} ${def.label}${detail}\n    ${usedPrefix}${def.command[0]} on|off`;
    });

    const text =
      `⚙️ *${groupMetadata?.subject || 'Grupo'}*\n\n` +
      `👥 Miembros: *${members}* · 👮 Admins: *${admins}* (${usedPrefix}admins)\n` +
      `🤖 Bot admin: ${isBotAdmin ? '🟢 sí' : '🔴 no'}\n` +
      `🔇 Silenciados: *${settings.mutedUsers?.length ?? 0}* (${usedPrefix}listmute)\n` +
      `⚠️ Expulsión a las *${getMaxWarnings(settings)}* advertencias (${usedPrefix}setwarns)\n` +
      `🤬 Palabras prohibidas: *${settings.badWords?.length ?? 0}*\n\n` +
      `*Interruptores*\n${switches.join('\n')}\n\n` +
      `_Mensajes: ${usedPrefix}setwelcome · ${usedPrefix}setbye · Enlace: ${usedPrefix}link_`;
    await m.reply(text);
  },
};

export const linkPlugin: PluginHandler = {
  command: ['link', 'enlace', 'invitacion', 'grouplink'],
  description: 'Enlace de invitación del grupo',
  category: 'group',
  help: ['link - Muestra el enlace de invitación'],
  group: true,
  admin: true,
  botAdmin: true,

  async handler(ctx: MessageContext) {
    const { m, conn, usedPrefix } = ctx;
    try {
      const code = await conn.groupInviteCode(m.chat);
      if (!code) throw new Error('sin código');
      await m.reply(`🔗 *Enlace del grupo*\n\nhttps://chat.whatsapp.com/${code}\n\n_${usedPrefix}revoke lo invalida y genera uno nuevo._`);
    } catch (error) {
      log.warn(`link en ${m.chat}:`, error instanceof Error ? error.message : error);
      await m.reply('❌ No pude obtener el enlace. ¿Sigo siendo admin?');
    }
  },
};

export const revokePlugin: PluginHandler = {
  command: ['revoke', 'resetlink', 'revocar'],
  description: 'Invalida el enlace de invitación y crea uno nuevo',
  category: 'group',
  help: ['revoke - Restablece el enlace de invitación'],
  group: true,
  admin: true,
  botAdmin: true,

  async handler(ctx: MessageContext) {
    const { m, conn } = ctx;
    try {
      const code = await conn.groupRevokeInvite(m.chat);
      await m.reply(
        `♻️ *Enlace restablecido*\n\nEl enlace anterior ya no sirve.` +
        (code ? `\n\nNuevo: https://chat.whatsapp.com/${code}` : ''),
      );
    } catch (error) {
      log.warn(`revoke en ${m.chat}:`, error instanceof Error ? error.message : error);
      await m.reply('❌ No pude restablecer el enlace. ¿Sigo siendo admin?');
    }
  },
};

export const setNamePlugin: PluginHandler = {
  command: ['setname', 'setsubject', 'nombregrupo'],
  description: 'Cambia el nombre del grupo',
  category: 'group',
  help: ['setname <nombre> - Cambia el nombre del grupo'],
  group: true,
  admin: true,
  botAdmin: true,

  async handler(ctx: MessageContext) {
    const { m, conn, text, usedPrefix } = ctx;
    const subject = text.trim();
    if (!subject || subject.length > MAX_SUBJECT_LENGTH) {
      await m.reply(`❌ Escribe el nuevo nombre (hasta ${MAX_SUBJECT_LENGTH} caracteres).\n\n📝 Uso: ${usedPrefix}setname <nombre>`);
      return;
    }
    try {
      await conn.groupUpdateSubject(m.chat, subject);
      invalidateGroupMetadata(m.chat);
      await m.react('✅');
    } catch (error) {
      log.warn(`setname en ${m.chat}:`, error instanceof Error ? error.message : error);
      await m.reply('❌ No pude cambiar el nombre del grupo.');
    }
  },
};

export const setDescPlugin: PluginHandler = {
  command: ['setdesc', 'setdescription', 'descripcion'],
  description: 'Cambia la descripción del grupo',
  category: 'group',
  help: ['setdesc <texto> - Cambia la descripción', 'setdesc borrar - Quita la descripción'],
  group: true,
  admin: true,
  botAdmin: true,

  async handler(ctx: MessageContext) {
    const { m, conn, text, usedPrefix } = ctx;
    const desc = text.trim();
    if (!desc || desc.length > MAX_DESCRIPTION_LENGTH) {
      await m.reply(`❌ Escribe la nueva descripción (hasta ${MAX_DESCRIPTION_LENGTH} caracteres).\n\n📝 Uso: ${usedPrefix}setdesc <texto>\n📝 Quitar: ${usedPrefix}setdesc borrar`);
      return;
    }
    const clear = /^(borrar|clear|quitar|ninguna)$/i.test(desc);
    try {
      await conn.groupUpdateDescription(m.chat, clear ? undefined : desc);
      invalidateGroupMetadata(m.chat);
      await m.react('✅');
    } catch (error) {
      log.warn(`setdesc en ${m.chat}:`, error instanceof Error ? error.message : error);
      await m.reply('❌ No pude cambiar la descripción del grupo.');
    }
  },
};

export const setPicPlugin: PluginHandler = {
  command: ['setpic', 'setppgroup', 'fotogrupo', 'setgrouppic'],
  description: 'Cambia la foto del grupo con la imagen citada',
  category: 'group',
  help: ['setpic - Responde a una imagen (o envíala con el comando) para ponerla de foto'],
  group: true,
  admin: true,
  botAdmin: true,

  async handler(ctx: MessageContext) {
    const { m, conn, usedPrefix } = ctx;
    // m.message ya viene desenvuelto (mensajes temporales, ver una vez); rawMessage.message no.
    const hasImage = [m.quoted?.message, m.message ?? m.rawMessage?.message]
      .some((message) => mediaInMessage(message)?.kind === 'image');
    if (!hasImage) {
      await m.reply(`❌ Responde a una imagen con ${usedPrefix}setpic, o envía la imagen con el comando de pie de foto.`);
      return;
    }
    await m.react('⏳');
    try {
      const media = await getQuotedOrOwnMedia(ctx, ['image'], { maxBytes: MAX_PIC_BYTES });
      if (!media) throw new Error('no se pudo leer la imagen del mensaje');
      await conn.updateProfilePicture(m.chat, media.buffer);
      invalidateGroupMetadata(m.chat);
      await m.react('✅');
    } catch (error) {
      log.warn(`setpic en ${m.chat}:`, error instanceof Error ? error.message : error);
      await m.react('❌');
      await m.reply(error instanceof MediaTooLargeError
        ? `⚠️ ${error.message}.`
        : '❌ No pude cambiar la foto del grupo. Prueba con una imagen más pequeña.');
    }
  },
};

export const adminsPlugin: PluginHandler = {
  command: ['admins', 'administradores', 'listadmins'],
  description: 'Lista los administradores del grupo',
  category: 'group',
  help: ['admins - Lista los administradores'],
  group: true,
  admin: true,

  async handler(ctx: MessageContext) {
    const { m, groupMetadata } = ctx;
    const admins = getAdmins(groupMetadata);
    if (admins.length === 0) {
      await m.reply('❌ No pude obtener la lista de administradores.');
      return;
    }
    const bot = findBotParticipant(groupMetadata, getBotIds(ctx));
    const lines = admins.map((p) => {
      const marks = `${isParticipantSuperAdmin(p) ? ' 👑' : ''}${p === bot ? ' 🤖' : ''}`;
      return `• ${mentionTag(p.id)}${marks}`;
    });
    await sendMention(ctx, `👮 *Administradores (${admins.length})*\n\n${lines.join('\n')}`, admins.map((p) => p.id));
  },
};

export const leavePlugin: PluginHandler = {
  command: ['leave', 'salirgrupo', 'irse'],
  description: 'El bot abandona el grupo',
  category: 'owner',
  help: ['leave - El bot sale de este grupo (owner)'],
  group: true,
  owner: true,

  async handler(ctx: MessageContext) {
    const { m, conn } = ctx;
    await m.reply('👋 Hasta luego.');
    try {
      await conn.groupLeave(m.chat);
      log.info(`salí del grupo ${m.chat} por orden de ${m.sender}`);
    } catch (error) {
      log.error(`leave en ${m.chat}:`, error instanceof Error ? error.message : error);
      await m.reply('❌ No pude salir del grupo.');
    }
  },
};
