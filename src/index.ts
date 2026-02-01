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
import { startTelegramBridge, stopTelegramBridge } from './lib/telegram-bridge.js';
import type { WASocket, proto, GroupMetadata } from 'baileys';
import { LRUCache } from './lib/lru-cache.js';

// Variables globales para reconexión
let db: Database;
let handler: MessageHandler;
let isFirstConnection = true;

// Caché de metadatos de grupos con límite de 1000 entradas (LRU)
const groupMetadataCache = new LRUCache<string, GroupMetadata>(1000);

// 🗑️ Caché de mensajes recientes para anti-delete (por grupo, últimos 200 mensajes)
const messageCache = new Map<string, Map<string, proto.IWebMessageInfo>>();
const MAX_CACHED_PER_CHAT = 200;

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
 * Conecta el bot a WhatsApp
 */
async function connectBot(): Promise<WASocket> {
  const conn = await startBot();

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

        // Solo cachear en grupos con anti-delete activo
        if (chatId.endsWith('@g.us')) {
          if (!messageCache.has(chatId)) {
            messageCache.set(chatId, new Map());
          }
          const chatCache = messageCache.get(chatId)!;
          chatCache.set(msg.key.id, msg);

          // Limitar tamaño del caché
          if (chatCache.size > MAX_CACHED_PER_CHAT) {
            const firstKey = chatCache.keys().next().value;
            if (firstKey) chatCache.delete(firstKey);
          }
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
          const chatCache = messageCache.get(chatId);
          if (!chatCache) continue;

          const cachedMsg = chatCache.get(msgId);
          if (!cachedMsg) continue;

          // Extraer contenido del mensaje eliminado
          const sender = cachedMsg.key.participant || cachedMsg.key.remoteJid || 'Desconocido';
          const senderNumber = sender.split('@')[0];
          const pushName = cachedMsg.pushName || senderNumber;

          const content = cachedMsg.message;
          if (!content) continue;

          const msgText =
            content.conversation ||
            content.extendedTextMessage?.text ||
            content.imageMessage?.caption ||
            content.videoMessage?.caption ||
            '';

          // Construir mensaje de reenvío
          let antiDeleteText = `🗑️ *Mensaje eliminado*\n\n👤 *${pushName}* (@${senderNumber}) eliminó:\n`;

          if (msgText) {
            antiDeleteText += `\n💬 ${msgText}`;
          }

          if (content.imageMessage) {
            antiDeleteText += '\n📷 [Imagen]';
          } else if (content.videoMessage) {
            antiDeleteText += '\n🎥 [Video]';
          } else if (content.audioMessage) {
            antiDeleteText += '\n🎵 [Audio]';
          } else if (content.stickerMessage) {
            antiDeleteText += '\n🎨 [Sticker]';
          } else if (content.documentMessage) {
            antiDeleteText += '\n📄 [Documento]';
          } else if (content.contactMessage) {
            antiDeleteText += '\n👤 [Contacto]';
          } else if (content.locationMessage) {
            antiDeleteText += '\n📍 [Ubicación]';
          }

          if (!msgText && !content.imageMessage && !content.videoMessage && !content.audioMessage &&
              !content.stickerMessage && !content.documentMessage && !content.contactMessage &&
              !content.locationMessage) {
            antiDeleteText += '\n📝 [Contenido no disponible]';
          }

          await conn.sendMessage(chatId, {
            text: antiDeleteText,
            mentions: [sender]
          });

          console.log(`🗑️ AntiDelete: Mensaje de ${pushName} reenviado en ${chatId}`);

          // Limpiar del caché
          chatCache.delete(msgId);
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
      if (shouldReconnect(lastDisconnect?.error)) {
        console.log(chalk.yellow('\n🔄 Reconectando en 3 segundos...\n'));
        setTimeout(() => connectBot(), 3000);
      } else {
        console.log(chalk.red('\n❌ Sesión cerrada permanentemente.\n'));
        console.log(chalk.yellow('   Elimina la carpeta CyaltronicSession y reinicia.\n'));
        process.exit(1);
      }
    }

    if (connection === 'open' && isFirstConnection) {
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
process.on('SIGINT', async () => {
  console.log(chalk.yellow('\n\n👋 Cerrando CYALTRONIC...\n'));
  await stopTelegramBridge();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log(chalk.yellow('\n\n👋 Cerrando CYALTRONIC...\n'));
  await stopTelegramBridge();
  process.exit(0);
});

// ¡Iniciar el bot!
main();
