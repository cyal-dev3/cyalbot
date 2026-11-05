import { areJidsSameUser } from 'baileys';
import type { MessageHandler } from '../handler.js';
import type { PluginHandler, MessageContext } from '../types/message.js';
import type { ChatSettings } from '../types/database.js';
import { getDatabase } from '../lib/database.js';
import { mentionTag, msToTime } from '../lib/utils.js';
import { resolveTarget, assertCanModerate } from '../lib/participants.js';
import { automutePlugin } from './group-toggles.js';

/** Campo pendiente en types/database.ts (ver handoff): vencimiento por jid de los mutes temporales. */
type MuteSettings = ChatSettings & { mutedUntil?: Record<string, number> };

export function getMutedUntil(settings: ChatSettings): Record<string, number> {
  const until = (settings as MuteSettings).mutedUntil;
  return until && typeof until === 'object' ? until : {};
}

/**
 * true si el jid está silenciado y, si el mute es temporal, aún no venció.
 * Es pura: no limpia nada. handler.isUserMuted debería usarla (ver handoff).
 */
export function isMutedNow(settings: ChatSettings, jid: string, now = Date.now()): boolean {
  const muted = settings.mutedUsers?.find((u) => areJidsSameUser(u, jid));
  if (!muted) return false;
  const until = getMutedUntil(settings)[muted];
  return until === undefined || until > now;
}

const MIN_MUTE_MS = 60_000;
const MAX_MUTE_MS = 30 * 24 * 3_600_000;

const UNIT_MS: Record<string, number> = {
  s: 1000, seg: 1000, segundos: 1000,
  m: 60_000, min: 60_000, minuto: 60_000, minutos: 60_000,
  h: 3_600_000, hr: 3_600_000, hora: 3_600_000, horas: 3_600_000,
  d: 86_400_000, dia: 86_400_000, dias: 86_400_000, día: 86_400_000, días: 86_400_000,
};

/** "10m", "2h", "1d", "30 min" -> ms; null si no es una duración válida (1 minuto a 30 días). */
export function parseMuteDuration(text: string | undefined | null): number | null {
  const match = (text ?? '').trim().toLowerCase().match(/^(\d+)\s*([a-zá-ú]+)$/);
  if (!match) return null;
  const unit = UNIT_MS[match[2]];
  if (!unit) return null;
  const ms = parseInt(match[1], 10) * unit;
  if (!Number.isFinite(ms) || ms < MIN_MUTE_MS || ms > MAX_MUTE_MS) return null;
  return ms;
}

function saveMutedUntil(chat: string, until: Record<string, number>): void {
  getDatabase().updateChatSettings(chat, { mutedUntil: until } as Partial<ChatSettings>);
}

/** Quita el mute a quienes ya vencieron. Usa handler.unmuteUser para mantener su registro en memoria. */
function expireMutes(ctx: MessageContext): void {
  const { m, handler } = ctx;
  const settings = getDatabase().getChatSettings(m.chat);
  const until = { ...getMutedUntil(settings) };
  const now = Date.now();
  let changed = false;
  for (const [jid, expiresAt] of Object.entries(until)) {
    if (expiresAt > now) continue;
    handler.unmuteUser(m.chat, jid);
    delete until[jid];
    changed = true;
  }
  if (changed) saveMutedUntil(m.chat, until);
}

function setMutedUntil(chat: string, jid: string, expiresAt: number | null): void {
  const until = { ...getMutedUntil(getDatabase().getChatSettings(chat)) };
  if (expiresAt === null) delete until[jid];
  else until[jid] = expiresAt;
  saveMutedUntil(chat, until);
}

async function sendMention(ctx: MessageContext, text: string, mentions: string[]): Promise<void> {
  const sent = await ctx.conn.sendMessage(ctx.m.chat, { text, mentions }, { quoted: ctx.m.rawMessage });
  if (sent?.key) ctx.handler.trackMessage(ctx.m.chat, sent.key);
}

/** Validaciones comunes de mute/tempmute; devuelve el jid canónico o null si ya respondió. */
async function prepareMute(ctx: MessageContext, usage: string): Promise<string | null> {
  const { m, handler, usedPrefix } = ctx;
  const target = resolveTarget(ctx, { allowNumber: true, allowSelf: true });
  if (!target) {
    await m.reply(`❌ Menciona o responde al mensaje de alguien para silenciarlo.\n\n📝 Ejemplo: ${usedPrefix}${usage}`);
    return null;
  }
  const reason = assertCanModerate(ctx, target, 'mute');
  if (reason) {
    await m.reply(`❌ ${reason}`);
    return null;
  }
  expireMutes(ctx);
  if (handler.isUserMuted(m.chat, target)) {
    await m.reply('⚠️ Ese usuario ya está silenciado.');
    return null;
  }
  return target;
}

/** Activa automute si estaba apagado; devuelve true si lo activó. */
function ensureAutoMute(ctx: MessageContext): boolean {
  if (ctx.handler.isAutoMuteEnabled(ctx.m.chat)) return false;
  ctx.handler.setAutoMute(ctx.m.chat, true);
  return true;
}

export const mutePlugin: PluginHandler = {
  command: ['mute', 'silenciar', 'callar'],
  tags: ['grupo', 'admin'],
  help: ['mute @usuario - Silencia a un usuario (sus mensajes se eliminan)'],
  group: true,
  admin: true,
  botAdmin: true,

  handler: async (ctx) => {
    const { m, handler, usedPrefix } = ctx;
    const target = await prepareMute(ctx, 'mute @usuario');
    if (!target) return;

    const activated = ensureAutoMute(ctx);
    handler.muteUser(m.chat, target);
    setMutedUntil(m.chat, target, null);

    if (handler.isCompactMode(m.chat)) {
      await m.react('🔇');
      return;
    }
    await sendMention(
      ctx,
      `🔇 ${mentionTag(target)} ha sido silenciado.\n\nSus mensajes se eliminarán hasta que un admin use ${usedPrefix}unmute.` +
      (activated ? '\n\n_Automute se activó automáticamente en este grupo._' : ''),
      [target],
    );
  },
};

export const tempMutePlugin: PluginHandler = {
  command: ['tempmute', 'mutetemp', 'silenciartemp'],
  tags: ['grupo', 'admin'],
  help: ['tempmute @usuario <10m|2h|1d> - Silencia a un usuario por un tiempo'],
  group: true,
  admin: true,
  botAdmin: true,

  handler: async (ctx) => {
    const { m, handler, args, usedPrefix } = ctx;
    const durationMs = args.map(parseMuteDuration).find((ms): ms is number => ms !== null) ?? null;
    if (durationMs === null) {
      await m.reply(
        `❌ Indica cuánto tiempo (de 1 minuto a 30 días).\n\n📝 Ejemplos:\n` +
        `• ${usedPrefix}tempmute @usuario 10m\n• ${usedPrefix}tempmute @usuario 2h\n• ${usedPrefix}tempmute @usuario 1d`,
      );
      return;
    }

    const target = await prepareMute(ctx, 'tempmute @usuario 10m');
    if (!target) return;

    const activated = ensureAutoMute(ctx);
    handler.muteUser(m.chat, target);
    setMutedUntil(m.chat, target, Date.now() + durationMs);

    if (handler.isCompactMode(m.chat)) {
      await m.react('⏳');
      return;
    }
    await sendMention(
      ctx,
      `🔇 ${mentionTag(target)} silenciado por *${msToTime(durationMs)}*.` +
      (activated ? '\n\n_Automute se activó automáticamente en este grupo._' : ''),
      [target],
    );
  },
};

export const unmutePlugin: PluginHandler = {
  command: ['unmute', 'desilenciar', 'hablar'],
  tags: ['grupo', 'admin'],
  help: ['unmute @usuario - Quita el silencio a un usuario'],
  group: true,
  admin: true,

  handler: async (ctx) => {
    const { m, handler, usedPrefix } = ctx;
    const target = resolveTarget(ctx, { allowNumber: true, allowSelf: true });
    if (!target) {
      await m.reply(`❌ Menciona o responde al mensaje de alguien para quitarle el silencio.\n\n📝 Ejemplo: ${usedPrefix}unmute @usuario`);
      return;
    }

    expireMutes(ctx);
    if (!handler.isUserMuted(m.chat, target)) {
      await m.reply('⚠️ Ese usuario no está silenciado.');
      return;
    }

    handler.unmuteUser(m.chat, target);
    setMutedUntil(m.chat, target, null);

    if (handler.isCompactMode(m.chat)) {
      await m.react('🔊');
      return;
    }
    await sendMention(ctx, `🔊 ${mentionTag(target)} ya puede hablar de nuevo.`, [target]);
  },
};

export const listMutePlugin: PluginHandler = {
  command: ['listmute', 'mutelist', 'silenciados'],
  tags: ['grupo', 'admin'],
  help: ['listmute - Muestra los usuarios silenciados'],
  group: true,
  admin: true,

  handler: async (ctx) => {
    const { m, handler, usedPrefix } = ctx;
    expireMutes(ctx);

    const settings = getDatabase().getChatSettings(m.chat);
    const until = getMutedUntil(settings);
    const muted = settings.mutedUsers ?? [];
    const status = `Automute: ${handler.isAutoMuteEnabled(m.chat) ? '🟢 Activo' : `🔴 Inactivo (${usedPrefix}automute on)`}`;

    if (muted.length === 0) {
      await m.reply(`🔇 *Silenciados*\n\n${status}\n\nNo hay usuarios silenciados en este grupo.`);
      return;
    }

    const now = Date.now();
    const lines = muted.map((jid, i) => {
      const expiresAt = until[jid];
      const remaining = expiresAt ? ` (quedan ${msToTime(expiresAt - now)})` : '';
      return `${i + 1}. ${mentionTag(jid)}${remaining}`;
    });
    await sendMention(ctx, `🔇 *Silenciados*\n\n${status}\n\n${lines.join('\n')}`, muted);
  },
};

/** @deprecated plugins/index.ts debe registrar estos plugins desde ENTRIES.grupos (automute está en TOGGLE_ENTRIES). */
export function registerGroupMutePlugins(handler: MessageHandler): void {
  handler.registerPlugin('group-mute', mutePlugin);
  handler.registerPlugin('group-tempmute', tempMutePlugin);
  handler.registerPlugin('group-unmute', unmutePlugin);
  handler.registerPlugin('group-automute', automutePlugin);
  handler.registerPlugin('group-listmute', listMutePlugin);
}
