import type { MessageContext } from '../types/message.js';
import type { Database } from '../lib/database.js';
import type { ActiveBuff, UserRPG } from '../types/user.js';
import { ITEMS, type Item, type ItemRarity } from '../types/rpg.js';
import { PVP, SPECIAL_ITEMS } from '../constants/rpg.js';
import { isOwnerId, sameUser } from '../config.js';
import { createLogger } from '../lib/logger.js';
import { resolveGroupRoles } from '../lib/group-events.js';
import { isPassiveActive } from '../lib/rpg-actions.js';
import { calculateTotalStats } from '../lib/rpg-utils.js';
import { EMOJI, formatNumber, getTargetUser, msToTime, randomInt } from '../lib/utils.js';
import { addItem, isEquipable, removeItem } from '../lib/rpg-inventory.js';
import { DROP_LUCK_BUFF, PERMANENT_BUFF, activeBuffs } from '../lib/rpg-combat.js';

const log = createLogger('rpg');

export interface SpecialItemInput {
  ctx: MessageContext;
  db: Database;
  user: UserRPG;
  /** Texto que quedó tras el nombre del item (nuevo nombre, etc.) */
  rest: string;
  now: number;
}

export interface SpecialItemOutcome {
  /** true: el efecto se aplicó y el item debe consumirse */
  ok: boolean;
  message: string;
  /** Cambios sobre el propio usuario, que el llamador guarda junto al inventario */
  updates?: Partial<UserRPG>;
}

type SpecialItemHandler = (input: SpecialItemInput) => Promise<SpecialItemOutcome>;

/** Ids solo comprables con diamantes que no deben salir de la caja misteriosa */
const DIAMOND_ONLY_EQUIPMENT = new Set(['espada_celestial', 'armadura_celestial', 'corona_reyes']);

const MYSTERY_BOX_WEIGHTS: Record<ItemRarity, number> = { comun: 0, raro: 60, epico: 30, legendario: 10 };

/** Equipables raro+ obtenibles desde la caja misteriosa */
export function mysteryBoxPool(): Item[] {
  return Object.values(ITEMS).filter(item =>
    isEquipable(item) && item.rarity !== 'comun' && !DIAMOND_ONLY_EQUIPMENT.has(item.id));
}

export function pickMysteryBoxItem(random: () => number = Math.random): Item | null {
  const pool = mysteryBoxPool();
  if (pool.length === 0) return null;
  const total = pool.reduce((sum, item) => sum + MYSTERY_BOX_WEIGHTS[item.rarity], 0);
  let roll = random() * total;
  for (const item of pool) {
    roll -= MYSTERY_BOX_WEIGHTS[item.rarity];
    if (roll < 0) return item;
  }
  return pool[pool.length - 1];
}

/** Runas permanentes activas (0-3) */
export function permanentExpStacks(user: UserRPG): number {
  const buff = activeBuffs(user, 0).find(b => b.type === 'expBoost' && b.expiresAt === PERMANENT_BUFF);
  if (!buff) return 0;
  return Math.max(0, Math.round((buff.value - 1) / SPECIAL_ITEMS.PERMANENT_EXP.PER_STACK));
}

interface GroupInfo {
  isBotAdmin: boolean;
  participants: string[];
  admins: string[];
}

/**
 * Roles del grupo. El handler solo los resuelve para plugins que declaran
 * admin/botAdmin/group y /usar no lo hace (sirve en privado), así que aquí se
 * leen a demanda de la metadata cacheada. null si WhatsApp no la devolvió.
 */
async function groupInfo(ctx: MessageContext): Promise<GroupInfo | null> {
  if (ctx.participants) return { isBotAdmin: ctx.isBotAdmin, participants: ctx.participants, admins: ctx.groupAdmins ?? [] };
  const roles = await resolveGroupRoles(ctx.conn, ctx.m.chat, ctx.m.sender);
  if (!roles.metadata) return null;
  return { isBotAdmin: roles.isBotAdmin, participants: roles.participants, admins: roles.admins };
}

function isProtectedJid(ctx: MessageContext, info: GroupInfo, jid: string): boolean {
  if (isOwnerId(jid)) return true;
  if (info.admins.some(admin => sameUser(admin, jid))) return true;
  const botId = ctx.conn?.user?.id;
  return Boolean(botId && sameUser(botId, jid));
}

const NO_METADATA = `${EMOJI.warning} No pude leer los datos del grupo, inténtalo en unos segundos.`;

/** Valida el objetivo de los tickets de grupo; devuelve el JID o el mensaje de error */
async function resolveGroupTarget(input: SpecialItemInput, usage: string): Promise<{ jid: string } | { error: string }> {
  const { ctx } = input;
  if (!ctx.isGroup) return { error: `${EMOJI.error} Este item solo se puede usar en un grupo.` };
  const info = await groupInfo(ctx);
  if (!info) return { error: NO_METADATA };
  if (!info.isBotAdmin) return { error: `${EMOJI.error} Necesito ser admin del grupo para usar este item.` };

  const target = getTargetUser({ mentionedJid: ctx.m.mentionedJid, quoted: ctx.m.quoted, chat: ctx.m.chat, sender: ctx.m.sender }, { args: ctx.args });
  if (!target) return { error: `${EMOJI.error} ¿Contra quién? Menciona o cita a alguien.\n\n📝 *Uso:* ${usage}` };
  if (sameUser(target, ctx.m.sender)) return { error: `${EMOJI.error} No puedes usarlo contra ti mismo.` };
  if (isProtectedJid(ctx, info, target)) return { error: `${EMOJI.error} No puedes usar este item contra admins, el owner o el bot.` };
  if (!info.participants.some(p => sameUser(p, target))) {
    return { error: `${EMOJI.error} Ese usuario no está en el grupo.` };
  }
  return { jid: target };
}

function extendProtection(current: number | undefined, duration: number, now: number): number {
  return Math.max(now, current || 0) + duration;
}

const HANDLERS: Record<string, SpecialItemHandler> = {
  ticket_muteo: async (input) => {
    const { ctx, db } = input;
    const target = await resolveGroupTarget(input, '/usar ticket muteo @usuario');
    if ('error' in target) return { ok: false, message: target.error };

    const chat = ctx.m.chat;
    ctx.handler.setAutoMute(chat, true);
    ctx.handler.muteUser(chat, target.jid);
    // El mute se levanta en memoria; si el bot se reinicia antes, queda hasta que un admin lo quite
    setTimeout(() => {
      ctx.handler.unmuteUser(chat, target.jid);
      log.info(`mute por ticket expirado para ${target.jid} en ${chat}`);
    }, SPECIAL_ITEMS.MUTE_DURATION).unref();

    const victim = db.getUser(target.jid);
    const name = victim.name || target.jid.split('@')[0];
    return {
      ok: true,
      message: `🔇 *¡TICKET DE MUTEO USADO!*\n\n*${input.user.name}* silenció a *${name}* por *${msToTime(SPECIAL_ITEMS.MUTE_DURATION)}*.\n_Sus mensajes se borrarán automáticamente._`
    };
  },

  ticket_kick: async (input) => {
    const { ctx, db } = input;
    const target = resolveGroupTarget(input, '/usar ticket kick @usuario');
    if ('error' in target) return { ok: false, message: target.error };

    try {
      await ctx.conn.groupParticipantsUpdate(ctx.m.chat, [target.jid], 'remove');
    } catch (error) {
      log.error('ticket_kick: no se pudo expulsar', error);
      return { ok: false, message: `${EMOJI.error} No pude expulsar a ese usuario. El ticket no se consumió.` };
    }

    const victim = db.getUser(target.jid);
    const name = victim.name || target.jid.split('@')[0];
    return { ok: true, message: `🚪 *¡TICKET DE EXPULSIÓN USADO!*\n\n*${input.user.name}* expulsó a *${name}* del grupo.` };
  },

  bomba_dinero: async (input) => {
    const { ctx, db, user, now } = input;
    if (!ctx.isGroup) return { ok: false, message: `${EMOJI.error} La bomba de dinero solo explota en grupos.` };
    const participants = ctx.participants ?? [];
    if (participants.length === 0) return { ok: false, message: `${EMOJI.error} No pude leer a los participantes del grupo.` };

    let total = 0;
    let protectedCount = 0;
    const victims: string[] = [];
    for (const jid of participants) {
      if (sameUser(jid, ctx.m.sender)) continue;
      const victim = db.getUser(jid);
      if (!victim.registered) continue;
      if ((victim.passiveMode && victim.passiveModeUntil > now) || victim.shieldRobo > now) {
        protectedCount++;
        continue;
      }
      const stolen = Math.min(victim.money, randomInt(SPECIAL_ITEMS.MONEY_BOMB.MIN, SPECIAL_ITEMS.MONEY_BOMB.MAX));
      if (stolen <= 0) continue;
      db.updateUser(jid, { money: victim.money - stolen });
      total += stolen;
      victims.push(`${victim.name}: -${formatNumber(stolen)}`);
    }

    if (victims.length === 0) {
      return { ok: false, message: `${EMOJI.warning} No hay nadie a quien robar (todos protegidos o sin dinero). La bomba no se consumió.` };
    }

    let message = `💣💥 *¡BOMBA DE DINERO!*\n\n*${user.name}* hizo explotar una bomba y recogió *${formatNumber(total)}* monedas.\n\n`;
    message += victims.slice(0, 15).map(v => `   • ${v}`).join('\n');
    if (victims.length > 15) message += `\n   _...y ${victims.length - 15} más_`;
    if (protectedCount > 0) message += `\n\n🛡️ ${protectedCount} jugador(es) estaban protegidos.`;
    return { ok: true, message, updates: { money: user.money + total, totalEarned: user.totalEarned + total } };
  },

  escudo_robo: async ({ user, now }) => {
    const until = extendProtection(user.shieldRobo, PVP.SHIELD_DURATION, now);
    return { ok: true, message: `🛡️ *Escudo Anti-Robo activado*\nNadie podrá robarte durante *${msToTime(until - now)}*.`, updates: { shieldRobo: until } };
  },

  escudo_antibombas: async ({ user, now }) => {
    const until = extendProtection(user.shieldBombas, PVP.SHIELD_DURATION, now);
    return { ok: true, message: `🧱 *Escudo Antibombas activado*\nLas bombas rebotarán durante *${msToTime(until - now)}*.`, updates: { shieldBombas: until } };
  },

  seguro_vida: async ({ user, now }) => {
    const until = extendProtection(user.seguroVida, SPECIAL_ITEMS.LIFE_INSURANCE_DURATION, now);
    return { ok: true, message: `📜 *Seguro de Vida Premium activado*\nEl IMSS no te cobrará durante *${msToTime(until - now)}*.`, updates: { seguroVida: until } };
  },

  cofre_oro: async ({ user }) => {
    const amount = randomInt(SPECIAL_ITEMS.GOLD_CHEST.MIN, SPECIAL_ITEMS.GOLD_CHEST.MAX);
    return {
      ok: true,
      message: `🎁 *¡Abriste el Cofre de Oro!*\n💰 Encontraste *${formatNumber(amount)}* monedas.`,
      updates: { money: user.money + amount, totalEarned: user.totalEarned + amount }
    };
  },

  pocion_suerte: async ({ user, now }) => {
    const buffs = activeBuffs(user, now).filter(b => b.type !== DROP_LUCK_BUFF);
    const buff: ActiveBuff = { type: DROP_LUCK_BUFF, value: SPECIAL_ITEMS.LUCK_POTION.DROP_BONUS, expiresAt: now + SPECIAL_ITEMS.LUCK_POTION.DURATION };
    buffs.push(buff);
    return {
      ok: true,
      message: `🍀 *Poción de Suerte*\n+${SPECIAL_ITEMS.LUCK_POTION.DROP_BONUS}% probabilidad de drops durante *${msToTime(SPECIAL_ITEMS.LUCK_POTION.DURATION)}*.`,
      updates: { activeBuffs: buffs }
    };
  },

  caja_misteriosa: async ({ user }) => {
    const item = pickMysteryBoxItem();
    if (!item) return { ok: false, message: `${EMOJI.error} La caja está vacía (no hay items disponibles).` };
    const result = addItem(user, item.id, 1);
    if (!result.ok) return { ok: false, message: `${EMOJI.error} Tu inventario está lleno. Vende algo antes de abrir la caja.` };
    return {
      ok: true,
      message: `📦 *¡Abriste la Caja Misteriosa!*\n\nEncontraste: ${item.emoji} *${item.name}* (${item.rarity})\n💡 Usa */equipar ${item.name.toLowerCase()}*`,
      updates: { inventory: user.inventory }
    };
  },

  cambio_nombre: async ({ user, rest }) => {
    const name = rest.trim();
    const { MIN, MAX } = SPECIAL_ITEMS.NAME_LENGTH;
    if (name.length < MIN || name.length > MAX) {
      return { ok: false, message: `${EMOJI.error} Escribe el nuevo nombre (${MIN}-${MAX} caracteres).\n\n📝 *Uso:* /usar cambio nombre <nuevo nombre>` };
    }
    return { ok: true, message: `📝 *Nombre cambiado*\n*${user.name}* ahora se llama *${name}*.`, updates: { name } };
  },

  reset_clase: async ({ user }) => {
    if (!user.playerClass) return { ok: false, message: `${EMOJI.error} No tienes clase que reiniciar.` };
    const stats = calculateTotalStats({ ...user, playerClass: null });
    return {
      ok: true,
      message: `🔄 *Clase reiniciada*\nYa no tienes clase. Usa */clase* para elegir una nueva sin costo.`,
      updates: {
        playerClass: null,
        health: Math.min(user.health, stats.maxHealth),
        mana: Math.min(user.mana, stats.maxMana),
        stamina: Math.min(user.stamina, stats.maxStamina)
      }
    };
  },

  doble_exp_permanente: async ({ user, now }) => {
    const { PER_STACK, MAX_STACKS } = SPECIAL_ITEMS.PERMANENT_EXP;
    const stacks = permanentExpStacks(user);
    if (stacks >= MAX_STACKS) {
      return { ok: false, message: `${EMOJI.error} Ya tienes el máximo de runas (${MAX_STACKS}). La runa no se consumió.` };
    }
    const buffs = activeBuffs(user, now).filter(b => !(b.type === 'expBoost' && b.expiresAt === PERMANENT_BUFF));
    const value = 1 + PER_STACK * (stacks + 1);
    buffs.push({ type: 'expBoost', value, expiresAt: PERMANENT_BUFF });
    return {
      ok: true,
      message: `🔯 *Runa de Experiencia activada*\nBonus permanente: *+${Math.round((value - 1) * 100)}% XP* (${stacks + 1}/${MAX_STACKS} runas).`,
      updates: { activeBuffs: buffs }
    };
  }
};

/** Cómo se usa cada item especial; lo muestra la tienda al comprarlo */
export const SPECIAL_ITEM_USAGE: Record<string, string> = {
  ticket_muteo: '/usar ticket muteo @usuario',
  ticket_kick: '/usar ticket kick @usuario',
  bomba_dinero: '/usar bomba dinero',
  escudo_robo: '/usar escudo robo',
  escudo_antibombas: '/usar escudo antibombas',
  seguro_vida: '/usar seguro vida',
  cofre_oro: '/usar cofre oro',
  pocion_suerte: '/usar pocion suerte',
  caja_misteriosa: '/usar caja misteriosa',
  cambio_nombre: '/usar cambio nombre <nuevo nombre>',
  reset_clase: '/usar reset clase',
  doble_exp_permanente: '/usar runa'
};

export function isSpecialItem(itemId: string): boolean {
  return itemId in HANDLERS;
}

export interface UseSpecialResult {
  consumed: boolean;
  message: string;
}

/**
 * Ejecuta el efecto de un item especial y, solo si tuvo efecto, descuenta una
 * unidad y guarda. Los items sin efecto implementado se rechazan sin consumir.
 */
export async function useSpecialItem(ctx: MessageContext, db: Database, user: UserRPG, item: Item, rest: string): Promise<UseSpecialResult> {
  const handler = HANDLERS[item.id];
  if (!handler) {
    return { consumed: false, message: `${EMOJI.error} *${item.name}* todavía no tiene efecto. No se consumió.` };
  }

  const outcome = await handler({ ctx, db, user, rest, now: Date.now() });
  if (!outcome.ok) return { consumed: false, message: outcome.message };

  if (!removeItem(user, item.id, 1)) {
    return { consumed: false, message: `${EMOJI.error} No tienes ${item.name} en tu inventario.` };
  }
  db.updateUser(ctx.m.sender, { ...outcome.updates, inventory: user.inventory });
  return { consumed: true, message: outcome.message };
}
