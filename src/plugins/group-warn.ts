import type { PluginHandler, MessageContext } from '../types/message.js';
import type { ChatSettings } from '../types/database.js';
import { getDatabase } from '../lib/database.js';
import { mentionTag, msToTime } from '../lib/utils.js';
import { resolveTarget, assertCanModerate, removeParticipant } from '../lib/participants.js';
import { getMaxWarnings, SYSTEM_WARNER } from '../lib/moderation.js';
import { replyTemp } from './group-delete.js';

const MAX_WARN_LIMIT = 20;

async function sendMention(ctx: MessageContext, text: string, mentions: string[]): Promise<void> {
  const sent = await ctx.conn.sendMessage(ctx.m.chat, { text, mentions }, { quoted: ctx.m.rawMessage });
  if (sent?.key) ctx.handler.trackMessage(ctx.m.chat, sent.key);
}

/** Razón escrita tras la mención o el número: se quitan las menciones y los números sueltos. */
function extractReason(text: string): string {
  return text.replace(/@\d+/g, '').replace(/(?:^|\s)\+?\d{7,16}(?=\s|$)/g, ' ').replace(/\s+/g, ' ').trim();
}

function relativeTime(timestamp: number, now = Date.now()): string {
  const elapsed = now - timestamp;
  return elapsed < 60_000 ? 'hace un momento' : `hace ${msToTime(elapsed)}`;
}

export const warnPlugin: PluginHandler = {
  command: ['warn', 'advertir'],
  description: 'Advertir a un usuario del grupo',
  category: 'group',
  help: ['warn @usuario [razón] - Advierte a un usuario; al llegar al máximo se le expulsa'],
  group: true,
  admin: true,
  botAdmin: true,

  async handler(ctx: MessageContext) {
    const { m, text, conn, usedPrefix } = ctx;
    const db = getDatabase();

    const target = resolveTarget(ctx, { allowNumber: true, allowSelf: true });
    if (!target) {
      await m.reply(`⚠️ Menciona o cita a un usuario.\n\n📝 Uso: ${usedPrefix}warn @usuario [razón]`);
      return;
    }
    const denied = assertCanModerate(ctx, target, 'warn');
    if (denied) {
      await m.reply(`❌ ${denied}`);
      return;
    }

    const reason = extractReason(text) || 'Sin razón especificada';
    const max = getMaxWarnings(db.getChatSettings(m.chat));
    const count = db.addWarning(m.chat, { odBy: m.sender, odTo: target, reason, timestamp: Date.now() });
    const tag = mentionTag(target);

    if (count >= max) {
      const kicked = await removeParticipant(conn, m.chat, target);
      if (kicked) {
        db.clearWarnings(m.chat, target);
        await sendMention(ctx, `🚫 ${tag} expulsado por acumular ${max} advertencias.\n📝 Última: ${reason}`, [target]);
      } else {
        await sendMention(ctx, `⚠️ ${tag} llegó a ${count}/${max} advertencias, pero no pude expulsarlo (¿es admin?). El conteo se conserva.`, [target]);
      }
      return;
    }

    if (ctx.handler.isCompactMode(m.chat)) {
      await m.react('⚠️');
      await replyTemp(ctx, `⚠️ ${tag} ${count}/${max}`, 5000, [target]);
      return;
    }
    await sendMention(
      ctx,
      `⚠️ *ADVERTENCIA ${count}/${max}*\n\n👤 Usuario: ${tag}\n📝 Razón: ${reason}\n\n` +
      `⚡ ${max - count} advertencia(s) más y será expulsado.`,
      [target],
    );
  },
};

export const unwarnPlugin: PluginHandler = {
  command: ['unwarn', 'quitarwarn'],
  description: 'Quitar una advertencia a un usuario',
  category: 'group',
  help: ['unwarn @usuario - Quita la advertencia más antigua'],
  group: true,
  admin: true,

  async handler(ctx: MessageContext) {
    const { m, usedPrefix } = ctx;
    const db = getDatabase();

    const target = resolveTarget(ctx, { allowNumber: true, allowSelf: true });
    if (!target) {
      await m.reply(`⚠️ Menciona o cita a un usuario.\n\n📝 Uso: ${usedPrefix}unwarn @usuario`);
      return;
    }

    if (!db.removeWarning(m.chat, target)) {
      await m.react('ℹ️');
      await m.reply('ℹ️ Ese usuario no tiene advertencias.');
      return;
    }

    const remaining = db.getWarnings(m.chat, target).length;
    if (ctx.handler.isCompactMode(m.chat)) {
      await m.react('✅');
      return;
    }
    const max = getMaxWarnings(db.getChatSettings(m.chat));
    await sendMention(ctx, `✅ Se quitó una advertencia a ${mentionTag(target)}.\n\n📊 Advertencias restantes: ${remaining}/${max}`, [target]);
  },
};

export const listWarnPlugin: PluginHandler = {
  command: ['listwarn', 'warns', 'advertencias'],
  description: 'Ver advertencias del grupo o de un usuario',
  category: 'group',
  help: ['warns - Usuarios con advertencias', 'warns @usuario - Detalle: razón, cuándo y quién'],
  group: true,
  admin: true,

  async handler(ctx: MessageContext) {
    const { m, usedPrefix } = ctx;
    const db = getDatabase();
    const max = getMaxWarnings(db.getChatSettings(m.chat));
    const target = resolveTarget(ctx, { allowNumber: true, allowSelf: true });

    if (target) {
      const warnings = db.getWarnings(m.chat, target);
      if (warnings.length === 0) {
        await sendMention(ctx, `✅ ${mentionTag(target)} no tiene advertencias.`, [target]);
        return;
      }
      const mentions = new Set<string>([target]);
      const lines = warnings.map((w, i) => {
        const by = w.odBy === SYSTEM_WARNER || !w.odBy.includes('@') ? 'sistema' : mentionTag(w.odBy);
        if (by !== 'sistema') mentions.add(w.odBy);
        return `${i + 1}. ${w.reason}\n   🕒 ${relativeTime(w.timestamp)} · 👮 ${by}`;
      });
      await sendMention(ctx, `⚠️ *Advertencias de ${mentionTag(target)}: ${warnings.length}/${max}*\n\n${lines.join('\n')}`, [...mentions]);
      return;
    }

    const allWarnings = db.getAllWarnings(m.chat);
    if (allWarnings.length === 0) {
      await m.reply('✅ No hay usuarios con advertencias en este grupo.');
      return;
    }

    const byUser = new Map<string, number>();
    for (const w of allWarnings) byUser.set(w.odTo, (byUser.get(w.odTo) ?? 0) + 1);

    const lines = [...byUser.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([jid, count]) => `👤 ${mentionTag(jid)}: ${count}/${max}`);
    await sendMention(
      ctx,
      `⚠️ *USUARIOS CON ADVERTENCIAS*\n\n${lines.join('\n')}\n\n_Detalle: ${usedPrefix}warns @usuario_`,
      [...byUser.keys()],
    );
  },
};

export const clearWarnPlugin: PluginHandler = {
  command: ['clearwarn', 'limpiarwarn'],
  description: 'Limpiar todas las advertencias de un usuario',
  category: 'group',
  help: ['clearwarn @usuario - Borra todas sus advertencias'],
  group: true,
  admin: true,

  async handler(ctx: MessageContext) {
    const { m, usedPrefix } = ctx;
    const db = getDatabase();

    const target = resolveTarget(ctx, { allowNumber: true, allowSelf: true });
    if (!target) {
      await m.reply(`⚠️ Menciona o cita a un usuario.\n\n📝 Uso: ${usedPrefix}clearwarn @usuario`);
      return;
    }

    const removed = db.clearWarnings(m.chat, target);
    if (removed === 0) {
      await m.reply('ℹ️ Ese usuario no tiene advertencias.');
      return;
    }
    if (ctx.handler.isCompactMode(m.chat)) {
      await m.react('🧹');
      return;
    }
    await sendMention(ctx, `✅ Se eliminaron ${removed} advertencia(s) de ${mentionTag(target)}.`, [target]);
  },
};

export const setWarnsPlugin: PluginHandler = {
  command: ['setwarns', 'maxwarns'],
  description: 'Cuántas advertencias llevan a la expulsión en este grupo',
  category: 'group',
  help: [`setwarns <n> - Advertencias para expulsar (1-${MAX_WARN_LIMIT})`],
  group: true,
  admin: true,

  async handler(ctx: MessageContext) {
    const { m, args, usedPrefix } = ctx;
    const db = getDatabase();
    const current = getMaxWarnings(db.getChatSettings(m.chat));
    const requested = parseInt(args[0] ?? '', 10);

    if (!Number.isInteger(requested) || requested < 1 || requested > MAX_WARN_LIMIT) {
      await m.reply(`⚠️ *Límite de advertencias:* ${current}\n\n📝 Uso: ${usedPrefix}setwarns <1-${MAX_WARN_LIMIT}>`);
      return;
    }

    db.updateChatSettings(m.chat, { maxWarnings: requested } as Partial<ChatSettings>);
    await m.reply(`✅ A partir de ahora se expulsa a la advertencia número *${requested}*.`);
  },
};
