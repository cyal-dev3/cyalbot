/**
 * Puente Telegram -> WhatsApp con GramJS (userbot). Escucha los grupos de
 * Telegram configurados y reenvía sus mensajes al grupo de WhatsApp a través
 * de una cola persistente (telegram-queue.ts), detectando picks de tipsters.
 */

import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { NewMessage, type NewMessageEvent } from 'telegram/events/index.js';
import type { WASocket } from 'baileys';
import { CONFIG } from '../config.js';
import { getDatabase } from './database.js';
import { TELEGRAM_BRIDGE_AUTHOR } from './betting-store.js';
import { extractTipsterName, buildTipsterStatCard } from './betting-parser.js';
import { createLogger } from './logger.js';
import { MessageQueue, type Delivery, type QueuedMessage } from './telegram-queue.js';
import { mentionTag } from './utils.js';

const log = createLogger('telegram');

export interface TelegramBridgeConfig {
  apiId: number;
  apiHash: string;
  stringSession: string;
  telegramGroupIds: string[];
  whatsappGroupId: string;
}

const MAX_BRIDGE_MEDIA_BYTES = 5 * 1024 * 1024;
const HEALTH_CHECK_MS = 30_000;
const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_DELAYS = [5_000, 10_000, 30_000, 60_000, 120_000];

let currentSock: WASocket | null = null;
let telegramClient: TelegramClient | null = null;
let healthCheck: NodeJS.Timeout | null = null;
let reconnecting: Promise<boolean> | null = null;
let reconnectExhausted = false;
let loaded = false;

// ---------------------------------------------------------------------------
// Avisos al owner y cola
// ---------------------------------------------------------------------------

async function notifyOwner(text: string): Promise<void> {
  if (!currentSock?.user || CONFIG.owners.length === 0) return;
  await currentSock.sendMessage(`${CONFIG.owners[0]}@s.whatsapp.net`, { text: `⚠️ ${text}` });
}

/** Detecta #Tipster, registra el pick si procede y arma la tarjeta y las menciones. */
function prepareDelivery(item: QueuedMessage): Delivery {
  const header = `*${item.senderName}:* ${item.text}`.trim();
  const tipsterName = extractTipsterName(item.text);
  if (!tipsterName) return { caption: header };

  const store = getDatabase().betting;
  const system = store.peekBettingSystem(item.whatsappGroupId);
  if (!system?.enabled) return { caption: header };

  const tipster = store.getTipster(item.whatsappGroupId, tipsterName);
  const mentions = (tipster?.followers ?? []).filter((jid) => store.getUserBetting(jid).notifyOnFavorite);

  let pickId: string | undefined;
  if (system.autoRegister && item.mediaPath) {
    pickId = store.registerPick(item.whatsappGroupId, {
      tipster: store.normalizeTipsterName(tipsterName),
      tipsterOriginal: tipsterName,
      description: item.text.substring(0, 500),
      units: 1,
      status: 'pending',
      createdAt: Date.now(),
      createdBy: TELEGRAM_BRIDGE_AUTHOR,
      followers: [],
    }).id;
    log.info(`pick auto-registrado: ${tipsterName}`);
  } else {
    log.debug(`tipster detectado: ${tipsterName}`);
  }

  const card = `\n\n${buildTipsterStatCard(tipsterName, tipster)}`;
  const followers = mentions.length > 0 ? `\n\n🔔 Seguidores: ${mentions.map(mentionTag).join(' ')}` : '';
  return {
    caption: header + card + followers,
    mentions,
    onSent: (messageId) => {
      if (!pickId || !messageId) return;
      store.setPickMessageId(item.whatsappGroupId, pickId, messageId);
      store.rememberReply(item.whatsappGroupId, messageId, pickId);
    },
  };
}

const messageQueue = new MessageQueue({
  dir: process.env.BRIDGE_DATA_DIR || 'data',
  notify: notifyOwner,
  prepare: prepareDelivery,
});

// ---------------------------------------------------------------------------
// Configuración
// ---------------------------------------------------------------------------

function validateConfig(): TelegramBridgeConfig | null {
  const { TELEGRAM_API_ID, TELEGRAM_API_HASH, TELEGRAM_STRING_SESSION, TELEGRAM_GROUP_IDS, WHATSAPP_GROUP_ID } = process.env;
  const missing = [
    !TELEGRAM_API_ID && 'TELEGRAM_API_ID',
    !TELEGRAM_API_HASH && 'TELEGRAM_API_HASH',
    !TELEGRAM_STRING_SESSION && 'TELEGRAM_STRING_SESSION',
    !TELEGRAM_GROUP_IDS && 'TELEGRAM_GROUP_IDS',
    !WHATSAPP_GROUP_ID && 'WHATSAPP_GROUP_ID',
  ].filter(Boolean);
  if (missing.length > 0) {
    log.info(`puente desactivado: falta ${missing.join(', ')}${missing.includes('TELEGRAM_STRING_SESSION') ? ' (genera la sesión con npm run telegram:session)' : ''}`);
    return null;
  }
  const apiId = parseInt(TELEGRAM_API_ID!, 10);
  if (!Number.isFinite(apiId)) {
    log.error('TELEGRAM_API_ID debe ser numérico; puente desactivado');
    return null;
  }
  return {
    apiId,
    apiHash: TELEGRAM_API_HASH!,
    stringSession: TELEGRAM_STRING_SESSION!,
    telegramGroupIds: TELEGRAM_GROUP_IDS!.split(',').map((id) => id.trim()).filter(Boolean),
    whatsappGroupId: WHATSAPP_GROUP_ID!,
  };
}

// ---------------------------------------------------------------------------
// Entrada de mensajes
// ---------------------------------------------------------------------------

function normalizeChatId(id: string): string {
  return id.startsWith('-100') ? id : `-100${id.replace(/^-/, '')}`;
}

async function senderName(event: NewMessageEvent): Promise<string> {
  try {
    const sender = await event.message.getSender();
    if (sender && 'firstName' in sender) {
      const user = sender as Api.User;
      return [user.firstName, user.lastName].filter(Boolean).join(' ') || 'Desconocido';
    }
    if (sender && 'title' in sender) return (sender as Api.Channel).title || 'Canal';
  } catch (error) {
    log.debug('sin datos del remitente:', error instanceof Error ? error.message : error);
  }
  return 'Desconocido';
}

function mediaSize(message: Api.Message): number {
  const raw = (message.document as unknown as { size?: unknown })?.size ?? (message.video as unknown as { size?: unknown })?.size ?? 0;
  return typeof raw === 'bigint' ? Number(raw) : Number(raw) || 0;
}

async function handleTelegramMessage(event: NewMessageEvent, client: TelegramClient, config: TelegramBridgeConfig): Promise<void> {
  const message = event.message;
  if (message.out) return;
  const chatId = message.chatId?.toString();
  if (!chatId) return;
  const normalized = normalizeChatId(chatId);
  if (!config.telegramGroupIds.some((id) => id === chatId || normalizeChatId(id) === normalized)) return;

  const text = message.text || message.message || '';
  const hasMedia = Boolean(message.photo || message.video);
  const mediaType = message.photo ? 'photo' : message.video ? 'video' : undefined;
  let mediaBuffer: Buffer | undefined;
  let mediaOmitted = false;

  if (hasMedia) {
    const size = mediaSize(message);
    if (size > MAX_BRIDGE_MEDIA_BYTES) {
      log.warn(`media de ${Math.round(size / 1024 / 1024)} MB omitida (> 5 MB)`);
      mediaOmitted = true;
    } else {
      try {
        const downloaded = await client.downloadMedia(message, {});
        if (Buffer.isBuffer(downloaded) && downloaded.length > 0 && downloaded.length <= MAX_BRIDGE_MEDIA_BYTES) {
          mediaBuffer = downloaded;
        } else {
          mediaOmitted = true;
        }
      } catch (error) {
        log.warn('no se pudo descargar la media, se reenvía solo el texto:', error instanceof Error ? error.message : error);
        mediaOmitted = true;
      }
    }
  }
  if (!text && !mediaBuffer) {
    if (!mediaOmitted) return;
  }

  messageQueue.enqueue({
    id: `${chatId}-${message.id}`,
    senderName: await senderName(event),
    text,
    whatsappGroupId: config.whatsappGroupId,
    mediaType,
    mediaBuffer,
    mediaOmitted,
  });
}

// ---------------------------------------------------------------------------
// Conexión y reconexión de Telegram
// ---------------------------------------------------------------------------

async function disconnectClient(): Promise<void> {
  const old = telegramClient;
  telegramClient = null;
  if (!old) return;
  try {
    await old.disconnect();
  } catch (error) {
    log.debug('al desconectar el cliente anterior:', error instanceof Error ? error.message : error);
  }
}

async function connectTelegramClient(config: TelegramBridgeConfig): Promise<boolean> {
  await disconnectClient();
  const client = new TelegramClient(new StringSession(config.stringSession), config.apiId, config.apiHash, { connectionRetries: 5 });
  try {
    await client.connect();
    const me = await client.getMe();
    if (me && 'firstName' in me) log.info(`conectado a Telegram como ${[me.firstName, me.lastName].filter(Boolean).join(' ')}`);
    client.addEventHandler((event: NewMessageEvent) => {
      handleTelegramMessage(event, client, config).catch((error) => log.error('al procesar un mensaje de Telegram:', error));
    }, new NewMessage({}));
    telegramClient = client;
    reconnectExhausted = false;
    return true;
  } catch (error) {
    log.error('no se pudo conectar a Telegram:', error instanceof Error ? error.message : error);
    try {
      await client.disconnect();
    } catch {
      // el cliente nunca llegó a abrirse
    }
    return false;
  }
}

/**
 * Reconexión con backoff. Una sola en vuelo: quien llame mientras otra corre
 * recibe la misma promesa. Tras agotar los intentos deja de insistir hasta
 * que alguien reinicie el puente a mano.
 */
export function attemptTelegramReconnect(config: TelegramBridgeConfig): Promise<boolean> {
  if (reconnecting) return reconnecting;
  if (reconnectExhausted) return Promise.resolve(false);
  reconnecting = (async () => {
    for (let attempt = 1; attempt <= MAX_RECONNECT_ATTEMPTS; attempt++) {
      const delay = RECONNECT_DELAYS[Math.min(attempt - 1, RECONNECT_DELAYS.length - 1)];
      log.warn(`reconectando Telegram (intento ${attempt}/${MAX_RECONNECT_ATTEMPTS}) en ${Math.round(delay / 1000)}s`);
      await new Promise((resolve) => setTimeout(resolve, delay).unref());
      if (await connectTelegramClient(config)) {
        log.info('Telegram reconectado');
        if (messageQueue.isPaused) messageQueue.resume();
        return true;
      }
    }
    reconnectExhausted = true;
    log.error('máximo de intentos de reconexión de Telegram alcanzado; usa /bridge restart');
    await notifyOwner('Puente Telegram: no pude reconectar tras varios intentos. Usa /bridge restart.').catch(() => undefined);
    return false;
  })().finally(() => {
    reconnecting = null;
  });
  return reconnecting;
}

function startHealthCheck(config: TelegramBridgeConfig): void {
  if (healthCheck) clearInterval(healthCheck);
  healthCheck = setInterval(async () => {
    if (reconnecting) return;
    try {
      if (!telegramClient || !telegramClient.connected) {
        log.warn('Telegram desconectado');
        await attemptTelegramReconnect(config);
        return;
      }
      await telegramClient.getMe();
    } catch (error) {
      log.warn('Telegram no responde al ping:', error instanceof Error ? error.message : error);
      await attemptTelegramReconnect(config);
    }
  }, HEALTH_CHECK_MS);
  healthCheck.unref();
}

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

export async function startTelegramBridge(sock: WASocket): Promise<TelegramClient | null> {
  currentSock = sock;
  messageQueue.updateSocket(sock);
  if (!loaded) {
    loaded = true;
    await messageQueue.load().catch((error) => log.error('al cargar la cola persistida:', error));
  }

  const config = validateConfig();
  if (!config) return null;

  log.info('conectando a Telegram');
  if (!(await connectTelegramClient(config))) return null;
  startHealthCheck(config);
  log.info(`escuchando ${config.telegramGroupIds.length} grupo(s) de Telegram, reenviando a ${config.whatsappGroupId}`);
  return telegramClient;
}

export async function stopTelegramBridge(): Promise<void> {
  if (healthCheck) clearInterval(healthCheck);
  healthCheck = null;
  await disconnectClient();
  await messageQueue.stop();
  log.info('puente Telegram detenido');
}

export async function restartTelegramBridge(sock: WASocket): Promise<TelegramClient | null> {
  log.info('reiniciando el puente Telegram');
  if (healthCheck) clearInterval(healthCheck);
  healthCheck = null;
  await disconnectClient();
  reconnectExhausted = false;
  messageQueue.resume();
  return startTelegramBridge(sock);
}

export function getTelegramClient(): TelegramClient | null {
  return telegramClient;
}

export function getPendingMessagesCount(): number {
  return messageQueue.pendingCount;
}

/** Pausa manual (sin reanudación automática). index.ts la llama al cerrarse WhatsApp. */
export function pauseMessageQueue(): void {
  messageQueue.pause();
}

export function resumeMessageQueue(): void {
  messageQueue.resume();
}

export function isMessageQueuePaused(): boolean {
  return messageQueue.isPaused;
}

/** El socket cambia en cada reconexión de WhatsApp. */
export function updateQueueSocket(sock: WASocket): void {
  currentSock = sock;
  messageQueue.updateSocket(sock);
}

export function isTelegramConnected(): boolean {
  return telegramClient?.connected ?? false;
}

export interface BridgeStatus {
  configured: boolean;
  telegramConnected: boolean;
  reconnecting: boolean;
  reconnectExhausted: boolean;
  queuePending: number;
  queuePaused: boolean;
  queueOldestAgeMs: number;
  whatsappGroupId: string | null;
  telegramGroups: number;
}

export function getBridgeStatus(): BridgeStatus {
  const config = validateConfig();
  return {
    configured: config !== null,
    telegramConnected: isTelegramConnected(),
    reconnecting: reconnecting !== null,
    reconnectExhausted,
    queuePending: messageQueue.pendingCount,
    queuePaused: messageQueue.isPaused,
    queueOldestAgeMs: messageQueue.oldestAgeMs,
    whatsappGroupId: config?.whatsappGroupId ?? null,
    telegramGroups: config?.telegramGroupIds.length ?? 0,
  };
}
