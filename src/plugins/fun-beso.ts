import type { PluginHandler } from '../types/message.js';
import type { MessageHandler } from '../handler.js';
import { getDatabase } from '../lib/database.js';
import { mentionTag } from '../lib/utils.js';
import { createInteractionPlugin, interactionStats, nameOf } from '../lib/social.js';

const KISS_TYPES = [
  { emoji: '😗', desc: 'un besito tierno en la mejilla' },
  { emoji: '😚', desc: 'un dulce beso en la frente' },
  { emoji: '😘', desc: 'un beso coqueto volado' },
  { emoji: '💋', desc: 'un beso apasionado' },
  { emoji: '😍', desc: 'un beso lleno de amor' },
  { emoji: '🥰', desc: 'un beso súper cariñoso' },
  { emoji: '😏', desc: 'un beso travieso' },
  { emoji: '🫦', desc: 'un beso MUY intenso' },
  { emoji: '💕', desc: 'un beso romántico de película' },
  { emoji: '✨', desc: 'un beso mágico que hace brillar todo' },
];

const MILESTONES: Record<number, string> = {
  1: '¡Primer beso! El inicio de algo especial...',
  5: '¡Ya van 5 besos! Parece que hay química...',
  10: '¡10 besos! Esto se está poniendo serio...',
  25: '¡25 besos! ¿Ya son novios o qué?',
  50: '¡50 BESOS! Son la pareja del grupo',
  100: '¡¡100 BESOS!! Amor verdadero confirmado',
  200: '¡¡¡200 BESOS!!! Leyendas del romance',
  500: '¡¡¡500 BESOS!!! Almas gemelas eternas',
  1000: '¡¡¡1000 BESOS!!! Récord mundial de amor',
};

const RELATION_TITLES: [number, string][] = [
  [1000, '💍 Almas Gemelas Eternas'], [500, '💖 Amor Verdadero'], [200, '💕 Pareja Legendaria'], [100, '💗 Enamorados'],
  [50, '💓 Novios del Grupo'], [25, '💞 Crush Confirmado'], [10, '💘 Hay Química'], [5, '💝 Coqueteo'],
];

export function relationshipTitle(count: number): string {
  return RELATION_TITLES.find(([min]) => count >= min)?.[1] ?? '💋 Conocidos';
}

export const besoPlugin = createInteractionPlugin({
  command: ['beso', 'kiss', 'besito', 'muah'],
  description: 'Dale un beso a alguien especial',
  kind: 'kiss',
  title: '¡BESO!',
  noun: 'Besos',
  types: KISS_TYPES,
  milestones: MILESTONES,
  relationTitle: relationshipTitle,
  selfReply: '😅 No puedes besarte a ti mismo... ¿o sí? 🪞',
  usage: '💋 *Besos*\n• {p}beso @usuario\n• Cita un mensaje + {p}beso\n• {p}misbesos · {p}topbesos',
});

export const misbesosPlugin: PluginHandler = {
  command: ['misbesos', 'mykisses', 'besostats'],
  description: 'Ver tus estadísticas de besos',
  category: 'fun',
  async handler(ctx) {
    const { m } = ctx;
    const db = getDatabase();
    const stats = interactionStats(db, m.sender, 'kiss');
    if (!stats) {
      await m.reply(`💋 Aún no has dado ni recibido besos. Usa *${ctx.usedPrefix || '/'}beso @usuario* para empezar.`);
      return;
    }
    const top = [...stats.history].sort((a, b) => b.count - a.count).slice(0, 3);
    const medals = ['🥇', '🥈', '🥉'];
    const lines = [
      `💋 *Besos de ${nameOf(m.sender, m.pushName, db)}*`,
      `Dados: *${stats.totalGiven}* · Recibidos: *${stats.totalReceived}* · Personas: *${stats.history.length}*`,
    ];
    if (top.length > 0) {
      lines.push('', '🏆 *Favoritos:*');
      top.forEach((r, i) => lines.push(`${medals[i]} ${mentionTag(r.jid)} — ${r.count} besos (${relationshipTitle(r.count)})`));
    }
    await ctx.conn.sendMessage(m.chat, { text: lines.join('\n'), mentions: top.map((r) => r.jid) }, { quoted: m.rawMessage });
  },
};

export const topbesosPlugin: PluginHandler = {
  command: ['topbesos', 'topkiss', 'besucones', 'rankingbesos'],
  description: 'Ranking de besucones del grupo',
  category: 'fun',
  group: true,
  async handler(ctx) {
    const { m } = ctx;
    const db = getDatabase();
    const participants = ctx.participants ?? (await ctx.conn.groupMetadata(m.chat)).participants.map((p) => p.id);
    const ranking = participants
      .map((jid) => ({ jid, stats: interactionStats(db, jid, 'kiss') }))
      .filter((r): r is { jid: string; stats: NonNullable<typeof r.stats> } => r.stats !== null)
      .sort((a, b) => b.stats.totalGiven - a.stats.totalGiven)
      .slice(0, 10);
    if (ranking.length === 0) {
      await m.reply(`💋 Nadie ha dado besos en este grupo. Sé el primero con *${ctx.usedPrefix || '/'}beso @usuario*.`);
      return;
    }
    const medals = ['🥇', '🥈', '🥉'];
    const lines = ranking.map((r, i) =>
      `${medals[i] ?? `${i + 1}.`} ${mentionTag(r.jid)} — 💋 ${r.stats.totalGiven} · 💕 ${r.stats.totalReceived}`);
    await ctx.conn.sendMessage(m.chat, {
      text: `💋 *Ranking de besucones*\n\n${lines.join('\n')}`, mentions: ranking.map((r) => r.jid),
    }, { quoted: m.rawMessage });
  },
};

export function registerBesos(handler: MessageHandler): void {
  handler.registerPlugin('fun-beso', besoPlugin);
  handler.registerPlugin('fun-misbesos', misbesosPlugin);
  handler.registerPlugin('fun-topbesos', topbesosPlugin);
}
