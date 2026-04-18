/**
 * 🎫 Plugin de Tipsters - Sistema de Betting CYALTRONIC
 * Comandos para gestionar tipsters favoritos y notificaciones
 */

import type { PluginHandler, MessageContext } from '../types/message.js';
import { getDatabase } from '../lib/database.js';
import { extractTipsterNameLegacy, BETTING_SEPARATOR } from '../lib/betting-parser.js';

/**
 * Comando /tipster - Gestionar tipsters favoritos
 */
export const tipsterPlugin: PluginHandler = {
  command: /^(tipster|tip)$/i,
  tags: ['betting'],
  help: [
    'tipster add <nombre> - Agregar tipster a favoritos',
    'tipster remove <nombre> - Quitar tipster de favoritos',
    'tipster list - Ver mis tipsters favoritos',
    'tipster notify - Toggle notificaciones'
  ],
  group: true,

  handler: async (ctx: MessageContext) => {
    const { m, args } = ctx;
    const db = getDatabase();

    const system = db.getBettingSystem(m.chat);
    if (!system.enabled) {
      return m.reply('❌ El sistema de betting no está habilitado en este grupo.');
    }

    const subcommand = args[0]?.toLowerCase();
    const tipsterName = args.slice(1).join(' ').trim();

    switch (subcommand) {
      case 'add':
      case 'agregar':
      case 'seguir': {
        let finalTipsterName = tipsterName;

        if (!finalTipsterName && m.quoted) {
          finalTipsterName = extractTipsterNameLegacy(m.quoted.text) || '';
        }

        if (!finalTipsterName) {
          return m.reply('❌ Debes especificar el nombre del tipster.\n\nEjemplo: /tipster add NombreTipster\n\nTambién puedes responder a un mensaje que comience con #NombreTipster');
        }

        const userBetting = db.getUserBetting(m.sender);

        if (userBetting.favoriteTipsters.length >= 20) {
          return m.reply('❌ Has alcanzado el límite de 20 tipsters favoritos.\n\nUsa /tipster remove para quitar alguno.');
        }

        const success = db.followTipster(m.chat, finalTipsterName, m.sender);

        if (!success) {
          return m.reply(`❌ Ya sigues a ${finalTipsterName}`);
        }

        const tipster = db.getTipster(m.chat, finalTipsterName);
        const record = tipster && (tipster.wins + tipster.losses > 0)
          ? `${tipster.wins}W - ${tipster.losses}L`
          : 'Sin historial';

        await m.reply(
          `✅ Tipster agregado a favoritos\n\n` +
          `🎫 ${finalTipsterName}\n` +
          `📊 Record: ${record}\n` +
          `👥 Seguidores: ${tipster?.followers.length || 1}\n\n` +
          `Recibirás notificaciones cuando llegue un pick de este tipster.`
        );
        break;
      }

      case 'remove':
      case 'quitar':
      case 'eliminar':
      case 'dejar': {
        let finalRemoveName = tipsterName;

        if (!finalRemoveName && m.quoted) {
          finalRemoveName = extractTipsterNameLegacy(m.quoted.text) || '';
        }

        if (!finalRemoveName) {
          return m.reply('❌ Debes especificar el nombre del tipster.\n\nEjemplo: /tipster remove NombreTipster\n\nTambién puedes responder a un mensaje que comience con #NombreTipster');
        }

        const success = db.unfollowTipster(m.chat, finalRemoveName, m.sender);

        if (!success) {
          return m.reply(`❌ No sigues a ${finalRemoveName}`);
        }

        await m.reply(`✅ Has dejado de seguir a ${finalRemoveName}`);
        break;
      }

      case 'list':
      case 'lista':
      case 'ver': {
        const userBetting = db.getUserBetting(m.sender);

        if (userBetting.favoriteTipsters.length === 0) {
          return m.reply('📋 No tienes tipsters favoritos.\n\nUsa /tipster add <nombre> para agregar uno.');
        }

        let msg = `🎫 TUS TIPSTERS FAVORITOS (${userBetting.favoriteTipsters.length}/20)\n${BETTING_SEPARATOR}\n\n`;

        for (const normalized of userBetting.favoriteTipsters) {
          const tipster = system.tipsters[normalized];
          if (tipster) {
            const total = tipster.wins + tipster.losses;
            const winrate = total > 0 ? ((tipster.wins / total) * 100).toFixed(0) : '0';
            const streak = tipster.currentStreak;
            const streakStr = streak > 0 ? `🔥+${streak}` : streak < 0 ? `❄️${streak}` : '';

            msg += `• ${tipster.name}\n`;
            msg += `   ${tipster.wins}W-${tipster.losses}L (${winrate}%) ${streakStr}\n`;
          } else {
            msg += `• ${normalized} (sin datos)\n`;
          }
        }

        msg += `\n🔔 Notificaciones: ${userBetting.notifyOnFavorite ? '✅ Activas' : '❌ Desactivadas'}`;
        msg += '\n\nUsa /tipster notify para cambiar notificaciones';

        await m.reply(msg);
        break;
      }

      case 'notify':
      case 'notificar':
      case 'notificaciones': {
        const userBetting = db.getUserBetting(m.sender);
        userBetting.notifyOnFavorite = !userBetting.notifyOnFavorite;

        await m.reply(
          `🔔 Notificaciones ${userBetting.notifyOnFavorite ? 'ACTIVADAS' : 'DESACTIVADAS'}\n\n` +
          (userBetting.notifyOnFavorite
            ? 'Recibirás @menciones cuando lleguen picks de tus tipsters favoritos.'
            : 'Ya no recibirás menciones cuando lleguen picks.')
        );
        break;
      }

      default:
        await m.reply(
          `🎫 GESTIÓN DE TIPSTERS\n\n` +
          `Comandos disponibles:\n` +
          `• /tipster add <nombre> - Agregar favorito\n` +
          `• /tipster remove <nombre> - Quitar favorito\n` +
          `• /tipster list - Ver mis favoritos\n` +
          `• /tipster notify - Toggle notificaciones`
        );
    }
  }
};

/**
 * Comando /mistipsters - Ver mis tipsters favoritos con stats
 */
export const misTipstersPlugin: PluginHandler = {
  command: /^(mistipsters|misfavoritos|mytipsters)$/i,
  tags: ['betting'],
  help: ['mistipsters - Ver mis tipsters favoritos con estadísticas'],
  group: true,

  handler: async (ctx: MessageContext) => {
    const { m } = ctx;
    const db = getDatabase();

    const system = db.getBettingSystem(m.chat);
    if (!system.enabled) {
      return m.reply('❌ El sistema de betting no está habilitado.');
    }

    const userBetting = db.getUserBetting(m.sender);

    if (userBetting.favoriteTipsters.length === 0) {
      return m.reply(
        '📋 No tienes tipsters favoritos\n\n' +
        'Usa /tipster add <nombre> para agregar tipsters.\n\n' +
        'Al agregar favoritos, recibirás notificaciones cuando lleguen sus picks.'
      );
    }

    let msg = `🎫 MIS TIPSTERS FAVORITOS\n${BETTING_SEPARATOR}\n\n`;

    const tipstersData = userBetting.favoriteTipsters
      .map(norm => system.tipsters[norm])
      .filter(t => t)
      .sort((a, b) => {
        const wrA = a.wins + a.losses > 0 ? a.wins / (a.wins + a.losses) : 0;
        const wrB = b.wins + b.losses > 0 ? b.wins / (b.wins + b.losses) : 0;
        return wrB - wrA;
      });

    for (const tipster of tipstersData) {
      const total = tipster.wins + tipster.losses;
      const winrate = total > 0 ? ((tipster.wins / total) * 100).toFixed(1) : '0.0';
      const roi = tipster.totalUnits > 0
        ? (((tipster.wonUnits - tipster.lostUnits) / tipster.totalUnits) * 100).toFixed(1)
        : '0.0';
      const streak = tipster.currentStreak;
      const streakEmoji = streak > 0 ? '🔥' : streak < 0 ? '❄️' : '➖';

      msg += `🎫 ${tipster.name}\n`;
      msg += `  📊 ${tipster.wins}W - ${tipster.losses}L (${winrate}%)\n`;
      msg += `  💰 ROI: ${parseFloat(roi) >= 0 ? '+' : ''}${roi}%\n`;
      msg += `  ${streakEmoji} Racha: ${streak > 0 ? '+' : ''}${streak}\n`;
      msg += `  ⏳ Pendientes: ${tipster.pending}\n\n`;
    }

    msg += `${BETTING_SEPARATOR}\n`;
    msg += `📈 Tus stats de seguimiento:\n`;
    msg += `  Total seguidos: ${userBetting.stats.totalFollowed}\n`;
    msg += `  ✅ Ganados: ${userBetting.stats.wonFollowed}\n`;
    msg += `  ❌ Perdidos: ${userBetting.stats.lostFollowed}`;

    const userTotal = userBetting.stats.wonFollowed + userBetting.stats.lostFollowed;
    if (userTotal > 0) {
      const userWinrate = ((userBetting.stats.wonFollowed / userTotal) * 100).toFixed(1);
      msg += `\n\nTu winrate siguiendo picks: ${userWinrate}%`;
    }

    await m.reply(msg);
  }
};

/**
 * Comando /tipsters @usuario - Ver favoritos de otro usuario
 */
export const tipstersDePlugin: PluginHandler = {
  command: /^(tipsters|tipstersde)$/i,
  tags: ['betting'],
  help: ['tipsters @usuario - Ver tipsters favoritos de otro usuario'],
  group: true,

  handler: async (ctx: MessageContext) => {
    const { m } = ctx;
    const db = getDatabase();

    const system = db.getBettingSystem(m.chat);
    if (!system.enabled) {
      return m.reply('❌ El sistema de betting no está habilitado.');
    }

    let targetJid = m.sender;
    let targetName = m.pushName || 'Usuario';

    if (m.mentionedJid && m.mentionedJid.length > 0) {
      targetJid = m.mentionedJid[0];
      targetName = targetJid.split('@')[0];
    } else if (m.quoted) {
      targetJid = m.quoted.sender;
      targetName = targetJid.split('@')[0];
    }

    const userBetting = db.getUserBetting(targetJid);
    const isSelf = targetJid === m.sender;

    if (userBetting.favoriteTipsters.length === 0) {
      return m.reply(
        isSelf
          ? '📋 No tienes tipsters favoritos.\n\nUsa /tipster add <nombre> para agregar.'
          : `📋 @${targetName} no tiene tipsters favoritos.`
      );
    }

    let msg = isSelf
      ? `🎫 TUS TIPSTERS FAVORITOS\n`
      : `🎫 TIPSTERS DE @${targetName}\n`;
    msg += `${BETTING_SEPARATOR}\n\n`;

    for (const normalized of userBetting.favoriteTipsters) {
      const tipster = system.tipsters[normalized];
      if (tipster) {
        const total = tipster.wins + tipster.losses;
        const winrate = total > 0 ? ((tipster.wins / total) * 100).toFixed(0) : '0';
        msg += `• ${tipster.name} - ${tipster.wins}W/${tipster.losses}L (${winrate}%)\n`;
      } else {
        msg += `• ${normalized}\n`;
      }
    }

    msg += `\nTotal: ${userBetting.favoriteTipsters.length} tipsters`;

    await m.reply(msg);
  }
};

export default [tipsterPlugin, misTipstersPlugin, tipstersDePlugin];
