/**
 * Manejador de Mensajes
 * Procesa mensajes entrantes y ejecuta comandos
 */

import { downloadMediaMessage, type WASocket, type proto, type GroupMetadata } from 'baileys';
import type { MessageContext, SerializedMessage, PluginHandler, PluginRegistry, MuteRegistry, CommandContext } from './types/message.js';
import type { Database } from './lib/database.js';
import { CONFIG, isOwnerId } from './config.js';
import { createSticker } from './lib/sticker.js';
import { downloadAuto, detectPlatform, type Platform } from './lib/downloaders.js';
import { findBadWord } from './lib/moderation.js';
import { createLogger } from './lib/logger.js';
import { rememberChatLine, isDirectedToBot, respondWithAI, isAIEnabled } from './lib/ai.js';

const log = createLogger('handler');

// Comandos de duelo que funcionan sin prefijo
const DUEL_COMMANDS_NO_PREFIX = ['g', 'golpe', 'golpear', 'hit', 'rendirse', 'surrender', 'abandonar', 'huir'];

// Patrones de habilidades de clase que funcionan sin prefijo en duelos
const SKILL_PATTERNS_NO_PREFIX = /^(golpe.?brutal|escudo.?defensor|grito.?guerra|bola.?fuego|rayo.?arcano|escudo.?magico|ataque.?furtivo|evadir|robo.?vital|disparo.?preciso|lluvia.?flechas|trampa.?cazador|fuego|rayo|brutal|furtivo|flechas|trampa)$/i;

// Estructura para rastrear mensajes para el comando .clear
interface TrackedMessage {
  key: proto.IMessageKey;
  timestamp: number;
  isCommand?: boolean; // Si es un mensaje de comando (del usuario)
}

// Carácter invisible para "limpiar" mensajes
const INVISIBLE_CHAR = '\u200B'; // Zero-width space

/**
 * Clase principal para manejar mensajes
 */
export class MessageHandler {
  private plugins: PluginRegistry = new Map();
  private contexts: CommandContext[] = [];
  private muteRegistry: MuteRegistry = new Map();
  private spamTracker: Map<string, number[]> = new Map(); // Rastreo de spam por usuario
  // Rastreo de mensajes del bot y comandos para .clear (por grupo)
  private messageTracker: Map<string, TrackedMessage[]> = new Map();
  private readonly MAX_TRACKED_MESSAGES = 150; // Máximo de mensajes a rastrear por grupo
  private readonly MESSAGE_EXPIRY = 60 * 60 * 1000; // 1 hora de expiración (límite de WhatsApp)
  private readonly AUTOCLEAR_DELAY = 2 * 60 * 1000; // 2 minutos para autoclear
  private readonly SPAM_TRACKER_EXPIRY: number;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private autoclearInterval: NodeJS.Timeout | null = null;

  constructor(
    private conn: WASocket,
    private db: Database
  ) {
    this.SPAM_TRACKER_EXPIRY = CONFIG.protection.intervalMs * 10;

    // Cargar datos de mute desde la base de datos al iniciar
    this.loadMuteDataFromDB();

    // Limpiar mensajes viejos cada 5 minutos
    this.cleanupInterval = setInterval(() => this.cleanupOldMessages(), 5 * 60 * 1000);

    // Ejecutar autoclear cada 30 segundos
    this.autoclearInterval = setInterval(() => this.processAutoClear(), 30 * 1000);
  }

  /**
   * Detiene los intervalos internos. Debe llamarse antes de reemplazar el handler
   * (reconexión) o durante apagado graceful para evitar fugas de memoria.
   */
  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    if (this.autoclearInterval) {
      clearInterval(this.autoclearInterval);
      this.autoclearInterval = null;
    }
    this.spamTracker.clear();
    this.messageTracker.clear();
  }

  /**
   * Rastrea un mensaje para poder eliminarlo después con .clear
   */
  trackMessage(chatId: string, key: proto.IMessageKey, isCommand: boolean = false): void {
    if (!this.messageTracker.has(chatId)) {
      this.messageTracker.set(chatId, []);
    }

    const messages = this.messageTracker.get(chatId)!;
    messages.push({ key, timestamp: Date.now(), isCommand });

    // Limitar cantidad de mensajes rastreados
    if (messages.length > this.MAX_TRACKED_MESSAGES) {
      messages.shift();
    }
  }

  /**
   * Obtiene los mensajes rastreados de un grupo
   */
  getTrackedMessages(chatId: string): TrackedMessage[] {
    return this.messageTracker.get(chatId) || [];
  }

  /**
   * Limpia los mensajes rastreados de un grupo
   */
  clearTrackedMessages(chatId: string): void {
    this.messageTracker.set(chatId, []);
  }

  /**
   * Limpia mensajes viejos de todos los grupos y entradas inactivas del spam tracker
   */
  private cleanupOldMessages(): void {
    const now = Date.now();
    for (const [chatId, messages] of this.messageTracker.entries()) {
      const filtered = messages.filter(m => now - m.timestamp < this.MESSAGE_EXPIRY);
      if (filtered.length === 0) {
        this.messageTracker.delete(chatId);
      } else {
        this.messageTracker.set(chatId, filtered);
      }
    }
    // Podar spamTracker: eliminar entradas cuya marca más reciente está caduca
    for (const [key, timestamps] of this.spamTracker.entries()) {
      const latest = timestamps.length ? timestamps[timestamps.length - 1] : 0;
      if (now - latest > this.SPAM_TRACKER_EXPIRY) {
        this.spamTracker.delete(key);
      }
    }
  }

  /**
   * Verifica si autoclear está habilitado en un grupo
   */
  isAutoClearEnabled(chatId: string): boolean {
    const settings = this.db.getChatSettings(chatId);
    return settings.autoClearEnabled || false;
  }

  /**
   * Activa/desactiva autoclear en un grupo
   */
  setAutoClear(chatId: string, enabled: boolean): void {
    this.db.updateChatSettings(chatId, { autoClearEnabled: enabled });
  }

  /**
   * Verifica si el modo compacto está habilitado en un grupo
   */
  isCompactMode(chatId: string): boolean {
    const settings = this.db.getChatSettings(chatId);
    return settings.compactMode || false;
  }

  /**
   * Activa/desactiva modo compacto en un grupo
   */
  setCompactMode(chatId: string, enabled: boolean): void {
    this.db.updateChatSettings(chatId, { compactMode: enabled });
  }

  /**
   * Elimina un mensaje del bot (intenta eliminar directamente, es más confiable)
   */
  async makeMessageInvisible(chatId: string, key: proto.IMessageKey): Promise<boolean> {
    try {
      // Intentar eliminar directamente (funciona con cualquier tipo de mensaje)
      await this.conn.sendMessage(chatId, { delete: key });
      return true;
    } catch (error) {
      // Si falla eliminar, intentar editar a invisible (solo funciona con texto)
      try {
        await this.conn.sendMessage(chatId, {
          text: INVISIBLE_CHAR,
          edit: key
        });
        return true;
      } catch {
        return false;
      }
    }
  }

  /**
   * Procesa autoclear para todos los grupos que lo tienen habilitado
   */
  private async processAutoClear(): Promise<void> {
    for (const [chatId, messages] of this.messageTracker.entries()) {
      // Solo procesar si autoclear está habilitado
      if (!this.isAutoClearEnabled(chatId)) continue;

      const now = Date.now();

      // Filtrar mensajes que tienen más del tiempo configurado
      const messagesToClear = messages.filter(m => now - m.timestamp >= this.AUTOCLEAR_DELAY);

      if (messagesToClear.length === 0) continue;

      // IDs de mensajes procesados exitosamente
      const processedIds = new Set<string>();

      // Procesar cada mensaje
      for (const tracked of messagesToClear) {
        try {
          // Eliminar cualquier tipo de mensaje
          await this.conn.sendMessage(chatId, { delete: tracked.key });

          // Marcar como procesado
          if (tracked.key.id) {
            processedIds.add(tracked.key.id);
          }

          // Pausa más larga para evitar rate limiting (300ms)
          await new Promise(resolve => setTimeout(resolve, 300));
        } catch {
          // Si falla, igual marcarlo para no reintentar infinitamente
          if (tracked.key.id) {
            processedIds.add(tracked.key.id);
          }
        }
      }

      // Remover mensajes procesados del tracker
      const remaining = messages.filter(m => !m.key.id || !processedIds.has(m.key.id));
      this.messageTracker.set(chatId, remaining);
    }
  }

  /**
   * Carga los datos de mute desde la base de datos
   */
  private loadMuteDataFromDB(): void {
    const chats = this.db.data.chats;
    for (const [chatId, settings] of Object.entries(chats)) {
      if (settings.mutedUsers && settings.mutedUsers.length > 0) {
        this.muteRegistry.set(chatId, {
          enabled: true,
          mutedUsers: new Set(settings.mutedUsers)
        });
      }
    }
    log.debug('Datos de mute cargados desde la base de datos');
  }

  /**
   * Guarda los datos de mute en la base de datos
   */
  private saveMuteToDB(groupId: string): void {
    const config = this.muteRegistry.get(groupId);
    const chatSettings = this.db.getChatSettings(groupId);

    chatSettings.mutedUsers = config ? Array.from(config.mutedUsers) : [];
    this.db.updateChatSettings(groupId, { mutedUsers: chatSettings.mutedUsers });
  }

  /**
   * Registra un plugin/comando
   */
  registerPlugin(name: string, plugin: PluginHandler): void {
    this.plugins.set(name, plugin);
  }

  /**
   * Obtiene todos los plugins registrados
   */
  getPlugins(): PluginRegistry {
    return this.plugins;
  }

  /** Registra un contexto de juego con prioridad sobre el registro global. */
  registerContext(context: CommandContext): void {
    this.contexts.push(context);
  }

  getContexts(): readonly CommandContext[] {
    return this.contexts;
  }

  /** Contextos activos para este mensaje (juego en curso del remitente o del chat). */
  private activeContexts(m: SerializedMessage): CommandContext[] {
    const active: CommandContext[] = [];
    for (const context of this.contexts) {
      try {
        if (context.isActive(m)) active.push(context);
      } catch (error) {
        log.error(`contexto ${context.name}:`, error);
      }
    }
    return active;
  }

  private static pluginMatches(plugin: PluginHandler, command: string, fullCommand: string): boolean {
    if (plugin.command instanceof RegExp) {
      return plugin.command.test(command.toLowerCase()) || plugin.command.test(fullCommand.toLowerCase());
    }
    return plugin.command.some((cmd) => cmd.toLowerCase() === command.toLowerCase());
  }

  /**
   * Obtiene el registro de mutes
   */
  getMuteRegistry(): MuteRegistry {
    return this.muteRegistry;
  }

  /**
   * Verifica si automute está activado en un grupo (persistido en DB)
   */
  isAutoMuteEnabled(groupId: string): boolean {
    const chatSettings = this.db.getChatSettings(groupId);
    return chatSettings.autoMuteEnabled || false;
  }

  /**
   * Activa/desactiva automute en un grupo (persistido en DB)
   */
  setAutoMute(groupId: string, enabled: boolean): void {
    this.db.updateChatSettings(groupId, { autoMuteEnabled: enabled });
  }

  /**
   * Agrega un usuario a la lista de mute (persistido en DB)
   */
  muteUser(groupId: string, userId: string): void {
    if (!this.muteRegistry.has(groupId)) {
      this.muteRegistry.set(groupId, {
        enabled: true,
        mutedUsers: new Set()
      });
    }
    this.muteRegistry.get(groupId)!.mutedUsers.add(userId);
    this.saveMuteToDB(groupId);
  }

  /**
   * Quita un usuario de la lista de mute (persistido en DB)
   */
  unmuteUser(groupId: string, userId: string): boolean {
    const config = this.muteRegistry.get(groupId);
    if (config) {
      const result = config.mutedUsers.delete(userId);
      this.saveMuteToDB(groupId);
      return result;
    }
    return false;
  }

  /**
   * Verifica si un usuario está muteado
   */
  isUserMuted(groupId: string, userId: string): boolean {
    const config = this.muteRegistry.get(groupId);
    return config?.mutedUsers.has(userId) || false;
  }

  /**
   * Obtiene metadatos del grupo
   */
  async getGroupMetadata(groupId: string): Promise<GroupMetadata | null> {
    try {
      return await this.conn.groupMetadata(groupId);
    } catch (error) {
      log.error('Error obteniendo metadata del grupo:', error);
      return null;
    }
  }

  /**
   * Verifica si un usuario es admin del grupo
   */
  isAdmin(participants: GroupMetadata['participants'], jid: string): boolean {
    const participant = participants.find(p => p.id === jid);
    return participant?.admin === 'admin' || participant?.admin === 'superadmin';
  }

  /**
   * Elimina un mensaje
   */
  async deleteMessage(chatId: string, messageKey: proto.IMessageKey): Promise<boolean> {
    try {
      await this.conn.sendMessage(chatId, { delete: messageKey });
      return true;
    } catch (error) {
      log.error('Error eliminando mensaje:', error);
      return false;
    }
  }

  /** Identificadores del bot (número y LID) para detectar menciones. */
  botIds(): string[] {
    const ids: string[] = [];
    const user = this.conn.user as { id?: string; lid?: string } | undefined;
    if (user?.id) ids.push(user.id);
    if (user?.lid) ids.push(user.lid);
    return ids;
  }

  /**
   * Serializa un mensaje de Baileys a formato simplificado
   */
  private serializeMessage(m: proto.IWebMessageInfo): SerializedMessage | null {
    const key = m.key;
    if (!key || !key.remoteJid) return null;

    const content = m.message;
    if (!content) return null;

    // Extraer texto del mensaje según el tipo
    const text =
      content.conversation ||
      content.extendedTextMessage?.text ||
      content.imageMessage?.caption ||
      content.videoMessage?.caption ||
      content.buttonsResponseMessage?.selectedDisplayText ||
      content.listResponseMessage?.title ||
      content.templateButtonReplyMessage?.selectedDisplayText ||
      '';

    // Determinar el remitente
    const sender = key.participant || key.remoteJid;
    const isGroup = key.remoteJid.endsWith('@g.us');

    // Extraer menciones
    const mentionedJid = content.extendedTextMessage?.contextInfo?.mentionedJid || [];

    // Extraer mensaje citado
    let quoted: SerializedMessage['quoted'] = undefined;
    const quotedMsg = content.extendedTextMessage?.contextInfo?.quotedMessage;
    if (quotedMsg) {
      const quotedParticipant = content.extendedTextMessage?.contextInfo?.participant;
      const quotedStanzaId = content.extendedTextMessage?.contextInfo?.stanzaId;

      quoted = {
        key: {
          remoteJid: key.remoteJid,
          fromMe: false,
          id: quotedStanzaId,
          participant: quotedParticipant
        },
        sender: quotedParticipant || key.remoteJid,
        text:
          quotedMsg.conversation ||
          quotedMsg.extendedTextMessage?.text ||
          quotedMsg.imageMessage?.caption ||
          '',
        message: quotedMsg
      };
    }

    return {
      key,
      sender,
      chat: key.remoteJid,
      text,
      fromMe: key.fromMe || false,
      isGroup,
      pushName: m.pushName || '',
      mentionedJid,
      quoted,
      rawMessage: m,

      // Método para responder (con tracking para .clear)
      reply: async (replyText: string) => {
        const result = await this.conn.sendMessage(key.remoteJid!, { text: replyText }, { quoted: m });
        // Rastrear mensaje para poder eliminarlo con .clear
        if (result?.key) {
          this.trackMessage(key.remoteJid!, result.key);
        }
        return result;
      },

      // Método para reaccionar
      react: async (emoji: string) => {
        await this.conn.sendMessage(key.remoteJid!, {
          react: { text: emoji, key: m.key }
        });
      }
    };
  }

  // Regex para detectar URLs en mensajes
  private static readonly URL_REGEX = /https?:\/\/[^\s]+/i;

  // Nombres de plataformas para logging
  private static readonly PLATFORM_NAMES: Record<Platform, string> = {
    tiktok: 'TikTok',
    instagram: 'Instagram',
    facebook: 'Facebook',
    twitter: 'Twitter/X',
    pinterest: 'Pinterest',
    threads: 'Threads',
    youtube: 'YouTube',
    unknown: 'Desconocido'
  };

  /**
   * Maneja auto-descarga de URLs detectadas usando la librería universal
   */
  private async handleAutoDownload(m: SerializedMessage, rawMessage: proto.IWebMessageInfo): Promise<void> {
    try {
      const urlMatch = m.text.match(MessageHandler.URL_REGEX);
      if (!urlMatch) return;

      const url = urlMatch[0];
      const platform = detectPlatform(url);

      // Solo procesar plataformas conocidas
      if (platform === 'unknown') return;

      const platformName = MessageHandler.PLATFORM_NAMES[platform];
      log.debug(`AutoDownload: ${platformName} detectado de ${m.sender}`);

      // Usar la librería universal de descargadores
      const result = await downloadAuto(url);

      if (!result.success || !result.medias || result.medias.length === 0) {
        log.debug(`AutoDownload: No se pudo descargar de ${platformName}`);
        return;
      }

      // Construir caption
      let caption = `📥 *${platformName}*`;
      if (result.author) caption += ` | ${result.author}`;
      if (result.title) caption += `\n${result.title.substring(0, 100)}`;

      // Enviar cada media (máximo 5 para autodownload)
      for (let i = 0; i < result.medias.length && i < 5; i++) {
        const media = result.medias[i];

        try {
          const response = await fetch(media.url);
          const buffer = Buffer.from(await response.arrayBuffer());

          if (media.type === 'video') {
            await this.conn.sendMessage(m.chat, {
              video: buffer,
              caption: i === 0 ? caption : undefined,
              mimetype: 'video/mp4'
            }, { quoted: rawMessage });
          } else if (media.type === 'audio') {
            await this.conn.sendMessage(m.chat, {
              audio: buffer,
              mimetype: 'audio/mpeg'
            }, { quoted: rawMessage });
          } else {
            await this.conn.sendMessage(m.chat, {
              image: buffer,
              caption: i === 0 ? caption : undefined
            }, { quoted: rawMessage });
          }
        } catch (mediaError) {
          log.error(`AutoDownload: Error enviando media ${i + 1}:`, mediaError);
        }
      }

      log.debug(`AutoDownload: ${platformName} completado (${result.medias.length} archivos)`);
    } catch (error) {
      log.error('Error en auto-download:', error);
    }
  }

  /**
   * Procesa un lote de mensajes entrantes
   */
  async handle(messages: proto.IWebMessageInfo[]): Promise<void> {
    for (const rawMessage of messages) {
      try {
        await this.processMessage(rawMessage);
      } catch (error) {
        log.error('Error procesando mensaje:', error);
      }
    }
  }

  /**
   * Procesa un mensaje individual
   */
  private async processMessage(rawMessage: proto.IWebMessageInfo): Promise<void> {
    // Serializar mensaje
    const m = this.serializeMessage(rawMessage);
    if (!m) return;

    // Ignorar mensajes propios
    if (m.fromMe) return;

    // 🔒 MODE CHECK: Verificar modo del bot
    const botSettings = this.db.getSettings();
    const botMode = botSettings.botMode || 'public';
    const isOwner = isOwnerId(m.sender);
    if (botMode !== 'public') {
      if (botMode === 'private' && !isOwner) return;
      if (botMode === 'group' && !m.isGroup) return;
      if (botMode === 'inbox' && m.isGroup) return;
    }

    // Variables de grupo
    let groupMetadata: GroupMetadata | undefined;
    let participants: string[] = [];
    let groupAdmins: string[] = [];
    let isAdmin = false;
    let isBotAdmin = false;
    const botJid = this.conn.user?.id;

    // Si es grupo, obtener metadata y verificar mute
    if (m.isGroup) {
      groupMetadata = (await this.getGroupMetadata(m.chat)) || undefined;

      if (groupMetadata) {
        participants = groupMetadata.participants.map(p => p.id);
        groupAdmins = groupMetadata.participants
          .filter(p => p.admin === 'admin' || p.admin === 'superadmin')
          .map(p => p.id);

        isAdmin = this.isAdmin(groupMetadata.participants, m.sender);

        // Verificar si el bot es admin
        // El bot tiene JID con número (5213314313423@s.whatsapp.net)
        // Pero los participantes del grupo usan LIDs (103518073536639@lid)
        // Necesitamos buscar al bot en los participantes y verificar si es admin
        if (botJid) {
          const botNumber = botJid.split(':')[0].split('@')[0];

          // Buscar al bot en los participantes del grupo
          // Primero intentar por JID directo, luego por LID que contenga info del bot
          const botParticipant = groupMetadata.participants.find(p => {
            // Comparar directamente
            if (p.id === botJid) return true;
            if (p.id.includes(botNumber)) return true;

            // Si el participante tiene un número de teléfono asociado
            const pNumber = p.id.split('@')[0];
            if (pNumber === botNumber) return true;

            return false;
          });

          // Si encontramos al bot, verificar si es admin
          if (botParticipant) {
            isBotAdmin = botParticipant.admin === 'admin' || botParticipant.admin === 'superadmin';
          } else {
            // Buscar por el LID del bot
            // Bot LID viene como "103518073536639:3@lid" pero en grupo es "103518073536639@lid"
            const botLid = (this.conn.user as { lid?: string })?.lid;
            if (botLid) {
              // Extraer solo el número del LID (sin :X y sin @lid)
              const botLidNumber = botLid.split(':')[0].split('@')[0];

              // Buscar en participantes por el número del LID
              const botLidParticipant = groupMetadata.participants.find(p => {
                const pLidNumber = p.id.split(':')[0].split('@')[0];
                return pLidNumber === botLidNumber;
              });

              if (botLidParticipant) {
                isBotAdmin = botLidParticipant.admin === 'admin' || botLidParticipant.admin === 'superadmin';
              }
            }
          }
        }

        // 🔇 Verificar si el usuario está muteado y automute está activo
        if (this.isAutoMuteEnabled(m.chat) && this.isUserMuted(m.chat, m.sender)) {
          if (isBotAdmin) {
            // Eliminar mensaje del usuario muteado
            await this.deleteMessage(m.chat, m.key);
            log.debug(`Mensaje eliminado de usuario muteado: ${m.sender}`);
          }
          return; // No procesar comandos de usuarios muteados
        }

        // 🛡️ PROTECCIÓN: Antilink y Antispam
        if (isBotAdmin && !isAdmin && m.text) {
          const chatSettings = this.db.getChatSettings(m.chat);

          // 🔗 ANTILINK: Detectar enlaces de WhatsApp
          if (chatSettings.antiLink) {
            const linkMatch = m.text.match(CONFIG.protection.linkRegex);
            if (linkMatch) {
              await this.deleteMessage(m.chat, m.key);
              await this.conn.sendMessage(m.chat, {
                text: `⚠️ @${m.sender.split('@')[0]} los enlaces de grupos no están permitidos aquí.`,
                mentions: [m.sender]
              });
              log.debug(`Antilink: Enlace eliminado de ${m.sender}`);

              // Agregar advertencia automática
              const warningCount = this.db.addWarning(m.chat, {
                odBy: 'SISTEMA',
                odTo: m.sender,
                reason: 'Enviar enlace de grupo',
                timestamp: Date.now()
              });

              if (warningCount >= CONFIG.protection.maxWarnings) {
                try {
                  await this.conn.groupParticipantsUpdate(m.chat, [m.sender], 'remove');
                  await this.conn.sendMessage(m.chat, {
                    text: `🚫 @${m.sender.split('@')[0]} fue expulsado por acumular ${CONFIG.protection.maxWarnings} advertencias.`,
                    mentions: [m.sender]
                  });
                  this.db.clearWarnings(m.chat, m.sender);
                } catch (e) {
                  log.error('Error expulsando usuario:', e);
                }
              }
              return;
            }
          }

          // 🚫 ANTISPAM: Detectar spam de mensajes
          if (chatSettings.antiSpam) {
            const now = Date.now();
            const userKey = `${m.chat}:${m.sender}`;

            if (!this.spamTracker.has(userKey)) {
              this.spamTracker.set(userKey, []);
            }

            const timestamps = this.spamTracker.get(userKey)!;
            // Filtrar timestamps dentro del intervalo
            const recentTimestamps = timestamps.filter(
              t => now - t < CONFIG.protection.intervalMs
            );
            recentTimestamps.push(now);
            this.spamTracker.set(userKey, recentTimestamps);

            if (recentTimestamps.length > CONFIG.protection.maxMessagesPerInterval) {
              await this.deleteMessage(m.chat, m.key);
              await this.conn.sendMessage(m.chat, {
                text: `⚠️ @${m.sender.split('@')[0]} deja de hacer spam o serás advertido.`,
                mentions: [m.sender]
              });
              log.debug(`Antispam: Spam detectado de ${m.sender}`);

              // Resetear contador para no advertir en cada mensaje
              this.spamTracker.set(userKey, [now]);
              return;
            }
          }

          // 🚫 ANTI-BAD WORDS: Detectar groserías
          if (chatSettings.antiBad && m.text) {
            const badWords = chatSettings.badWords || [];
            if (badWords.length > 0) {
              const foundWord = findBadWord(m.text, badWords);

              if (foundWord) {
                await this.deleteMessage(m.chat, m.key);
                await this.conn.sendMessage(m.chat, {
                  text: `⚠️ @${m.sender.split('@')[0]} las groserías no están permitidas aquí.`,
                  mentions: [m.sender]
                });
                log.debug(`AntiBad: Grosería detectada de ${m.sender}: ${foundWord}`);
                return;
              }
            }
          }
        }
      }
    }

    // 🎨 AUTO-STICKER: Convertir imágenes automáticamente a stickers
    if (m.isGroup && rawMessage.message?.imageMessage) {
      const autoStickerSettings = this.db.getChatSettings(m.chat);
      if (autoStickerSettings.autoSticker) {
        // Solo si no es un comando (no empieza con prefijo)
        const hasPrefix = m.text && CONFIG.prefix.test(m.text);
        if (!hasPrefix) {
          try {
            const mediaBuffer = await downloadMediaMessage(
              rawMessage,
              'buffer',
              {},
              {
                logger: console as any,
                reuploadRequest: this.conn.updateMediaMessage
              }
            ) as Buffer;

            const stickerBuffer = await createSticker(mediaBuffer, {
              packname: 'CYALTRONIC',
              author: m.pushName || 'User',
              categories: ['🎨']
            });

            await this.conn.sendMessage(m.chat, { sticker: stickerBuffer });
            log.debug(`AutoSticker: Imagen convertida de ${m.sender}`);
          } catch (error) {
            log.error('Error en auto-sticker:', error);
          }
        }
      }
    }

    // 📥 AUTO-DOWNLOADER: Detectar URLs y descargar automáticamente
    if (m.isGroup && m.text) {
      const autoDownloadSettings = this.db.getChatSettings(m.chat);
      if (autoDownloadSettings.autoDownload) {
        const hasPrefix = CONFIG.prefix.test(m.text);
        if (!hasPrefix) {
          await this.handleAutoDownload(m, rawMessage);
        }
      }
    }

    if (!m.text) return;

    // Historial corto por chat para /resumen y contexto de la IA
    if (m.isGroup) rememberChatLine(m.chat, m.pushName || m.sender.split('@')[0], m.text);

    // Verificar si es un comando con prefijo
    const prefixMatch = m.text.match(CONFIG.prefix);

    let usedPrefix = '';
    let fullCommand = '';
    let command = '';
    let args: string[] = [];
    let text = '';
    let isNoPrefixDuelCommand = false;

    // Contextos de juego activos: sus plugins ganan a cualquier otro alias,
    // y pueden aceptar el texto sin prefijo.
    const contexts = this.activeContexts(m);
    if (contexts.length > 0) {
      const raw = prefixMatch ? m.text.slice(prefixMatch[0].length).trim() : m.text.trim();
      const [rawCommand, ...rawArgs] = raw.split(/\s+/);
      if (rawCommand) {
        for (const context of contexts) {
          if (!prefixMatch && !context.noPrefix) continue;
          const plugin = context.plugins.find((p) =>
            MessageHandler.pluginMatches(p, rawCommand, raw) && (prefixMatch || p.noPrefix !== false));
          if (!plugin) continue;
          const ctx: MessageContext = {
            conn: this.conn,
            m,
            text: rawArgs.join(' '),
            args: rawArgs,
            command: rawCommand.toLowerCase(),
            usedPrefix: prefixMatch ? prefixMatch[0] : '',
            isOwner,
            isAdmin,
            isBotAdmin,
            isGroup: m.isGroup,
            groupMetadata,
            participants,
            groupAdmins,
            handler: this,
          };
          try {
            log.info(`[${context.name}] ${rawCommand} de ${m.pushName || m.sender.split('@')[0]}`);
            await plugin.handler(ctx);
          } catch (error) {
            log.error(`error en contexto ${context.name} (${rawCommand}):`, error);
            await m.reply(CONFIG.messages.error);
          }
          return;
        }
      }
    }

    if (prefixMatch) {
      // Comando con prefijo normal
      usedPrefix = prefixMatch[0];
      fullCommand = m.text.slice(usedPrefix.length).trim();
      [command, ...args] = fullCommand.split(/\s+/);
      text = args.join(' ');
    } else if (m.isGroup) {
      // Verificar si es un comando de duelo sin prefijo
      const textLower = m.text.toLowerCase().trim();
      const firstWord = textLower.split(/\s+/)[0];

      if (DUEL_COMMANDS_NO_PREFIX.includes(firstWord) || SKILL_PATTERNS_NO_PREFIX.test(textLower)) {
        isNoPrefixDuelCommand = true;
        usedPrefix = '';
        fullCommand = m.text.trim();
        [command, ...args] = fullCommand.split(/\s+/);
        text = args.join(' ');
      } else {
        // Texto normal en grupo: solo interesa si va dirigido al bot
        if (isAIEnabled() && CONFIG.ai.replyToMentions && this.db.getChatSettings(m.chat).aiChat !== false
          && isDirectedToBot(m, this.botIds())) {
          await respondWithAI({ conn: this.conn, m, rawMessage, text: m.text, isOwner });
        }
        return;
      }
    } else {
      // Privado sin prefijo: conversación directa con la IA
      if (isAIEnabled() && CONFIG.ai.privateChat) {
        await respondWithAI({ conn: this.conn, m, rawMessage, text: m.text, isOwner });
      }
      return;
    }

    if (!command) return;

    const senderNumber = m.sender.split('@')[0];

    // Buscar plugin que maneje el comando
    for (const [name, plugin] of this.plugins) {
      let matches = false;

      if (plugin.command instanceof RegExp) {
        // Para comandos de duelo sin prefijo, probar contra el texto completo (para habilidades multi-palabra)
        const testString = isNoPrefixDuelCommand ? fullCommand.toLowerCase() : command.toLowerCase();
        matches = plugin.command.test(testString);
      } else if (Array.isArray(plugin.command)) {
        matches = plugin.command.some(cmd =>
          cmd.toLowerCase() === command.toLowerCase()
        );
      }

      if (matches) {
        // Verificar permisos
        if (plugin.owner && !isOwner) {
          await m.reply(CONFIG.messages.ownerOnly);
          return;
        }

        if (plugin.group && !m.isGroup) {
          await m.reply(CONFIG.messages.groupOnly);
          return;
        }

        if (plugin.admin && !isAdmin && !isOwner) {
          await m.reply('❌ Este comando es solo para administradores del grupo.');
          return;
        }

        if (plugin.botAdmin && !isBotAdmin) {
          await m.reply('❌ Necesito ser administrador del grupo para ejecutar este comando.');
          return;
        }

        if (plugin.register) {
          const user = this.db.getUser(m.sender);
          if (!user.registered) {
            await m.reply(CONFIG.messages.notRegistered);
            return;
          }
        }

        // Construir contexto
        const ctx: MessageContext = {
          conn: this.conn,
          m,
          text,
          args,
          command: command.toLowerCase(),
          usedPrefix,
          isOwner,
          isAdmin,
          isBotAdmin,
          isGroup: m.isGroup,
          groupMetadata,
          participants,
          groupAdmins,
          handler: this
        };

        // Rastrear el mensaje del comando para .clear (excepto el propio .clear y .autoclear)
        const cmdLower = command.toLowerCase();
        if (cmdLower !== 'clear' && cmdLower !== 'limpiar' && cmdLower !== 'clean' && cmdLower !== 'autoclear') {
          this.trackMessage(m.chat, m.key, true); // true = es comando de usuario
        }

        // Ejecutar plugin
        try {
          log.info(`${isNoPrefixDuelCommand ? 'duelo' : 'comando'} ${usedPrefix}${command} de ${m.pushName || senderNumber}`);
          await plugin.handler(ctx);
        } catch (error) {
          log.error(`Error en plugin ${name}:`, error);
          if (error instanceof Error) {
            await m.reply(`❌ Error: ${error.message}`);
          } else {
            await m.reply(CONFIG.messages.error);
          }
        }

        break; // Solo ejecutar un plugin por mensaje
      }
    }
  }
}
