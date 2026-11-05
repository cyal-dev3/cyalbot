import type { Database } from './database.js';
import type { BettingSystem, TipsterStats, BettingPick } from '../types/database.js';
import { DEFAULT_BETTING_SYSTEM, DEFAULT_TIPSTER_STATS } from '../types/database.js';
import { DEFAULT_USER_BETTING, type UserBetting } from '../types/user.js';

/** Máximo de tipsters favoritos por usuario */
export const MAX_FAVORITE_TIPSTERS = 20;

/** Copia independiente del betting por defecto; nunca compartir el objeto entre usuarios */
export function createDefaultBetting(): UserBetting {
  return structuredClone(DEFAULT_USER_BETTING);
}

/**
 * Normaliza el nombre de un tipster para indexar: sin emojis ni símbolos,
 * minúsculas y espacios a guiones bajos.
 */
export function normalizeTipsterName(name: string): string {
  return name
    .replace(/[\u{1F300}-\u{1F9FF}]/gu, '')
    .replace(/[^\w\sáéíóúñÁÉÍÓÚÑ]/gi, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}

/**
 * Tipsters y picks por grupo. Vive dentro de ChatSettings.bettingSystem y
 * persiste a través de la Database que recibe.
 */
export class BettingStore {
  constructor(private readonly db: Database) {}

  normalizeTipsterName(name: string): string {
    return normalizeTipsterName(name);
  }

  getBettingSystem(chatId: string): BettingSystem {
    const chat = this.db.getChatSettings(chatId);
    if (!chat.bettingSystem) {
      chat.bettingSystem = structuredClone(DEFAULT_BETTING_SYSTEM);
      this.db.markDirty();
    }
    return chat.bettingSystem;
  }

  updateBettingSystem(chatId: string, updates: Partial<BettingSystem>): void {
    Object.assign(this.getBettingSystem(chatId), updates);
    this.db.markDirty();
  }

  getOrCreateTipster(chatId: string, tipsterName: string): TipsterStats {
    const system = this.getBettingSystem(chatId);
    const normalized = normalizeTipsterName(tipsterName);

    if (!system.tipsters[normalized]) {
      system.tipsters[normalized] = {
        ...structuredClone(DEFAULT_TIPSTER_STATS),
        name: tipsterName.trim(),
        normalized
      };
      this.db.markDirty();
    }

    return system.tipsters[normalized];
  }

  getTipster(chatId: string, tipsterName: string): TipsterStats | null {
    const system = this.getBettingSystem(chatId);
    return system.tipsters[normalizeTipsterName(tipsterName)] || null;
  }

  registerPick(chatId: string, pick: Omit<BettingPick, 'id'>): BettingPick {
    const system = this.getBettingSystem(chatId);
    const tipster = this.getOrCreateTipster(chatId, pick.tipsterOriginal);

    const newPick: BettingPick = {
      ...pick,
      id: `pick_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
      tipster: tipster.normalized
    };

    system.picks.unshift(newPick);

    tipster.pending++;
    tipster.totalUnits += pick.units;
    tipster.lastPickDate = Date.now();

    if (system.picks.length > system.maxPicks) {
      system.picks = system.picks.slice(0, system.maxPicks);
    }

    this.db.markDirty();
    return newPick;
  }

  /** Recorta el historial resuelto a maxHistory, descartando los resueltos más antiguos */
  private trimHistory(system: BettingSystem): void {
    const maxHistory = system.maxHistory > 0 ? system.maxHistory : DEFAULT_BETTING_SYSTEM.maxHistory;
    const resolved = system.picks.filter(p => p.status !== 'pending');
    if (resolved.length <= maxHistory) return;

    const toDrop = new Set(
      resolved
        .sort((a, b) => (a.resolvedAt || 0) - (b.resolvedAt || 0))
        .slice(0, resolved.length - maxHistory)
        .map(p => p.id)
    );
    system.picks = system.picks.filter(p => !toDrop.has(p.id));
  }

  resolvePick(chatId: string, pickId: string, won: boolean, resolvedBy: string): BettingPick | null {
    const system = this.getBettingSystem(chatId);
    const pick = system.picks.find(p => p.id === pickId);
    if (!pick || pick.status !== 'pending') return null;

    const tipster = system.tipsters[pick.tipster];
    if (!tipster) return null;

    pick.status = won ? 'won' : 'lost';
    pick.resolvedAt = Date.now();
    pick.resolvedBy = resolvedBy;

    tipster.pending--;

    if (won) {
      tipster.wins++;
      tipster.wonUnits += pick.units;
      tipster.currentStreak = tipster.currentStreak >= 0 ? tipster.currentStreak + 1 : 1;
      if (tipster.currentStreak > tipster.bestStreak) {
        tipster.bestStreak = tipster.currentStreak;
      }
    } else {
      tipster.losses++;
      tipster.lostUnits += pick.units;
      tipster.currentStreak = tipster.currentStreak <= 0 ? tipster.currentStreak - 1 : -1;
      if (tipster.currentStreak < tipster.worstStreak) {
        tipster.worstStreak = tipster.currentStreak;
      }
    }

    for (const followerJid of pick.followers) {
      const betting = this.getUserBetting(followerJid);
      if (won) betting.stats.wonFollowed++;
      else betting.stats.lostFollowed++;
    }

    this.trimHistory(system);
    this.db.markDirty();
    return pick;
  }

  /** Anula un pick (void/push) sin afectar wins/losses */
  cancelPick(chatId: string, pickId: string, _cancelledBy: string): BettingPick | null {
    const system = this.getBettingSystem(chatId);
    const pickIndex = system.picks.findIndex(p => p.id === pickId);
    if (pickIndex === -1) return null;

    const pick = system.picks[pickIndex];
    if (pick.status !== 'pending') return null;

    const tipster = system.tipsters[pick.tipster];
    if (tipster) {
      tipster.pending--;
      tipster.totalUnits -= pick.units;
    }

    const cancelledPick = { ...pick };
    system.picks.splice(pickIndex, 1);

    this.db.markDirty();
    return cancelledPick;
  }

  getPendingPicks(chatId: string, tipsterName?: string): BettingPick[] {
    const system = this.getBettingSystem(chatId);
    let picks = system.picks.filter(p => p.status === 'pending');

    if (tipsterName) {
      const normalized = normalizeTipsterName(tipsterName);
      picks = picks.filter(p => p.tipster === normalized);
    }

    return picks;
  }

  getPickByMessageId(chatId: string, messageId: string): BettingPick | null {
    return this.getBettingSystem(chatId).picks.find(p => p.messageId === messageId) || null;
  }

  setPickMessageId(chatId: string, pickId: string, messageId: string): boolean {
    const pick = this.getBettingSystem(chatId).picks.find(p => p.id === pickId);
    if (!pick) return false;
    pick.messageId = messageId;
    this.db.markDirty();
    return true;
  }

  clearPendingPicks(chatId: string): number {
    const system = this.getBettingSystem(chatId);
    const pending = system.picks.filter(p => p.status === 'pending');
    for (const pick of pending) {
      const tipster = system.tipsters[pick.tipster];
      if (tipster) {
        tipster.pending = Math.max(0, tipster.pending - 1);
        tipster.totalUnits = Math.max(0, tipster.totalUnits - pick.units);
      }
    }
    system.picks = system.picks.filter(p => p.status !== 'pending');
    this.db.markDirty();
    return pending.length;
  }

  getPickById(chatId: string, pickId: string): BettingPick | null {
    return this.getBettingSystem(chatId).picks.find(p => p.id === pickId) || null;
  }

  getLastPendingPick(chatId: string, tipsterName?: string): BettingPick | null {
    const pending = this.getPendingPicks(chatId, tipsterName);
    return pending.length > 0 ? pending[0] : null;
  }

  followPick(chatId: string, pickId: string, userJid: string): boolean {
    const pick = this.getBettingSystem(chatId).picks.find(p => p.id === pickId);
    if (!pick || pick.status !== 'pending') return false;
    if (pick.followers.includes(userJid)) return false;

    pick.followers.push(userJid);
    this.getUserBetting(userJid).stats.totalFollowed++;

    this.db.markDirty();
    return true;
  }

  getTipsterFollowers(chatId: string, tipsterName: string): string[] {
    return this.getTipster(chatId, tipsterName)?.followers || [];
  }

  /**
   * Sigue a un tipster. Devuelve false si ya lo seguía o si el usuario llegó
   * al límite de favoritos (en ese caso no se añade como follower).
   */
  followTipster(chatId: string, tipsterName: string, userJid: string): boolean {
    const tipster = this.getOrCreateTipster(chatId, tipsterName);
    if (tipster.followers.includes(userJid)) return false;

    const betting = this.getUserBetting(userJid);
    const normalized = normalizeTipsterName(tipsterName);
    const alreadyFavorite = betting.favoriteTipsters.includes(normalized);
    if (!alreadyFavorite && betting.favoriteTipsters.length >= MAX_FAVORITE_TIPSTERS) {
      return false;
    }

    tipster.followers.push(userJid);
    if (!alreadyFavorite) betting.favoriteTipsters.push(normalized);

    this.db.markDirty();
    return true;
  }

  unfollowTipster(chatId: string, tipsterName: string, userJid: string): boolean {
    const tipster = this.getTipster(chatId, tipsterName);
    if (!tipster) return false;

    const index = tipster.followers.indexOf(userJid);
    if (index === -1) return false;
    tipster.followers.splice(index, 1);

    const betting = this.getUserBetting(userJid);
    const favIndex = betting.favoriteTipsters.indexOf(normalizeTipsterName(tipsterName));
    if (favIndex !== -1) {
      betting.favoriteTipsters.splice(favIndex, 1);
    }

    this.db.markDirty();
    return true;
  }

  getUserBetting(userJid: string): UserBetting {
    const user = this.db.getUser(userJid);
    if (!user.betting) {
      user.betting = createDefaultBetting();
      this.db.markDirty();
    }
    return user.betting;
  }

  getTipsterRanking(
    chatId: string,
    sortBy: 'winrate' | 'roi' | 'wins' | 'streak' = 'winrate',
    limit: number = 10
  ): TipsterStats[] {
    const tipsters = Object.values(this.getBettingSystem(chatId).tipsters);

    return tipsters
      .filter(t => t.wins + t.losses > 0)
      .sort((a, b) => {
        switch (sortBy) {
          case 'winrate': {
            const wrA = a.wins / (a.wins + a.losses) || 0;
            const wrB = b.wins / (b.wins + b.losses) || 0;
            return wrB - wrA;
          }
          case 'roi': {
            const roiA = a.totalUnits > 0 ? ((a.wonUnits - a.lostUnits) / a.totalUnits) * 100 : 0;
            const roiB = b.totalUnits > 0 ? ((b.wonUnits - b.lostUnits) / b.totalUnits) * 100 : 0;
            return roiB - roiA;
          }
          case 'wins':
            return b.wins - a.wins;
          case 'streak':
            return b.bestStreak - a.bestStreak;
          default:
            return 0;
        }
      })
      .slice(0, limit);
  }

  getPickHistory(chatId: string, tipsterName?: string, limit: number = 100): BettingPick[] {
    let picks = this.getBettingSystem(chatId).picks.filter(p => p.status !== 'pending');

    if (tipsterName) {
      const normalized = normalizeTipsterName(tipsterName);
      picks = picks.filter(p => p.tipster === normalized);
    }

    return picks
      .sort((a, b) => (b.resolvedAt || 0) - (a.resolvedAt || 0))
      .slice(0, limit);
  }
}
