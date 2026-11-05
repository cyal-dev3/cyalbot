/**
 * Tipsters favoritos: /tipster seguir|dejar|lista|avisos y /tipsters @usuario.
 */

import type { PluginHandler } from '../types/message.js';
import { getDatabase } from '../lib/database.js';
import { MAX_FAVORITE_TIPSTERS } from '../lib/betting-store.js';
import { extractTipsterNameLegacy, formatRecord, renderFavoriteTipsters, requireBetting } from '../lib/betting-parser.js';
import { getTargetUserOrSelf, mentionTag } from '../lib/utils.js';

const SUBCOMMANDS: Record<string, 'seguir' | 'dejar' | 'lista' | 'avisos'> = {
  seguir: 'seguir', add: 'seguir', agregar: 'seguir', follow: 'seguir',
  dejar: 'dejar', remove: 'dejar', quitar: 'dejar', eliminar: 'dejar', unfollow: 'dejar',
  lista: 'lista', list: 'lista', ver: 'lista', favoritos: 'lista',
  avisos: 'avisos', notify: 'avisos', notificar: 'avisos', notificaciones: 'avisos',
};

/** Alias heredados de /mistipsters: entran directos a la lista. */
const LIST_ALIASES = new Set(['mistipsters', 'misfavoritos', 'mytipsters']);

export const tipsterPlugin: PluginHandler = {
  command: ['tipster', 'tip', ...LIST_ALIASES],
  tags: ['betting'],
  description: 'Gestiona tus tipsters favoritos',
  help: [
    'tipster seguir <nombre> - Agregar un tipster a favoritos (o responde a su mensaje)',
    'tipster dejar <nombre> - Quitarlo de favoritos',
    'tipster lista - Ver tus favoritos con estadísticas',
    'tipster avisos - Activar o desactivar las menciones cuando llega un pick',
  ],
  usage: ['tipster seguir Tipster1', 'tipster lista', 'tipster avisos'],
  group: true,

  handler: async (ctx) => {
    const { m, command, args, usedPrefix } = ctx;
    const store = getDatabase().betting;
    const system = await requireBetting(ctx);
    if (!system) return;

    const sub = LIST_ALIASES.has(command) ? 'lista' : SUBCOMMANDS[args[0]?.toLowerCase() ?? ''];
    const nameFromArgs = args.slice(1).join(' ').trim();
    const resolveName = (): string => nameFromArgs || (m.quoted ? extractTipsterNameLegacy(m.quoted.text) ?? '' : '');

    switch (sub) {
      case 'seguir': {
        const name = resolveName();
        if (!name) {
          return m.reply(`Dime a quién: *${usedPrefix}tipster seguir NombreTipster*, o responde a un mensaje que empiece con #NombreTipster.`);
        }
        const result = store.followTipsterStatus(m.chat, name, m.sender);
        if (result === 'already') return m.reply(`Ya sigues a *${name}*.`);
        if (result === 'limit') return m.reply(`Ya tienes ${MAX_FAVORITE_TIPSTERS} favoritos. Quita alguno con *${usedPrefix}tipster dejar <nombre>*.`);
        const tipster = store.getTipster(m.chat, name);
        return m.reply(
          `✅ Sigues a *${name}*\n📊 Record: ${formatRecord(tipster)}\n👥 Seguidores: ${tipster?.followers.length ?? 1}\n\n` +
          `Te mencionaré cuando llegue un pick suyo (*${usedPrefix}tipster avisos* para cambiarlo).`,
        );
      }

      case 'dejar': {
        const name = resolveName();
        if (!name) return m.reply(`Dime a quién: *${usedPrefix}tipster dejar NombreTipster*.`);
        if (!store.unfollowTipster(m.chat, name, m.sender)) return m.reply(`No seguías a *${name}*.`);
        return m.reply(`✅ Dejaste de seguir a *${name}*.`);
      }

      case 'lista': {
        const betting = store.getUserBetting(m.sender);
        if (betting.favoriteTipsters.length === 0) {
          return m.reply(`📋 No tienes tipsters favoritos. Añade uno con *${usedPrefix}tipster seguir <nombre>*.`);
        }
        return m.reply(renderFavoriteTipsters(betting, system, { usedPrefix, showNotify: true }));
      }

      case 'avisos': {
        const enabled = store.toggleNotify(m.sender);
        return m.reply(enabled
          ? '🔔 Avisos activados: te mencionaré cuando lleguen picks de tus favoritos.'
          : '🔕 Avisos desactivados: ya no te mencionaré al llegar picks.');
      }

      default:
        return m.reply(
          `🎫 *TIPSTERS FAVORITOS*\n\n` +
          `• *${usedPrefix}tipster seguir <nombre>* - Agregar favorito\n` +
          `• *${usedPrefix}tipster dejar <nombre>* - Quitar favorito\n` +
          `• *${usedPrefix}tipster lista* - Ver mis favoritos\n` +
          `• *${usedPrefix}tipster avisos* - Activar o desactivar menciones`,
        );
    }
  },
};

/** @deprecated /mistipsters ya es un alias de /tipster lista; plugins/index.ts debe dejar de registrarlo. */
export const misTipstersPlugin = tipsterPlugin;

export const tipstersDePlugin: PluginHandler = {
  command: ['tipsters', 'tipstersde'],
  tags: ['betting'],
  description: 'Tipsters favoritos de otro usuario',
  help: ['tipsters @usuario - Ver los tipsters favoritos de alguien'],
  usage: ['tipsters @usuario'],
  group: true,

  handler: async (ctx) => {
    const { m, args, usedPrefix } = ctx;
    const db = getDatabase();
    const system = await requireBetting(ctx);
    if (!system) return;

    const targetJid = getTargetUserOrSelf(m, { args });
    const isSelf = targetJid === m.sender;
    if (!isSelf && !db.hasUser(targetJid)) {
      return m.reply(`${mentionTag(targetJid)} todavía no ha usado el bot, así que no tiene tipsters.`);
    }
    const betting = db.betting.getUserBetting(targetJid);
    if (betting.favoriteTipsters.length === 0) {
      return m.reply(isSelf
        ? `📋 No tienes tipsters favoritos. Añade uno con *${usedPrefix}tipster seguir <nombre>*.`
        : `📋 ${mentionTag(targetJid)} no tiene tipsters favoritos.`);
    }
    await m.reply(renderFavoriteTipsters(betting, system, {
      usedPrefix,
      title: isSelf ? undefined : `TIPSTERS DE ${mentionTag(targetJid)}`,
      showNotify: isSelf,
    }));
  },
};

export default [tipsterPlugin, tipstersDePlugin];
