/**
 * Menú generado desde el registro de plugins: categorías con conteo, comandos
 * más usados, detalle por categoría y ayuda por comando con el prefijo real.
 */

import type { PluginHandler, MessageContext, MessageHandlerInterface } from '../types/message.js';
import { CONFIG } from '../config.js';
import { EMOJI, pickRandom } from '../lib/utils.js';
import { getDatabase } from '../lib/database.js';
import { resolveGroupRoles } from '../lib/group-events.js';
import { listCommands, type CommandInfo } from './index.js';

interface CategoryMeta {
  id: string;
  emoji: string;
  name: string;
  /** Solo se muestra a admins del grupo (y owners). */
  adminOnly?: boolean;
  ownerOnly?: boolean;
}

/** Categorías del menú, en orden de aparición. */
const CATEGORIES: CategoryMeta[] = [
  { id: 'ia', emoji: '🧠', name: 'Inteligencia Artificial' },
  { id: 'rpg', emoji: '🎮', name: 'RPG' },
  { id: 'juegos', emoji: '🃏', name: 'Juegos y casino' },
  { id: 'fun', emoji: '🎪', name: 'Diversión' },
  { id: 'betting', emoji: '🎫', name: 'Betting/Tipsters' },
  { id: 'media', emoji: '🎵', name: 'Media y stickers' },
  { id: 'descargas', emoji: '📥', name: 'Descargas' },
  { id: 'herramientas', emoji: '🔧', name: 'Herramientas' },
  { id: 'grupos', emoji: '👥', name: 'Administración de grupo', adminOnly: true },
  { id: 'owner', emoji: '🔐', name: 'Owner', ownerOnly: true },
  { id: 'otros', emoji: '📦', name: 'Otros' },
];

/** Valores de `plugin.category` y de tags legacy que apuntan a una categoría del menú. */
const CATEGORY_ALIASES: Record<string, string> = {
  ia: 'ia', ai: 'ia',
  rpg: 'rpg', combate: 'rpg', dungeon: 'rpg', inventario: 'rpg', tienda: 'rpg', ranking: 'rpg', mascota: 'rpg', gremio: 'rpg', economia: 'rpg', forja: 'rpg',
  game: 'juegos', games: 'juegos', juegos: 'juegos', casino: 'juegos',
  fun: 'fun', diversion: 'fun', social: 'fun',
  betting: 'betting', apuestas: 'betting',
  media: 'media', sticker: 'media', musica: 'media',
  download: 'descargas', downloads: 'descargas', descargas: 'descargas',
  tools: 'herramientas', herramientas: 'herramientas', utilidad: 'herramientas',
  group: 'grupos', grupo: 'grupos', grupos: 'grupos', admin: 'grupos',
  owner: 'owner',
};

/** Prefijos del nombre de registro cuando el plugin no declara categoría. */
const PREFIX_CATEGORY: [prefix: string, category: string][] = [
  ['rpg-', 'rpg'], ['owner-', 'owner'], ['admin-', 'owner'], ['game-', 'juegos'], ['fun-', 'fun'],
  ['group-', 'grupos'], ['media-', 'media'], ['sticker-', 'media'], ['download-', 'descargas'],
  ['tools-', 'herramientas'], ['betting-', 'betting'], ['ai-', 'ia'],
];

const MENU_TIPS = [
  '💡 Mencióname en el grupo o escríbeme en privado y te respondo',
  '💡 /resumen te pone al día si llegaste tarde a la conversación',
  '💡 Responde a una foto con /ia y te digo qué hay en ella',
  '💡 Usa /perfil para ver tu progreso',
  '💡 /daily te da recompensas gratis cada día',
  '💡 Mina materiales con /minar para /forja',
  '💡 Elige una clase con /clase para habilidades',
  '💡 Los dungeons dan mejor loot: /dungeon',
  '💡 Deposita en /banco para proteger tu dinero',
  '💡 Modo /pasivo te protege de robos',
  '💡 /casino para ver los juegos y /mesa para la partida abierta',
  '💡 /recordar 30m sacar la ropa de la lavadora',
  '💡 /encuesta Pregunta | opción 1 | opción 2',
  '💡 Reporta bugs con /bug <descripción>',
  '💡 /s convierte imágenes en stickers',
  '💡 Mejora tu equipo con /forja mejorar',
  '💡 /ranking muestra los mejores jugadores',
  '💡 /tipster add para seguir tipsters favoritos',
  '💡 /rankingtipsters muestra los mejores tipsters',
];

/** Lista corta por si aún no hay estadísticas de uso. */
const QUICK_COMMANDS = ['ia', 'perfil', 'daily', 'work', 'minar', 'atacar', 'tienda', 'inventario'];
const QUICK_LIMIT = 8;

interface Viewer {
  isOwner: boolean;
  isAdmin: boolean;
  isGroup: boolean;
}

interface MenuEntry extends CommandInfo {
  categoryId: string;
  /** Alias no sombreados por otro plugin; el primero es el que se muestra. */
  visibleCommands: string[];
}

function normalizeCategory(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return CATEGORY_ALIASES[value.toLowerCase()];
}

function resolveCategory(info: CommandInfo): string {
  if (info.owner) return 'owner';
  const declared = normalizeCategory(info.category);
  if (declared) return declared;
  const byPrefix = PREFIX_CATEGORY.find(([prefix]) => info.name.startsWith(prefix));
  if (byPrefix) return byPrefix[1];
  for (const tag of info.tags) {
    const mapped = normalizeCategory(tag);
    if (mapped) return mapped;
  }
  return 'otros';
}

function canSee(entry: MenuEntry, viewer: Viewer): boolean {
  if (entry.owner && !viewer.isOwner) return false;
  if (entry.admin && !viewer.isAdmin && !viewer.isOwner) return false;
  if (entry.group && !viewer.isGroup) return false;
  const category = CATEGORIES.find((c) => c.id === entry.categoryId);
  if (category?.ownerOnly && !viewer.isOwner) return false;
  if (category?.adminOnly && !viewer.isAdmin && !viewer.isOwner) return false;
  return true;
}

/** Entradas del menú visibles para quien pregunta, sin alias sombreados ni plugins sin alias. */
function buildEntries(handler: MessageHandlerInterface, viewer: Viewer): MenuEntry[] {
  const shadowed = new Map<string, Set<string>>();
  for (const { alias, loser } of handler.getAliasCollisions()) {
    let set = shadowed.get(loser);
    if (!set) {
      set = new Set();
      shadowed.set(loser, set);
    }
    set.add(alias);
  }
  const entries: MenuEntry[] = [];
  for (const info of listCommands(handler)) {
    const lost = shadowed.get(info.name);
    const visibleCommands = lost ? info.commands.filter((c) => !lost.has(c)) : info.commands;
    if (visibleCommands.length === 0) continue;
    const entry: MenuEntry = { ...info, categoryId: resolveCategory(info), visibleCommands };
    if (canSee(entry, viewer)) entries.push(entry);
  }
  return entries;
}

/** Categoría por id, nombre o alias; la coincidencia parcial del nombre exige 3+ letras para no tragarse alias de una letra. */
function findCategory(query: string): CategoryMeta | undefined {
  const q = query.toLowerCase();
  return (
    CATEGORIES.find((c) => c.id === q) ||
    CATEGORIES.find((c) => c.name.toLowerCase() === q) ||
    CATEGORIES.find((c) => c.id === normalizeCategory(q)) ||
    (q.length >= 3 ? CATEGORIES.find((c) => c.name.toLowerCase().includes(q)) : undefined)
  );
}

function findEntry(entries: MenuEntry[], query: string): MenuEntry | undefined {
  const wanted = query.replace(CONFIG.prefix, '');
  return entries.find((e) => e.visibleCommands.includes(wanted)) ?? entries.find((e) => e.commands.includes(wanted));
}

/** Comandos más usados según las estadísticas; si no hay, la lista fija. */
function quickCommands(entries: MenuEntry[]): string[] {
  const stats = getDatabase().data.stats ?? {};
  const ranked = entries
    .map((e) => ({ cmd: e.visibleCommands[0], total: stats[e.name]?.total ?? 0 }))
    .filter((e) => e.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, QUICK_LIMIT)
    .map((e) => e.cmd);
  if (ranked.length >= QUICK_LIMIT) return ranked;
  const known = new Set(entries.flatMap((e) => e.visibleCommands));
  for (const cmd of QUICK_COMMANDS) {
    if (ranked.length >= QUICK_LIMIT) break;
    if (known.has(cmd) && !ranked.includes(cmd)) ranked.push(cmd);
  }
  return ranked;
}

function withPrefix(text: string, usedPrefix: string): string {
  return text.replace(/\//g, usedPrefix);
}

const LINE = '━━━━━━━━━━━━━━━━━━━━━';

function mainMenu(entries: MenuEntry[], userName: string, usedPrefix: string): string {
  const counts = new Map<string, number>();
  for (const e of entries) counts.set(e.categoryId, (counts.get(e.categoryId) ?? 0) + 1);

  let menu = `╭━━━━━━━━━━━━━━━━━━━━━╮\n┃  ${EMOJI.bot} *${CONFIG.botName}*\n┃  _Hola, ${userName}!_\n╰━━━━━━━━━━━━━━━━━━━━━╯\n\n`;
  const quick = quickCommands(entries);
  if (quick.length > 0) {
    menu += `⚡ *RÁPIDO:* ${quick.map((c) => `${usedPrefix}${c}`).join('  ')}\n\n`;
  }
  menu += `📋 *CATEGORÍAS*\n\n`;
  for (const cat of CATEGORIES) {
    const count = counts.get(cat.id);
    if (!count) continue;
    menu += `${cat.emoji} *${cat.name}* _(${count})_\n   → ${usedPrefix}menu ${cat.id}\n`;
  }
  menu += `\n${LINE}\n${withPrefix(pickRandom(MENU_TIPS), usedPrefix)}`;
  menu += `\n💡 ${usedPrefix}menu <comando> muestra la ayuda de un comando`;
  return menu;
}

function categoryMenu(cat: CategoryMeta, entries: MenuEntry[], usedPrefix: string): string {
  const items = entries.filter((e) => e.categoryId === cat.id);
  let menu = `${cat.emoji} *${cat.name.toUpperCase()}* _(${items.length})_\n${LINE}\n\n`;
  for (const e of items) {
    const marks = [e.group && !cat.adminOnly ? '👥' : '', e.admin && !cat.adminOnly ? '🛡️' : ''].filter(Boolean).join('');
    menu += `▸ *${usedPrefix}${e.visibleCommands[0]}*${marks ? ` ${marks}` : ''}`;
    if (e.description) menu += `\n   ${e.description}`;
    menu += `\n`;
  }
  menu += `\n${LINE}\n💡 ${usedPrefix}menu - Menú principal\n💡 ${usedPrefix}menu <comando> - Detalles`;
  return menu;
}

/** Línea de ayuda con el prefijo real delante si empieza por uno de los alias del plugin. */
function helpLine(line: string, aliases: string[], usedPrefix: string): string {
  const first = line.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  return aliases.includes(first) ? `${usedPrefix}${line.trim()}` : line;
}

function commandDetails(entry: MenuEntry, usedPrefix: string): string {
  const cat = CATEGORIES.find((c) => c.id === entry.categoryId);
  const main = entry.visibleCommands[0];
  let details = `${cat?.emoji ?? '📦'} *${usedPrefix}${main}*\n${LINE}\n`;
  if (entry.description) details += `\n📝 *Descripción:*\n   ${entry.description}\n`;

  const usage = entry.usage.length > 0
    ? entry.usage.map((u) => `${usedPrefix}${u}`)
    : entry.help.map((h) => helpLine(h, entry.commands, usedPrefix));
  if (usage.length > 0) details += `\n🔧 *Uso:*\n${usage.map((u) => `   ${u}`).join('\n')}\n`;

  const aliases = entry.visibleCommands.slice(1);
  if (aliases.length > 0) details += `\n🏷️ *Alias:* ${aliases.map((a) => `${usedPrefix}${a}`).join(', ')}\n`;

  const requirements = [
    entry.owner && 'solo owner',
    entry.admin && 'admin del grupo',
    entry.botAdmin && 'bot admin',
    entry.group && 'solo en grupos',
    entry.register && 'registro (' + usedPrefix + 'verificar)',
  ].filter(Boolean);
  if (requirements.length > 0) details += `\n🔒 *Requiere:* ${requirements.join(', ')}\n`;
  if (cat) details += `\n📁 *Categoría:* ${cat.emoji} ${cat.name}`;
  return details;
}

export const menuPlugin: PluginHandler = {
  command: ['menu', 'help', 'ayuda', 'comandos', '?'],
  category: 'herramientas',
  description: 'Lista de comandos por categoría y ayuda de cada comando',
  help: [
    'menu - Ver menú principal',
    'menu <categoría> - Ver comandos de una categoría',
    'menu <comando> - Ver detalles de un comando',
  ],

  handler: async (ctx: MessageContext) => {
    const { m, conn, text, usedPrefix, isOwner, handler } = ctx;
    const query = text.trim().toLowerCase();
    const isAdmin = m.isGroup ? (await resolveGroupRoles(conn, m.chat, m.sender)).isAdmin : false;
    const entries = buildEntries(handler, { isOwner, isAdmin, isGroup: m.isGroup });

    if (query) {
      // El comando exacto va primero: "s" o "ia" son alias, no una búsqueda de categoría.
      const entry = findEntry(entries, query);
      if (entry) {
        await m.reply(commandDetails(entry, usedPrefix));
        return;
      }

      const cat = findCategory(query);
      if (cat && entries.some((e) => e.categoryId === cat.id)) {
        await m.reply(categoryMenu(cat, entries, usedPrefix));
        return;
      }

      const shown = query.length > 30 ? `${query.slice(0, 30)}…` : query;
      await m.reply(`${EMOJI.error} No encontré "*${shown}*".\n\n📋 Usa *${usedPrefix}menu* para ver las categorías.`);
      return;
    }

    const user = getDatabase().data.users[m.sender];
    const userName = user?.name || m.pushName || 'Aventurero';
    await m.reply(mainMenu(entries, userName, usedPrefix));
    await m.react('📋');
  },
};

export default menuPlugin;
