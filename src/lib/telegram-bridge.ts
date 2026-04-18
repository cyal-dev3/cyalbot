/**
 * Telegram Bridge - Puente de reenvío Telegram → WhatsApp
 *
 * Utiliza GramJS (Userbot) para escuchar mensajes de grupos de Telegram
 * y reenviarlos a un grupo de WhatsApp usando Baileys.
 */

import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { NewMessage, NewMessageEvent } from 'telegram/events/index.js';
import type { WASocket } from 'baileys';
import chalk from 'chalk';
import { getDatabase } from './database.js';

interface TelegramBridgeConfig {
  apiId: number;
  apiHash: string;
  stringSession: string;
  telegramGroupIds: string[];
  whatsappGroupId: string;
}

// ============================================================================
// Cola de mensajes para procesamiento secuencial (persistente)
// ============================================================================

/**
 * Datos pre-procesados del mensaje para poder reenviarlo sin depender del socket original
 */
interface ProcessedMessageData {
  id: string;
  senderName: string;
  text: string;
  mediaBuffer?: Buffer;
  mediaType?: 'photo' | 'video';
  config: TelegramBridgeConfig;
  timestamp: number;
  retries: number;
}

class MessageQueue {
  private queue: ProcessedMessageData[] = [];
  private isProcessing = false;
  private isPaused = false;
  private currentSock: WASocket | null = null;
  private readonly maxRetries = 10; // Más reintentos ya que no descartamos mensajes
  private readonly delayBetweenMessages = 1000;
  private readonly retryDelays = [2000, 5000, 10000, 15000, 30000]; // Backoff más largo
  private consecutiveErrors = 0;
  private readonly maxConsecutiveErrors = 5;
  private readonly maxQueueSize = 100; // Límite de mensajes en cola
  private readonly maxMessageAge = 30 * 60 * 1000; // 30 minutos máximo de antigüedad

  /**
   * Actualiza el socket de WhatsApp (llamar después de reconexión)
   */
  updateSocket(sock: WASocket): void {
    this.currentSock = sock;
    console.log(
      chalk.gray(`[${new Date().toLocaleTimeString('es-MX')}] `) +
      chalk.cyan(`🔄 Socket de WhatsApp actualizado en la cola`)
    );
    // Si hay mensajes pendientes y no estamos pausados, intentar procesar
    if (this.queue.length > 0 && !this.isPaused && !this.isProcessing) {
      this.processQueue();
    }
  }

  /**
   * Agrega un mensaje pre-procesado a la cola
   */
  async enqueue(
    event: NewMessageEvent,
    client: TelegramClient,
    config: TelegramBridgeConfig
  ): Promise<void> {
    // NO actualizar el socket aquí - usar el que se actualiza vía updateSocket()

    // Verificar límite de cola
    if (this.queue.length >= this.maxQueueSize) {
      // Eliminar mensajes más antiguos si excedemos el límite
      const removed = this.queue.shift();
      if (removed) {
        console.log(
          chalk.gray(`[${new Date().toLocaleTimeString('es-MX')}] `) +
          chalk.yellow(`⚠️ Cola llena, descartando mensaje antiguo de ${removed.senderName}`)
        );
      }
    }

    try {
      // Pre-procesar el mensaje para no depender del evento original
      const message = event.message;
      const senderName = await this.getSenderName(client, event);
      const text = message.text || message.message || '';

      let mediaBuffer: Buffer | undefined;
      let mediaType: 'photo' | 'video' | undefined;

      // Cap de tamaño para pre-buffering (evita OOM en cola con muchos videos)
      const MAX_BRIDGE_MEDIA_BYTES = 5 * 1024 * 1024; // 5 MB

      // Descargar media ahora para no perderlo
      if (message.photo || message.video) {
        const docSize = (message.document as unknown as { size?: unknown })?.size;
        const vidSize = (message.video as unknown as { size?: unknown })?.size;
        const rawSize = docSize ?? vidSize ?? 0;
        const mediaSize = typeof rawSize === 'bigint' ? Number(rawSize) : Number(rawSize);
        if (mediaSize > MAX_BRIDGE_MEDIA_BYTES) {
          console.log(
            chalk.gray(`[${new Date().toLocaleTimeString('es-MX')}] `) +
            chalk.yellow(`⚠️ Media de ${Math.round(mediaSize / 1024 / 1024)}MB omitida (> 5MB), se envía solo texto`)
          );
        } else {
          try {
            mediaBuffer = await client.downloadMedia(message, {}) as Buffer;
            if (mediaBuffer && mediaBuffer.length > MAX_BRIDGE_MEDIA_BYTES) {
              console.log(
                chalk.gray(`[${new Date().toLocaleTimeString('es-MX')}] `) +
                chalk.yellow(`⚠️ Media descargada supera 5MB, descartando buffer`)
              );
              mediaBuffer = undefined;
            } else {
              mediaType = message.photo ? 'photo' : 'video';
            }
          } catch (err) {
            console.log(
              chalk.gray(`[${new Date().toLocaleTimeString('es-MX')}] `) +
              chalk.yellow(`⚠️ No se pudo descargar media, guardando solo texto`)
            );
          }
        }
      }

      const processedMessage: ProcessedMessageData = {
        id: `${message.chatId}-${message.id}-${Date.now()}`,
        senderName,
        text,
        mediaBuffer,
        mediaType,
        config,
        timestamp: Date.now(),
        retries: 0
      };

      this.queue.push(processedMessage);

      console.log(
        chalk.gray(`[${new Date().toLocaleTimeString('es-MX')}] `) +
        chalk.cyan(`📥 Mensaje en cola (${this.queue.length} pendientes)`)
      );

      this.processQueue();
    } catch (error) {
      console.error(
        chalk.red(`❌ Error al encolar mensaje:`),
        error instanceof Error ? error.message : error
      );
    }
  }

  /**
   * Obtiene el nombre del remitente
   */
  private async getSenderName(client: TelegramClient, event: NewMessageEvent): Promise<string> {
    try {
      const sender = await event.message.getSender();
      if (sender) {
        if ('firstName' in sender) {
          const user = sender as Api.User;
          return user.firstName + (user.lastName ? ` ${user.lastName}` : '');
        }
        if ('title' in sender) {
          return (sender as Api.Channel).title || 'Canal';
        }
      }
    } catch {
      // Ignorar errores
    }
    return 'Desconocido';
  }

  /**
   * Procesa la cola de mensajes secuencialmente
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0 || this.isPaused) return;

    // Verificar que tenemos socket antes de procesar
    if (!this.currentSock?.user) {
      console.log(
        chalk.gray(`[${new Date().toLocaleTimeString('es-MX')}] `) +
        chalk.yellow(`⏸️ Socket de WhatsApp no disponible, esperando...`)
      );
      return;
    }

    this.isProcessing = true;

    while (this.queue.length > 0 && !this.isPaused) {
      // Limpiar mensajes muy antiguos
      this.cleanOldMessages();

      if (this.queue.length === 0) break;

      const item = this.queue[0]; // Peek, no shift aún

      try {
        await this.processMessage(item);
        // Éxito - ahora sí eliminamos de la cola
        this.queue.shift();
        this.consecutiveErrors = 0;

        console.log(
          chalk.gray(`[${new Date().toLocaleTimeString('es-MX')}] `) +
          chalk.green(`✅ Mensaje enviado (${this.queue.length} pendientes)`)
        );

        // Delay entre mensajes
        if (this.queue.length > 0) {
          await this.delay(this.delayBetweenMessages);
        }
      } catch (error) {
        await this.handleError(item, error);
      }
    }

    this.isProcessing = false;
  }

  /**
   * Limpia mensajes que exceden el tiempo máximo de antigüedad
   */
  private cleanOldMessages(): void {
    const now = Date.now();
    const oldCount = this.queue.length;

    this.queue = this.queue.filter(msg => {
      const age = now - msg.timestamp;
      if (age > this.maxMessageAge) {
        console.log(
          chalk.gray(`[${new Date().toLocaleTimeString('es-MX')}] `) +
          chalk.yellow(`⏰ Mensaje de ${msg.senderName} expirado (${Math.round(age/60000)}min)`)
        );
        return false;
      }
      return true;
    });

    const removed = oldCount - this.queue.length;
    if (removed > 0) {
      console.log(
        chalk.gray(`[${new Date().toLocaleTimeString('es-MX')}] `) +
        chalk.yellow(`🧹 ${removed} mensaje(s) expirado(s) eliminado(s)`)
      );
    }
  }

  /**
   * Procesa un mensaje individual
   */
  private async processMessage(item: ProcessedMessageData): Promise<void> {
    // Verificar que tenemos socket disponible
    if (!this.currentSock?.user) {
      throw new Error('Connection Closed - WhatsApp socket no disponible');
    }

    const sock = this.currentSock;
    const { senderName, text, mediaBuffer, mediaType, config } = item;

    // Formatear mensaje
    const formattedText = `*Reenvio de Telegram:*\n\n*${senderName}:* ${text}`;

    // Detectar tipster
    const tipsterInfo = await handleTipsterDetection(sock, config, text, mediaBuffer, mediaType === 'photo');

    let caption = formattedText;
    if (tipsterInfo && tipsterInfo.mentions.length > 0) {
      const mentionText = tipsterInfo.mentions
        .map(jid => `@${jid.split('@')[0]}`)
        .join(' ');
      caption += `\n\n🔔 *Seguidores:* ${mentionText}`;
    }

    // Enviar según tipo de contenido
    if (mediaBuffer && mediaType) {
      if (mediaType === 'photo') {
        await sock.sendMessage(config.whatsappGroupId, {
          image: mediaBuffer,
          caption,
          mentions: tipsterInfo?.mentions || []
        });
      } else {
        await sock.sendMessage(config.whatsappGroupId, {
          video: mediaBuffer,
          caption,
          mentions: tipsterInfo?.mentions || []
        });
      }

      if (tipsterInfo) {
        console.log(
          chalk.gray(`[${new Date().toLocaleTimeString('es-MX')}] `) +
          chalk.magenta(`🎫 Tipster detectado: ${tipsterInfo.tipsterName}`)
        );
      }
    } else if (text) {
      await sock.sendMessage(config.whatsappGroupId, {
        text: formattedText
      });
    }
  }

  /**
   * Maneja errores - mantiene el mensaje en cola para reintentar
   */
  private async handleError(item: ProcessedMessageData, error: unknown): Promise<void> {
    const isConnectionError = this.isConnectionError(error);
    this.consecutiveErrors++;
    item.retries++;

    // Si hay muchos errores consecutivos, pausar la cola (pero NO limpiarla)
    if (isConnectionError && this.consecutiveErrors >= this.maxConsecutiveErrors) {
      console.log(
        chalk.gray(`[${new Date().toLocaleTimeString('es-MX')}] `) +
        chalk.red(`🛑 Demasiados errores de conexión. Pausando cola (${this.queue.length} mensajes guardados)...`)
      );

      this.isPaused = true;
      // NO limpiamos la cola - los mensajes se mantienen para cuando se reconecte
      return;
    }

    if (isConnectionError && item.retries < this.maxRetries) {
      const delayIndex = Math.min(item.retries - 1, this.retryDelays.length - 1);
      const delay = this.retryDelays[delayIndex];

      console.log(
        chalk.gray(`[${new Date().toLocaleTimeString('es-MX')}] `) +
        chalk.yellow(`⏳ Reintento ${item.retries}/${this.maxRetries} en ${delay/1000}s... (${this.queue.length} en cola)`)
      );

      await this.delay(delay);
      // El mensaje sigue al frente de la cola, se reintentará
    } else if (item.retries >= this.maxRetries) {
      // Después de muchos reintentos, eliminar el mensaje
      this.queue.shift();
      console.error(
        chalk.red(`❌ Mensaje descartado después de ${this.maxRetries} reintentos:`),
        `De: ${item.senderName}`
      );
    }
  }

  /**
   * Detecta si es un error de conexión
   */
  private isConnectionError(error: unknown): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      return message.includes('connection closed') ||
             message.includes('connection lost') ||
             message.includes('timed out') ||
             message.includes('socket hang up') ||
             message.includes('econnreset') ||
             message.includes('network');
    }
    return false;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  get pendingCount(): number {
    return this.queue.length;
  }

  pause(): void {
    this.isPaused = true;
    console.log(
      chalk.gray(`[${new Date().toLocaleTimeString('es-MX')}] `) +
      chalk.yellow(`⏸️ Cola pausada (${this.queue.length} mensajes guardados)`)
    );
  }

  resume(): void {
    this.isPaused = false;
    this.consecutiveErrors = 0;
    console.log(
      chalk.gray(`[${new Date().toLocaleTimeString('es-MX')}] `) +
      chalk.green(`▶️ Cola reanudada (${this.queue.length} mensajes pendientes)`)
    );
    this.processQueue();
  }

  get paused(): boolean {
    return this.isPaused;
  }
}

// Instancia global de la cola
const messageQueue = new MessageQueue();

let telegramClient: TelegramClient | null = null;

/**
 * Valida que todas las variables de entorno necesarias estén configuradas
 */
function validateConfig(): TelegramBridgeConfig | null {
  const apiId = process.env.TELEGRAM_API_ID;
  const apiHash = process.env.TELEGRAM_API_HASH;
  const stringSession = process.env.TELEGRAM_STRING_SESSION;
  const telegramGroupIds = process.env.TELEGRAM_GROUP_IDS;
  const whatsappGroupId = process.env.WHATSAPP_GROUP_ID;

  if (!apiId || !apiHash) {
    console.log(chalk.yellow('⚠️  Telegram Bridge: TELEGRAM_API_ID o TELEGRAM_API_HASH no configurados'));
    return null;
  }

  if (!stringSession) {
    console.log(chalk.yellow('⚠️  Telegram Bridge: TELEGRAM_STRING_SESSION no configurado'));
    console.log(chalk.gray('   Ejecuta: npm run telegram:session'));
    return null;
  }

  if (!telegramGroupIds) {
    console.log(chalk.yellow('⚠️  Telegram Bridge: TELEGRAM_GROUP_IDS no configurado'));
    return null;
  }

  if (!whatsappGroupId) {
    console.log(chalk.yellow('⚠️  Telegram Bridge: WHATSAPP_GROUP_ID no configurado'));
    return null;
  }

  return {
    apiId: parseInt(apiId, 10),
    apiHash,
    stringSession,
    telegramGroupIds: telegramGroupIds.split(',').map(id => id.trim()),
    whatsappGroupId,
  };
}


/**
 * Maneja un mensaje nuevo de Telegram - Encola el mensaje para procesamiento secuencial
 */
function handleTelegramMessage(
  event: NewMessageEvent,
  client: TelegramClient,
  config: TelegramBridgeConfig
): void {
  const message = event.message;

  // Ignorar mensajes propios
  if (message.out) return;

  // Verificar que el mensaje viene de uno de los grupos configurados
  const chatId = message.chatId?.toString();
  if (!chatId) return;

  // Normalizar el ID (puede venir con o sin el prefijo -100)
  const normalizedChatId = chatId.startsWith('-100') ? chatId : `-100${chatId}`;
  const isFromConfiguredGroup = config.telegramGroupIds.some(id => {
    const normalizedConfigId = id.startsWith('-100') ? id : `-100${id}`;
    return normalizedConfigId === normalizedChatId || id === chatId;
  });

  if (!isFromConfiguredGroup) return;

  // Log del mensaje recibido
  console.log(
    chalk.gray(`[${new Date().toLocaleTimeString('es-MX')}] `) +
    chalk.blue(`[Telegram] `) +
    chalk.white(`Nuevo mensaje recibido, encolando...`)
  );

  // Encolar el mensaje (pre-procesa y guarda los datos) - el socket se obtiene de la cola
  messageQueue.enqueue(event, client, config);
}

/**
 * Regex para detectar tipsters en el formato 🎫 NombreTipster
 */
const TIPSTER_REGEX = /🎫\s*([^\n]+)/;

/**
 * Detecta y notifica sobre picks de tipsters
 */
async function handleTipsterDetection(
  sock: WASocket,
  config: TelegramBridgeConfig,
  text: string,
  mediaBuffer?: Buffer,
  isPhoto?: boolean
): Promise<{ tipsterName: string; mentions: string[] } | null> {
  const match = text.match(TIPSTER_REGEX);
  if (!match) return null;

  const tipsterName = match[1].trim();
  if (!tipsterName) return null;

  try {
    const db = getDatabase();
    const system = db.getBettingSystem(config.whatsappGroupId);

    // Si el sistema no está habilitado, no hacer nada extra
    if (!system.enabled) return null;

    const normalized = db.normalizeTipsterName(tipsterName);
    const tipster = db.getTipster(config.whatsappGroupId, tipsterName);

    // Obtener seguidores para mencionar
    const mentions: string[] = [];

    if (tipster && tipster.followers.length > 0) {
      // Mencionar a los seguidores que tienen notificaciones activas
      for (const followerJid of tipster.followers) {
        const userBetting = db.getUserBetting(followerJid);
        if (userBetting.notifyOnFavorite) {
          mentions.push(followerJid);
        }
      }
    }

    // Auto-registrar pick si está habilitado
    if (system.autoRegister && mediaBuffer) {
      db.registerPick(config.whatsappGroupId, {
        tipster: normalized,
        tipsterOriginal: tipsterName,
        description: text.substring(0, 500),
        units: 1,
        status: 'pending',
        createdAt: Date.now(),
        createdBy: 'TELEGRAM_BRIDGE',
        followers: [],
        messageId: undefined // Se actualizará después de enviar
      });

      console.log(
        chalk.gray(`[${new Date().toLocaleTimeString('es-MX')}] `) +
        chalk.magenta(`🎫 Pick auto-registrado: ${tipsterName}`)
      );
    }

    return { tipsterName, mentions };
  } catch (error) {
    console.error('Error en detección de tipster:', error);
    return null;
  }
}


// Variables para reconexión de Telegram
let currentConfig: TelegramBridgeConfig | null = null;
let telegramReconnectAttempts = 0;
const MAX_TELEGRAM_RECONNECT_ATTEMPTS = 10;
const TELEGRAM_RECONNECT_DELAYS = [5000, 10000, 30000, 60000, 120000]; // Backoff exponencial

/**
 * Conecta el cliente de Telegram con manejo de reconexión
 */
async function connectTelegramClient(config: TelegramBridgeConfig): Promise<boolean> {
  try {
    const session = new StringSession(config.stringSession);

    telegramClient = new TelegramClient(session, config.apiId, config.apiHash, {
      connectionRetries: 5,
    });

    await telegramClient.connect();

    // Verificar que estamos autenticados
    const me = await telegramClient.getMe();
    if (me && 'firstName' in me) {
      console.log(chalk.green(`   ✅ Conectado como: ${me.firstName} ${me.lastName || ''}`));
    }

    // Configurar el handler de mensajes nuevos (sin pasar socket - se usa el de la cola)
    telegramClient.addEventHandler(
      (event: NewMessageEvent) => handleTelegramMessage(event, telegramClient!, config),
      new NewMessage({})
    );

    // Monitorear estado de conexión de Telegram
    setupTelegramConnectionMonitor(config);

    telegramReconnectAttempts = 0; // Reset en conexión exitosa
    return true;
  } catch (error) {
    console.error(chalk.red('❌ Error conectando a Telegram:'), error);
    return false;
  }
}

// Intervalo de monitoreo de conexión
let telegramHealthCheckInterval: NodeJS.Timeout | null = null;

/**
 * Configura el monitoreo de conexión de Telegram para reconexión automática
 */
function setupTelegramConnectionMonitor(config: TelegramBridgeConfig): void {
  // Limpiar intervalo anterior si existe
  if (telegramHealthCheckInterval) {
    clearInterval(telegramHealthCheckInterval);
  }

  // Monitoreo periódico de salud de la conexión cada 30 segundos
  telegramHealthCheckInterval = setInterval(async () => {
    try {
      if (!telegramClient) {
        console.log(
          chalk.gray(`[${new Date().toLocaleTimeString('es-MX')}] `) +
          chalk.yellow(`⚠️ Cliente de Telegram no existe, reconectando...`)
        );
        await attemptTelegramReconnect(config);
        return;
      }

      if (!telegramClient.connected) {
        console.log(
          chalk.gray(`[${new Date().toLocaleTimeString('es-MX')}] `) +
          chalk.yellow(`⚠️ Telegram desconectado, reconectando...`)
        );
        await attemptTelegramReconnect(config);
        return;
      }

      // Ping de salud - intentar obtener información del usuario
      try {
        await telegramClient.getMe();
      } catch (pingError) {
        console.log(
          chalk.gray(`[${new Date().toLocaleTimeString('es-MX')}] `) +
          chalk.yellow(`⚠️ Telegram no responde al ping, reconectando...`)
        );
        await attemptTelegramReconnect(config);
      }
    } catch (error) {
      console.error(
        chalk.red(`❌ Error en health check de Telegram:`),
        error instanceof Error ? error.message : error
      );
    }
  }, 30000); // Verificar cada 30 segundos
}

/**
 * Intenta reconectar a Telegram con backoff exponencial
 */
async function attemptTelegramReconnect(config: TelegramBridgeConfig): Promise<void> {
  if (telegramReconnectAttempts >= MAX_TELEGRAM_RECONNECT_ATTEMPTS) {
    console.log(
      chalk.gray(`[${new Date().toLocaleTimeString('es-MX')}] `) +
      chalk.red(`❌ Máximo de intentos de reconexión de Telegram alcanzado. Reinicia el bot manualmente.`)
    );
    return;
  }

  telegramReconnectAttempts++;
  const delayIndex = Math.min(telegramReconnectAttempts - 1, TELEGRAM_RECONNECT_DELAYS.length - 1);
  const delay = TELEGRAM_RECONNECT_DELAYS[delayIndex];

  console.log(
    chalk.gray(`[${new Date().toLocaleTimeString('es-MX')}] `) +
    chalk.yellow(`🔄 Reconectando Telegram (intento ${telegramReconnectAttempts}/${MAX_TELEGRAM_RECONNECT_ATTEMPTS}) en ${delay/1000}s...`)
  );

  await new Promise(resolve => setTimeout(resolve, delay));

  try {
    // Desconectar cliente actual si existe
    if (telegramClient) {
      try {
        await telegramClient.disconnect();
      } catch {
        // Ignorar errores de desconexión
      }
      telegramClient = null;
    }

    // Reconectar
    const success = await connectTelegramClient(config);
    if (success) {
      console.log(
        chalk.gray(`[${new Date().toLocaleTimeString('es-MX')}] `) +
        chalk.green(`✅ Telegram reconectado exitosamente`)
      );
      // Reanudar cola si estaba pausada por errores de conexión
      if (messageQueue.paused) {
        messageQueue.resume();
      }
    } else {
      // Reintentar
      await attemptTelegramReconnect(config);
    }
  } catch (error) {
    console.error(
      chalk.red(`❌ Error en reconexión de Telegram:`),
      error instanceof Error ? error.message : error
    );
    await attemptTelegramReconnect(config);
  }
}

/**
 * Inicia el cliente de Telegram y el puente de reenvío
 */
export async function startTelegramBridge(sock: WASocket): Promise<TelegramClient | null> {
  const config = validateConfig();
  if (!config) {
    console.log(chalk.gray('   Telegram Bridge deshabilitado'));
    return null;
  }

  currentConfig = config;

  // Actualizar el socket en la cola ANTES de conectar
  messageQueue.updateSocket(sock);

  try {
    console.log(chalk.yellow('🔌 Conectando a Telegram...'));

    const success = await connectTelegramClient(config);
    if (!success) {
      return null;
    }

    console.log(chalk.green(`   ✅ Escuchando ${config.telegramGroupIds.length} grupo(s) de Telegram`));
    console.log(chalk.green(`   ✅ Reenviando a: ${config.whatsappGroupId}`));
    console.log(chalk.green(`   ✅ Cola de mensajes habilitada (procesamiento secuencial)`));
    console.log(chalk.green(`   ✅ Reconexión automática de Telegram habilitada`));

    return telegramClient;
  } catch (error) {
    console.error(chalk.red('❌ Error iniciando Telegram Bridge:'), error);
    return null;
  }
}

/**
 * Detiene el cliente de Telegram
 */
export async function stopTelegramBridge(): Promise<void> {
  // Detener el monitoreo de salud
  if (telegramHealthCheckInterval) {
    clearInterval(telegramHealthCheckInterval);
    telegramHealthCheckInterval = null;
  }

  if (telegramClient) {
    try {
      await telegramClient.disconnect();
    } catch {
      // Ignorar errores de desconexión
    }
    telegramClient = null;
    console.log(chalk.yellow('🔌 Telegram Bridge desconectado'));
  }
}

/**
 * Obtiene el cliente de Telegram (para uso externo si es necesario)
 */
export function getTelegramClient(): TelegramClient | null {
  return telegramClient;
}

/**
 * Obtiene el número de mensajes pendientes en la cola
 */
export function getPendingMessagesCount(): number {
  return messageQueue.pendingCount;
}

/**
 * Pausa la cola de mensajes (llamar durante reconexiones de WhatsApp)
 */
export function pauseMessageQueue(): void {
  messageQueue.pause();
}

/**
 * Reanuda la cola de mensajes (llamar después de reconectarse a WhatsApp)
 */
export function resumeMessageQueue(): void {
  messageQueue.resume();
}

/**
 * Verifica si la cola está pausada
 */
export function isMessageQueuePaused(): boolean {
  return messageQueue.paused;
}

/**
 * Actualiza el socket de WhatsApp en la cola (llamar después de reconexión)
 */
export function updateQueueSocket(sock: WASocket): void {
  messageQueue.updateSocket(sock);
}

/**
 * Reinicia el Telegram Bridge manualmente
 */
export async function restartTelegramBridge(sock: WASocket): Promise<TelegramClient | null> {
  console.log(
    chalk.gray(`[${new Date().toLocaleTimeString('es-MX')}] `) +
    chalk.yellow(`🔄 Reiniciando Telegram Bridge...`)
  );

  // Detener el bridge actual
  await stopTelegramBridge();

  // Resetear intentos de reconexión
  telegramReconnectAttempts = 0;

  // Reiniciar
  return startTelegramBridge(sock);
}

/**
 * Verifica si el cliente de Telegram está conectado
 */
export function isTelegramConnected(): boolean {
  return telegramClient?.connected ?? false;
}
