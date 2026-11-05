import { areJidsSameUser, type proto } from 'baileys';
import type { PluginHandler, MessageContext } from '../types/message.js';
import { getBotIds } from '../lib/participants.js';

type DeleteContext = Pick<MessageContext, 'conn' | 'handler'>;

/** Borra un mensaje vía handler.deleteMessage, que además hace que anti-delete lo olvide. */
export async function deleteByKey(ctx: DeleteContext, chat: string, key: proto.IMessageKey): Promise<boolean> {
  return ctx.handler.deleteMessage(chat, key);
}

/** Envía un aviso que se borra solo pasados `ms`. No se rastrea para /clear. */
export async function replyTemp(ctx: Pick<MessageContext, 'conn' | 'handler' | 'm'>, text: string, ms = 5000, mentions?: string[]): Promise<void> {
  const sent = await ctx.conn.sendMessage(ctx.m.chat, mentions?.length ? { text, mentions } : { text });
  if (!sent?.key) return;
  setTimeout(() => {
    void deleteByKey(ctx, ctx.m.chat, sent.key);
  }, ms);
}

export const deletePlugin: PluginHandler = {
  command: ['delete', 'del', 'eliminar', 'borrar'],
  tags: ['grupo', 'admin'],
  help: ['delete - Responde a un mensaje para eliminarlo'],
  group: true,
  admin: true,
  botAdmin: true,

  handler: async (ctx) => {
    const { m, usedPrefix } = ctx;
    if (!m.quoted) {
      await m.reply(`❌ Responde al mensaje que quieres eliminar con ${usedPrefix}delete.`);
      return;
    }

    const quotedKey = m.quoted.key;
    if (!quotedKey.id) {
      await m.reply('❌ No pude obtener información del mensaje.');
      return;
    }

    // El serializador marca fromMe=false en toda cita; un mensaje del propio bot solo se borra con fromMe=true.
    const fromBot = getBotIds(ctx).some((id) => areJidsSameUser(id, m.quoted?.sender));
    const ok = await deleteByKey(ctx, m.chat, {
      remoteJid: m.chat,
      fromMe: fromBot || Boolean(quotedKey.fromMe),
      id: quotedKey.id,
      participant: fromBot ? undefined : quotedKey.participant,
    });

    if (ok) await m.react('✅');
    else await m.reply('❌ No pude eliminar ese mensaje. Puede que sea muy antiguo o no tenga permisos.');
  },
};

const CLEAR_BATCH = 5;
const CLEAR_BATCH_PAUSE_MS = 500;

export const clearPlugin: PluginHandler = {
  command: ['clear', 'limpiar', 'clean'],
  tags: ['grupo', 'admin'],
  help: [
    'clear - Borra los mensajes recientes del bot y los comandos (última hora)',
    'clear <n> - Borra solo los últimos n mensajes rastreados',
  ],
  group: true,
  admin: true,
  botAdmin: true,
  untracked: true,

  handler: async (ctx) => {
    const { m, handler, text } = ctx;
    await m.react('🧹');

    const tracked = handler.getTrackedMessages(m.chat);
    const requested = parseInt(text.trim(), 10);
    const toDelete = Number.isFinite(requested) && requested > 0 ? tracked.slice(-requested) : [...tracked];

    await deleteByKey(ctx, m.chat, m.key);

    if (toDelete.length === 0) {
      await replyTemp(ctx, '🧹 No hay mensajes recientes para limpiar.\n\n_Los mensajes se rastrean durante 1 hora._', 4000);
      return;
    }

    let cleaned = 0;
    let failed = 0;
    // Todo lo intentado sale del rastreo, también lo que falló: reintentarlo no va a funcionar mejor.
    const processed = new Set<string>();
    for (let i = 0; i < toDelete.length; i += CLEAR_BATCH) {
      const batch = toDelete.slice(i, i + CLEAR_BATCH);
      const results = await Promise.all(batch.map((t) => deleteByKey(ctx, m.chat, t.key)));
      results.forEach((ok, idx) => {
        if (ok) cleaned++;
        else failed++;
        const id = batch[idx].key.id;
        if (id) processed.add(id);
      });
      if (i + CLEAR_BATCH < toDelete.length) await new Promise((r) => setTimeout(r, CLEAR_BATCH_PAUSE_MS));
    }

    // Solo salen del rastreo los procesados; el resto conserva su marca de tiempo.
    handler.removeTrackedMessages(m.chat, [...processed]);
    const remaining = handler.getTrackedMessages(m.chat);

    await replyTemp(
      ctx,
      `🧹 *Limpieza completada*\n\n✅ Eliminados: *${cleaned}*` +
      (failed > 0 ? `\n⚠️ No eliminados: *${failed}* (muy antiguos o ya borrados)` : '') +
      (remaining.length > 0 ? `\n📌 Siguen rastreados: ${remaining.length}` : ''),
      4000,
    );
  },
};
