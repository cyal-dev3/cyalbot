import type { WASocket } from 'baileys';
import { createLogger } from '../logger.js';
import { getDatabase } from '../database.js';
import { releaseEscrow } from './bets.js';
import { CASINO_LIMITS } from './state.js';

const log = createLogger('mesas');

// ---------------------------------------------------------------------------
// Conexión activa: los timers de las mesas no tienen ctx, así que cada comando
// de juego registra la conexión con la que se ejecutó.
// ---------------------------------------------------------------------------

let activeConn: WASocket | null = null;

export function setActiveConnection(conn: WASocket): void {
  activeConn = conn;
}

export function getConn(): WASocket | null {
  return activeConn;
}

// ---------------------------------------------------------------------------
// Sesiones
// ---------------------------------------------------------------------------

export interface Session<TPlayer, TState, TPhase extends string = string> {
  /** Identificador único de la mesa: distingue una mesa cerrada de otra nueva en el mismo grupo. */
  id: number;
  groupId: string;
  game: string;
  phase: TPhase;
  state: TState;
  players: Map<string, TPlayer>;
  /** Orden de turnos (JIDs). */
  order: string[];
  turn: number;
  createdAt: number;
  updatedAt: number;
  /** Fin de la fase actual (ms epoch); 0 si no hay temporizador. */
  phaseEndsAt: number;
  timer: NodeJS.Timeout | null;
}

export interface SessionManagerOptions {
  game: string;
  /** Nombre que ve el usuario en `mesa`. */
  label: string;
  maxTables?: number;
  idleMs?: number;
}

export interface ActiveTable {
  game: string;
  label: string;
  phase: string;
  remainingSeconds: number;
  players: string[];
}

const managers: GameSessionManager<unknown, unknown, string>[] = [];
let nextSessionId = 1;

/** Barrido periódico: una mesa atascada no debe depender de que alguien abra otra. */
const SWEEP_MS = 60_000;
setInterval(() => {
  for (const m of managers) m.sweepIdle();
}, SWEEP_MS).unref();

export class GameSessionManager<TPlayer, TState, TPhase extends string = string> {
  readonly game: string;
  readonly label: string;
  private readonly maxTables: number;
  private readonly idleMs: number;
  private readonly sessions = new Map<string, Session<TPlayer, TState, TPhase>>();

  constructor(options: SessionManagerOptions) {
    this.game = options.game;
    this.label = options.label;
    this.maxTables = options.maxTables ?? CASINO_LIMITS.maxTables;
    this.idleMs = options.idleMs ?? CASINO_LIMITS.idleMs;
    managers.push(this as GameSessionManager<unknown, unknown, string>);
  }

  /** Crea la mesa del grupo. Devuelve null si ya existe o se alcanzó el límite. */
  create(groupId: string, init: { phase: TPhase; state: TState }): Session<TPlayer, TState, TPhase> | null {
    this.sweepIdle();
    if (this.sessions.has(groupId) || this.sessions.size >= this.maxTables) return null;
    const now = Date.now();
    const session: Session<TPlayer, TState, TPhase> = {
      id: nextSessionId++,
      groupId, game: this.game, phase: init.phase, state: init.state,
      players: new Map(), order: [], turn: 0,
      createdAt: now, updatedAt: now, phaseEndsAt: 0, timer: null,
    };
    this.sessions.set(groupId, session);
    return session;
  }

  /** Mesa del grupo; una mesa vencida (sin actividad > idleMs) se cierra con reembolso y no se devuelve. */
  get(groupId: string): Session<TPlayer, TState, TPhase> | undefined {
    const s = this.sessions.get(groupId);
    if (s && Date.now() - s.updatedAt > this.idleMs) {
      log.warn(`${this.game} ${groupId}: mesa inactiva cerrada con reembolso`);
      this.close(groupId, { refund: true });
      return undefined;
    }
    return s;
  }

  has(groupId: string): boolean {
    return this.get(groupId) !== undefined;
  }

  /**
   * True si `session` sigue siendo la mesa viva del grupo. Las resoluciones con
   * animación (await) lo comprueban antes de pagar: un `cerrarmesa` a mitad pudo
   * reembolsar y una mesa nueva pudo abrirse en el mismo grupo.
   */
  isCurrent(session: Session<TPlayer, TState, TPhase>): boolean {
    return this.sessions.get(session.groupId) === session;
  }

  size(): number {
    return this.sessions.size;
  }

  all(): Iterable<Session<TPlayer, TState, TPhase>> {
    return this.sessions.values();
  }

  touch(groupId: string): void {
    const s = this.sessions.get(groupId);
    if (s) s.updatedAt = Date.now();
  }

  join(groupId: string, jid: string, player: TPlayer): boolean {
    const s = this.sessions.get(groupId);
    if (!s || s.players.has(jid)) return false;
    s.players.set(jid, player);
    s.order.push(jid);
    s.updatedAt = Date.now();
    return true;
  }

  leave(groupId: string, jid: string): boolean {
    const s = this.sessions.get(groupId);
    if (!s || !s.players.has(jid)) return false;
    const index = s.order.indexOf(jid);
    s.players.delete(jid);
    s.order.splice(index, 1);
    if (index < s.turn) s.turn -= 1;
    if (s.turn >= s.order.length) s.turn = 0;
    s.updatedAt = Date.now();
    return true;
  }

  isPlayerIn(groupId: string, jid: string): boolean {
    return this.sessions.get(groupId)?.players.has(jid) ?? false;
  }

  /** Mesa en la que participa el jugador, sin importar el grupo. */
  findByPlayer(jid: string): Session<TPlayer, TState, TPhase> | undefined {
    for (const s of this.sessions.values()) if (s.players.has(jid)) return s;
    return undefined;
  }

  setPhase(groupId: string, phase: TPhase): void {
    const s = this.sessions.get(groupId);
    if (!s) return;
    s.phase = phase;
    s.updatedAt = Date.now();
  }

  /** JID del jugador en turno, o null si no hay jugadores. */
  current(groupId: string): string | null {
    const s = this.sessions.get(groupId);
    if (!s || s.order.length === 0) return null;
    return s.order[s.turn] ?? null;
  }

  /** Pasa al siguiente jugador y lo devuelve; null cuando se dio la vuelta completa. */
  advance(groupId: string): string | null {
    const s = this.sessions.get(groupId);
    if (!s || s.order.length === 0) return null;
    s.turn += 1;
    s.updatedAt = Date.now();
    if (s.turn >= s.order.length) {
      s.turn = 0;
      return null;
    }
    return s.order[s.turn];
  }

  /**
   * Programa el fin de la fase. Si `fn` lanza, se registra, se reembolsa la
   * custodia y se cierra la mesa, para que ningún error deje dinero atrapado.
   */
  setTimer(groupId: string, ms: number, fn: () => void | Promise<void>): void {
    const s = this.sessions.get(groupId);
    if (!s) return;
    this.clearTimer(groupId);
    s.phaseEndsAt = Date.now() + ms;
    s.updatedAt = Date.now();
    const timer = setTimeout(() => {
      s.timer = null;
      s.phaseEndsAt = 0;
      Promise.resolve()
        .then(fn)
        .catch((error) => {
          log.error(`${this.game} ${groupId}: error en temporizador, mesa cerrada con reembolso:`, error);
          this.close(groupId, { refund: true });
        });
    }, ms);
    timer.unref();
    s.timer = timer;
  }

  clearTimer(groupId: string): void {
    const s = this.sessions.get(groupId);
    if (!s) return;
    if (s.timer) clearTimeout(s.timer);
    s.timer = null;
    s.phaseEndsAt = 0;
  }

  remainingSeconds(groupId: string): number {
    const s = this.sessions.get(groupId);
    if (!s || !s.phaseEndsAt) return 0;
    return Math.max(0, Math.ceil((s.phaseEndsAt - Date.now()) / 1000));
  }

  /** Cierra la mesa; con `refund` devuelve toda la custodia del juego en ese grupo. */
  close(groupId: string, options: { refund?: boolean } = {}): boolean {
    const s = this.sessions.get(groupId);
    if (!s) return false;
    this.clearTimer(groupId);
    this.sessions.delete(groupId);
    if (options.refund) {
      try {
        releaseEscrow(getDatabase(), groupId, this.game, { refund: true });
      } catch (error) {
        log.error(`${this.game} ${groupId}: no se pudo reembolsar la custodia:`, error);
      }
    }
    return true;
  }

  /** Cierra con reembolso las mesas sin actividad reciente. */
  sweepIdle(now = Date.now()): number {
    let closed = 0;
    for (const s of [...this.sessions.values()]) {
      if (now - s.updatedAt > this.idleMs) {
        log.warn(`${this.game} ${s.groupId}: mesa inactiva cerrada con reembolso`);
        this.close(s.groupId, { refund: true });
        closed++;
      }
    }
    return closed;
  }

  describe(groupId: string): ActiveTable | null {
    const s = this.sessions.get(groupId);
    if (!s) return null;
    return {
      game: this.game, label: this.label, phase: s.phase,
      remainingSeconds: this.remainingSeconds(groupId), players: [...s.players.keys()],
    };
  }
}

/** Mesas activas de cualquier juego en un grupo (para `mesa`). */
export function listActiveTables(groupId: string): ActiveTable[] {
  return managers.map((m) => m.describe(groupId)).filter((t): t is ActiveTable => t !== null);
}

/** Cierra con reembolso todas las mesas del grupo (para `cerrarmesa`). */
export function closeAllTables(groupId: string): string[] {
  const closed: string[] = [];
  for (const m of managers) if (m.close(groupId, { refund: true })) closed.push(m.label);
  return closed;
}

/** Si otro juego de letras (trivia/ahorcado) ya usa el chat, lo dice. */
export function activeGameOf(groupId: string, games: string[]): string | null {
  for (const m of managers) if (games.includes(m.game) && m.has(groupId)) return m.label;
  return null;
}
