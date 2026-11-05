import { randomBytes } from 'node:crypto';
import type { WASocket, proto, GroupMetadata, AnyMessageContent, MiscMessageGenerationOptions } from 'baileys';
import type {
  MessageContext, SerializedMessage, PluginHandler, PluginRegistry, MuteRegistry, CommandContext, AliasCollision, TargetOptions,
} from './types/message.js';
import { DEFAULT_CHAT_SETTINGS, type ChatSettings } from './types/database.js';
import type { UserRPG } from './types/user.js';
import type { Database } from './lib/database.js';
import { CONFIG, isOwnerId, sameUser } from './config.js';
import { createSticker } from './lib/sticker.js';
import { handleAutoDownload } from './lib/autodownload.js';
import { findBadWord } from './lib/moderation.js';
import { createLogger } from './lib/logger.js';
import { LRUCache } from './lib/lru-cache.js';
import { unwrapMessage, getText, getMentions, getQuoted, downloadMedia } from './lib/wa-message.js';
import { commandAliases, suggestCommand } from './lib/command-suggest.js';
import { resolveGroupRoles, getGroupMetadataCached, invalidateGroupMetadata, botIdentities, type GroupRoles } from './lib/group-events.js';
import { getTargetUser } from './lib/utils.js';
import * as scheduler from './lib/scheduler.js';

const log = createLogger('handler');

// La IA arrastra el SDK de Anthropic y el catálogo de plugins; solo se carga si está configurada.
type AIModule = typeof import('./lib/ai.js');
let aiModule: Promise<AIModule> | null = null;
function loadAI(): Promise<AIModule> {
  return (aiModule ??= import('./lib/ai.js'));
}

interface TrackedMessage {
  key: proto.IMessageKey;
  timestamp: number;
  /** true si es el mensaje de comando del usuario (no del bot). */
  isCommand?: boolean;
}

interface RegisteredPlugin {
  name: string;
  plugin: PluginHandler;
  /** Posición de registro: entre dos candidatos gana el menor. */
  order: number;
}

interface Dispatch {
  name: string;
  plugin: PluginHandler;
  /** Nombre del contexto que capturó el comando, si lo hubo. */
  context?: string;
}

interface Incoming {
  m: SerializedMessage;
  usedPrefix: string;
  command: string;
  args: string[];
  isOwner: boolean;
  chatSettings: ChatSettings;
  roles: () => Promise<GroupRoles>;
}

const MAX_TRACKED_MESSAGES = 150;
/** WhatsApp solo permite borrar mensajes de la última hora. */
const MESSAGE_EXPIRY_MS = 60 * 60 * 1000;
const AUTOCLEAR_DELAY_MS = 2 * 60 * 1000;
const SUGGEST_COOLDOWN_MS = 10_000;
const MAX_ECHOED_COMMAND = 30;
/** Comandos de limpieza cuyo mensaje no debe rastrearse (hasta que group-delete marque `untracked`). */
const UNTRACKED_COMMANDS = new Set(['clear', 'limpiar', 'clean', 'autoclear', 'autolimpiar', 'autoclean']);

export class MessageHandler {
  private plugins: PluginRegistry = new Map();
  private aliasIndex = new Map<string, RegisteredPlugin>();
  /** Plugins con RegExp que no es una alternancia simple; se prueban en orden. */
  private patternPlugins: RegisteredPlugin[] = [];
  private aliasCollisions: AliasCollision[] = [];
  private registrationOrder = 0;
  private contexts: CommandContext[] = [];
  private autoClearRunning = false;
  private muteRegistry: MuteRegistry = new Map();
  private spamTracker = new Map<string, number[]>();
  private messageTracker = new Map<string, TrackedMessage[]>();
  private suggestionCooldown = new LRUCache<string, number>(500);
  private readonly spamTrackerExpiry: number;
  private readonly timerPrefix: string;

  constructor(
    private conn: WASocket,
    private db: Database,
  ) {
    this.spamTrackerExpiry = CONFIG.protection.intervalMs * 10;
    this.timerPrefix = `handler:${randomBytes(2).toString('hex')}`;
    this.loadMuteDataFromDB();
    scheduler.every(`${this.timerPrefix}:cleanup`, 5 * 60 * 1000, () => this.cleanupOldMessages());
    scheduler.every(`${this.timerPrefix}:autoclear`, 30 * 1000, () => this.processAutoClear());
  }

  /** Detiene los timers internos. Llamar antes de reemplazar el handler (reconexión) o al apagar. */
  stop(): void {
    scheduler.stop(`${this.timerPrefix}:cleanup`);
    scheduler.stop(`${this.timerPrefix}:autoclear`);
    this.spamTracker.clear();
    this.messageTracker.clear();
  }

  // ---------------------------------------------------------------------------
  // Rastreo de mensajes para /clear y autoclear (solo grupos)
  // ---------------------------------------------------------------------------

  trackMessage(chatId: string, key: proto.IMessageKey, isCommand = false): void {
    if (!chatId.endsWith('@g.us')) return;
    let messages = this.messageTracker.get(chatId);
    if (!messages) {
      messages = [];
      this.messageTracker.set(chatId, messages);
    }
    messages.push({ key, timestamp: Date.now(), isCommand });
    if (messages.length > MAX_TRACKED_MESSAGES) messages.shift();
  }

  getTrackedMessages(chatId: string): TrackedMessage[] {
    return this.messageTracker.get(chatId) || [];
  }

  clearTrackedMessages(chatId: string): void {
    this.messageTracker.delete(chatId);
  }

  private cleanupOldMessages(): void {
    const now = Date.now();
    for (const [chatId, messages] of this.messageTracker.entries()) {
      const filtered = messages.filter((m) => now - m.timestamp < MESSAGE_EXPIRY_MS);
      if (filtered.length === 0) this.messageTracker.delete(chatId);
      else this.messageTracker.set(chatId, filtered);
    }
    for (const [key, timestamps] of this.spamTracker.entries()) {
      const latest = timestamps.length ? timestamps[timestamps.length - 1] : 0;
      if (now - latest > this.spamTrackerExpiry) this.spamTracker.delete(key);
    }
  }

  private async processAutoClear(): Promise<void> {
    // Una pasada puede durar más que el intervalo (300 ms por mensaje); si se solapan, se borraría dos veces.
    if (this.autoClearRunning) return;
    this.autoClearRunning = true;
    try {
      for (const [chatId, messages] of this.messageTracker.entries()) {
        if (!this.isAutoClearEnabled(chatId)) continue;
        const now = Date.now();
        const toClear = messages.filter((m) => now - m.timestamp >= AUTOCLEAR_DELAY_MS);
        if (toClear.length === 0) continue;

        for (const tracked of toClear) {
          // Se quita del rastreo antes de borrar para no reintentar aunque falle.
          this.untrack(chatId, tracked);
          try {
            await this.conn.sendMessage(chatId, { delete: tracked.key });
            // Pausa para no disparar el rate limit de WhatsApp.
            await new Promise((resolve) => setTimeout(resolve, 300));
          } catch {
            // Mensajes de más de una hora o ya borrados: no hay nada que hacer.
          }
        }
      }
    } finally {
      this.autoClearRunning = false;
    }
  }

  private untrack(chatId: string, tracked: TrackedMessage): void {
    const messages = this.messageTracker.get(chatId);
    if (!messages) return;
    const index = messages.indexOf(tracked);
    if (index !== -1) messages.splice(index, 1);
    if (messages.length === 0) this.messageTracker.delete(chatId);
  }

  // ---------------------------------------------------------------------------
  // Ajustes por chat (sin crear entradas en la BD al consultar)
  // ---------------------------------------------------------------------------

  /** Ajustes del chat si existen en la BD; si no, los defaults sin persistir nada. */
  private readChatSettings(chatId: string): ChatSettings {
    return this.db.data.chats[chatId] ? this.db.getChatSettings(chatId) : structuredClone(DEFAULT_CHAT_SETTINGS);
  }

  isAutoClearEnabled(chatId: string): boolean {
    return this.db.data.chats[chatId]?.autoClearEnabled === true;
  }

  setAutoClear(chatId: string, enabled: boolean): void {
    this.db.updateChatSettings(chatId, { autoClearEnabled: enabled });
  }

  isCompactMode(chatId: string): boolean {
    return this.db.data.chats[chatId]?.compactMode === true;
  }

  setCompactMode(chatId: string, enabled: boolean): void {
    this.db.updateChatSettings(chatId, { compactMode: enabled });
  }

  isAutoMuteEnabled(groupId: string): boolean {
    return this.db.data.chats[groupId]?.autoMuteEnabled === true;
  }

  setAutoMute(groupId: string, enabled: boolean): void {
    this.db.updateChatSettings(groupId, { autoMuteEnabled: enabled });
  }

  // ---------------------------------------------------------------------------
  // Mute
  // ---------------------------------------------------------------------------

  private loadMuteDataFromDB(): void {
    for (const [chatId, settings] of Object.entries(this.db.data.chats)) {
      if (settings.mutedUsers && settings.mutedUsers.length > 0) {
        this.muteRegistry.set(chatId, { enabled: true, mutedUsers: new Set(settings.mutedUsers) });
      }
    }
  }

  private saveMuteToDB(groupId: string): void {
    const config = this.muteRegistry.get(groupId);
    this.db.updateChatSettings(groupId, { mutedUsers: config ? Array.from(config.mutedUsers) : [] });
  }

  muteUser(groupId: string, userId: string): void {
    let config = this.muteRegistry.get(groupId);
    if (!config) {
      config = { enabled: true, mutedUsers: new Set() };
      this.muteRegistry.set(groupId, config);
    }
    config.mutedUsers.add(userId);
    this.saveMuteToDB(groupId);
  }

  unmuteUser(groupId: string, userId: string): boolean {
    const config = this.muteRegistry.get(groupId);
    if (!config) return false;
    const result = config.mutedUsers.delete(userId);
    this.saveMuteToDB(groupId);
    return result;
  }

  isUserMuted(groupId: string, userId: string): boolean {
    return this.muteRegistry.get(groupId)?.mutedUsers.has(userId) || false;
  }

  // ---------------------------------------------------------------------------
  // Registro de plugins y contextos
  // ---------------------------------------------------------------------------

  registerPlugin(name: string, plugin: PluginHandler): void {
    if (this.plugins.has(name)) {
      log.warn(`el nombre de plugin ${name} ya estaba registrado; se sobrescribe`);
      this.unregisterPlugin(name);
    }
    this.plugins.set(name, plugin);
    const entry: RegisteredPlugin = { name, plugin, order: this.registrationOrder++ };

    const aliases = commandAliases(plugin);
    if (aliases.length === 0) {
      this.patternPlugins.push(entry);
      return;
    }
    for (const alias of aliases) {
      const taken = this.aliasIndex.get(alias);
      if (taken) {
        log.warn(`alias "${alias}" de ${name} ya lo usa ${taken.name}; gana ${taken.name}`);
        this.aliasCollisions.push({ alias, winner: taken.name, loser: name });
        continue;
      }
      this.aliasIndex.set(alias, entry);
    }
  }

  /** Quita el plugin del índice y de los patrones para que el nuevo registro con ese nombre lo reemplace. */
  private unregisterPlugin(name: string): void {
    for (const [alias, entry] of this.aliasIndex) {
      if (entry.name === name) this.aliasIndex.delete(alias);
    }
    this.patternPlugins = this.patternPlugins.filter((entry) => entry.name !== name);
    this.aliasCollisions = this.aliasCollisions.filter((c) => c.winner !== name && c.loser !== name);
  }

  getPlugins(): PluginRegistry {
    return this.plugins;
  }

  getAliasCollisions(): readonly AliasCollision[] {
    return this.aliasCollisions;
  }

  findPlugin(alias: string): RegisteredPlugin | null {
    return this.aliasIndex.get(alias.toLowerCase()) ?? null;
  }

  /**
   * Candidato del registro global: el índice de alias y los plugins con RegExp
   * compleja compiten por orden de registro ("el primero registrado gana").
   */
  private findGlobal(command: string, body: string): RegisteredPlugin | null {
    const indexed = this.findPlugin(command);
    // patternPlugins está en orden de registro: solo cuentan los anteriores al hit del índice.
    for (const entry of this.patternPlugins) {
      if (indexed && entry.order > indexed.order) break;
      if (MessageHandler.pluginMatches(entry.plugin, command, body)) return entry;
    }
    return indexed;
  }

  /** Registra un contexto de juego con prioridad sobre el registro global. */
  registerContext(context: CommandContext): void {
    this.contexts.push(context);
  }

  getContexts(): readonly CommandContext[] {
    return this.contexts;
  }

  private static pluginMatches(plugin: PluginHandler, command: string, body: string): boolean {
    if (plugin.command instanceof RegExp) {
      // Las habilidades de clase son varias palabras: se prueba también el texto completo.
      return plugin.command.test(command) || plugin.command.test(body.toLowerCase());
    }
    return plugin.command.some((cmd) => cmd.toLowerCase() === command);
  }

  /** Busca el comando en los contextos activos para este mensaje. */
  private matchContext(m: SerializedMessage, command: string, body: string, hasPrefix: boolean): Dispatch | null {
    for (const context of this.contexts) {
      let active = false;
      try {
        active = context.isActive(m);
      } catch (error) {
        log.error(`contexto ${context.name}.isActive:`, error);
      }
      if (!active) continue;
      if (!hasPrefix && !context.noPrefix) continue;
      for (const plugin of context.plugins) {
        if (!hasPrefix && plugin.noPrefix === false) continue;
        if (MessageHandler.pluginMatches(plugin, command, body)) {
          return { name: `${context.name}:${commandAliases(plugin)[0] ?? command}`, plugin, context: context.name };
        }
      }
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Utilidades de envío
  // ---------------------------------------------------------------------------

  async getGroupMetadata(groupId: string): Promise<GroupMetadata | null> {
    return getGroupMetadataCached(this.conn, groupId);
  }

  async deleteMessage(chatId: string, messageKey: proto.IMessageKey): Promise<boolean> {
    try {
      await this.conn.sendMessage(chatId, { delete: messageKey });
      return true;
    } catch (error) {
      log.error('error eliminando mensaje:', error);
      return false;
    }
  }

  /** Identificadores del bot (número y LID) para detectar menciones. */
  botIds(): string[] {
    return botIdentities(this.conn);
  }

  /** Envía y rastrea (solo grupos) para /clear. */
  async send(chatId: string, content: AnyMessageContent, options?: MiscMessageGenerationOptions): Promise<proto.WebMessageInfo | undefined> {
    const result = await this.conn.sendMessage(chatId, content, options);
    if (result?.key) this.trackMessage(chatId, result.key);
    return result;
  }

  // ---------------------------------------------------------------------------
  // Serialización
  // ---------------------------------------------------------------------------

  private serializeMessage(raw: proto.IWebMessageInfo): SerializedMessage | null {
    const key = raw.key;
    if (!key || !key.remoteJid) return null;
    const content = unwrapMessage(raw);
    if (!content) return null;

    const chat = key.remoteJid;
    const sender = key.participant || chat;
    const isGroup = chat.endsWith('@g.us');
    const botIds = this.botIds();

    let quoted: SerializedMessage['quoted'];
    const quotedContent = getQuoted(content);
    if (quotedContent) {
      const participant = quotedContent.participant;
      quoted = {
        key: {
          remoteJid: chat,
          fromMe: participant ? botIds.some((id) => sameUser(id, participant)) : false,
          id: quotedContent.stanzaId,
          participant,
        },
        sender: participant || chat,
        text: quotedContent.text,
        message: quotedContent.message,
      };
    }

    return {
      key,
      sender,
      chat,
      text: getText(content),
      fromMe: key.fromMe || false,
      isGroup,
      pushName: raw.pushName || '',
      mentionedJid: getMentions(content),
      quoted,
      rawMessage: raw,
      message: content,
      reply: (text: string) => this.send(chat, { text }, { quoted: raw }),
      react: async (emoji: string) => {
        await this.conn.sendMessage(chat, { react: { text: emoji, key } });
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Automatismos de grupo
  // ---------------------------------------------------------------------------

  private async handleAutoSticker(m: SerializedMessage, rawMessage: proto.IWebMessageInfo): Promise<void> {
    try {
      const mediaBuffer = await downloadMedia(this.conn, rawMessage);
      const stickerBuffer = await createSticker(mediaBuffer, {
        packname: CONFIG.botName,
        author: m.pushName || 'User',
        categories: ['🎨'],
      });
      await this.conn.sendMessage(m.chat, { sticker: stickerBuffer });
      log.debug(`autosticker: imagen convertida de ${m.sender}`);
    } catch (error) {
      log.error('error en autosticker:', error);
    }
  }

  /** Antilink, antispam y antibad. Devuelve true si el mensaje fue eliminado. */
  private async applyProtections(m: SerializedMessage, settings: ChatSettings): Promise<boolean> {
    const mention = { mentions: [m.sender] };
    const tag = `@${m.sender.split('@')[0]}`;

    // search() ignora el flag g y lastIndex, a diferencia de test().
    if (settings.antiLink && m.text.search(CONFIG.protection.linkRegex) !== -1) {
      await this.deleteMessage(m.chat, m.key);
      await this.conn.sendMessage(m.chat, { text: `⚠️ ${tag} los enlaces de grupos no están permitidos aquí.`, ...mention });
      log.debug(`antilink: enlace eliminado de ${m.sender}`);
      const warnings = this.db.addWarning(m.chat, { odBy: 'SISTEMA', odTo: m.sender, reason: 'Enviar enlace de grupo', timestamp: Date.now() });
      if (warnings >= CONFIG.protection.maxWarnings) {
        try {
          await this.conn.groupParticipantsUpdate(m.chat, [m.sender], 'remove');
          await this.conn.sendMessage(m.chat, { text: `🚫 ${tag} fue expulsado por acumular ${CONFIG.protection.maxWarnings} advertencias.`, ...mention });
          this.db.clearWarnings(m.chat, m.sender);
        } catch (error) {
          log.error('error expulsando usuario:', error);
        }
      }
      return true;
    }

    if (settings.antiSpam) {
      const now = Date.now();
      const userKey = `${m.chat}:${m.sender}`;
      const recent = (this.spamTracker.get(userKey) ?? []).filter((t) => now - t < CONFIG.protection.intervalMs);
      recent.push(now);
      this.spamTracker.set(userKey, recent);
      if (recent.length > CONFIG.protection.maxMessagesPerInterval) {
        await this.deleteMessage(m.chat, m.key);
        await this.conn.sendMessage(m.chat, { text: `⚠️ ${tag} deja de hacer spam o serás advertido.`, ...mention });
        log.debug(`antispam: spam detectado de ${m.sender}`);
        this.spamTracker.set(userKey, [now]);
        return true;
      }
    }

    if (settings.antiBad && settings.badWords?.length) {
      const found = findBadWord(m.text, settings.badWords);
      if (found) {
        await this.deleteMessage(m.chat, m.key);
        await this.conn.sendMessage(m.chat, { text: `⚠️ ${tag} las groserías no están permitidas aquí.`, ...mention });
        log.debug(`antibad: grosería de ${m.sender}: ${found}`);
        return true;
      }
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Procesamiento
  // ---------------------------------------------------------------------------

  async handle(messages: proto.IWebMessageInfo[]): Promise<void> {
    for (const rawMessage of messages) {
      try {
        await this.processMessage(rawMessage);
      } catch (error) {
        log.error('error procesando mensaje:', error);
      }
    }
  }

  private async processMessage(rawMessage: proto.IWebMessageInfo): Promise<void> {
    const m = this.serializeMessage(rawMessage);
    if (!m || m.fromMe) return;

    const isOwner = isOwnerId(m.sender);
    const botMode = this.db.getSettings().botMode || 'public';
    if (botMode === 'private' && !isOwner) return;
    if (botMode === 'group' && !m.isGroup) return;
    if (botMode === 'inbox' && m.isGroup) return;

    const chatSettings = this.readChatSettings(m.chat);
    let cachedRoles: GroupRoles | null = null;
    const roles = async (): Promise<GroupRoles> => (cachedRoles ??= await resolveGroupRoles(this.conn, m.chat, m.sender));

    if (m.isGroup) {
      const needsProtection = chatSettings.autoMuteEnabled || chatSettings.antiLink || chatSettings.antiSpam || chatSettings.antiBad;
      if (needsProtection) {
        const r = await roles();
        if (chatSettings.autoMuteEnabled && this.isUserMuted(m.chat, m.sender)) {
          if (r.isBotAdmin) {
            await this.deleteMessage(m.chat, m.key);
            log.debug(`mensaje eliminado de usuario muteado: ${m.sender}`);
          }
          return;
        }
        if (r.isBotAdmin && !r.isAdmin && m.text && (await this.applyProtections(m, chatSettings))) return;
      }

      const hasPrefix = Boolean(m.text) && CONFIG.prefix.test(m.text);
      if (!hasPrefix) {
        if (chatSettings.autoSticker && m.message?.imageMessage) await this.handleAutoSticker(m, rawMessage);
        if (chatSettings.autoDownload && m.text) await handleAutoDownload(this.conn, m, m.text);
      }
    }

    if (!m.text) return;

    const ai = CONFIG.ai.enabled ? await loadAI() : null;
    if (ai && m.isGroup) ai.rememberChatLine(m.chat, m.pushName || m.sender.split('@')[0], m.text);

    const prefixMatch = m.text.match(CONFIG.prefix);
    const usedPrefix = prefixMatch ? prefixMatch[0] : '';
    const body = m.text.slice(usedPrefix.length).trim();
    const [rawCommand = '', ...args] = body.split(/\s+/);
    const command = rawCommand.toLowerCase();
    const incoming: Incoming = { m, usedPrefix, command, args, isOwner, chatSettings, roles };

    // Los contextos activos (duelo, dungeon, mesa de blackjack...) van antes
    // que el registro global y son los únicos que aceptan texto sin prefijo.
    if (command) {
      const dispatch = this.matchContext(m, command, body, Boolean(prefixMatch));
      if (dispatch) {
        await this.execute(dispatch, incoming);
        return;
      }
    }

    if (!prefixMatch) {
      if (!ai) return;
      if (m.isGroup) {
        if (CONFIG.ai.replyToMentions && chatSettings.aiChat !== false && ai.isDirectedToBot(m, this.botIds())) {
          await ai.respondWithAI({ conn: this.conn, m, rawMessage, text: m.text, isOwner });
        }
      } else if (CONFIG.ai.privateChat) {
        await ai.respondWithAI({ conn: this.conn, m, rawMessage, text: m.text, isOwner });
      }
      return;
    }

    if (!command) return;
    const found = this.findGlobal(command, body);
    if (!found) {
      await this.replyUnknownCommand(incoming);
      return;
    }
    await this.execute(found, incoming);
  }

  /** Alias visibles para quien pregunta, según sus permisos. */
  visibleAliases(who: { isOwner: boolean; isAdmin: boolean; isGroup: boolean }): { aliases: string[]; primary: Set<string> } {
    const aliases: string[] = [];
    const primary = new Set<string>();
    const seenPlugins = new Set<PluginHandler>();
    for (const [alias, { plugin }] of this.aliasIndex) {
      if (plugin.owner && !who.isOwner) continue;
      if (plugin.admin && !who.isAdmin && !who.isOwner) continue;
      if (plugin.group && !who.isGroup) continue;
      aliases.push(alias);
      if (!seenPlugins.has(plugin)) {
        seenPlugins.add(plugin);
        primary.add(alias);
      }
    }
    return { aliases, primary };
  }

  private async replyUnknownCommand({ m, command: typed, usedPrefix, isOwner, chatSettings, roles }: Incoming): Promise<void> {
    // "..." o "/" solos no son intentos de comando.
    if (!/[a-z0-9]/i.test(typed)) return;
    // Lo que se repite al chat (y se compara con cada alias) se acota: nadie teclea comandos tan largos.
    const command = typed.length > MAX_ECHOED_COMMAND ? `${typed.slice(0, MAX_ECHOED_COMMAND)}…` : typed;
    const now = Date.now();
    const last = this.suggestionCooldown.get(m.chat);
    if (last !== undefined && now - last < SUGGEST_COOLDOWN_MS) return;
    this.suggestionCooldown.set(m.chat, now);

    if (chatSettings.compactMode) {
      await m.react('❓');
      return;
    }
    const isAdmin = m.isGroup ? (await roles()).isAdmin : false;
    const { aliases, primary } = this.visibleAliases({ isOwner, isAdmin, isGroup: m.isGroup });
    const suggestion = suggestCommand(command, aliases, { primary });
    const hint = suggestion ? ` ¿Quisiste decir *${usedPrefix}${suggestion}*?` : '';
    await m.reply(`No existe ${usedPrefix}${command}.${hint} Escribe ${usedPrefix}menu para ver todo.`);
  }

  private recordStat(name: string, ok: boolean): void {
    const stats = this.db.data.stats;
    const entry = (stats[name] ??= { total: 0, success: 0, failed: 0, lastUsed: 0 });
    entry.total++;
    if (ok) entry.success++;
    else entry.failed++;
    entry.lastUsed = Date.now();
    this.db.markDirty();
  }

  private async execute(dispatch: Dispatch, incoming: Incoming): Promise<void> {
    const { name, plugin } = dispatch;
    const { m, usedPrefix, command, args, isOwner, chatSettings } = incoming;

    if (plugin.owner && !isOwner) {
      await m.reply(CONFIG.messages.ownerOnly);
      return;
    }
    if (plugin.group && !m.isGroup) {
      await m.reply(CONFIG.messages.groupOnly);
      return;
    }

    let roles: GroupRoles | null = null;
    if (m.isGroup && (plugin.admin || plugin.botAdmin || plugin.group)) {
      roles = await incoming.roles();
      // El owner no necesita la metadata para pasar la comprobación de admin.
      if (!roles.metadata && (plugin.botAdmin || (plugin.admin && !isOwner))) {
        await m.reply('⚠️ No pude leer los datos del grupo, inténtalo en unos segundos.');
        return;
      }
    }
    if (plugin.admin && !isOwner && !roles?.isAdmin) {
      // Si acaban de ascenderlo, la metadata cacheada está vieja: se descarta para el próximo intento.
      if (m.isGroup) invalidateGroupMetadata(m.chat);
      await m.reply('❌ Este comando es solo para administradores del grupo.');
      return;
    }
    if (plugin.botAdmin && !roles?.isBotAdmin) {
      if (m.isGroup) invalidateGroupMetadata(m.chat);
      await m.reply(
        '❌ Necesito ser administrador del grupo para ejecutar este comando.\n\n' +
        'Un admin puede dármelo en: Info del grupo > Participantes > (bot) > Hacer admin del grupo.',
      );
      return;
    }
    if (plugin.register && !this.db.getUser(m.sender).registered) {
      await m.reply(CONFIG.messages.notRegistered);
      return;
    }

    const db = this.db;
    let user: UserRPG | undefined;
    const ctx: MessageContext = {
      conn: this.conn,
      m,
      text: args.join(' '),
      args,
      command,
      usedPrefix,
      isOwner,
      isAdmin: roles?.isAdmin ?? false,
      isBotAdmin: roles?.isBotAdmin ?? false,
      isGroup: m.isGroup,
      groupMetadata: roles?.metadata ?? undefined,
      participants: roles?.participants,
      groupAdmins: roles?.admins,
      handler: this,
      chatSettings,
      get user(): UserRPG {
        return (user ??= db.getUser(m.sender));
      },
      send: (content, options) => this.send(m.chat, content, options),
      target: (options?: TargetOptions) => getTargetUser(m, { args, ...options }),
    };

    if (!plugin.untracked && !UNTRACKED_COMMANDS.has(command)) {
      this.trackMessage(m.chat, m.key, true);
    }

    const who = m.pushName || m.sender.split('@')[0];
    log.info(`${dispatch.context ? `[${dispatch.context}] ` : ''}${usedPrefix}${command} de ${who}`);
    try {
      await plugin.handler(ctx);
      this.recordStat(name, true);
    } catch (error) {
      this.recordStat(name, false);
      const ref = randomBytes(3).toString('hex');
      log.error(`plugin ${name} [${ref}]:`, error);
      try {
        await m.reply(`${CONFIG.messages.error} (ref ${ref})`);
      } catch (replyError) {
        log.error(`no se pudo avisar del error ${ref}:`, replyError);
      }
    }
  }
}
