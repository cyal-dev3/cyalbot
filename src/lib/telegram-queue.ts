/**
 * Cola persistente de mensajes Telegram -> WhatsApp. Procesa en orden, guarda
 * cada entrada en data/telegram-queue.json (y la media en data/bridge-media/)
 * para sobrevivir reinicios, reintenta solo los errores de conexión y se pausa
 * con reanudación automática cuando WhatsApp no responde.
 */

import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import { mkdir, readFile, unlink, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { createLogger } from './logger.js';
import { RateLimiter } from './rate-limit.js';

const log = createLogger('telegram');

export type MediaType = 'photo' | 'video';

export interface QueuedMessage {
  id: string;
  senderName: string;
  text: string;
  whatsappGroupId: string;
  mediaType?: MediaType;
  /** Ruta del archivo de media guardado; ausente si no hay media o se omitió */
  mediaPath?: string;
  /** El mensaje traía media que no se pudo conservar (tamaño o descarga) */
  mediaOmitted?: boolean;
  timestamp: number;
  retries: number;
}

export interface EnqueueInput {
  id: string;
  senderName: string;
  text: string;
  whatsappGroupId: string;
  mediaType?: MediaType;
  mediaBuffer?: Buffer;
  mediaOmitted?: boolean;
}

/** Lo que la cola necesita del socket de WhatsApp. */
export interface QueueSocket {
  user?: unknown;
  sendMessage(jid: string, content: Record<string, unknown>): Promise<{ key?: { id?: string | null } | null } | undefined>;
}

export interface Delivery {
  caption: string;
  mentions?: string[];
  /** Se llama con el id del mensaje enviado (p. ej. para asociarlo a un pick) */
  onSent?: (messageId: string | undefined) => void;
}

export interface QueueOptions {
  /** Carpeta de persistencia (telegram-queue.json y bridge-media/) */
  dir?: string;
  delayBetweenMessages?: number;
  retryDelays?: number[];
  maxConsecutiveErrors?: number;
  /** Primera espera antes de reanudar tras una pausa por errores; se duplica en cada pausa seguida */
  autoResumeMs?: number;
  maxAutoResumeMs?: number;
  warnQueueSize?: number;
  warnAgeMs?: number;
  /** Aviso al owner (texto corto). Nunca debe lanzar. */
  notify?: (text: string) => Promise<void> | void;
  /** Construye caption y menciones para un mensaje; por defecto "*remitente:* texto" */
  prepare?: (item: QueuedMessage) => Promise<Delivery> | Delivery;
  now?: () => number;
}

interface QueueFile {
  queue: QueuedMessage[];
}

const MEDIA_EXT: Record<MediaType, string> = { photo: 'jpg', video: 'mp4' };

export function isConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return ['connection closed', 'connection lost', 'timed out', 'socket hang up', 'econnreset', 'network', 'socket no disponible', 'not open']
    .some((needle) => message.includes(needle));
}

export class MessageQueue {
  private queue: QueuedMessage[] = [];
  private readonly ready = new Map<string, Promise<void>>();
  private readonly file: Low<QueueFile>;
  private readonly mediaDir: string;
  private sock: QueueSocket | null = null;
  private processing = false;
  private paused = false;
  private pausedByErrors = 0;
  private consecutiveErrors = 0;
  private resumeTimer: NodeJS.Timeout | null = null;
  private stopped = false;
  private persist: Promise<void> = Promise.resolve();
  private readonly warnThrottle = new RateLimiter(1, 15 * 60_000);

  private readonly delayBetweenMessages: number;
  private readonly retryDelays: number[];
  private readonly maxConsecutiveErrors: number;
  private readonly autoResumeMs: number;
  private readonly maxAutoResumeMs: number;
  private readonly warnQueueSize: number;
  private readonly warnAgeMs: number;
  private readonly notify: (text: string) => Promise<void> | void;
  private readonly prepare: (item: QueuedMessage) => Promise<Delivery> | Delivery;
  private readonly now: () => number;

  constructor(options: QueueOptions = {}) {
    const dir = options.dir ?? 'data';
    this.mediaDir = join(dir, 'bridge-media');
    this.file = new Low(new JSONFile<QueueFile>(join(dir, 'telegram-queue.json')), { queue: [] });
    this.delayBetweenMessages = options.delayBetweenMessages ?? 1_000;
    this.retryDelays = options.retryDelays ?? [2_000, 5_000, 10_000, 15_000, 30_000];
    this.maxConsecutiveErrors = options.maxConsecutiveErrors ?? 5;
    this.autoResumeMs = options.autoResumeMs ?? 60_000;
    this.maxAutoResumeMs = options.maxAutoResumeMs ?? 10 * 60_000;
    this.warnQueueSize = options.warnQueueSize ?? 50;
    this.warnAgeMs = options.warnAgeMs ?? 15 * 60_000;
    this.notify = options.notify ?? (() => undefined);
    this.prepare = options.prepare ?? ((item) => ({ caption: `*${item.senderName}:* ${item.text}`.trim() }));
    this.now = options.now ?? Date.now;
  }

  // ---------------------------------------------------------------------------
  // Persistencia
  // ---------------------------------------------------------------------------

  /** Recarga lo que quedó en disco en la ejecución anterior. Llamar una vez al arrancar. */
  async load(): Promise<number> {
    await mkdir(this.mediaDir, { recursive: true });
    try {
      await this.file.read();
    } catch (error) {
      log.error('telegram-queue.json ilegible, se empieza con la cola vacía:', error instanceof Error ? error.message : error);
      this.file.data = { queue: [] };
    }
    const stored = Array.isArray(this.file.data?.queue) ? this.file.data.queue : [];
    const restored: QueuedMessage[] = [];
    for (const item of stored) {
      if (!item || typeof item.id !== 'string' || typeof item.whatsappGroupId !== 'string') continue;
      if (item.mediaPath && !(await exists(item.mediaPath))) {
        item.mediaPath = undefined;
        item.mediaOmitted = true;
      }
      restored.push({ ...item, retries: 0 });
    }
    this.queue = [...restored, ...this.queue];
    await this.save();
    if (restored.length > 0) log.info(`${restored.length} mensaje(s) recuperados de la cola persistida`);
    this.kick();
    return restored.length;
  }

  private save(): Promise<void> {
    // Las escrituras se encadenan para que dos guardados seguidos no se pisen.
    this.persist = this.persist
      .then(async () => {
        this.file.data = { queue: this.queue };
        await this.file.write();
      })
      .catch((error) => log.error('no se pudo guardar telegram-queue.json:', error instanceof Error ? error.message : error));
    return this.persist;
  }

  // ---------------------------------------------------------------------------
  // Entrada
  // ---------------------------------------------------------------------------

  /**
   * Encola de forma síncrona (el orden queda fijado al llamar) y devuelve en
   * `ready` la promesa de que media y JSON están en disco. El envío espera a `ready`.
   */
  enqueue(input: EnqueueInput): { item: QueuedMessage; ready: Promise<void> } {
    const item: QueuedMessage = {
      id: input.id,
      senderName: input.senderName,
      text: input.text,
      whatsappGroupId: input.whatsappGroupId,
      mediaType: input.mediaType,
      mediaOmitted: input.mediaOmitted,
      timestamp: this.now(),
      retries: 0,
    };
    if (input.mediaBuffer && input.mediaType) {
      item.mediaPath = join(this.mediaDir, `${safeFileName(item.id)}.${MEDIA_EXT[input.mediaType]}`);
    }
    this.queue.push(item);

    const ready = (async () => {
      if (item.mediaPath && input.mediaBuffer) {
        try {
          await mkdir(this.mediaDir, { recursive: true });
          await writeFile(item.mediaPath, input.mediaBuffer);
        } catch (error) {
          log.warn(`no se pudo guardar la media de ${item.id}, se enviará solo texto:`, error instanceof Error ? error.message : error);
          item.mediaPath = undefined;
          item.mediaOmitted = true;
        }
      }
      await this.save();
    })();
    this.ready.set(item.id, ready);
    ready.finally(() => this.ready.delete(item.id)).catch(() => undefined);

    log.info(`mensaje de ${item.senderName} en cola (${this.queue.length} pendientes)`);
    this.checkBacklog();
    this.kick();
    return { item, ready };
  }

  // ---------------------------------------------------------------------------
  // Procesamiento
  // ---------------------------------------------------------------------------

  updateSocket(sock: QueueSocket | null): void {
    this.sock = sock;
    if (sock) {
      log.debug('socket de WhatsApp actualizado en la cola');
      this.kick();
    }
  }

  private kick(): void {
    if (this.processing || this.paused || this.stopped || this.queue.length === 0) return;
    void this.processQueue();
  }

  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      while (this.queue.length > 0 && !this.paused && !this.stopped) {
        if (!this.sock?.user) {
          log.debug('socket de WhatsApp no disponible, la cola espera');
          return;
        }
        this.checkBacklog();
        const item = this.queue[0];
        await (this.ready.get(item.id) ?? Promise.resolve());
        try {
          await this.deliver(item);
          this.queue.shift();
          this.consecutiveErrors = 0;
          this.pausedByErrors = 0;
          void this.save();
          if (this.queue.length > 0 && this.delayBetweenMessages > 0) await sleep(this.delayBetweenMessages);
        } catch (error) {
          await this.handleError(item, error);
        }
      }
    } finally {
      this.processing = false;
    }
  }

  private async deliver(item: QueuedMessage): Promise<void> {
    const sock = this.sock;
    if (!sock?.user) throw new Error('Connection Closed: socket no disponible');

    const delivery = await this.prepare(item);
    let caption = delivery.caption;
    const mentions = delivery.mentions ?? [];

    let media: Buffer | null = null;
    if (item.mediaPath) {
      try {
        media = await readFile(item.mediaPath);
      } catch (error) {
        log.warn(`media de ${item.id} ilegible, se envía solo texto:`, error instanceof Error ? error.message : error);
        item.mediaOmitted = true;
      }
    }
    if (!media && (item.mediaOmitted || item.mediaType)) caption = `${caption}\n\n[media omitida]`.trim();

    let sent;
    if (media && item.mediaType === 'photo') {
      sent = await sock.sendMessage(item.whatsappGroupId, { image: media, caption, mentions });
    } else if (media && item.mediaType === 'video') {
      sent = await sock.sendMessage(item.whatsappGroupId, { video: media, caption, mentions });
    } else if (caption) {
      sent = await sock.sendMessage(item.whatsappGroupId, { text: caption, mentions });
    } else {
      log.warn(`mensaje ${item.id} de ${item.senderName} sin texto ni media, se descarta`);
      return;
    }
    delivery.onSent?.(sent?.key?.id ?? undefined);

    if (media) {
      log.info(`enviado con ${item.mediaType} (${this.queue.length - 1} pendientes)`);
      await unlink(item.mediaPath!).catch(() => undefined);
    } else if (item.mediaOmitted || item.mediaType) {
      log.warn(`enviado solo texto, media omitida (${this.queue.length - 1} pendientes)`);
    } else {
      log.info(`enviado (${this.queue.length - 1} pendientes)`);
    }
  }

  private async handleError(item: QueuedMessage, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    if (!isConnectionError(error)) {
      // Un error que no es de red no se arregla reintentando: se descarta y se avisa.
      this.queue.shift();
      void this.save();
      if (item.mediaPath) unlink(item.mediaPath).catch(() => undefined);
      log.error(`mensaje de ${item.senderName} descartado: ${message}`);
      await this.safeNotify(`Puente Telegram: descarté un mensaje de ${item.senderName} por un error no recuperable: ${message.slice(0, 200)}`);
      return;
    }

    this.consecutiveErrors++;
    item.retries++;
    if (this.consecutiveErrors >= this.maxConsecutiveErrors) {
      this.pausedByErrors++;
      const wait = Math.min(this.autoResumeMs * 2 ** (this.pausedByErrors - 1), this.maxAutoResumeMs);
      log.warn(`${this.consecutiveErrors} errores de conexión seguidos; cola pausada ${Math.round(wait / 1000)}s con ${this.queue.length} mensajes guardados`);
      this.pause(wait);
      return;
    }
    const delay = this.retryDelays[Math.min(item.retries - 1, this.retryDelays.length - 1)];
    log.warn(`reintento ${item.retries} en ${Math.round(delay / 1000)}s (${this.queue.length} en cola): ${message}`);
    await sleep(delay);
  }

  private checkBacklog(): void {
    const oldest = this.queue[0];
    const age = oldest ? this.now() - oldest.timestamp : 0;
    const tooMany = this.queue.length > this.warnQueueSize;
    const tooOld = age > this.warnAgeMs;
    if (!tooMany && !tooOld) return;
    if (!this.warnThrottle.try('backlog', this.now()).ok) return;
    const reason = tooMany
      ? `hay ${this.queue.length} mensajes en cola`
      : `el mensaje más antiguo lleva ${Math.round(age / 60_000)} min esperando`;
    log.warn(`atasco en la cola: ${reason}`);
    void this.safeNotify(`Puente Telegram: ${reason}${this.paused ? ' (cola pausada)' : ''}.`);
  }

  private async safeNotify(text: string): Promise<void> {
    try {
      await this.notify(text);
    } catch (error) {
      log.debug('no se pudo avisar al owner:', error instanceof Error ? error.message : error);
    }
  }

  // ---------------------------------------------------------------------------
  // Control
  // ---------------------------------------------------------------------------

  /** Pausa; con `autoResumeMs` programa la reanudación automática. */
  pause(autoResumeMs?: number): void {
    this.paused = true;
    if (this.resumeTimer) clearTimeout(this.resumeTimer);
    this.resumeTimer = null;
    if (autoResumeMs !== undefined && autoResumeMs > 0) {
      this.resumeTimer = setTimeout(() => {
        this.resumeTimer = null;
        log.info('reanudando la cola automáticamente');
        this.resume();
      }, autoResumeMs);
      if (typeof this.resumeTimer.unref === 'function') this.resumeTimer.unref();
    }
    log.info(`cola pausada (${this.queue.length} mensajes guardados)`);
  }

  resume(): void {
    if (this.resumeTimer) clearTimeout(this.resumeTimer);
    this.resumeTimer = null;
    this.paused = false;
    this.consecutiveErrors = 0;
    log.info(`cola reanudada (${this.queue.length} pendientes)`);
    this.kick();
  }

  /** Detiene el procesamiento (apagado); lo encolado queda en disco. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.resumeTimer) clearTimeout(this.resumeTimer);
    this.resumeTimer = null;
    await this.persist;
  }

  get pendingCount(): number {
    return this.queue.length;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  get isProcessing(): boolean {
    return this.processing;
  }

  /** Antigüedad en ms del mensaje más antiguo en cola, o 0. */
  get oldestAgeMs(): number {
    return this.queue[0] ? this.now() - this.queue[0].timestamp : 0;
  }

  snapshot(): readonly QueuedMessage[] {
    return this.queue;
  }
}

function safeFileName(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    if (typeof t.unref === 'function') t.unref();
  });
}
