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
 * Maneja un mensaje nuevo de Telegram
 */
async function handleTelegramMessage(
  event: NewMessageEvent,
  client: TelegramClient,
  sock: WASocket,
  config: TelegramBridgeConfig
): Promise<void> {
  try {
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
      try {
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
      } catch (mediaError) {
        console.error(chalk.red('❌ Error descargando media de Telegram:'), mediaError);
        // Si falla la descarga de media, enviar solo el texto
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
  } catch (error) {
    console.error(chalk.red('❌ Error procesando mensaje de Telegram:'), error);
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
