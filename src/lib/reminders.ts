/**
 * Recordatorios (/recordar) y aviso diario de cumpleaños. Los recordatorios
 * viven en DatabaseSchema.reminders y sobreviven reinicios; un tick de 30 s
 * envía los vencidos y purga los enviados hace más de 7 días.
 */

import type { WASocket } from 'baileys';
import type { DatabaseSchema, Reminder } from '../types/database.js';
import { getDatabase } from './database.js';
import { createLogger } from './logger.js';
import { mentionTag } from './utils.js';

const log = createLogger('tools');

/** Zona horaria para interpretar "mañana 9:00" y para el aviso de las 09:00. */
export const REMINDER_TIMEZONE = process.env.BOT_TIMEZONE || 'America/Mexico_City';

export const MAX_ACTIVE_REMINDERS = 10;
export const MIN_REMINDER_MS = 60_000;
export const MAX_REMINDER_MS = 366 * 24 * 60 * 60_000;
const TICK_MS = 30_000;
const FIRED_RETENTION_MS = 7 * 24 * 60 * 60_000;
const BIRTHDAY_HOUR = 9;

/** Lo mínimo que necesita este módulo de la base de datos; permite probarlo sin disco. */
export interface ReminderDb {
  data: DatabaseSchema;
  markDirty(): void;
}

export type Sender = Pick<WASocket, 'sendMessage'> & { groupMetadata?: WASocket['groupMetadata'] };

// ---------------------------------------------------------------------------
// Fechas en zona horaria
// ---------------------------------------------------------------------------

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const partFormatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(zone: string): Intl.DateTimeFormat {
  let f = partFormatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    });
    partFormatters.set(zone, f);
  }
  return f;
}

export function zonedParts(ts: number, zone = REMINDER_TIMEZONE): ZonedParts {
  const parts: Record<string, number> = {};
  for (const p of formatterFor(zone).formatToParts(new Date(ts))) {
    if (p.type !== 'literal') parts[p.type] = parseInt(p.value, 10);
  }
  return { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour % 24, minute: parts.minute };
}

/** Timestamp UTC del instante que en `zone` se lee como esas partes (día inválido como 31/02 rueda al mes siguiente). */
export function zonedTimestamp(p: ZonedParts, zone = REMINDER_TIMEZONE): number {
  const wanted = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  let guess = wanted;
  // Dos pasadas bastan: la primera corrige el desfase, la segunda absorbe un cambio de horario en medio.
  for (let i = 0; i < 2; i++) {
    const z = zonedParts(guess, zone);
    guess += wanted - Date.UTC(z.year, z.month - 1, z.day, z.hour, z.minute);
  }
  return guess;
}

/** "MM-DD" de `ts` en la zona del bot. */
export function monthDayKey(ts: number, zone = REMINDER_TIMEZONE): string {
  const p = zonedParts(ts, zone);
  return `${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Interpretación de "cuándo"
// ---------------------------------------------------------------------------

const UNIT_MS: [RegExp, number][] = [
  [/^(s|seg|segs|segundos?)$/, 1_000],
  [/^(m|min|mins|minutos?)$/, 60_000],
  [/^(h|hr|hrs|horas?)$/, 3_600_000],
  [/^(d|dias?|días?)$/, 86_400_000],
  [/^(sem|semanas?)$/, 7 * 86_400_000],
];

function unitMs(unit: string): number | null {
  for (const [re, ms] of UNIT_MS) if (re.test(unit)) return ms;
  return null;
}

function parseClock(hourRaw: string, minuteRaw: string | undefined, suffix: string | undefined): { hour: number; minute: number } | null {
  let hour = parseInt(hourRaw, 10);
  const minute = minuteRaw ? parseInt(minuteRaw, 10) : 0;
  if (suffix === 'pm' && hour < 12) hour += 12;
  if (suffix === 'am' && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

/**
 * Convierte "10m", "2h", "1d", "en 30 min", "mañana", "mañana 9:00",
 * "hoy 18:30", "15/12 18:30" o "a las 7pm" en milisegundos desde `now`.
 * Devuelve null si no lo entiende o si cae fuera de [1 min, 1 año].
 */
export function parseDuration(input: string, now = Date.now(), zone = REMINDER_TIMEZONE): number | null {
  const text = input.trim().toLowerCase().replace(/\s+/g, ' ').replace(/^en /, '').replace(/^(a|para) las? /, '');
  if (!text) return null;

  let delay: number | null = null;

  const relativeMatch = text.match(/^(\d+(?:[.,]\d+)?) ?([a-záí]+)$/);
  const relativeUnit = relativeMatch ? unitMs(relativeMatch[2]) : null;
  // "7pm" también encaja en este patrón; si la unidad no es de tiempo se prueba como hora del reloj.
  const relative = relativeUnit === null ? null : relativeMatch;
  if (relative && relativeUnit !== null) {
    delay = Math.round(parseFloat(relative[1].replace(',', '.')) * relativeUnit);
  }

  const dayWord = text.match(/^(hoy|mañana|manana|pasado mañana|pasado manana)(?: (?:a las? )?(\d{1,2})(?::(\d{2}))? ?(am|pm|h)?)?$/);
  if (!relative && dayWord) {
    const offsetDays = dayWord[1] === 'hoy' ? 0 : dayWord[1].startsWith('pasado') ? 2 : 1;
    const clock = dayWord[2] ? parseClock(dayWord[2], dayWord[3], dayWord[4]) : { hour: BIRTHDAY_HOUR, minute: 0 };
    if (!clock) return null;
    const today = zonedParts(now, zone);
    let at = zonedTimestamp({ ...today, day: today.day + offsetDays, ...clock }, zone);
    // "hoy 18:30" cuando ya pasó: se entiende mañana.
    if (dayWord[1] === 'hoy' && at <= now) at += 86_400_000;
    delay = at - now;
  }

  const clockOnly = text.match(/^(\d{1,2})(?::(\d{2}))? ?(am|pm|h)$/) ?? text.match(/^(\d{1,2}):(\d{2})()$/);
  if (!relative && !dayWord && clockOnly) {
    const clock = parseClock(clockOnly[1], clockOnly[2] || undefined, clockOnly[3] || undefined);
    if (!clock) return null;
    const today = zonedParts(now, zone);
    let at = zonedTimestamp({ ...today, ...clock }, zone);
    if (at <= now) at += 86_400_000;
    delay = at - now;
  }

  const dated = text.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?: (?:a las? )?(\d{1,2})(?::(\d{2}))? ?(am|pm|h)?)?$/);
  if (!relative && !dayWord && !clockOnly && dated) {
    const day = parseInt(dated[1], 10);
    const month = parseInt(dated[2], 10);
    if (day < 1 || day > 31 || month < 1 || month > 12) return null;
    const clock = dated[4] ? parseClock(dated[4], dated[5], dated[6]) : { hour: BIRTHDAY_HOUR, minute: 0 };
    if (!clock) return null;
    const today = zonedParts(now, zone);
    let year = dated[3] ? parseInt(dated[3], 10) : today.year;
    if (dated[3] && dated[3].length === 2) year += 2000;
    let at = zonedTimestamp({ year, month, day, ...clock }, zone);
    if (!dated[3] && at <= now) at = zonedTimestamp({ year: year + 1, month, day, ...clock }, zone);
    delay = at - now;
  }

  if (delay === null || !Number.isFinite(delay)) return null;
  if (delay < MIN_REMINDER_MS || delay > MAX_REMINDER_MS) return null;
  return delay;
}

/**
 * Separa el "cuándo" inicial del texto del recordatorio probando prefijos de
 * hasta 4 palabras, del más largo al más corto, y exige que quede texto.
 */
export function splitReminder(text: string, now = Date.now(), zone = REMINDER_TIMEZONE): { at: number; text: string } | null {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  for (let n = Math.min(4, tokens.length - 1); n >= 1; n--) {
    const delay = parseDuration(tokens.slice(0, n).join(' '), now, zone);
    if (delay !== null) return { at: now + delay, text: tokens.slice(n).join(' ') };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Almacén
// ---------------------------------------------------------------------------

function all(db: ReminderDb): Reminder[] {
  if (!Array.isArray(db.data.reminders)) {
    db.data.reminders = [];
    db.markDirty();
  }
  return db.data.reminders;
}

function newId(existing: Reminder[]): string {
  const taken = new Set(existing.map((r) => r.id));
  for (;;) {
    const id = Math.random().toString(36).slice(2, 7);
    if (id.length === 5 && !taken.has(id)) return id;
  }
}

export function listReminders(user: string, db: ReminderDb = getDatabase()): Reminder[] {
  return all(db).filter((r) => r.user === user && !r.firedAt).sort((a, b) => a.at - b.at);
}

export function scheduleReminder(
  input: { chat: string; user: string; text: string; at: number },
  db: ReminderDb = getDatabase(),
): Reminder | 'limit' {
  const reminders = all(db);
  if (listReminders(input.user, db).length >= MAX_ACTIVE_REMINDERS) return 'limit';
  const reminder: Reminder = { id: newId(reminders), ...input, text: input.text.slice(0, 500), createdAt: Date.now() };
  reminders.push(reminder);
  db.markDirty();
  return reminder;
}

/** Cancela un recordatorio activo del usuario por id (o por su final). */
export function cancelReminder(user: string, id: string, db: ReminderDb = getDatabase()): Reminder | null {
  const needle = id.trim().toLowerCase();
  if (!needle) return null;
  const reminders = all(db);
  const index = reminders.findIndex((r) => r.user === user && !r.firedAt && (r.id === needle || r.id.endsWith(needle)));
  if (index === -1) return null;
  const [removed] = reminders.splice(index, 1);
  db.markDirty();
  return removed;
}

// ---------------------------------------------------------------------------
// Disparo
// ---------------------------------------------------------------------------

let connection: Sender | null = null;
let activeDb: ReminderDb | null = null;
let timer: NodeJS.Timeout | null = null;
let lastBirthdayRun = '';

/** El socket cambia en cada reconexión; index.ts debe pasar el nuevo. */
export function setRemindersConnection(conn: Sender | null): void {
  connection = conn;
}

/** Envía los recordatorios vencidos y purga los antiguos. Devuelve cuántos envió. */
export async function runRemindersTick(now = Date.now(), db: ReminderDb = getDatabase(), conn: Sender | null = connection): Promise<number> {
  const reminders = all(db);
  const before = reminders.length;
  const kept = reminders.filter((r) => !r.firedAt || now - r.firedAt < FIRED_RETENTION_MS);
  if (kept.length !== before) {
    db.data.reminders = kept;
    db.markDirty();
  }

  if (!conn) return 0;
  let sent = 0;
  for (const reminder of kept) {
    if (reminder.firedAt || reminder.at > now) continue;
    try {
      await conn.sendMessage(reminder.chat, {
        text: `⏰ ${mentionTag(reminder.user)}: ${reminder.text}`,
        mentions: [reminder.user],
      });
      reminder.firedAt = now;
      db.markDirty();
      sent++;
    } catch (error) {
      log.warn(`no se pudo enviar el recordatorio ${reminder.id}:`, error instanceof Error ? error.message : error);
    }
  }
  return sent;
}

/**
 * Anuncia en los grupos con birthdayAnnounce los cumpleaños de hoy entre sus
 * participantes. Devuelve cuántos grupos recibieron aviso.
 */
export async function dailyBirthdayCheck(conn: Sender, db: ReminderDb = getDatabase(), now = Date.now()): Promise<number> {
  const birthdays = db.data.birthdays ?? {};
  const today = monthDayKey(now);
  const celebrating = Object.entries(birthdays).filter(([, date]) => date === today).map(([jid]) => jid);
  if (celebrating.length === 0) return 0;

  let announced = 0;
  for (const [chat, settings] of Object.entries(db.data.chats)) {
    if (!settings?.birthdayAnnounce || !chat.endsWith('@g.us')) continue;
    let members: string[] | null = null;
    if (conn.groupMetadata) {
      try {
        members = (await conn.groupMetadata(chat)).participants.map((p) => p.id);
      } catch (error) {
        log.warn(`cumpleaños: sin metadata de ${chat}:`, error instanceof Error ? error.message : error);
        continue;
      }
    }
    const inGroup = members ? celebrating.filter((jid) => members.includes(jid)) : celebrating;
    if (inGroup.length === 0) continue;
    const tags = inGroup.map(mentionTag).join(', ');
    try {
      await conn.sendMessage(chat, {
        text: inGroup.length === 1 ? `🎂 ¡Hoy cumple años ${tags}! Felicítenlo 🎉` : `🎂 ¡Hoy cumplen años ${tags}! Felicítenlos 🎉`,
        mentions: inGroup,
      });
      announced++;
    } catch (error) {
      log.warn(`cumpleaños: no se pudo avisar en ${chat}:`, error instanceof Error ? error.message : error);
    }
  }
  return announced;
}

async function tick(): Promise<void> {
  const now = Date.now();
  const db = activeDb ?? getDatabase();
  try {
    await runRemindersTick(now, db);
  } catch (error) {
    log.error('tick de recordatorios:', error);
  }
  // Ventana corta tras las 09:00 para no repetir el aviso si el bot reinicia más tarde ese día.
  const local = zonedParts(now);
  const dayKey = `${local.year}-${monthDayKey(now)}`;
  if (connection && local.hour === BIRTHDAY_HOUR && local.minute < 5 && lastBirthdayRun !== dayKey) {
    lastBirthdayRun = dayKey;
    try {
      await dailyBirthdayCheck(connection, db);
    } catch (error) {
      log.error('aviso de cumpleaños:', error);
    }
  }
}

/** Arranca el tick de 30 s. Idempotente; actualiza el socket si ya corría. `db` solo se pasa en tests. */
export function startReminders(conn: Sender, db?: ReminderDb): void {
  connection = conn;
  if (db) activeDb = db;
  if (timer) return;
  timer = setInterval(() => void tick(), TICK_MS);
  if (typeof timer.unref === 'function') timer.unref();
  void tick();
}

export function stopReminders(): void {
  if (timer) clearInterval(timer);
  timer = null;
  connection = null;
  activeDb = null;
}

export function remindersRunning(): boolean {
  return timer !== null;
}
