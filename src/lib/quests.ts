import type { Database } from './database.js';
import { DAILY_QUESTS, WEEKLY_QUESTS, ITEMS, type Quest, type QuestObjective } from '../types/rpg.js';
import type { QuestProgress, UserRPG } from '../types/user.js';
import { formatNumber } from './utils.js';
import { grantRewards } from './rpg-actions.js';

/**
 * Objetivos que pueden contar progreso. Amplía QuestObjective (types/rpg.ts,
 * del agente de combate) con las acciones de recolección y economía; cuando ese
 * tipo se amplíe, este alias puede volver a ser QuestObjective.
 */
export type QuestGoal = QuestObjective | 'mine' | 'daily' | 'fumar' | 'transfer' | 'fish' | 'hunt' | 'explore';

export interface QuestDef extends Omit<Quest, 'objective'> {
  objective: QuestGoal;
}

export const DAILY_RESET = 24 * 60 * 60 * 1000;
export const WEEKLY_RESET = 7 * 24 * 60 * 60 * 1000;
export const DAILY_QUEST_COUNT = 3;
export const WEEKLY_QUEST_COUNT = 2;

/** Misiones diarias extra; viven aquí porque DAILY_QUESTS pertenece a types/rpg.ts */
export const EXTRA_DAILY_QUESTS: QuestDef[] = [
  {
    id: 'daily_mine_3',
    name: 'Minero Incansable',
    emoji: '⛏️',
    description: 'Mina 3 veces',
    type: 'daily',
    objective: 'mine',
    target: 3,
    rewards: { exp: 500, money: 400, diamonds: 10 }
  },
  {
    id: 'daily_daily_1',
    name: 'Madrugador',
    emoji: '🎁',
    description: 'Reclama tu recompensa diaria',
    type: 'daily',
    objective: 'daily',
    target: 1,
    rewards: { exp: 300, money: 300, diamonds: 5 }
  },
  {
    id: 'daily_fumar_2',
    name: 'Humo Sagrado',
    emoji: '🪨',
    description: 'Fuma 2 piedras',
    type: 'daily',
    objective: 'fumar',
    target: 2,
    rewards: { exp: 400, money: 500, diamonds: 10 }
  },
  {
    id: 'daily_transfer_1000',
    name: 'Generoso',
    emoji: '💸',
    description: 'Transfiere 1,000 monedas a otros jugadores',
    type: 'daily',
    objective: 'transfer',
    target: 1000,
    rewards: { exp: 600, money: 200, diamonds: 15 }
  },
  {
    id: 'daily_fish_3',
    name: 'Pescador Paciente',
    emoji: '🎣',
    description: 'Pesca 3 veces',
    type: 'daily',
    objective: 'fish',
    target: 3,
    rewards: { exp: 500, money: 400, diamonds: 10 }
  }
];

export const ALL_DAILY_QUESTS: QuestDef[] = [...DAILY_QUESTS, ...EXTRA_DAILY_QUESTS];
export const ALL_WEEKLY_QUESTS: QuestDef[] = [...WEEKLY_QUESTS];

const QUEST_INDEX = new Map<string, QuestDef>(
  [...ALL_DAILY_QUESTS, ...ALL_WEEKLY_QUESTS].map(q => [q.id, q])
);

export function getQuestById(questId: string): QuestDef | null {
  return QUEST_INDEX.get(questId) ?? null;
}

export function assignRandomQuests(pool: QuestDef[], count: number): QuestProgress[] {
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count).map(quest => ({ questId: quest.id, progress: 0, completed: false }));
}

/** true si la misión ya se cobró (reclamada manual o automáticamente) */
export function isQuestClaimed(progress: QuestProgress): boolean {
  return progress.completed && Boolean(progress.claimedAt);
}

/**
 * Reasigna misiones diarias/semanales cuando toca el reset o cuando faltan.
 * Muta `user` y devuelve true si cambió algo (el caller persiste).
 */
export function ensureQuestsFresh(user: UserRPG, now: number = Date.now()): boolean {
  let changed = false;

  if (!Array.isArray(user.dailyQuests) || user.dailyQuests.length === 0 || now - user.lastDailyReset >= DAILY_RESET) {
    user.dailyQuests = assignRandomQuests(ALL_DAILY_QUESTS, DAILY_QUEST_COUNT);
    user.lastDailyReset = now;
    changed = true;
  }

  if (!Array.isArray(user.weeklyQuests) || user.weeklyQuests.length === 0 || now - user.lastWeeklyReset >= WEEKLY_RESET) {
    user.weeklyQuests = assignRandomQuests(ALL_WEEKLY_QUESTS, WEEKLY_QUEST_COUNT);
    user.lastWeeklyReset = now;
    changed = true;
  }

  return changed;
}

export interface QuestUpdateResult {
  /** Misiones que se completaron y cobraron en esta llamada */
  completed: QuestDef[];
  /** Líneas para el mensaje al jugador (una por misión completada, más las de sus recompensas) */
  lines: string[];
}

function formatQuestRewards(quest: QuestDef): string {
  const parts = [`+${formatNumber(quest.rewards.exp)} XP`, `+${formatNumber(quest.rewards.money)} 💰`];
  if (quest.rewards.diamonds) parts.push(`+${quest.rewards.diamonds} 💎`);
  if (quest.rewards.items?.length) {
    parts.push(quest.rewards.items.map(id => ITEMS[id]?.emoji ?? '📦').join(''));
  }
  return parts.join(', ');
}

/**
 * Cobra una misión: la marca reclamada, entrega items y recompensas (con modos
 * globales y corte de esclavitud vía grantRewards) y devuelve las líneas del mensaje.
 */
function claimQuest(db: Database, jid: string, user: UserRPG, progress: QuestProgress, quest: QuestDef, now: number): string[] {
  progress.completed = true;
  progress.claimedAt = now;

  for (const itemId of quest.rewards.items ?? []) {
    const existing = user.inventory.find(i => i.itemId === itemId);
    if (existing) existing.quantity++;
    else user.inventory.push({ itemId, quantity: 1 });
  }

  const reward = grantRewards(
    db,
    jid,
    { exp: quest.rewards.exp, money: quest.rewards.money, diamonds: quest.rewards.diamonds ?? 0 },
    { source: 'quest', rank: false, now }
  );

  return [`🎁 Misión completada: ${quest.emoji} *${quest.name}* (${formatQuestRewards(quest)})`, ...reward.lines];
}

/**
 * Cobra las misiones ya completadas que sigan sin reclamar (progreso heredado
 * de antes del auto-reclamo). Va SIEMPRE antes de ensureQuestsFresh para que un
 * reset no se lleve lo que el jugador ya ganó. Devuelve si cobró alguna.
 */
function claimPendingQuests(db: Database, jid: string, user: UserRPG, now: number, result: QuestUpdateResult): boolean {
  let claimed = false;
  for (const progress of [...(user.dailyQuests ?? []), ...(user.weeklyQuests ?? [])]) {
    if (isQuestClaimed(progress)) continue;
    const quest = getQuestById(progress.questId);
    if (!quest || progress.progress < quest.target) continue;

    result.completed.push(quest);
    result.lines.push(...claimQuest(db, jid, user, progress, quest, now));
    claimed = true;
  }
  return claimed;
}

function persistQuests(db: Database, jid: string, user: UserRPG): void {
  db.updateUser(jid, {
    dailyQuests: user.dailyQuests,
    weeklyQuests: user.weeklyQuests,
    lastDailyReset: user.lastDailyReset,
    lastWeeklyReset: user.lastWeeklyReset,
    inventory: user.inventory
  });
}

/**
 * Suma progreso a todas las misiones activas cuyo `objective` coincide y cobra
 * automáticamente las que se completan. Persiste con db.updateUser.
 */
export function updateQuestProgress(
  db: Database,
  jid: string,
  objective: QuestGoal,
  amount: number,
  now: number = Date.now()
): QuestUpdateResult {
  const result: QuestUpdateResult = { completed: [], lines: [] };
  if (!Number.isFinite(amount) || amount <= 0) return result;

  const user = db.getUser(jid);
  let changed = claimPendingQuests(db, jid, user, now, result);
  if (ensureQuestsFresh(user, now)) changed = true;

  for (const progress of [...user.dailyQuests, ...user.weeklyQuests]) {
    if (isQuestClaimed(progress)) continue;
    const quest = getQuestById(progress.questId);
    if (!quest || quest.objective !== objective) continue;

    progress.progress += amount;
    changed = true;

    if (progress.progress >= quest.target) {
      result.completed.push(quest);
      result.lines.push(...claimQuest(db, jid, user, progress, quest, now));
    }
  }

  if (changed) persistQuests(db, jid, user);
  return result;
}

/**
 * Cobra las misiones completadas que sigan sin reclamar (progreso anterior al
 * auto-reclamo), aunque ya haya pasado el reset, y después renueva las que toque.
 */
export function claimCompletedQuests(db: Database, jid: string, now: number = Date.now()): QuestUpdateResult {
  const user = db.getUser(jid);
  const result: QuestUpdateResult = { completed: [], lines: [] };

  let changed = claimPendingQuests(db, jid, user, now, result);
  if (ensureQuestsFresh(user, now)) changed = true;

  if (changed) persistQuests(db, jid, user);
  return result;
}

function questBar(current: number, max: number, size: number = 8): string {
  const filled = Math.min(size, Math.floor((current / max) * size));
  return '█'.repeat(filled) + '░'.repeat(size - filled);
}

/** Lista de misiones con progreso (dos líneas por misión), igual para diarias y semanales */
export function renderQuestList(title: string, quests: QuestProgress[], resetIn: string): { text: string; pending: number } {
  let text = `${title} _(reset en ${resetIn})_\n`;
  let pending = 0;

  for (const progress of quests) {
    const quest = getQuestById(progress.questId);
    if (!quest) continue;

    const current = Math.min(progress.progress, quest.target);
    const claimed = isQuestClaimed(progress);
    const complete = current >= quest.target;
    if (complete && !claimed) pending++;

    const status = claimed ? '✅' : complete ? '🎁' : '⏳';
    text += `${status} ${quest.emoji} *${quest.name}* — ${quest.description}\n`;
    text += `   [${questBar(current, quest.target)}] ${formatNumber(current)}/${formatNumber(quest.target)}` +
      (claimed ? ' · cobrada' : ` · 🎁 ${formatQuestRewards(quest)}`) + '\n';
  }

  return { text: text + '\n', pending };
}
