import type { PluginHandler } from '../types/message.js';
import type { UserRPG } from '../types/user.js';
import { getDatabase, type Database } from './database.js';
import { displayName, getTargetUser, mentionTag, pickRandom } from './utils.js';
import { LIMITS } from '../constants/rpg.js';

export type InteractionKind = 'kiss' | 'hug';

interface HistoryRecord {
  jid: string;
  count: number;
}

interface StatsView {
  totalGiven: number;
  totalReceived: number;
  history: HistoryRecord[];
  /** Fija el timestamp de la última interacción en el registro. */
  stamp: (record: HistoryRecord, at: number) => void;
  lastOf: (record: HistoryRecord) => number;
}

/** Vista uniforme sobre kissStats/hugStats, que difieren solo en nombres de campo. */
function statsView(user: UserRPG, kind: InteractionKind): StatsView {
  if (kind === 'kiss') {
    const s = user.kissStats;
    return {
      get totalGiven() { return s.totalGiven; }, set totalGiven(v) { s.totalGiven = v; },
      get totalReceived() { return s.totalReceived; }, set totalReceived(v) { s.totalReceived = v; },
      history: s.kissHistory,
      stamp: (r, at) => { (r as unknown as { lastKiss: number }).lastKiss = at; },
      lastOf: (r) => (r as unknown as { lastKiss: number }).lastKiss,
    };
  }
  const s = user.hugStats;
  return {
    get totalGiven() { return s.totalGiven; }, set totalGiven(v) { s.totalGiven = v; },
    get totalReceived() { return s.totalReceived; }, set totalReceived(v) { s.totalReceived = v; },
    history: s.hugHistory,
    stamp: (r, at) => { (r as unknown as { lastHug: number }).lastHug = at; },
    lastOf: (r) => (r as unknown as { lastHug: number }).lastHug,
  };
}

function trimHistory(view: StatsView): void {
  if (view.history.length <= LIMITS.MAX_KISS_HISTORY) return;
  view.history.sort((a, b) => view.lastOf(b) - view.lastOf(a));
  view.history.splice(LIMITS.MAX_KISS_HISTORY);
}

export interface InteractionResult {
  /** Veces que `from` le ha dado esta interacción a `to`. */
  count: number;
  totalGiven: number;
}

/** Registra un beso/abrazo de `from` a `to` en ambos usuarios y marca la BD. */
export function recordInteraction(db: Database, from: string, to: string, kind: InteractionKind): InteractionResult {
  const now = Date.now();
  const giver = statsView(db.getUser(from), kind);
  const receiver = statsView(db.getUser(to), kind);

  giver.totalGiven += 1;
  let record = giver.history.find((r) => r.jid === to);
  if (!record) {
    record = { jid: to, count: 0 };
    giver.stamp(record, 0);
    giver.history.push(record);
  }
  record.count += 1;
  giver.stamp(record, now);
  trimHistory(giver);

  receiver.totalReceived += 1;
  db.markDirty();
  return { count: record.count, totalGiven: giver.totalGiven };
}

export interface InteractionStats {
  totalGiven: number;
  totalReceived: number;
  history: HistoryRecord[];
}

/** Estadísticas sin crear al usuario si no existe. */
export function interactionStats(db: Database, jid: string, kind: InteractionKind): InteractionStats | null {
  if (!db.hasUser(jid)) return null;
  const view = statsView(db.getUser(jid), kind);
  if (view.totalGiven === 0 && view.totalReceived === 0) return null;
  return { totalGiven: view.totalGiven, totalReceived: view.totalReceived, history: view.history };
}

/** Nombre legible sin crear usuarios fantasma en la BD. */
export function nameOf(jid: string, pushName?: string | null, db: Database = getDatabase()): string {
  return displayName(jid, db.hasUser(jid) ? db.getUser(jid).name : null, pushName);
}

export interface InteractionPluginOptions {
  command: string[];
  description: string;
  kind: InteractionKind;
  /** Título del mensaje, p. ej. "¡BESO!" */
  title: string;
  /** Variantes aleatorias: emoji y descripción ("un besito tierno"). */
  types: { emoji: string; desc: string }[];
  /** Mensaje especial al alcanzar cierto número entre dos personas. */
  milestones: Record<number, string>;
  /** Respuesta cuando el objetivo es uno mismo. */
  selfReply: string;
  /** Texto de ayuda cuando no hay objetivo; {p} es el prefijo. */
  usage: string;
  /** Etiqueta de la relación según el conteo (opcional). */
  relationTitle?: (count: number) => string;
  /** Palabra para "X entre ustedes". */
  noun: string;
}

/** Genera un plugin de interacción (beso, abrazo...) con la misma mecánica y textos. */
export function createInteractionPlugin(options: InteractionPluginOptions): PluginHandler {
  return {
    command: options.command,
    description: options.description,
    category: 'fun',
    async handler(ctx) {
      const { m, conn } = ctx;
      const target = getTargetUser(m, { allowSelf: true });
      if (!target) {
        await m.reply(options.usage.replace(/\{p\}/g, ctx.usedPrefix || '/'));
        return;
      }
      if (target === m.sender) {
        await m.reply(options.selfReply);
        return;
      }
      const db = getDatabase();
      const result = recordInteraction(db, m.sender, target, options.kind);
      const variant = pickRandom(options.types);
      const senderName = nameOf(m.sender, m.pushName, db);
      const milestone = options.milestones[result.count];
      if (ctx.handler.isCompactMode(m.chat)) {
        const text = `${variant.emoji} ${mentionTag(m.sender)} → ${mentionTag(target)} (${result.count})${milestone ? ` 🎉 ${milestone}` : ''}`;
        await conn.sendMessage(m.chat, { text, mentions: [m.sender, target] }, { quoted: m.rawMessage });
        return;
      }
      const lines = [
        `${variant.emoji} *${options.title}* ${variant.emoji}`,
        '',
        `${mentionTag(m.sender)} le dio ${variant.desc} a ${mentionTag(target)}`,
        '',
        `${variant.emoji} ${options.noun} entre ustedes: *${result.count}*`,
      ];
      if (options.relationTitle) lines.push(options.relationTitle(result.count));
      if (milestone) lines.push('', `🎉 *${milestone}*`);
      lines.push('', `📊 Total dados por ${senderName}: *${result.totalGiven}*`);
      await conn.sendMessage(m.chat, { text: lines.join('\n'), mentions: [m.sender, target] }, { quoted: m.rawMessage });
    },
  };
}
