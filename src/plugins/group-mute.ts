import type { PluginHandler, MessageContext } from '../types/message.js';
import type { ChatSettings } from '../types/database.js';
import { getDatabase } from '../lib/database.js';
import { mentionTag, msToTime } from '../lib/utils.js';
import { resolveTarget, assertCanModerate, isSameParticipant } from '../lib/participants.js';
import { getMutedUntil } from '../lib/moderation.js';

export { isMutedNow, getMutedUntil } from '../lib/moderation.js';

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
  getDatabase().updateChatSettings(chat, { mutedUntil: until });
}

/**
 * Entrada de mutedUsers que corresponde al objetivo. Puede estar en otro
 * formato (número en un grupo LID o al revés) si se guardó con una versión
 * anterior, por eso no se compara con igualdad.
 */
export function findStoredMute(
  ctx: Pick<MessageContext, 'groupMetadata'>,
  settings: Pick<ChatSettings, 'mutedUsers'>,
  target: string,
): string | undefined {
  return settings.mutedUsers?.find((u) => isSameParticipant(ctx.groupMetadata, u, target));
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

/**
 * Deja al objetivo silenciado con el vencimiento dado (null = permanente). Si
 * ya había una entrada en otro formato se migra al id canónico del grupo.
 */
function storeMute(ctx: MessageContext, stored: string | undefined, target: string, expiresAt: number | null): void {
  const { m, handler } = ctx;
  const until = { ...getMutedUntil(getDatabase().getChatSettings(m.chat)) };
  if (stored && stored !== target) {
    handler.unmuteUser(m.chat, stored);
    delete until[stored];
  }
  handler.muteUser(m.chat, target);
  if (expiresAt === null) delete until[target];
  else until[target] = expiresAt;
  saveMutedUntil(m.chat, until);
}

function clearMute(ctx: MessageContext, stored: string, target: string): void {
  const { m, handler } = ctx;
  const until = { ...getMutedUntil(getDatabase().getChatSettings(m.chat)) };
  handler.unmuteUser(m.chat, stored);
  delete until[stored];
  if (target !== stored) {
    handler.unmuteUser(m.chat, target);
    delete until[target];
  }
  saveMutedUntil(m.chat, until);
}

async function sendMention(ctx: MessageContext, text: string, mentions: string[]): Promise<void> {
  const sent = await ctx.conn.sendMessage(ctx.m.chat, { text, mentions }, { quoted: ctx.m.rawMessage });
  if (sent?.key) ctx.handler.trackMessage(ctx.m.chat, sent.key);
}

interface PreparedMute {
  /** Id canónico del objetivo en el grupo. */
  target: string;
  /** Entrada actual en mutedUsers, si ya estaba silenciado. */
  stored?: string;
  /** Vencimiento del mute actual; undefined si es permanente o no está silenciado. */
  until?: number;
}

/** Validaciones comunes de mute/tempmute; null si ya respondió. */
async function prepareMute(ctx: MessageContext, usage: string): Promise<PreparedMute | null> {
  const { m, usedPrefix } = ctx;
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
  const settings = getDatabase().getChatSettings(m.chat);
  const stored = findStoredMute(ctx, settings, target);
  return { target, stored, until: stored ? getMutedUntil(settings)[stored] : undefined };
}

/** Activa automute si estaba apagado; devuelve true si lo activó. */
function ensureAutoMute(ctx: MessageContext): boolean {
  if (ctx.handler.isAutoMuteEnabled(ctx.m.chat)) return false;
  ctx.handler.setAutoMute(ctx.m.chat, true);
  return true;
}

const AUTOMUTE_NOTE = '\n\n_Automute se activó automáticamente en este grupo._';

export const mutePlugin: PluginHandler = {
  command: ['mute', 'silenciar', 'callar'],
  tags: ['grupo', 'admin'],
  help: ['mute @usuario - Silencia a un usuario (sus mensajes se eliminan)'],
  group: true,
  admin: true,
  botAdmin: true,

  handler: async (ctx) => {
    const { m, handler, usedPrefix } = ctx;
    const prepared = await prepareMute(ctx, 'mute @usuario');
    if (!prepared) return;
    const { target, stored, until } = prepared;

    if (stored && until === undefined) {
      await m.reply(`⚠️ Ese usuario ya está silenciado permanentemente. Con ${usedPrefix}unmute le quitas el silencio.`);
      return;
    }

    const activated = ensureAutoMute(ctx);
    storeMute(ctx, stored, target, null);

    if (handler.isCompactMode(m.chat)) {
      await m.react('🔇');
      return;
    }
    const text = stored
      ? `🔇 ${mentionTag(target)} ahora está silenciado permanentemente (antes era temporal).`
      : `🔇 ${mentionTag(target)} ha sido silenciado.\n\nSus mensajes se eliminarán hasta que un admin use ${usedPrefix}unmute.`;
    await sendMention(ctx, text + (activated ? AUTOMUTE_NOTE : ''), [target]);
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

    const prepared = await prepareMute(ctx, 'tempmute @usuario 10m');
    if (!prepared) return;
    const { target, stored } = prepared;

    const activated = ensureAutoMute(ctx);
    storeMute(ctx, stored, target, Date.now() + durationMs);

    if (handler.isCompactMode(m.chat)) {
      await m.react('⏳');
      return;
    }
    const text = stored
      ? `🔄 Mute de ${mentionTag(target)} actualizado: ahora vence en *${msToTime(durationMs)}*.`
      : `🔇 ${mentionTag(target)} silenciado por *${msToTime(durationMs)}*.`;
    await sendMention(ctx, text + (activated ? AUTOMUTE_NOTE : ''), [target]);
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
    const stored = findStoredMute(ctx, getDatabase().getChatSettings(m.chat), target);
    if (!stored) {
      await m.reply('⚠️ Ese usuario no está silenciado.');
      return;
    }

    clearMute(ctx, stored, target);

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
