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

interface TelegramBridgeConfig {
  apiId: number;
  apiHash: string;
  stringSession: string;
  telegramGroupIds: string[];
  whatsappGroupId: string;
}

// ============================================================================
// Cola de mensajes para procesamiento secuencial
// ============================================================================

interface QueuedMessage {
  event: NewMessageEvent;
  client: TelegramClient;
  sock: WASocket;
  config: TelegramBridgeConfig;
  retries: number;
}

class MessageQueue {
  private queue: QueuedMessage[] = [];
  private isProcessing = false;
  private readonly maxRetries = 3;
  private readonly delayBetweenMessages = 1000; // 1 segundo entre mensajes
  private readonly retryDelays = [2000, 5000, 10000]; // Backoff exponencial

  /**
   * Agrega un mensaje a la cola para procesamiento
   */
  enqueue(item: Omit<QueuedMessage, 'retries'>): void {
    this.queue.push({ ...item, retries: 0 });
    console.log(
      chalk.gray(`[${new Date().toLocaleTimeString('es-MX')}] `) +
      chalk.cyan(`📥 Mensaje en cola (${this.queue.length} pendientes)`)
    );
    this.processQueue();
  }

  /**
   * Procesa la cola de mensajes secuencialmente
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0) return;

    this.isProcessing = true;

    while (this.queue.length > 0) {
      const item = this.queue.shift()!;

      try {
        await this.processMessage(item);
        // Delay entre mensajes para evitar rate limiting
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
   * Procesa un mensaje individual con manejo de errores
   */
  private async processMessage(item: QueuedMessage): Promise<void> {
    await processMessageInternal(item.event, item.client, item.sock, item.config);
  }

  /**
   * Maneja errores con reintentos y backoff exponencial
   */
  private async handleError(item: QueuedMessage, error: unknown): Promise<void> {
    const isConnectionError = this.isConnectionError(error);

    if (isConnectionError && item.retries < this.maxRetries) {
      item.retries++;
      const delay = this.retryDelays[item.retries - 1] || this.retryDelays[this.retryDelays.length - 1];

      console.log(
        chalk.gray(`[${new Date().toLocaleTimeString('es-MX')}] `) +
        chalk.yellow(`⏳ Reintento ${item.retries}/${this.maxRetries} en ${delay/1000}s...`)
      );

      await this.delay(delay);
      // Re-agregar al frente de la cola para reintentar
      this.queue.unshift(item);
    } else {
      console.error(
        chalk.red(`❌ Error procesando mensaje (sin más reintentos):`),
        error instanceof Error ? error.message : error
      );
    }
  }

  /**
   * Detecta si es un error de conexión que se puede reintentar
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

  /**
   * Utilidad de delay
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Obtiene el número de mensajes pendientes
   */
  get pendingCount(): number {
    return this.queue.length;
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
 * Formatea el mensaje para WhatsApp
 */
function formatMessage(senderName: string, text: string): string {
  return `*Reenvio de Telegram:*\n\n*${senderName}:* ${text}`;
}

/**
 * Obtiene el nombre del remitente
 */
async function getSenderName(client: TelegramClient, event: NewMessageEvent): Promise<string> {
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
    // Ignorar errores al obtener el remitente
  }
  return 'Desconocido';
}

/**
 * Maneja un mensaje nuevo de Telegram - Encola el mensaje para procesamiento secuencial
 */
function handleTelegramMessage(
  event: NewMessageEvent,
  client: TelegramClient,
  sock: WASocket,
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

  // Encolar el mensaje para procesamiento secuencial
  messageQueue.enqueue({ event, client, sock, config });
}

/**
 * Procesa el mensaje internamente (llamado desde la cola)
 */
async function processMessageInternal(
  event: NewMessageEvent,
  client: TelegramClient,
  sock: WASocket,
  config: TelegramBridgeConfig
): Promise<void> {
  const message = event.message;
  const senderName = await getSenderName(client, event);
  const text = message.text || message.message || '';

  // Log del mensaje recibido
  console.log(
    chalk.gray(`[${new Date().toLocaleTimeString('es-MX')}] `) +
    chalk.blue(`[Telegram] `) +
    chalk.green(`${senderName}: `) +
    chalk.white(text.substring(0, 100) + (text.length > 100 ? '...' : ''))
  );

  // Verificar si tiene media (foto o video)
  if (message.photo || message.video) {
    // Descargar el media como Buffer
    const buffer = await client.downloadMedia(message, {}) as Buffer;

    if (buffer) {
      const caption = formatMessage(senderName, text || '');

      if (message.photo) {
        await sock.sendMessage(config.whatsappGroupId, {
          image: buffer,
          caption: caption,
        });
      } else if (message.video) {
        await sock.sendMessage(config.whatsappGroupId, {
          video: buffer,
          caption: caption,
        });
      }

      console.log(
        chalk.gray(`[${new Date().toLocaleTimeString('es-MX')}] `) +
        chalk.green(`✅ Media reenviado a WhatsApp`)
      );
      return;
    }
  }

  // Enviar mensaje de texto
  if (text) {
    const formattedText = formatMessage(senderName, text);

    await sock.sendMessage(config.whatsappGroupId, {
      text: formattedText,
    });

    console.log(
      chalk.gray(`[${new Date().toLocaleTimeString('es-MX')}] `) +
      chalk.green(`✅ Mensaje reenviado a WhatsApp`)
    );
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

  try {
    console.log(chalk.yellow('🔌 Conectando a Telegram...'));

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

    // Configurar el handler de mensajes nuevos
    telegramClient.addEventHandler(
      (event: NewMessageEvent) => handleTelegramMessage(event, telegramClient!, sock, config),
      new NewMessage({})
    );

    console.log(chalk.green(`   ✅ Escuchando ${config.telegramGroupIds.length} grupo(s) de Telegram`));
    console.log(chalk.green(`   ✅ Reenviando a: ${config.whatsappGroupId}`));
    console.log(chalk.green(`   ✅ Cola de mensajes habilitada (procesamiento secuencial)`));

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
  if (telegramClient) {
    await telegramClient.disconnect();
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
