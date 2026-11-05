import type { GroupMetadata } from 'baileys';
import type { MessageHandler } from '../handler.js';
import type { PluginHandler, MessageContext } from '../types/message.js';
import { createLogger } from '../lib/logger.js';
import { mentionTag } from '../lib/utils.js';
import { resolveTargets, assertCanModerate, isSameParticipant, type ModerationAction } from '../lib/participants.js';

const log = createLogger('grupos');

/** Lo que devuelve conn.groupParticipantsUpdate por participante (el nodo puede traer jid, lid o phone_number). */
export interface ParticipantUpdateResult {
  status: string;
  jid?: string | null;
  content?: { attrs?: Record<string, string | undefined> } | null;
}

function resultIds(result: ParticipantUpdateResult): string[] {
  const attrs = result.content?.attrs ?? {};
  return [result.jid, attrs.jid, attrs.lid, attrs.phone_number]
    .filter((id): id is string => typeof id === 'string' && id.includes('@'));
}

/**
 * Reparte los participantes enviados entre aceptados y rechazados según la
 * respuesta de WhatsApp. El servidor puede contestar con el id en el otro
 * formato (número por LID o al revés), así que se compara vía metadata. Si
 * contestó por participante y alguno no aparece, no se da por hecho.
 */
export function splitUpdateResults(
  sent: readonly string[],
  results: readonly ParticipantUpdateResult[],
  metadata: Pick<GroupMetadata, 'participants'> | null | undefined,
): { done: string[]; failed: string[] } {
  const done: string[] = [];
  const failed: string[] = [];
  for (const jid of sent) {
    const result = results.find((r) => resultIds(r).some((id) => isSameParticipant(metadata, id, jid)));
    if (results.length === 0 || result?.status === '200') done.push(jid);
    else failed.push(jid);
  }
  return { done, failed };
}

type GroupAction = Extract<ModerationAction, 'kick' | 'promote' | 'demote'>;

interface ActionTexts {
  verb: string;
  wa: 'remove' | 'promote' | 'demote';
  emoji: string;
  done: string;
  usage: string;
}

const ACTIONS: Record<GroupAction, ActionTexts> = {
  kick: { verb: 'expulsar', wa: 'remove', emoji: '🚪', done: 'expulsado(s)', usage: 'kick @usuario [@otro...]' },
  promote: { verb: 'hacer admin', wa: 'promote', emoji: '👑', done: 'ahora admin', usage: 'promote @usuario [@otro...]' },
  demote: { verb: 'quitar admin', wa: 'demote', emoji: '📉', done: 'ya no admin', usage: 'demote @usuario [@otro...]' },
};

/**
 * Aplica kick/promote/demote a todas las menciones en una sola llamada y
 * responde con un único resumen. Para promote/demote el aviso en el grupo lo
 * da group-events.ts, así que solo se reacciona.
 */
async function moderate(ctx: MessageContext, action: GroupAction): Promise<void> {
  const { m, conn, usedPrefix } = ctx;
  const texts = ACTIONS[action];
  const targets = resolveTargets(ctx, { allowNumber: true, allowSelf: true });

  if (targets.length === 0) {
    await m.reply(`❌ Menciona o responde al mensaje de alguien para ${texts.verb}.\n\n📝 Ejemplo: ${usedPrefix}${texts.usage}`);
    return;
  }

  const rejected: { jid: string; reason: string }[] = [];
  const allowed: string[] = [];
  for (const jid of targets) {
    const reason = assertCanModerate(ctx, jid, action);
    if (reason) rejected.push({ jid, reason });
    else allowed.push(jid);
  }

  let failed: string[] = [];
  let done: string[] = [];
  if (allowed.length > 0) {
    try {
      const results = await conn.groupParticipantsUpdate(m.chat, allowed, texts.wa);
      ({ done, failed } = splitUpdateResults(allowed, results, ctx.groupMetadata));
    } catch (error) {
      log.error(`${action} en ${m.chat}:`, error instanceof Error ? error.message : error);
      failed.push(...allowed);
    }
  }

  const compact = ctx.handler.isCompactMode(m.chat);
  const onlySuccess = rejected.length === 0 && failed.length === 0;
  if (done.length > 0) await m.react(texts.emoji);
  else await m.react('❌');

  // Promote/demote: el grupo ya ve el aviso de group-events; solo se habla si algo falló.
  if (onlySuccess && (compact || action !== 'kick')) return;

  const lines: string[] = [];
  if (done.length > 0 && action === 'kick') lines.push(`${texts.emoji} ${done.map(mentionTag).join(', ')} ${texts.done}.`);
  for (const { jid, reason } of rejected) lines.push(`⚠️ ${mentionTag(jid)}: ${reason}`);
  if (failed.length > 0) {
    lines.push(`❌ No pude ${texts.verb} a ${failed.map(mentionTag).join(', ')}. ¿Tengo permisos y sigue en el grupo?`);
  }

  const sent = await conn.sendMessage(m.chat, {
    text: lines.join('\n'),
    mentions: [...done, ...rejected.map((r) => r.jid), ...failed],
  }, { quoted: m.rawMessage });
  if (sent?.key) ctx.handler.trackMessage(m.chat, sent.key);
}

export const promotePlugin: PluginHandler = {
  command: ['promote', 'admin', 'haceradmin'],
  tags: ['grupo', 'admin'],
  help: ['promote @usuario [@otro...] - Hace admin a los mencionados'],
  group: true,
  admin: true,
  botAdmin: true,
  handler: (ctx) => moderate(ctx, 'promote'),
};

export const demotePlugin: PluginHandler = {
  command: ['demote', 'quitaradmin', 'removeadmin'],
  tags: ['grupo', 'admin'],
  help: ['demote @usuario [@otro...] - Quita admin a los mencionados'],
  group: true,
  admin: true,
  botAdmin: true,
  handler: (ctx) => moderate(ctx, 'demote'),
};

export const kickPlugin: PluginHandler = {
  command: ['kick', 'expulsar', 'ban'],
  tags: ['grupo', 'admin'],
  help: ['kick @usuario [@otro...] - Expulsa a los mencionados'],
  group: true,
  admin: true,
  botAdmin: true,
  handler: (ctx) => moderate(ctx, 'kick'),
};

/** @deprecated plugins/index.ts debe registrar promotePlugin, demotePlugin y kickPlugin desde ENTRIES.grupos. */
export function registerGroupAdminPlugins(handler: MessageHandler): void {
  handler.registerPlugin('group-promote', promotePlugin);
  handler.registerPlugin('group-demote', demotePlugin);
  handler.registerPlugin('group-kick', kickPlugin);
}
