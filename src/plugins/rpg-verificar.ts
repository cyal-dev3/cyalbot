import type { PluginHandler, MessageContext } from '../types/message.js';
import { EMOJI, formatNumber } from '../lib/utils.js';
import { getDatabase } from '../lib/database.js';
import { CONFIG } from '../config.js';
import { grantRewards, getPlayerId, usageError } from '../lib/rpg-actions.js';

const NAME_MIN = 2;
const NAME_MAX = 25;
const AGE_MIN = 13;
const AGE_MAX = 100;

export type RegistrationParse =
  | { name: string; age: number }
  | { name: string; age: null }
  | null;

/**
 * Acepta "Nombre 18", "Nombre.18", "Nombre,18" y "Nombre" (sin edad). Devuelve
 * null si no hay nombre.
 */
export function parseRegistration(text: string): RegistrationParse {
  const clean = text.trim().replace(/\s+/g, ' ');
  if (!clean) return null;

  const match = clean.match(/^(.+?)\s*[.,\s]\s*(\d{1,3})$/);
  if (match) {
    return { name: match[1].trim(), age: parseInt(match[2], 10) };
  }
  return { name: clean, age: null };
}

export const verificarPlugin: PluginHandler = {
  command: /^(verificar|registrar|register|reg)$/i,
  tags: ['rpg'],
  help: [
    'verificar <nombre> <edad> - Registrarte en el RPG (también nombre.edad o nombre,edad)',
    'verificar - Usa tu nombre de WhatsApp (luego te pedirá la edad)'
  ],
  usage: ['verificar <nombre> <edad>', 'verificar Shadow.18'],

  handler: async (ctx: MessageContext) => {
    const { m, text, usedPrefix, command } = ctx;
    const db = getDatabase();
    const user = db.getUser(m.sender);

    if (user.registered) {
      return m.reply(
        `${EMOJI.warning} *¡Ya estás registrado, aventurero!*\n\n` +
        `${EMOJI.info} Tu nombre: *${user.name}*\n` +
        `${EMOJI.level} Tu nivel: *${user.level}*\n\n` +
        `${EMOJI.star} Usa *${usedPrefix}perfil* para ver tu progreso completo.`
      );
    }

    const parsed = parseRegistration(text) ?? (m.pushName?.trim() ? { name: m.pushName.trim(), age: null } : null);
    if (!parsed) return usageError(ctx, verificarPlugin, 'Escribe tu nombre y tu edad.');

    const name = parsed.name;
    if (name.length < NAME_MIN || name.length > NAME_MAX) {
      return m.reply(`${EMOJI.error} El nombre debe tener entre *${NAME_MIN}* y *${NAME_MAX}* caracteres.`);
    }

    if (parsed.age === null) {
      return m.reply(
        `${EMOJI.info} Casi listo, *${name}*. Me falta tu edad.\n\n` +
        `➡️ Envía: *${usedPrefix}${command} ${name}.18* (cambia 18 por tu edad)`
      );
    }

    const age = parsed.age;
    if (age < AGE_MIN) return m.reply(`${EMOJI.error} Debes tener *al menos ${AGE_MIN} años* para registrarte.`);
    if (age > AGE_MAX) return m.reply(`${EMOJI.error} Por favor ingresa una *edad válida* (menor a ${AGE_MAX}).`);

    const now = Date.now();
    db.updateUser(m.sender, {
      name,
      age,
      registered: true,
      regTime: now,
      lastHealthRegen: now,
      lastStaminaRegen: now
    });
    const playerId = getPlayerId(db, m.sender);

    const bonus = CONFIG.rpg.registerBonus;
    const reward = grantRewards(db, m.sender, { exp: bonus.exp, money: bonus.money }, { source: 'register', rank: false, now });

    const extra = reward.lines.length ? `\n${reward.lines.join('\n')}` : '';
    await m.reply(
      `${EMOJI.success}${EMOJI.crown} *¡REGISTRO EXITOSO!*\n\n` +
      `${EMOJI.sparkles} *¡Bienvenido al mundo de ${CONFIG.botName}, ${name}!*\n` +
      `${EMOJI.info} *${name}*, ${age} años · ID *#${playerId}* · ${new Date(now).toLocaleDateString('es-MX')}\n\n` +
      `${EMOJI.gift} *Regalo de bienvenida:* +${formatNumber(reward.money)} ${EMOJI.coin} · +${formatNumber(reward.exp)} ${EMOJI.exp}${extra}\n\n` +
      `${EMOJI.sword} *¡Tu aventura comienza ahora!* Comandos útiles:\n` +
      `• *${usedPrefix}perfil* ver tu perfil · *${usedPrefix}daily* recompensa diaria\n` +
      `• *${usedPrefix}work* trabajar por XP · *${usedPrefix}misiones* tus misiones`
    );
  }
};

export default verificarPlugin;
