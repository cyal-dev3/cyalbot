import type { Database } from '../database.js';
import type { DatabaseSchema } from '../../types/database.js';

/** Límites compartidos por todos los juegos de apuestas. */
export const CASINO_LIMITS = {
  minBet: 50,
  maxBet: 25_000,
  /** Comisión de la casa en duelos entre jugadores (ppt). */
  duelFee: 0.05,
  /** Mesas simultáneas por juego. */
  maxTables: 100,
  /** Una mesa sin actividad durante este tiempo se cierra con reembolso. */
  idleMs: 15 * 60_000,
  /** Porcentaje de cada apuesta perdida en el slot que alimenta el jackpot. */
  jackpotShare: 0.01,
} as const;

export interface GameStats {
  wagered: number;
  paid: number;
  rounds: number;
}

export interface EscrowEntry {
  groupId: string;
  jid: string;
  amount: number;
  game: string;
  at: number;
}

/**
 * Estado persistente del casino. Vive en settings.casino; types/database.ts
 * debería declararlo como `casino?: CasinoState` (dueño: agente de datos).
 */
export interface CasinoState {
  escrow: EscrowEntry[];
  stats: Record<string, GameStats>;
  jackpot: number;
}

type SettingsWithCasino = DatabaseSchema['settings'] & { casino?: CasinoState };

/** Devuelve la referencia viva al estado del casino, creándolo si no existe. */
export function getCasino(db: Database): CasinoState {
  const settings = db.getSettings() as SettingsWithCasino;
  if (!settings.casino || typeof settings.casino !== 'object') {
    settings.casino = { escrow: [], stats: {}, jackpot: 0 };
    db.updateSettings({ casino: settings.casino } as never);
  }
  const casino = settings.casino;
  if (!Array.isArray(casino.escrow)) casino.escrow = [];
  if (!casino.stats || typeof casino.stats !== 'object') casino.stats = {};
  if (!Number.isFinite(casino.jackpot)) casino.jackpot = 0;
  return casino;
}

export function gameStats(db: Database, game: string): GameStats {
  const casino = getCasino(db);
  if (!casino.stats[game]) casino.stats[game] = { wagered: 0, paid: 0, rounds: 0 };
  return casino.stats[game];
}
