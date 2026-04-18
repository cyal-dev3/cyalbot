/**
 * 🚀 CYALTRONIC - Bot de WhatsApp RPG
 * Punto de entrada principal
 *
 * @author Cyal
 * @version 3.0.0
 */

import 'dotenv/config';
import chalk from 'chalk';
import { startBot, shouldReconnect } from './main.js';
import { MessageHandler } from './handler.js';
import { initDatabase, type Database, getDatabase } from './lib/database.js';
import { loadPlugins } from './plugins/index.js';
import { CONFIG } from './config.js';
import { startAutoEvents } from './lib/auto-events.js';
import { startAutoRegen } from './lib/auto-regen.js';
import { startTelegramBridge, stopTelegramBridge, pauseMessageQueue, resumeMessageQueue, updateQueueSocket } from './lib/telegram-bridge.js';
import { downloadMediaMessage, type WASocket, type proto, type GroupMetadata } from 'baileys';
import { LRUCache } from './lib/lru-cache.js';
import { startCleanupScheduler, stopCleanupScheduler } from './lib/cleanup-scheduler.js';

// Variables globales para reconexión
let db: Database;
let handler: MessageHandler;
let currentConn: WASocket | null = null;
let isFirstConnection = true;
let isReconnecting = false;
let reconnectAttempts = 0;
let reconnectTimeout: NodeJS.Timeout | null = null;
let reconnectCount = 0;
const RECONNECT_BACKOFF_MS = [3000, 6000, 12000, 24000, 30000];

// Caché de metadatos de grupos con límite de 1000 entradas (LRU)
const groupMetadataCache = new LRUCache<string, GroupMetadata>(1000);

// 🗑️ Caché de mensajes recientes para anti-delete — LRU plano 'chatId|msgId' → msg
const MAX_ANTIDELETE_CACHE = 5000;
const MAX_ANTIDELETE_MEDIA_BYTES = 15 * 1024 * 1024; // 15 MB
const messageCache = new LRUCache<string, proto.IWebMessageInfo>(MAX_ANTIDELETE_CACHE);
const antiDeleteKey = (chatId: string, msgId: string): string => `${chatId}|${msgId}`;

export function getReconnectStats(): { count: number; attempts: number } {
  return { count: reconnectCount, attempts: reconnectAttempts };
}

/**
 * Muestra el banner de inicio
 */
function showBanner(): void {
  console.clear();
  console.log('');
  console.log(chalk.cyan('╔═══════════════════════════════════════════════════════╗'));
  console.log(chalk.cyan('║                                                       ║'));
  console.log(chalk.cyan('║') + chalk.yellow.bold('     ██████╗██╗   ██╗ █████╗ ██╗  ████████╗██████╗    ') + chalk.cyan('║'));
  console.log(chalk.cyan('║') + chalk.yellow.bold('    ██╔════╝╚██╗ ██╔╝██╔══██╗██║  ╚══██╔══╝██╔══██╗   ') + chalk.cyan('║'));
  console.log(chalk.cyan('║') + chalk.yellow.bold('    ██║      ╚████╔╝ ███████║██║     ██║   ██████╔╝   ') + chalk.cyan('║'));
  console.log(chalk.cyan('║') + chalk.yellow.bold('    ██║       ╚██╔╝  ██╔══██║██║     ██║   ██╔══██╗   ') + chalk.cyan('║'));
  console.log(chalk.cyan('║') + chalk.yellow.bold('    ╚██████╗   ██║   ██║  ██║███████╗██║   ██║  ██║   ') + chalk.cyan('║'));
  console.log(chalk.cyan('║') + chalk.yellow.bold('     ╚═════╝   ╚═╝   ╚═╝  ╚═╝╚══════╝╚═╝   ╚═╝  ╚═╝   ') + chalk.cyan('║'));
  console.log(chalk.cyan('║                                                       ║'));
  console.log(chalk.cyan('║') + chalk.white.bold('           🤖 CYALTRONIC - WhatsApp Bot RPG            ') + chalk.cyan('║'));
  console.log(chalk.cyan('║') + chalk.gray('                  Versión ' + CONFIG.version + '                       ') + chalk.cyan('║'));
  console.log(chalk.cyan('║                                                       ║'));
  console.log(chalk.cyan('╚═══════════════════════════════════════════════════════╝'));
  console.log('');
}

/**
 * Muestra los comandos disponibles
 */
function showCommands(): void {
  console.log(chalk.cyan('═══════════════════════════════════════'));
  console.log(chalk.cyan('   📝 COMANDOS DISPONIBLES'));
  console.log(chalk.cyan('═══════════════════════════════════════'));
  console.log('');
  console.log(chalk.yellow('   📜 RPG:'));
  console.log(chalk.white('   /verificar nombre.edad  - Registrarse'));
  console.log(chalk.white('   /perfil                 - Ver perfil'));
  console.log(chalk.white('   /nivel                  - Subir nivel'));
  console.log(chalk.white('   /daily                  - Regalo diario'));
  console.log(chalk.white('   /work                   - Trabajar'));
  console.log('');
  console.log(chalk.yellow('   👑 Admin Grupos:'));
  console.log(chalk.white('   /promote @user          - Hacer admin'));
  console.log(chalk.white('   /demote @user           - Quitar admin'));
  console.log(chalk.white('   /kick @user             - Expulsar'));
  console.log(chalk.white('   /delete                 - Eliminar mensaje'));
  console.log('');
  console.log(chalk.yellow('   🔇 Mute (Owner):'));
  console.log(chalk.white('   /automute on/off        - Activar sistema'));
  console.log(chalk.white('   /mute @user             - Silenciar'));
  console.log(chalk.white('   /unmute @user           - Quitar silencio'));
  console.log(chalk.white('   /listmute               - Ver silenciados'));
  console.log('');
  console.log(chalk.yellow('   📢 Notificaciones:'));
  console.log(chalk.white('   /n <mensaje>            - Notificar a todos'));
  console.log('');
  console.log(chalk.yellow('   🎵 Media:'));
  console.log(chalk.white('   /play <canción>         - Descargar música'));
  console.log(chalk.white('   /play <url>             - YouTube/Spotify/SC'));
  console.log('');
  console.log(chalk.cyan('═══════════════════════════════════════'));
  console.log('');
}

/**
 * Obtiene el nombre del grupo desde caché o API
 */
async function getGroupName(conn: WASocket, groupId: string): Promise<string> {
  try {
    // Revisar caché primero
    if (groupMetadataCache.has(groupId)) {
      return groupMetadataCache.get(groupId)!.subject;
    }

    // Obtener de la API
    const metadata = await conn.groupMetadata(groupId);
    groupMetadataCache.set(groupId, metadata);
    return metadata.subject;
  } catch {
    return 'Grupo';
  }
}

/**
 * Extrae el texto de un mensaje
 */
function getMessageText(message: proto.IWebMessageInfo): string {
  const content = message.message;
  if (!content) return '';

  return (
    content.conversation ||
    content.extendedTextMessage?.text ||
    content.imageMessage?.caption ||
    content.videoMessage?.caption ||
    ''
  );
}

/**
 * Log de mensaje entrante con formato
 */
async function logMessage(conn: WASocket, message: proto.IWebMessageInfo): Promise<void> {
  const key = message.key;
  if (!key || !key.remoteJid) return;

  const text = getMessageText(message);
  if (!text) return; // Solo loguear mensajes con texto

  const isGroup = key.remoteJid.endsWith('@g.us');
  const sender = key.participant || key.remoteJid;
  const senderNumber = sender.split('@')[0];
  const pushName = message.pushName || senderNumber;

  if (isGroup) {
    const groupName = await getGroupName(conn, key.remoteJid);
    console.log(
      chalk.gray(`[${new Date().toLocaleTimeString('es-MX')}] `) +
      chalk.cyan(`[${groupName}] `) +
      chalk.green(`${pushName}: `) +
      chalk.white(text.substring(0, 100) + (text.length > 100 ? '...' : ''))
    );
  } else {
    console.log(
      chalk.gray(`[${new Date().toLocaleTimeString('es-MX')}] `) +
      chalk.magenta(`[Privado] `) +
      chalk.green(`${pushName}: `) +
      chalk.white(text.substring(0, 100) + (text.length > 100 ? '...' : ''))
    );
  }
}

/**
 * Maneja actualizaciones de participantes del grupo
 */
async function handleParticipantsUpdate(
  conn: WASocket,
  update: { id: string; participants: string[]; action: string }
): Promise<void> {
  const { id: groupId, participants, action } = update;

  try {
    const groupName = await getGroupName(conn, groupId);
    const db = getDatabase();
    const chatSettings = db.getChatSettings(groupId);

    for (const participant of participants) {
      const participantNumber = participant.split('@')[0];

      switch (action) {
        case 'add':
          console.log(
            chalk.gray(`[${new Date().toLocaleTimeString('es-MX')}] `) +
            chalk.cyan(`[${groupName}] `) +
            chalk.green(`👋 ${participantNumber} se unió al grupo`)
          );
          // Mensaje de bienvenida personalizado
          if (chatSettings.welcome) {
            const welcomeMsg = chatSettings.sWelcome
              .replace(/{user}/g, `@${participantNumber}`)
              .replace(/{group}/g, groupName)
              .replace(/{desc}/g, groupMetadataCache.get(groupId)?.desc || 'Sin descripción');

            await conn.sendMessage(groupId, {
              text: welcomeMsg,
              mentions: [participant]
            });
          }
          break;

        case 'remove':
          console.log(
            chalk.gray(`[${new Date().toLocaleTimeString('es-MX')}] `) +
            chalk.cyan(`[${groupName}] `) +
            chalk.red(`👋 ${participantNumber} salió del grupo`)
          );
          // Mensaje de despedida personalizado
          if (chatSettings.detect) {
            const byeMsg = chatSettings.sBye
              .replace(/{user}/g, participantNumber)
              .replace(/{group}/g, groupName);

            await conn.sendMessage(groupId, {
              text: byeMsg
            });
          }
          break;

        case 'promote':
          console.log(
            chalk.gray(`[${new Date().toLocaleTimeString('es-MX')}] `) +
            chalk.cyan(`[${groupName}] `) +
            chalk.yellow(`👑 ${participantNumber} ahora es admin`)
          );
          await conn.sendMessage(groupId, {
            text: `👑 @${participantNumber} fue promovido a administrador.`,
            mentions: [participant]
          });
          // Invalidar caché del grupo
          groupMetadataCache.delete(groupId);
          break;

        case 'demote':
          console.log(
            chalk.gray(`[${new Date().toLocaleTimeString('es-MX')}] `) +
            chalk.cyan(`[${groupName}] `) +
            chalk.yellow(`📉 ${participantNumber} ya no es admin`)
          );
          await conn.sendMessage(groupId, {
            text: `📉 @${participantNumber} fue degradado de administrador.`,
            mentions: [participant]
          });
          // Invalidar caché del grupo
          groupMetadataCache.delete(groupId);
          break;
      }
    }
  } catch (error) {
    console.error(chalk.red('❌ Error en participantsUpdate:'), error);
  }
}

/**
 * Maneja actualizaciones de grupos
 */
async function handleGroupsUpdate(
  updates: Partial<GroupMetadata>[]
): Promise<void> {
  for (const update of updates) {
    try {
      if (!update.id) continue;

      if (update.subject) {
        console.log(
          chalk.gray(`[${new Date().toLocaleTimeString('es-MX')}] `) +
          chalk.cyan(`[Grupo] `) +
          chalk.yellow(`📝 Nombre cambiado a: ${update.subject}`)
        );
        // Actualizar caché
        if (groupMetadataCache.has(update.id)) {
          const cached = groupMetadataCache.get(update.id)!;
          cached.subject = update.subject;
        }
      }

      if (update.desc) {
        console.log(
          chalk.gray(`[${new Date().toLocaleTimeString('es-MX')}] `) +
          chalk.cyan(`[Grupo] `) +
          chalk.yellow(`📋 Descripción actualizada`)
        );
      }
    } catch (error) {
      console.error(chalk.red('❌ Error en groupsUpdate:'), error);
    }
  }
}

/**
 * Cierra el socket y handler previos antes de reconectar
 * Evita listeners duplicados y fugas de intervalos
 */
function teardownPrevious(): void {
  if (handler) {
    try {
      handler.stop();
    } catch {}
  }
  if (currentConn) {
    try {
      currentConn.ev.removeAllListeners('messages.upsert');
      currentConn.ev.removeAllListeners('messages.update');
      currentConn.ev.removeAllListeners('group-participants.update');
      currentConn.ev.removeAllListeners('groups.update');
      currentConn.ev.removeAllListeners('connection.update');
      currentConn.end(undefined);
    } catch {}
    currentConn = null;
  }
}

/**
 * Conecta el bot a WhatsApp
 */
async function connectBot(): Promise<WASocket> {
  teardownPrevious();

  const conn = await startBot();
  currentConn = conn;

  // Crear nuevo handler con la nueva conexión
  handler = new MessageHandler(conn, db);
  loadPlugins(handler);

  // Escuchar mensajes entrantes
  conn.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    // Cachear mensajes para anti-delete y loguear
    for (const msg of messages) {
      if (!msg.key.fromMe && msg.key.remoteJid && msg.key.id && msg.message) {
        const chatId = msg.key.remoteJid;

        // Solo cachear en grupos (el LRU global se encarga del tamaño)
        if (chatId.endsWith('@g.us')) {
          messageCache.set(antiDeleteKey(chatId, msg.key.id), msg);
        }

        await logMessage(conn, msg);
      }
    }

    // Procesar comandos
    await handler.handle(messages);
  });

  // 🗑️ Escuchar eliminación de mensajes (anti-delete)
  conn.ev.on('messages.update', async (updates) => {
    for (const update of updates) {
      try {
        // Detectar mensaje eliminado (messageStubType 1 = REVOKE)
        if (update.update?.messageStubType === 1 || update.update?.message === null) {
          const chatId = update.key?.remoteJid;
          const msgId = update.key?.id;
          if (!chatId || !msgId || !chatId.endsWith('@g.us')) continue;

          // Verificar si anti-delete está activo
          const currentDb = getDatabase();
          const chatSettings = currentDb.getChatSettings(chatId);
          if (!chatSettings.antiDelete) continue;

          // Buscar mensaje en caché
          const cacheKey = antiDeleteKey(chatId, msgId);
          const cachedMsg = messageCache.get(cacheKey);
          if (!cachedMsg) continue;

          const content = cachedMsg.message;
          if (!content) continue;

          const pushName = cachedMsg.pushName || 'Usuario';

          // Guardia de tamaño: no reenviar medios gigantes (OOM protection)
          const mediaSize = Number(
            content.imageMessage?.fileLength ??
            content.videoMessage?.fileLength ??
            content.audioMessage?.fileLength ??
            content.documentMessage?.fileLength ??
            0
          );
          if (mediaSize > MAX_ANTIDELETE_MEDIA_BYTES) {
            console.log(`🗑️ AntiDelete: media de ${pushName} omitida (${(mediaSize / 1024 / 1024).toFixed(1)} MB > 15 MB)`);
            messageCache.delete(cacheKey);
            continue;
          }

          // Intentar reenviar el contenido original sin texto adicional
          try {
            // Imagen
            if (content.imageMessage) {
              const buffer = await downloadMediaMessage(
                cachedMsg,
                'buffer',
                {},
                { logger: console as any, reuploadRequest: conn.updateMediaMessage }
              ) as Buffer;
              await conn.sendMessage(chatId, {
                image: buffer,
                caption: content.imageMessage.caption || undefined
              });
            }
            // Video o GIF
            else if (content.videoMessage) {
              const buffer = await downloadMediaMessage(
                cachedMsg,
                'buffer',
                {},
                { logger: console as any, reuploadRequest: conn.updateMediaMessage }
              ) as Buffer;
              const isGif = content.videoMessage.gifPlayback || false;
              await conn.sendMessage(chatId, {
                video: buffer,
                caption: isGif ? undefined : (content.videoMessage.caption || undefined),
                mimetype: content.videoMessage.mimetype || 'video/mp4',
                gifPlayback: isGif
              });
            }
            // Audio
            else if (content.audioMessage) {
              const buffer = await downloadMediaMessage(
                cachedMsg,
                'buffer',
                {},
                { logger: console as any, reuploadRequest: conn.updateMediaMessage }
              ) as Buffer;
              await conn.sendMessage(chatId, {
                audio: buffer,
                mimetype: content.audioMessage.mimetype || 'audio/mpeg',
                ptt: content.audioMessage.ptt || false
              });
            }
            // Sticker
            else if (content.stickerMessage) {
              const buffer = await downloadMediaMessage(
                cachedMsg,
                'buffer',
                {},
                { logger: console as any, reuploadRequest: conn.updateMediaMessage }
              ) as Buffer;
              await conn.sendMessage(chatId, { sticker: buffer });
            }
            // Documento
            else if (content.documentMessage) {
              const buffer = await downloadMediaMessage(
                cachedMsg,
                'buffer',
                {},
                { logger: console as any, reuploadRequest: conn.updateMediaMessage }
              ) as Buffer;
              await conn.sendMessage(chatId, {
                document: buffer,
                mimetype: content.documentMessage.mimetype || 'application/octet-stream',
                fileName: content.documentMessage.fileName || 'documento'
              });
            }
            // Texto simple o extendido
            else if (content.conversation || content.extendedTextMessage?.text) {
              const text = content.conversation || content.extendedTextMessage?.text || '';
              await conn.sendMessage(chatId, { text });
            }
            // Contacto
            else if (content.contactMessage) {
              await conn.sendMessage(chatId, {
                contacts: {
                  displayName: content.contactMessage.displayName || 'Contacto',
                  contacts: [{ vcard: content.contactMessage.vcard || '' }]
                }
              });
            }
            // Ubicación
            else if (content.locationMessage) {
              await conn.sendMessage(chatId, {
                location: {
                  degreesLatitude: content.locationMessage.degreesLatitude || 0,
                  degreesLongitude: content.locationMessage.degreesLongitude || 0
                }
              });
            }

            console.log(`🗑️ AntiDelete: Contenido de ${pushName} reenviado`);
          } catch (downloadError) {
            // Si falla la descarga del media, no hacer nada (silencioso)
            console.log(`🗑️ AntiDelete: No se pudo reenviar media de ${pushName}`);
          }

          // Limpiar del caché
          messageCache.delete(cacheKey);
        }
      } catch (error) {
        console.error('❌ Error en anti-delete:', error);
      }
    }
  });

  // Escuchar cambios de participantes (promote, demote, add, remove)
  conn.ev.on('group-participants.update', async (update) => {
    await handleParticipantsUpdate(conn, update);
  });

  // Escuchar cambios de grupo (nombre, descripción)
  conn.ev.on('groups.update', async (updates) => {
    await handleGroupsUpdate(updates);
  });

  // Manejar reconexión automática
  conn.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === 'close') {
      // Pausar cola de Telegram antes de reconectar
      pauseMessageQueue();

      if (isReconnecting) return; // guard: evitar reconexiones superpuestas

      if (shouldReconnect(lastDisconnect?.error)) {
        isReconnecting = true;
        const delay = RECONNECT_BACKOFF_MS[Math.min(reconnectAttempts, RECONNECT_BACKOFF_MS.length - 1)];
        reconnectAttempts++;
        console.log(chalk.yellow(`\n🔄 Reconectando en ${Math.round(delay / 1000)}s (intento ${reconnectAttempts})...\n`));
        if (reconnectTimeout) clearTimeout(reconnectTimeout);
        reconnectTimeout = setTimeout(async () => {
          reconnectTimeout = null;
          try {
            await connectBot();
          } catch (err) {
            console.error(chalk.red('❌ Error al reconectar:'), err);
            isReconnecting = false; // permitir siguiente intento
          }
        }, delay);
      } else {
        console.log(chalk.red('\n❌ Sesión cerrada permanentemente.\n'));
        console.log(chalk.yellow('   Elimina la carpeta CyaltronicSession y reinicia.\n'));
        process.exit(1);
      }
    }

    if (connection === 'open') {
      isReconnecting = false;
      reconnectAttempts = 0;

      if (isFirstConnection) {
        isFirstConnection = false;
        showCommands();

        // Iniciar sistema de eventos automáticos
        startAutoEvents(conn);

        // Iniciar sistema de regeneración pasiva
        startAutoRegen();

        // Iniciar puente de Telegram (en paralelo, no bloquea)
        startTelegramBridge(conn).catch((err) => {
          console.error(chalk.red('❌ Error en Telegram Bridge:'), err);
        });
      } else {
        reconnectCount++;
        // Reconexión - actualizar socket y reanudar cola (sin perder mensajes)
        console.log(chalk.yellow('🔄 Actualizando conexión del Telegram Bridge...'));
        updateQueueSocket(conn);
        resumeMessageQueue();
      }
    }
  });

  return conn;
}

/**
 * Función principal de inicio
 */
async function main(): Promise<void> {
  showBanner();

  try {
    // 1. Inicializar base de datos (solo una vez)
    console.log(chalk.yellow('📦 Inicializando base de datos...'));
    db = await initDatabase('database.json');
    console.log(chalk.green('   ✅ Base de datos lista'));
    console.log('');

    // 1.5 Arrancar tareas de mantenimiento (sweep de tmp/, poda de sesión)
    startCleanupScheduler();

    // 2. Conectar a WhatsApp
    console.log(chalk.yellow('🔌 Conectando a WhatsApp...'));
    await connectBot();

  } catch (error) {
    console.error(chalk.red('\n❌ Error fatal al iniciar:'), error);
    process.exit(1);
  }
}

// Manejar errores no capturados
process.on('uncaughtException', (error) => {
  console.error(chalk.red('❌ Error no capturado:'), error);
});

process.on('unhandledRejection', (reason) => {
  console.error(chalk.red('❌ Promesa rechazada:'), reason);
});

// Manejar cierre graceful
async function gracefulShutdown(signal: string): Promise<void> {
  console.log(chalk.yellow(`\n\n👋 Cerrando CYALTRONIC (${signal})...\n`));
  try {
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }
    if (handler) handler.stop();
    stopCleanupScheduler();
    await stopTelegramBridge();
    if (db) await db.stop(); // flush pendiente + detener intervalo
  } catch (err) {
    console.error(chalk.red('❌ Error durante apagado:'), err);
  }
  process.exit(0);
}

process.on('SIGINT', () => { void gracefulShutdown('SIGINT'); });
process.on('SIGTERM', () => { void gracefulShutdown('SIGTERM'); });

// ¡Iniciar el bot!
main();
