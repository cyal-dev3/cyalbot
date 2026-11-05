import type { PluginHandler, MessageContext } from '../types/message.js';
import { EMOJI, formatNumber, parseAmount, mentionTag, normalizeText } from '../lib/utils.js';
import { getDatabase, type Database } from '../lib/database.js';
import { GUILD } from '../constants/rpg.js';
import type { Guild } from '../types/database.js';
import type { UserRPG } from '../types/user.js';
import { GUILD_XP_BONUS_PER_LEVEL, usageError } from '../lib/rpg-actions.js';
import { updateQuestProgress } from '../lib/quests.js';

const GUILDS_PER_PAGE = 10;
const MAX_DESCRIPTION = 120;

export function findGuildByName(db: Database, name: string): Guild | null {
  const wanted = normalizeText(name.trim());
  return db.listGuilds().find(g => normalizeText(g.name) === wanted) ?? null;
}

/** Gremio del usuario; limpia un guildId huérfano (gremio disuelto) */
export function getUserGuild(db: Database, jid: string, user: UserRPG): Guild | null {
  if (!user.guildId) return null;
  const guild = db.getGuild(user.guildId);
  if (!guild || !guild.members.includes(jid)) {
    db.updateUser(jid, { guildId: null });
    return null;
  }
  return guild;
}

/** Suma XP al gremio y sube los niveles que correspondan; devuelve los niveles ganados */
export function addGuildExp(guild: Guild, amount: number): number {
  let gained = 0;
  guild.exp += Math.max(0, Math.floor(amount));
  while (guild.exp >= guild.level * GUILD.XP_PER_LEVEL) {
    guild.exp -= guild.level * GUILD.XP_PER_LEVEL;
    guild.level++;
    gained++;
  }
  return gained;
}

function requireMember(ctx: MessageContext, db: Database, user: UserRPG): Guild | null {
  const guild = getUserGuild(db, ctx.m.sender, user);
  if (!guild) void ctx.m.reply(`❌ No perteneces a ningún gremio. Usa *${ctx.usedPrefix}gremio listar*.`);
  return guild;
}

function requireLeader(ctx: MessageContext, db: Database, user: UserRPG): Guild | null {
  const guild = requireMember(ctx, db, user);
  if (!guild) return null;
  if (guild.leader !== ctx.m.sender) {
    void ctx.m.reply('👑 Solo el líder del gremio puede hacer eso.');
    return null;
  }
  return guild;
}

/** Miembro del gremio por mención/cita/número, o por nombre registrado */
function resolveMember(ctx: MessageContext, db: Database, guild: Guild, rest: string): string | null {
  const target = ctx.target({ args: ctx.args });
  if (target) return guild.members.includes(target) ? target : null;
  const wanted = normalizeText(rest);
  if (!wanted) return null;
  return guild.members.find(jid => normalizeText(db.getUser(jid).name) === wanted) ?? null;
}

export const gremioPlugin: PluginHandler = {
  command: /^(gremio|guild)$/i,
  tags: ['rpg', 'gremio'],
  help: [
    'gremio - Info de tu gremio',
    'gremio crear <nombre> - Fundar un gremio',
    'gremio unirse <nombre> - Unirte a un gremio',
    'gremio salir - Abandonar tu gremio',
    'gremio depositar <cantidad> - Aportar al tesoro (da XP al gremio)',
    'gremio retirar <cantidad> - Sacar del tesoro (líder)',
    'gremio expulsar @usuario - Expulsar a un miembro (líder)',
    'gremio lider @usuario - Ceder el liderazgo (líder)',
    'gremio descripcion <texto> - Cambiar la descripción (líder)',
    'gremio listar [página] - Ver todos los gremios'
  ],
  usage: [
    'gremio', 'gremio crear <nombre>', 'gremio unirse <nombre>', 'gremio salir',
    'gremio depositar <cantidad>', 'gremio retirar <cantidad>', 'gremio expulsar @usuario',
    'gremio lider @usuario', 'gremio descripcion <texto>', 'gremio listar [página]'
  ],
  register: true,
  handler: async (ctx: MessageContext) => {
    const { m, args, usedPrefix } = ctx;
    const db = getDatabase();
    const user = db.getUser(m.sender);
    const sub = (args[0] ?? '').toLowerCase();
    const rest = args.slice(1).join(' ').trim();

    switch (sub) {
      case 'crear':
      case 'create': {
        if (getUserGuild(db, m.sender, user)) return m.reply(`🏰 Ya perteneces a un gremio. Sal primero con *${usedPrefix}gremio salir*.`);
        if (!rest) return usageError(ctx, gremioPlugin, 'Indica el nombre del gremio.');
        if (rest.length < 3 || rest.length > 24) return m.reply('❌ El nombre debe tener entre 3 y 24 caracteres.');
        if (findGuildByName(db, rest)) return m.reply('❌ Ya existe un gremio con ese nombre.');
        if (user.money < GUILD.CREATE_COST) return m.reply(`${EMOJI.warning} Crear un gremio cuesta *${formatNumber(GUILD.CREATE_COST)} 💰*.`);

        const now = Date.now();
        const guild: Guild = {
          id: `g_${now}_${Math.random().toString(36).slice(2, 8)}`,
          name: rest,
          tag: normalizeText(rest).replace(/[^a-z0-9]/g, '').slice(0, 3).toUpperCase() || 'GRM',
          leader: m.sender,
          members: [m.sender],
          treasury: 0,
          level: 1,
          exp: 0,
          createdAt: now,
          description: ''
        };
        db.saveGuild(guild);
        db.updateUser(m.sender, { money: user.money - GUILD.CREATE_COST, guildId: guild.id });
        const questLines = updateQuestProgress(db, m.sender, 'spend', GUILD.CREATE_COST).lines;

        return m.reply(
          `🏰 Gremio *${guild.name}* [${guild.tag}] creado por ${formatNumber(GUILD.CREATE_COST)} 💰.\n` +
          `💡 Tus miembros ganan *+${GUILD_XP_BONUS_PER_LEVEL}% XP por nivel del gremio*; sube de nivel depositando en el tesoro.` +
          (questLines.length ? `\n\n${questLines.join('\n')}` : '')
        );
      }

      case 'unirse':
      case 'join': {
        if (getUserGuild(db, m.sender, user)) return m.reply('🏰 Ya perteneces a un gremio.');
        if (!rest) return usageError(ctx, gremioPlugin, 'Indica el nombre del gremio.');
        const guild = findGuildByName(db, rest);
        if (!guild) return m.reply('❌ No se encontró ese gremio.');
        if (guild.members.length >= GUILD.MAX_MEMBERS) return m.reply(`❌ El gremio está lleno (${GUILD.MAX_MEMBERS} miembros).`);

        guild.members.push(m.sender);
        db.saveGuild(guild);
        db.updateUser(m.sender, { guildId: guild.id });
        return m.reply(`🎉 Te uniste al gremio *${guild.name}* [${guild.tag}]. Bonus de XP: *+${guild.level * GUILD_XP_BONUS_PER_LEVEL}%*.`);
      }

      case 'salir':
      case 'leave': {
        const guild = requireMember(ctx, db, user);
        if (!guild) return;

        guild.members = guild.members.filter(jid => jid !== m.sender);
        db.updateUser(m.sender, { guildId: null });

        if (guild.members.length === 0) {
          db.deleteGuild(guild.id);
          return m.reply(`🏰 Saliste de *${guild.name}*. El gremio quedó vacío y fue disuelto.`);
        }
        if (guild.leader === m.sender) guild.leader = guild.members[0];
        db.saveGuild(guild);
        return m.reply(`🏰 Saliste de *${guild.name}*.`);
      }

      case 'depositar':
      case 'deposit': {
        const guild = requireMember(ctx, db, user);
        if (!guild) return;
        const amount = parseAmount(rest, user.money);
        if (amount === null || amount <= 0) return usageError(ctx, gremioPlugin, 'Cantidad inválida (ej. 5000, 1k, todo).');
        if (user.money < amount) return m.reply(`${EMOJI.warning} No tienes tanto dinero (tienes ${formatNumber(user.money)}).`);

        guild.treasury += amount;
        const levels = addGuildExp(guild, Math.floor(amount / 100));
        db.saveGuild(guild);
        db.updateUser(m.sender, { money: user.money - amount });

        return m.reply(
          `💰 Depositaste ${formatNumber(amount)} al tesoro de *${guild.name}* (ahora ${formatNumber(guild.treasury)}).` +
          (levels > 0 ? `\n⭐ ¡El gremio subió al nivel *${guild.level}*! Bonus de XP: +${guild.level * GUILD_XP_BONUS_PER_LEVEL}%.` : '')
        );
      }

      case 'retirar':
      case 'withdraw': {
        const guild = requireLeader(ctx, db, user);
        if (!guild) return;
        const amount = parseAmount(rest, guild.treasury);
        if (amount === null || amount <= 0) return usageError(ctx, gremioPlugin, 'Cantidad inválida (ej. 5000, 1k, todo).');
        if (amount > guild.treasury) return m.reply(`${EMOJI.warning} El tesoro solo tiene ${formatNumber(guild.treasury)}.`);

        guild.treasury -= amount;
        db.saveGuild(guild);
        db.updateUser(m.sender, { money: user.money + amount });
        return m.reply(`💸 Retiraste ${formatNumber(amount)} del tesoro de *${guild.name}* (quedan ${formatNumber(guild.treasury)}).`);
      }

      case 'expulsar':
      case 'kick': {
        const guild = requireLeader(ctx, db, user);
        if (!guild) return;
        const target = resolveMember(ctx, db, guild, rest);
        if (!target) return m.reply('❌ Menciona a un miembro del gremio (o escribe su nombre).');
        if (target === m.sender) return m.reply(`❌ No puedes expulsarte; usa *${usedPrefix}gremio salir*.`);

        guild.members = guild.members.filter(jid => jid !== target);
        db.saveGuild(guild);
        db.updateUser(target, { guildId: null });
        return ctx.send({ text: `👢 ${mentionTag(target)} fue expulsado de *${guild.name}*.`, mentions: [target] });
      }

      case 'lider':
      case 'líder':
      case 'leader': {
        const guild = requireLeader(ctx, db, user);
        if (!guild) return;
        const target = resolveMember(ctx, db, guild, rest);
        if (!target) return m.reply('❌ Menciona a un miembro del gremio (o escribe su nombre).');
        if (target === m.sender) return m.reply('👑 Ya eres el líder.');

        guild.leader = target;
        db.saveGuild(guild);
        return ctx.send({ text: `👑 ${mentionTag(target)} es el nuevo líder de *${guild.name}*.`, mentions: [target] });
      }

      case 'descripcion':
      case 'descripción':
      case 'desc': {
        const guild = requireLeader(ctx, db, user);
        if (!guild) return;
        if (!rest) return usageError(ctx, gremioPlugin, 'Escribe la nueva descripción.');
        if (rest.length > MAX_DESCRIPTION) return m.reply(`❌ Máximo ${MAX_DESCRIPTION} caracteres.`);

        guild.description = rest;
        db.saveGuild(guild);
        return m.reply(`📝 Descripción de *${guild.name}* actualizada.`);
      }

      case 'tesoro':
      case 'treasury': {
        const guild = requireMember(ctx, db, user);
        if (!guild) return;
        return m.reply(`💰 Tesoro de *${guild.name}*: *${formatNumber(guild.treasury)}* monedas.`);
      }

      case 'listar':
      case 'list': {
        const guilds = db.listGuilds().sort((a, b) => b.level - a.level || b.members.length - a.members.length);
        if (guilds.length === 0) return m.reply(`🏰 No hay gremios creados. Funda uno con *${usedPrefix}gremio crear <nombre>*.`);

        const pages = Math.ceil(guilds.length / GUILDS_PER_PAGE);
        const page = Math.min(pages, Math.max(1, parseInt(rest, 10) || 1));
        const start = (page - 1) * GUILDS_PER_PAGE;
        const body = guilds
          .slice(start, start + GUILDS_PER_PAGE)
          .map((g, i) => `${start + i + 1}. *${g.name}* [${g.tag}] — Nv.${g.level} · ${g.members.length}/${GUILD.MAX_MEMBERS} miembros`)
          .join('\n');

        return m.reply(
          `🏰 *Gremios (página ${page}/${pages})*\n━━━━━━━━━━━━━━\n${body}` +
          (pages > 1 ? `\n\n💡 *${usedPrefix}gremio listar ${page + 1 > pages ? 1 : page + 1}* para ver más` : '')
        );
      }

      case 'info':
      case '': {
        const guild = requireMember(ctx, db, user);
        if (!guild) return;
        return ctx.send({
          text: `🏰 *${guild.name}* [${guild.tag}]\n━━━━━━━━━━━━━━\n` +
            (guild.description ? `📝 _${guild.description}_\n` : '') +
            `👑 Líder: ${mentionTag(guild.leader)}\n` +
            `👥 Miembros: ${guild.members.length}/${GUILD.MAX_MEMBERS}\n` +
            `⭐ Nivel: ${guild.level} (XP ${formatNumber(guild.exp)}/${formatNumber(guild.level * GUILD.XP_PER_LEVEL)})\n` +
            `✨ Bonus de XP para miembros: +${guild.level * GUILD_XP_BONUS_PER_LEVEL}%\n` +
            `💰 Tesoro: ${formatNumber(guild.treasury)}`,
          mentions: [guild.leader]
        });
      }

      default:
        return usageError(ctx, gremioPlugin, `Subcomando desconocido: ${sub}`);
    }
  }
};
