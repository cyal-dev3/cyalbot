import type { PluginHandler, MessageContext } from '../types/message.js';
import type { MessageHandler } from '../handler.js';
import { getDatabase } from '../lib/database.js';
import { getTargetUserOrSelf, mentionTag, normalizeText } from '../lib/utils.js';
import { nameOf } from '../lib/social.js';

const LOVE_MESSAGES: { max: number; emoji: string; message: string }[] = [
  { max: 10, emoji: '💔', message: '¡Uy! Mejor búscate a alguien más...' },
  { max: 20, emoji: '😢', message: 'Esto no pinta bien para ustedes...' },
  { max: 30, emoji: '😕', message: 'Hay mejores opciones por ahí...' },
  { max: 40, emoji: '🤔', message: 'Podría funcionar... con mucho trabajo.' },
  { max: 50, emoji: '😐', message: 'Ni fu ni fa, suerte del 50/50.' },
  { max: 60, emoji: '🙂', message: '¡Hay potencial! No está mal.' },
  { max: 70, emoji: '😊', message: '¡Buena química! Podrían ser buenos juntos.' },
  { max: 80, emoji: '😍', message: '¡Wow! Hacen muy buena pareja.' },
  { max: 90, emoji: '💖', message: '¡Casi perfectos! ¡Deberían salir!' },
  { max: 99, emoji: '💘', message: '¡INCREÍBLE! ¡Almas gemelas!' },
  { max: 100, emoji: '💯', message: '¡¡¡COMPATIBILIDAD PERFECTA!!! ¡El amor verdadero!' },
];

/** FNV-1a de 32 bits: estable entre reinicios y sin depender del orden de los nombres. */
export function stableHash(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/** Porcentaje 0-100 determinista para una pareja (misma salida en cualquier orden). */
export function lovePercentage(a: string, b: string): number {
  const key = [normalizeText(a), normalizeText(b)].sort().join('|');
  return stableHash(key) % 101;
}

function loveBar(percentage: number): string {
  const filled = Math.floor(percentage / 10);
  return '💗'.repeat(filled) + '🖤'.repeat(10 - filled);
}

interface Pair {
  /** Identidad para el hash: JID completo si es un usuario, nombre si es texto. */
  idA: string;
  idB: string;
  labelA: string;
  labelB: string;
  mentions: string[];
}

function resolvePair(ctx: MessageContext): Pair | null {
  const { m, text } = ctx;
  const db = getDatabase();
  const people = m.mentionedJid.filter((j) => !j.endsWith('@g.us'));
  if (people.length >= 2) {
    return { idA: people[0], idB: people[1], labelA: mentionTag(people[0]), labelB: mentionTag(people[1]), mentions: people.slice(0, 2) };
  }
  const target = getTargetUserOrSelf(m);
  if (target !== m.sender) {
    return { idA: m.sender, idB: target, labelA: mentionTag(m.sender), labelB: mentionTag(target), mentions: [m.sender, target] };
  }
  const names = text.split(/\s+(?:y|&|con)\s+|\s*,\s*/i).map((n) => n.trim()).filter(Boolean);
  if (names.length >= 2) return { idA: names[0], idB: names[1], labelA: names[0], labelB: names[1], mentions: [] };
  if (names.length === 1) {
    return { idA: m.sender, idB: names[0], labelA: nameOf(m.sender, m.pushName, db), labelB: names[0], mentions: [] };
  }
  return null;
}

export const amorPlugin: PluginHandler = {
  command: ['amor', 'love', 'ship', 'compatibilidad'],
  description: 'Calcular compatibilidad amorosa entre dos personas',
  category: 'fun',
  usage: ['amor @usuario', 'amor @usuario1 @usuario2', 'amor Juan y María'],
  async handler(ctx) {
    const pair = resolvePair(ctx);
    if (!pair) {
      const p = ctx.usedPrefix || '/';
      await ctx.m.reply(`💕 *Calculadora de amor*\n• ${p}amor @usuario\n• ${p}amor @usuario1 @usuario2\n• ${p}amor Nombre1 y Nombre2\n• Cita un mensaje + ${p}amor`);
      return;
    }
    const percentage = lovePercentage(pair.idA, pair.idB);
    const { emoji, message } = LOVE_MESSAGES.find((l) => percentage <= l.max) ?? LOVE_MESSAGES[LOVE_MESSAGES.length - 1];
    const text = `💕 *Calculadora de amor*\n\n👤 ${pair.labelA}\n❤️ + ❤️\n👤 ${pair.labelB}\n\n${loveBar(percentage)}\n\n${emoji} *Compatibilidad:* ${percentage}%\n💬 ${message}`;
    await ctx.conn.sendMessage(ctx.m.chat, { text, mentions: pair.mentions }, { quoted: ctx.m.rawMessage });
  },
};

export const gayPlugin: PluginHandler = {
  command: ['gay', 'gaytest'],
  description: 'Test de gayedad (broma)',
  category: 'fun',
  usage: ['gay', 'gay @usuario'],
  async handler(ctx) {
    const { m } = ctx;
    const target = getTargetUserOrSelf(m);
    const percentage = stableHash(`gay|${target}`) % 101;
    const bar = '🏳️‍🌈'.repeat(Math.floor(percentage / 20)) + '⬜'.repeat(5 - Math.floor(percentage / 20));
    const text = `🏳️‍🌈 *Gay test*\n\n👤 ${mentionTag(target)}\n\n${bar}\n\n📊 *Resultado:* ${percentage}%`;
    await ctx.conn.sendMessage(m.chat, { text, mentions: [target] }, { quoted: m.rawMessage });
  },
};

export function registerAmor(handler: MessageHandler): void {
  handler.registerPlugin('fun-amor', amorPlugin);
  handler.registerPlugin('fun-gay', gayPlugin);
}
