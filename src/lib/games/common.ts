import { randomInt } from 'node:crypto';
import type { proto } from 'baileys';
import type { MessageContext, MessageHandlerInterface, PluginHandler, CommandContext } from '../../types/message.js';
import { getDatabase, type Database } from '../database.js';
import { displayName, mentionTag } from '../utils.js';
import { createLogger } from '../logger.js';
import { CONFIG } from '../../config.js';
import { getConn, setActiveConnection } from './session.js';

const log = createLogger('juegos');

export { mentionTag };

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms).unref());
}

/** Entero aleatorio criptográfico en [min, max]. */
export function rollInt(min: number, max: number): number {
  return randomInt(min, max + 1);
}

export function pickOne<T>(list: readonly T[]): T {
  return list[randomInt(list.length)];
}

/** Fisher-Yates en una sola pasada con crypto.randomInt. */
export function shuffle<T>(list: T[]): T[] {
  for (let i = list.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

/** Nombre legible del jugador: registrado, luego pushName, luego número. */
export function playerName(jid: string, pushName?: string | null, db: Database = getDatabase()): string {
  return displayName(jid, db.hasUser(jid) ? db.getUser(jid).name : null, pushName);
}

// ---------------------------------------------------------------------------
// Envío desde temporizadores (sin ctx) y edición de mensajes
// ---------------------------------------------------------------------------

export async function say(chat: string, text: string, mentions: string[] = []): Promise<proto.IMessageKey | null> {
  const conn = getConn();
  if (!conn) {
    log.warn(`sin conexión activa, no se pudo enviar a ${chat}`);
    return null;
  }
  try {
    const sent = await conn.sendMessage(chat, { text, mentions });
    return sent?.key ?? null;
  } catch (error) {
    log.error(`error al enviar a ${chat}:`, error);
    return null;
  }
}

/** Edita un mensaje enviado por el bot. Si falla (mensaje viejo, sin conexión) devuelve false. */
export async function edit(chat: string, key: proto.IMessageKey | null, text: string, mentions: string[] = []): Promise<boolean> {
  const conn = getConn();
  if (!conn || !key) return false;
  try {
    await conn.sendMessage(chat, { text, mentions, edit: key });
    return true;
  } catch (error) {
    log.debug(`no se pudo editar mensaje en ${chat}:`, error);
    return false;
  }
}

/** Mensaje con menciones citando al autor. */
export async function replyMentions(ctx: MessageContext, text: string, mentions: string[]): Promise<void> {
  await ctx.conn.sendMessage(ctx.m.chat, { text, mentions }, { quoted: ctx.m.rawMessage });
}

// ---------------------------------------------------------------------------
// Entrada a un comando de juego: registra la conexión y comprueba requisitos
// que el handler no aplica a los plugins de contexto.
// ---------------------------------------------------------------------------

export function enter(ctx: MessageContext): void {
  setActiveConnection(ctx.conn);
  attachContexts(ctx.handler);
}

/** Verifica registro en el RPG; responde y devuelve false si no lo está. */
export async function requireRegistered(ctx: MessageContext): Promise<boolean> {
  if (getDatabase().getUser(ctx.m.sender).registered) return true;
  await ctx.m.reply(CONFIG.messages.notRegistered);
  return false;
}

export async function requireGroup(ctx: MessageContext): Promise<boolean> {
  if (ctx.m.isGroup) return true;
  await ctx.m.reply(CONFIG.messages.groupOnly);
  return false;
}

// ---------------------------------------------------------------------------
// Contextos: cada juego declara el suyo al cargar el módulo. registerXxx los
// registra en el handler; mientras plugins/index.ts no llame a esas funciones,
// enter() los engancha la primera vez que se ejecuta un comando de juego.
// ---------------------------------------------------------------------------

const declaredContexts: CommandContext[] = [];
const attached = new WeakMap<MessageHandlerInterface, Set<string>>();

export function declareContext(context: CommandContext): CommandContext {
  declaredContexts.push(context);
  return context;
}

export function attachContexts(handler: MessageHandlerInterface, only?: CommandContext[]): void {
  let done = attached.get(handler);
  if (!done) {
    done = new Set();
    attached.set(handler, done);
  }
  for (const context of only ?? declaredContexts) {
    if (done.has(context.name)) continue;
    done.add(context.name);
    handler.registerContext(context);
  }
}

// ---------------------------------------------------------------------------
// Ficha de cada juego para `casino` y los alias xxxinfo
// ---------------------------------------------------------------------------

export interface GameInfo {
  key: string;
  name: string;
  emoji: string;
  /** Comando mínimo para jugar, sin prefijo. */
  play: string;
  /** Reglas; {p} se sustituye por el prefijo usado. */
  rules: string[];
  casino: boolean;
}

export function rulesText(info: GameInfo, prefix: string): string {
  const lines = info.rules.map((r) => `• ${r.replace(/\{p\}/g, prefix)}`);
  return `${info.emoji} *${info.name}*\n\n${lines.join('\n')}\n\nJugar: *${prefix}${info.play}*`;
}

/** Plugin de ayuda de un juego (alias viejos slotinfo/bjinfo/ruletainfo). */
export function infoPlugin(info: GameInfo, aliases: string[]): PluginHandler {
  return {
    command: aliases,
    description: `Reglas de ${info.name}`,
    category: 'casino',
    async handler(ctx) {
      await ctx.m.reply(rulesText(info, ctx.usedPrefix || '/'));
    },
  };
}
