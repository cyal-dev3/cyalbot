/**
 * Punto de entrada. Levanta la base de datos, conecta a WhatsApp y
 * engancha los eventos. La reconexión recrea el socket y el handler.
 */

import 'dotenv/config';
import type { WASocket, proto } from 'baileys';
import { startBot, shouldReconnect, cancelPairingTimeout } from './main.js';
import { MessageHandler } from './handler.js';
import { initDatabase, type Database } from './lib/database.js';
import { loadPlugins } from './plugins/index.js';
import { CONFIG } from './config.js';
import { startAutoEvents, stopAutoEvents } from './lib/auto-events.js';
import { startAutoRegen, stopAutoRegen } from './lib/auto-regen.js';
import {
  startTelegramBridge, stopTelegramBridge, pauseMessageQueue, resumeMessageQueue, updateQueueSocket,
} from './lib/telegram-bridge.js';
import { startCleanupScheduler, stopCleanupScheduler } from './lib/cleanup-scheduler.js';
import { registerReactionHandler } from './lib/reaction-handler.js';
import { rememberMessage, handleMessageUpdates } from './lib/anti-delete.js';
import { handleParticipantsUpdate, handleGroupsUpdate, getGroupName } from './lib/group-events.js';
import { createLogger } from './lib/logger.js';
import { initAI } from './lib/ai.js';
import { unwrapMessage, getText } from './lib/wa-message.js';
import { stopAll as stopScheduledTasks } from './lib/scheduler.js';

const log = createLogger('bot');

let db: Database;
let handler: MessageHandler | null = null;
let currentConn: WASocket | null = null;
let isFirstConnection = true;
let isReconnecting = false;
let reconnectAttempts = 0;
let reconnectCount = 0;
let reconnectTimeout: NodeJS.Timeout | null = null;
let lastError: string | null = null;
let lastErrorAt: number | null = null;
const RECONNECT_BACKOFF_MS = [3000, 6000, 12000, 24000, 30000];
/** Fallos seguidos de connectBot antes de rendirse y dejar que pm2 reinicie el proceso. */
const MAX_CONSECUTIVE_FAILURES = 10;

export interface ReconnectStats {
  /** Reconexiones completadas con éxito. */
  count: number;
  /** Intentos desde la última conexión abierta. */
  attempts: number;
  lastError: string | null;
  lastErrorAt: number | null;
}

export function getReconnectStats(): ReconnectStats {
  return { count: reconnectCount, attempts: reconnectAttempts, lastError, lastErrorAt };
}

async function logIncoming(conn: WASocket, message: proto.IWebMessageInfo): Promise<void> {
  const key = message.key;
  if (!key?.remoteJid) return;
  const text = getText(unwrapMessage(message));
  if (!text) return;

  const sender = (key.participant || key.remoteJid).split('@')[0];
  const name = message.pushName || sender;
  const where = key.remoteJid.endsWith('@g.us') ? await getGroupName(conn, key.remoteJid) : 'privado';
  const preview = text.length > 100 ? `${text.slice(0, 100)}…` : text;
  log.debug(`[${where}] ${name}: ${preview}`);
}

/** Cierra socket y handler anteriores para no acumular listeners ni timers. */
function teardownPrevious(): void {
  cancelPairingTimeout();
  handler?.stop();
  handler = null;
  if (currentConn) {
    try {
      for (const event of [
        'messages.upsert', 'messages.update', 'messages.reaction', 'creds.update',
        'group-participants.update', 'groups.update', 'connection.update',
      ] as const) {
        currentConn.ev.removeAllListeners(event);
      }
      currentConn.end(undefined);
    } catch {
      // el socket ya estaba cerrado
    }
    currentConn = null;
  }
}

function scheduleReconnect(): void {
  if (isReconnecting) return;
  isReconnecting = true;
  if (reconnectAttempts >= MAX_CONSECUTIVE_FAILURES) {
    log.error(`${reconnectAttempts} intentos de reconexión seguidos sin éxito; saliendo para que el supervisor reinicie el proceso`);
    process.exit(1);
  }
  const delay = RECONNECT_BACKOFF_MS[Math.min(reconnectAttempts, RECONNECT_BACKOFF_MS.length - 1)];
  reconnectAttempts++;
  log.warn(`reconectando en ${Math.round(delay / 1000)}s (intento ${reconnectAttempts})`);
  if (reconnectTimeout) clearTimeout(reconnectTimeout);
  reconnectTimeout = setTimeout(async () => {
    reconnectTimeout = null;
    try {
      await connectBot();
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      lastErrorAt = Date.now();
      log.error('error al reconectar:', error);
      isReconnecting = false;
      scheduleReconnect();
    }
  }, delay);
}

async function connectBot(): Promise<WASocket> {
  teardownPrevious();

  const conn = await startBot();
  currentConn = conn;

  const h = new MessageHandler(conn, db);
  handler = h;
  loadPlugins(h);
  initAI(h);
  registerReactionHandler(conn, db);

  conn.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      if (msg.key.fromMe) continue;
      rememberMessage(msg);
      await logIncoming(conn, msg);
    }
    await h.handle(messages);
  });

  conn.ev.on('messages.update', (updates) => {
    handleMessageUpdates(conn, updates).catch((error) => log.error('anti-delete:', error));
  });

  conn.ev.on('group-participants.update', (update) => {
    handleParticipantsUpdate(conn, update).catch((error) => log.error('participants.update:', error));
  });

  conn.ev.on('groups.update', handleGroupsUpdate);

  conn.ev.on('connection.update', ({ connection, lastDisconnect }) => {
    if (connection === 'close') {
      pauseMessageQueue();
      if (lastDisconnect?.error) {
        lastError = lastDisconnect.error.message;
        lastErrorAt = Date.now();
      }
      if (shouldReconnect(lastDisconnect?.error)) {
        scheduleReconnect();
      } else {
        log.error(`sesión cerrada de forma permanente. Borra la carpeta ${CONFIG.authFolder} y vuelve a vincular.`);
        process.exit(1);
      }
      return;
    }

    if (connection === 'open') {
      isReconnecting = false;
      reconnectAttempts = 0;

      if (isFirstConnection) {
        isFirstConnection = false;
        startAutoEvents(conn);
        startAutoRegen();
        startTelegramBridge(conn).catch((error) => log.error('telegram bridge:', error));
      } else {
        reconnectCount++;
        updateQueueSocket(conn);
        resumeMessageQueue();
      }
    }
  });

  return conn;
}

async function main(): Promise<void> {
  log.info(`${CONFIG.botName} v${CONFIG.version} iniciando (node ${process.version})`);
  if (CONFIG.owners.length === 0) {
    log.warn('BOT_OWNERS no está definido: los comandos de owner quedan deshabilitados');
  }
  if (!CONFIG.ai.enabled) {
    log.info('ANTHROPIC_API_KEY no definida: la IA está desactivada');
  }

  try {
    db = await initDatabase(CONFIG.databasePath);
    startCleanupScheduler();
    await connectBot();
  } catch (error) {
    log.error('error fatal al iniciar:', error);
    process.exit(1);
  }
}

process.on('uncaughtException', (error) => log.error('excepción no capturada:', error));
process.on('unhandledRejection', (reason) => log.error('promesa rechazada:', reason));

async function gracefulShutdown(signal: string): Promise<void> {
  log.info(`cerrando (${signal})`);
  try {
    if (reconnectTimeout) clearTimeout(reconnectTimeout);
    handler?.stop();
    stopCleanupScheduler();
    stopAutoRegen();
    stopAutoEvents();
    stopScheduledTasks();
    await stopTelegramBridge();
    if (db) await db.stop();
  } catch (error) {
    log.error('error durante el apagado:', error);
  }
  process.exit(0);
}

process.on('SIGINT', () => void gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));

void main();
