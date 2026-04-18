/**
 * 🏰 Plugin Gremios - CYALTRONIC
 * Permite formar, unirse y gestionar gremios con tesorería compartida.
 * Comandos: /gremio crear|unirse|salir|tesoro|depositar|info|listar
 */

import type { PluginHandler, MessageContext } from '../types/message.js';
import { EMOJI, formatNumber, randomInt } from '../lib/utils.js';
import { getDatabase } from '../lib/database.js';
import { CONFIG } from '../config.js';
import type { Guild } from '../types/database.js';

const CREATE_COST = 10000;
const MAX_MEMBERS = 50;

function getGuilds(): Record<string, Guild> {
  const db = getDatabase();
  if (!db.data.guilds) db.data.guilds = {};
  return db.data.guilds;
}

function findGuildByName(name: string): Guild | null {
  const guilds = getGuilds();
  const normalized = name.trim().toLowerCase();
  for (const g of Object.values(guilds)) {
    if (g.name.toLowerCase() === normalized) return g;
  }
  return null;
}

export const gremioPlugin: PluginHandler = {
  command: /^(gremio|guild)$/i,
  tags: ['rpg', 'gremio'],
  help: [
    'gremio crear <nombre>',
    'gremio unirse <nombre>',
    'gremio salir',
    'gremio tesoro',
    'gremio depositar <cantidad>',
    'gremio info',
    'gremio listar'
  ],
  register: true,
  handler: async (ctx: MessageContext) => {
    const { m, args } = ctx;
    const db = getDatabase();
    const user = db.getUser(m.sender);
    if (!user.registered) return m.reply(CONFIG.messages.notRegistered);

    const sub = (args[0] || '').toLowerCase();
    const rest = args.slice(1).join(' ').trim();

    switch (sub) {
      case 'crear':
      case 'create': {
        if (user.guildId) return m.reply('🏰 Ya perteneces a un gremio. Sal primero con */gremio salir*.');
        if (!rest) return m.reply('Uso: /gremio crear <nombre>');
        if (rest.length < 3 || rest.length > 24) return m.reply('❌ El nombre debe tener entre 3 y 24 caracteres.');
        if (findGuildByName(rest)) return m.reply('❌ Ya existe un gremio con ese nombre.');
        if (user.money < CREATE_COST) return m.reply(`${EMOJI.warning} Crear un gremio cuesta *${formatNumber(CREATE_COST)} 💰*.`);

        const id = `g_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const guild: Guild = {
          id,
          name: rest,
          tag: rest.slice(0, 3).toUpperCase(),
          leader: m.sender,
          members: [m.sender],
          treasury: 0,
          level: 1,
          exp: 0,
          createdAt: Date.now(),
          description: ''
        };
        getGuilds()[id] = guild;
        user.money -= CREATE_COST;
        db.updateUser(m.sender, { money: user.money, guildId: id });
        return m.reply(`🏰 Gremio *${guild.name}* [${guild.tag}] creado. Costo: ${formatNumber(CREATE_COST)} 💰.`);
      }

      case 'unirse':
      case 'join': {
        if (user.guildId) return m.reply('🏰 Ya perteneces a un gremio.');
        if (!rest) return m.reply('Uso: /gremio unirse <nombre>');
        const guild = findGuildByName(rest);
        if (!guild) return m.reply('❌ No se encontró ese gremio.');
        if (guild.members.length >= MAX_MEMBERS) return m.reply('❌ El gremio está lleno.');
        guild.members.push(m.sender);
        db.updateUser(m.sender, { guildId: guild.id });
        return m.reply(`🎉 Te uniste al gremio *${guild.name}* [${guild.tag}].`);
      }

      case 'salir':
      case 'leave': {
        if (!user.guildId) return m.reply('❌ No perteneces a un gremio.');
        const guild = getGuilds()[user.guildId];
        if (!guild) {
          db.updateUser(m.sender, { guildId: null });
          return m.reply('🏰 Saliste del gremio (el gremio ya no existía).');
        }
        guild.members = guild.members.filter(jid => jid !== m.sender);
        db.updateUser(m.sender, { guildId: null });
        // Si se queda vacío o sale el líder sin miembros, disolver
        if (guild.members.length === 0) {
          delete getGuilds()[guild.id];
          return m.reply(`🏰 Saliste de *${guild.name}*. El gremio fue disuelto.`);
        }
        if (guild.leader === m.sender) {
          guild.leader = guild.members[0];
        }
        return m.reply(`🏰 Saliste de *${guild.name}*.`);
      }

      case 'tesoro':
      case 'treasury': {
        if (!user.guildId) return m.reply('❌ No perteneces a un gremio.');
        const guild = getGuilds()[user.guildId];
        if (!guild) return m.reply('❌ Tu gremio no existe.');
        return m.reply(`💰 Tesoro de *${guild.name}*: *${formatNumber(guild.treasury)}* monedas.`);
      }

      case 'depositar':
      case 'deposit': {
        if (!user.guildId) return m.reply('❌ No perteneces a un gremio.');
        const guild = getGuilds()[user.guildId];
        if (!guild) return m.reply('❌ Tu gremio no existe.');
        const amount = parseInt(rest, 10);
        if (!Number.isFinite(amount) || amount <= 0) return m.reply('Uso: /gremio depositar <cantidad>');
        if (user.money < amount) return m.reply(`${EMOJI.warning} No tienes tanto dinero.`);
        user.money -= amount;
        guild.treasury += amount;
        guild.exp += Math.floor(amount / 100);
        while (guild.exp >= guild.level * 5000) {
          guild.exp -= guild.level * 5000;
          guild.level++;
        }
        db.updateUser(m.sender, { money: user.money });
        return m.reply(`💰 Depositaste ${formatNumber(amount)} al tesoro de *${guild.name}*.`);
      }

      case 'info':
      case '': {
        if (!user.guildId) return m.reply('❌ No perteneces a un gremio. Usa */gremio listar*.');
        const guild = getGuilds()[user.guildId];
        if (!guild) return m.reply('❌ Tu gremio no existe.');
        const leaderNum = guild.leader.split('@')[0];
        return m.reply(
          `🏰 *${guild.name}* [${guild.tag}]\n` +
          `━━━━━━━━━━━━━━\n` +
          `👑 Líder: @${leaderNum}\n` +
          `👥 Miembros: ${guild.members.length}/${MAX_MEMBERS}\n` +
          `⭐ Nivel: ${guild.level} (XP ${guild.exp}/${guild.level * 5000})\n` +
          `💰 Tesoro: ${formatNumber(guild.treasury)}`
        );
      }

      case 'listar':
      case 'list': {
        const guilds = Object.values(getGuilds()).sort((a, b) => b.level - a.level).slice(0, 10);
        if (guilds.length === 0) return m.reply('🏰 No hay gremios creados.');
        const body = guilds
          .map((g, i) => `${i + 1}. *${g.name}* [${g.tag}] — Nv.${g.level} · ${g.members.length} miembros`)
          .join('\n');
        return m.reply(`🏰 *Top 10 Gremios*\n━━━━━━━━━━━━━━\n${body}`);
      }

      default:
        return m.reply(
          `🏰 *Gremios*\n\n` +
          `• /gremio crear <nombre>\n` +
          `• /gremio unirse <nombre>\n` +
          `• /gremio salir\n` +
          `• /gremio tesoro\n` +
          `• /gremio depositar <cantidad>\n` +
          `• /gremio info\n` +
          `• /gremio listar`
        );
    }
  }
};
