import * as fs from 'node:fs';
import * as path from 'node:path';
import type { PluginHandler, MessageContext } from '../types/message.js';
import type { MessageHandler } from '../handler.js';
import { getDatabase } from '../lib/database.js';
import { getTargetUser, mentionTag, msToTime, pickRandom } from '../lib/utils.js';
import { createInteractionPlugin, nameOf } from '../lib/social.js';

// ---------------------------------------------------------------------------
// Abrazo
// ---------------------------------------------------------------------------

export const abrazoPlugin = createInteractionPlugin({
  command: ['abrazo', 'hug', 'abrazar', 'apapacho'],
  description: 'Dale un abrazo a alguien especial',
  kind: 'hug',
  title: '¡ABRAZO!',
  noun: 'Abrazos',
  types: [
    { emoji: '🤗', desc: 'un abrazo cálido y reconfortante' },
    { emoji: '🫂', desc: 'un abrazo fuerte y protector' },
    { emoji: '💕', desc: 'un abrazo tierno y dulce' },
    { emoji: '🥰', desc: 'un abrazo lleno de cariño' },
    { emoji: '😊', desc: 'un abrazo amistoso' },
    { emoji: '🌟', desc: 'un abrazo muy especial' },
    { emoji: '✨', desc: 'un abrazo mágico que ilumina el día' },
    { emoji: '🐻', desc: 'un abrazo de oso gigante' },
  ],
  milestones: {
    1: '¡Primer abrazo! El inicio de una bonita amistad...',
    10: '¡10 abrazos! Son muy buenos amigos',
    50: '¡50 abrazos! Mejores amigos confirmados',
    100: '¡100 abrazos! Amistad legendaria',
  },
  selfReply: '🤗 *Te das un auto-abrazo*\n\n_A veces uno mismo es su mejor compañía..._',
  usage: '🤗 *Abrazos*\n• {p}abrazo @usuario\n• Cita un mensaje + {p}abrazo',
});

// ---------------------------------------------------------------------------
// Kissall: un beso simbólico a los registrados del grupo
// ---------------------------------------------------------------------------

const KISSALL_COOLDOWN_MS = 60 * 60_000;
const KISSALL_MAX_MENTIONS = 20;
const kissallLast = new Map<string, number>();

export const kissallPlugin: PluginHandler = {
  command: ['kissall', 'besartodos', 'besoatodos'],
  description: 'Da un beso a los registrados del grupo (una vez por hora)',
  category: 'fun',
  group: true,
  register: true,
  async handler(ctx) {
    const { m } = ctx;
    const last = kissallLast.get(m.sender) ?? 0;
    if (Date.now() - last < KISSALL_COOLDOWN_MS) {
      await m.reply(`💋 Ya repartiste besos hace poco. Vuelve en ${msToTime(KISSALL_COOLDOWN_MS - (Date.now() - last))}.`);
      return;
    }
    const db = getDatabase();
    const participants = ctx.participants ?? (await ctx.conn.groupMetadata(m.chat)).participants.map((p) => p.id);
    const kissed = participants.filter((jid) => jid !== m.sender && db.hasUser(jid) && db.getUser(jid).registered);
    if (kissed.length === 0) {
      await m.reply('😢 No hay otros usuarios registrados en el grupo para besar.');
      return;
    }
    kissallLast.set(m.sender, Date.now());
    // Cuenta como un solo beso dado en el ranking; cada receptor recibe uno.
    const giver = db.getUser(m.sender);
    giver.kissStats.totalGiven += 1;
    for (const jid of kissed) db.getUser(jid).kissStats.totalReceived += 1;
    db.markDirty();

    const mentioned = kissed.slice(0, KISSALL_MAX_MENTIONS);
    const rest = kissed.length - mentioned.length;
    const text = `💋 *¡Beso masivo!*\n\n${mentionTag(m.sender)} le dio un beso a *${kissed.length}* personas:\n${mentioned.map(mentionTag).join(' ')}${rest > 0 ? ` y ${rest} más` : ''}\n\n_¡Mucho amor en este grupo!_ 💕`;
    await ctx.conn.sendMessage(m.chat, { text, mentions: [m.sender, ...mentioned] }, { quoted: m.rawMessage });
  },
};

// ---------------------------------------------------------------------------
// Buenos días
// ---------------------------------------------------------------------------

const GOOD_MORNING = [
  'Buenos días {target}, espero que tengas un día increíble!',
  'Buen día {target}! Que la fuerza te acompañe hoy!',
  'Despierta {target}! El mundo te necesita hoy!',
  'Buenos días {target}! Arriba esas vibras!',
  'Hey {target}! Buenos días, crack!',
  'Wakey wakey {target}! Es hora de brillar!',
  'Gud mornin {target}! Hoy va a ser un gran día!',
  'Buenos días {target}! A romperla hoy!',
];

export const gudmorninPlugin: PluginHandler = {
  command: ['gudmornin', 'buenosdias', 'gm', 'goodmorning'],
  description: 'Desea buenos días a alguien o al grupo',
  category: 'fun',
  async handler(ctx) {
    const { m } = ctx;
    const target = getTargetUser(m);
    const message = pickRandom(GOOD_MORNING).replace('{target}', target ? mentionTag(target) : 'a todos');
    const text = `☀️ *Buenos días*\n\n${mentionTag(m.sender)} dice:\n"${message}"\n\n🌅 _Que tengan un excelente día!_`;
    await ctx.conn.sendMessage(m.chat, { text, mentions: target ? [m.sender, target] : [m.sender] }, { quoted: m.rawMessage });
  },
};

// ---------------------------------------------------------------------------
// Poka y ctm con frases personalizables por grupo
// ---------------------------------------------------------------------------

const DEFAULT_POKA = [
  '🥫💰 *{name}* está pidiendo limosna...\n\n_"Una monedita para el taco, jefe..."_',
  '🥫🪙 *{name}* sacó su latita...\n\n_"Cualquier cosa ayuda, mi buen..."_',
  '🥫💵 *{name}* extiende la mano...\n\n_"Pa\' la coca, carnal..."_',
  '🥫🤲 *{name}* hace cara de perrito triste...\n\n_"Ando bien poka, ayuda..."_',
  '🥫😢 *{name}* muestra su cartera vacía...\n\n_"No me alcanza ni pa\'l camión..."_',
];

const INSULTS: { flag: string; lang: string; lines: string[] }[] = [
  { flag: '🇲🇽', lang: 'Español', lines: ['¡Chinga tu madre, {target}!', '¡Vete a la verga, {target}!', '¡Que te folle un pez, {target}!'] },
  { flag: '🇺🇸', lang: 'English', lines: ['Go f*ck yourself, {target}!', 'Screw you, {target}!', 'Kiss my a**, {target}!'] },
  { flag: '🇫🇷', lang: 'Français', lines: ['Va te faire foutre, {target}!', 'Nique ta mère, {target}!', 'Casse-toi, {target}!'] },
  { flag: '🇩🇪', lang: 'Deutsch', lines: ['Leck mich am Arsch, {target}!', 'Verpiss dich, {target}!', 'Du Hurensohn, {target}!'] },
  { flag: '🇮🇹', lang: 'Italiano', lines: ['Vaffanculo, {target}!', 'Figlio di puttana, {target}!', 'Vai a farti fottere, {target}!'] },
];

type PhraseSet = 'poka' | 'ctm';
const PHRASE_FIELD: Record<PhraseSet, 'customPoka' | 'customCtm'> = { poka: 'customPoka', ctm: 'customCtm' };
const MAX_PHRASES = 30;
const MAX_PHRASE_LENGTH = 300;

function customPhrases(ctx: MessageContext, set: PhraseSet): string[] {
  if (!ctx.m.isGroup) return [];
  return getDatabase().getChatSettings(ctx.m.chat)[PHRASE_FIELD[set]] ?? [];
}

export const pokaPlugin: PluginHandler = {
  command: ['poka', 'limosna', 'pobre'],
  description: 'Pide limosna con estilo',
  category: 'fun',
  async handler(ctx) {
    const custom = customPhrases(ctx, 'poka');
    const name = nameOf(ctx.m.sender, ctx.m.pushName);
    await ctx.m.reply(pickRandom(custom.length > 0 ? custom : DEFAULT_POKA).replace(/\{name\}/g, name));
  },
};

export const chingatumadrePlugin: PluginHandler = {
  command: ['chingatumadre', 'ctm', 'fuck', 'insultar'],
  description: 'Insulta a alguien en 5 idiomas',
  category: 'fun',
  async handler(ctx) {
    const { m } = ctx;
    const target = getTargetUser(m);
    if (!target) {
      await m.reply(`🤬 Uso: *${ctx.usedPrefix || '/'}ctm @usuario*\n_Porque a veces las palabras duelen más en varios idiomas..._`);
      return;
    }
    const custom = customPhrases(ctx, 'ctm');
    const senderTag = mentionTag(m.sender);
    const targetTag = mentionTag(target);
    const text = custom.length > 0
      ? pickRandom(custom).replace(/\{name\}/g, senderTag).replace(/\{target\}/g, targetTag)
      : `🤬 ${senderTag} le menta la madre a ${targetTag} en 5 idiomas:\n\n`
        + INSULTS.map((i) => `${i.flag} *${i.lang}:*\n${pickRandom(i.lines).replace('{target}', targetTag)}`).join('\n\n');
    await ctx.conn.sendMessage(m.chat, { text, mentions: [m.sender, target] }, { quoted: m.rawMessage });
  },
};

export const hazanaPlugin: PluginHandler = {
  command: ['hazana', 'hazaña', 'carlitos', 'feria'],
  description: 'Muestra el sticker de Carlitos ganando feria',
  category: 'fun',
  async handler(ctx) {
    const { m, conn } = ctx;
    const stickerPath = path.join(process.cwd(), 'assets', 'stickers', 'carlitos.webp');
    if (fs.existsSync(stickerPath)) {
      await conn.sendMessage(m.chat, { sticker: fs.readFileSync(stickerPath) }, { quoted: m.rawMessage });
      return;
    }
    await m.reply('🏆💰 *¡Hazaña legendaria!*\n\nCarlitos acaba de ganar un chingo de feria!\n🎰 JACKPOT 🎰\n\n_Falta el sticker: coloca carlitos.webp en assets/stickers/_');
  },
};

/**
 * Texto del mensaje tras el prefijo y las primeras `skip` palabras. Se toma de
 * m.text (no de args) para conservar saltos de línea en las frases guardadas.
 */
function textAfter(ctx: MessageContext, skip: number): string {
  const body = ctx.m.text.slice(ctx.usedPrefix.length).trimStart();
  const match = body.match(new RegExp(`^(?:\\S+\\s+){${skip}}`));
  return match ? body.slice(match[0].length).trim() : '';
}

async function runFrases(ctx: MessageContext, set: string, action: string, rest: string): Promise<void> {
  const { m } = ctx;
  const p = ctx.usedPrefix || '/';
  if (set !== 'poka' && set !== 'ctm') {
    await m.reply(`📝 *Frases*\n• ${p}frases poka list\n• ${p}frases ctm add <texto> ({name} y {target})\n• ${p}frases poka del <n>\n• ${p}frases ctm clear\n\nAñadir, borrar y limpiar es solo para admins.`);
    return;
  }
  const db = getDatabase();
  const field = PHRASE_FIELD[set];
  const phrases = [...(db.getChatSettings(m.chat)[field] ?? [])];

  if (action === 'list' || action === 'ver') {
    if (phrases.length === 0) {
      await m.reply(`📋 Sin frases personalizadas para ${set}; se usan las de serie. Añade con *${p}frases ${set} add <texto>*.`);
      return;
    }
    await m.reply(`📋 *Frases de ${set}* (${phrases.length}/${MAX_PHRASES})\n\n${phrases.map((f, i) => `${i + 1}. ${f}`).join('\n\n')}`);
    return;
  }
  if (!ctx.isAdmin && !ctx.isOwner) {
    await m.reply('❌ Solo los administradores pueden cambiar las frases.');
    return;
  }
  if (action === 'add' || action === 'agregar') {
    const phrase = rest.trim();
    if (!phrase) {
      await m.reply(`Uso: *${p}frases ${set} add <texto>*. Variables: {name}${set === 'ctm' ? ' y {target}' : ''}.`);
      return;
    }
    if (phrase.length > MAX_PHRASE_LENGTH) {
      await m.reply(`❌ Máximo ${MAX_PHRASE_LENGTH} caracteres por frase.`);
      return;
    }
    if (phrases.length >= MAX_PHRASES) {
      await m.reply(`❌ Ya hay ${MAX_PHRASES} frases; borra alguna con *${p}frases ${set} del <n>*.`);
      return;
    }
    phrases.push(phrase);
    db.updateChatSettings(m.chat, { [field]: phrases });
    await m.reply(`✅ Frase ${phrases.length} añadida a ${set}.`);
    return;
  }
  if (action === 'del' || action === 'borrar') {
    const index = parseInt(rest, 10) - 1;
    if (!(index >= 0 && index < phrases.length)) {
      await m.reply(phrases.length === 0 ? 'No hay frases que borrar.' : `❌ Indica un número del 1 al ${phrases.length}.`);
      return;
    }
    const [removed] = phrases.splice(index, 1);
    db.updateChatSettings(m.chat, { [field]: phrases });
    await m.reply(`✅ Frase eliminada: "${removed}". Quedan ${phrases.length}.`);
    return;
  }
  if (action === 'clear' || action === 'limpiar') {
    db.updateChatSettings(m.chat, { [field]: [] });
    await m.reply(`✅ Frases de ${set} borradas; vuelven las de serie.`);
    return;
  }
  await m.reply(`Acciones: list, add <texto>, del <n>, clear. Ej: *${p}frases ${set} list*`);
}

/** `frases <poka|ctm> add <texto> | list | del <n> | clear` */
export const frasesPlugin: PluginHandler = {
  command: ['frases'],
  description: 'Frases personalizadas de poka y ctm del grupo',
  category: 'fun',
  group: true,
  usage: ['frases poka list', 'frases ctm add 🤬 {name} le dice a {target}...', 'frases poka del 2', 'frases ctm clear'],
  handler: (ctx) => runFrases(ctx, (ctx.args[0] ?? '').toLowerCase(), (ctx.args[1] ?? 'list').toLowerCase(), textAfter(ctx, 3)),
};

/** Alias viejos (addpoka, delctm...) como atajos de `frases`; no copian ctx para no disparar el getter perezoso `user`. */
function frasesShortcut(aliases: string[], set: PhraseSet, action: string): PluginHandler {
  return {
    command: aliases,
    description: `Atajo de frases ${set} ${action}`,
    category: 'fun',
    group: true,
    handler: (ctx) => runFrases(ctx, set, action, textAfter(ctx, 1)),
  };
}

export const addPokaPlugin = frasesShortcut(['addpoka', 'agregarpoka'], 'poka', 'add');
export const listPokaPlugin = frasesShortcut(['listpoka', 'verpoka', 'frasespoka'], 'poka', 'list');
export const delPokaPlugin = frasesShortcut(['delpoka', 'borrarpoka', 'removepoka'], 'poka', 'del');
export const clearPokaPlugin = frasesShortcut(['clearpoka', 'limpiarpoka', 'resetpoka'], 'poka', 'clear');
export const addCtmPlugin = frasesShortcut(['addctm', 'agregarctm'], 'ctm', 'add');
export const listCtmPlugin = frasesShortcut(['listctm', 'verctm', 'frasesctm'], 'ctm', 'list');
export const delCtmPlugin = frasesShortcut(['delctm', 'borrarctm', 'removectm'], 'ctm', 'del');
export const clearCtmPlugin = frasesShortcut(['clearctm', 'limpiarctm', 'resetctm'], 'ctm', 'clear');

export function registerSocial(handler: MessageHandler): void {
  const entries: [string, PluginHandler][] = [
    ['fun-abrazo', abrazoPlugin], ['fun-kissall', kissallPlugin], ['fun-gudmornin', gudmorninPlugin],
    ['fun-poka', pokaPlugin], ['fun-chingatumadre', chingatumadrePlugin], ['fun-hazana', hazanaPlugin],
    ['fun-frases', frasesPlugin],
    ['fun-addpoka', addPokaPlugin], ['fun-listpoka', listPokaPlugin], ['fun-delpoka', delPokaPlugin], ['fun-clearpoka', clearPokaPlugin],
    ['fun-addctm', addCtmPlugin], ['fun-listctm', listCtmPlugin], ['fun-delctm', delCtmPlugin], ['fun-clearctm', clearCtmPlugin],
  ];
  for (const [name, plugin] of entries) handler.registerPlugin(name, plugin);
}
