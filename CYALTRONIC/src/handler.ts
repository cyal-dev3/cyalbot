/**
 * 📨 Manejador de Mensajes de CYALTRONIC
 * Procesa mensajes entrantes y ejecuta comandos
 */

import type { WASocket, proto, GroupMetadata } from 'baileys';
import type { MessageContext, SerializedMessage, PluginHandler, PluginRegistry, MuteRegistry } from './types/message.js';
import type { Database } from './lib/database.js';
import { CONFIG } from './config.js';

// Comandos de duelo que funcionan sin prefijo
const DUEL_COMMANDS_NO_PREFIX = ['g', 'golpe', 'golpear', 'hit', 'rendirse', 'surrender', 'abandonar', 'huir'];

// Patrones de habilidades de clase que funcionan sin prefijo en duelos
const SKILL_PATTERNS_NO_PREFIX = /^(golpe.?brutal|escudo.?defensor|grito.?guerra|bola.?fuego|rayo.?arcano|escudo.?magico|ataque.?furtivo|evadir|robo.?vital|disparo.?preciso|lluvia.?flechas|trampa.?cazador|fuego|rayo|brutal|furtivo|flechas|trampa)$/i;

/**
 * Clase principal para manejar mensajes
 */
export class MessageHandler {
  private plugins: PluginRegistry = new Map();
  private muteRegistry: MuteRegistry = new Map();
  private autoMuteEnabled: Map<string, boolean> = new Map(); // Grupos con automute activado

  constructor(
    private conn: WASocket,
    private db: Database
  ) {}

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

  /**
   * Obtiene el registro de mutes
   */
  getMuteRegistry(): MuteRegistry {
    return this.muteRegistry;
  }

  /**
   * Verifica si automute está activado en un grupo
   */
  isAutoMuteEnabled(groupId: string): boolean {
    return this.autoMuteEnabled.get(groupId) || false;
  }

  /**
   * Activa/desactiva automute en un grupo
   */
  setAutoMute(groupId: string, enabled: boolean): void {
    this.autoMuteEnabled.set(groupId, enabled);
  }

  /**
   * Agrega un usuario a la lista de mute
   */
  muteUser(groupId: string, userId: string): void {
    if (!this.muteRegistry.has(groupId)) {
      this.muteRegistry.set(groupId, {
        enabled: true,
        mutedUsers: new Set()
      });
    }
    this.muteRegistry.get(groupId)!.mutedUsers.add(userId);
  }

  /**
   * Quita un usuario de la lista de mute
   */
  unmuteUser(groupId: string, userId: string): boolean {
    const config = this.muteRegistry.get(groupId);
    if (config) {
      return config.mutedUsers.delete(userId);
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
      console.error('❌ Error obteniendo metadata del grupo:', error);
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
      console.error('❌ Error eliminando mensaje:', error);
      return false;
    }
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

      // Método para responder
      reply: async (replyText: string) => {
        return this.conn.sendMessage(key.remoteJid!, { text: replyText }, { quoted: m });
      },

      // Método para reaccionar
      react: async (emoji: string) => {
        await this.conn.sendMessage(key.remoteJid!, {
          react: { text: emoji, key: m.key }
        });
      }
    };
  }

  /**
   * Procesa un lote de mensajes entrantes
   */
  async handle(messages: proto.IWebMessageInfo[]): Promise<void> {
    for (const rawMessage of messages) {
      try {
        await this.processMessage(rawMessage);
      } catch (error) {
        console.error('❌ Error procesando mensaje:', error);
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

    // Inicializar usuario en DB
    this.db.getUser(m.sender);

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
            console.log(`🔇 Mensaje eliminado de usuario muteado: ${m.sender}`);
          }
          return; // No procesar comandos de usuarios muteados
        }
      }
    }

    // Si no hay texto, no procesar comandos
    if (!m.text) return;

    // Verificar si es un comando con prefijo
    const prefixMatch = m.text.match(CONFIG.prefix);

    let usedPrefix = '';
    let fullCommand = '';
    let command = '';
    let args: string[] = [];
    let text = '';
    let isNoPrefixDuelCommand = false;

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
        // No es comando con prefijo ni comando de duelo, ignorar
        return;
      }
    } else {
      // Chat privado sin prefijo, ignorar
      return;
    }

    if (!command) return;

    // Verificar si es owner
    const senderNumber = m.sender.split('@')[0].replace(/[^0-9]/g, '');
    const isOwner = CONFIG.owners.some(owner =>
      senderNumber.includes(owner) || owner.includes(senderNumber)
    );

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
          groupAdmins
        };

        // Ejecutar plugin
        try {
          const cmdLog = isNoPrefixDuelCommand ? `⚔️ Duelo: ${command}` : `📨 Comando: ${usedPrefix}${command}`;
          console.log(`${cmdLog} | De: ${m.pushName || senderNumber}`);
          await plugin.handler(ctx);
        } catch (error) {
          console.error(`❌ Error en plugin ${name}:`, error);
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
