/**
 * Interruptores por grupo (on/off) definidos en una sola tabla. Cada entrada
 * produce un plugin con el mismo comportamiento: sin argumento muestra estado
 * y uso, con on/off escribe el campo de ChatSettings y confirma.
 */

import type { PluginHandler, MessageContext } from '../types/message.js';
import type { ChatSettings } from '../types/database.js';
import { getDatabase } from '../lib/database.js';
import { CONFIG } from '../config.js';
import { getAntiLinkMode, type AntiLinkMode } from '../lib/moderation.js';
import { previewWelcome, previewBye } from './group-welcome.js';

export type ToggleState = 'on' | 'off' | 'status';

const ON_WORDS = new Set(['on', '1', 'si', 'sí', 'yes', 'activar', 'activado', 'activada', 'enable', 'true']);
const OFF_WORDS = new Set(['off', '0', 'no', 'desactivar', 'desactivado', 'desactivada', 'disable', 'false']);

/** Interpreta el argumento de un interruptor; cualquier otra cosa (o nada) es 'status'. */
export function parseToggle(text: string | undefined | null): ToggleState {
  const word = (text ?? '').trim().toLowerCase().split(/\s+/)[0] ?? '';
  if (ON_WORDS.has(word)) return 'on';
  if (OFF_WORDS.has(word)) return 'off';
  return 'status';
}

/** Campos que todavía no existen en ChatSettings (los añade el agente de datos; ver handoff). */
type PendingBooleanField = 'enabled';

type BooleanField = {
  [K in keyof ChatSettings]-?: NonNullable<ChatSettings[K]> extends boolean ? K : never;
}[keyof ChatSettings];

export type ToggleField = BooleanField | PendingBooleanField;

export interface ToggleDefinition {
  command: string[];
  field: ToggleField;
  /** Nombre corto para el panel y los mensajes de estado. */
  label: string;
  emoji: string;
  description: string;
  /** Confirmaciones; `{p}` se sustituye por el prefijo usado. */
  onText: string;
  offText: string;
  admin?: boolean;
  owner?: boolean;
  botAdmin?: boolean;
  /** Valor cuando el campo no está en la BD (p. ej. `enabled` se asume true). */
  defaultOn?: boolean;
  /** Campos adicionales a guardar al activar (p. ej. cargar las palabras por defecto). */
  onEnable?: (settings: ChatSettings) => Partial<ChatSettings> | void;
  /** Subcomandos que no son on/off: `antilink all`, `welcome test`. */
  extra?: Record<string, (ctx: MessageContext, settings: ChatSettings) => Promise<void>>;
  /** Línea adicional en el estado (modo, cantidad de palabras...). */
  statusLine?: (settings: ChatSettings) => string;
  /** Líneas de uso adicionales; reciben el prefijo. */
  usageExtra?: (prefix: string) => string[];
}

export function readToggle(settings: ChatSettings, def: Pick<ToggleDefinition, 'field' | 'defaultOn'>): boolean {
  const value = (settings as unknown as Record<string, unknown>)[def.field];
  return typeof value === 'boolean' ? value : def.defaultOn === true;
}

export function statusIcon(enabled: boolean): string {
  return enabled ? '🟢' : '🔴';
}

function statusText(def: ToggleDefinition, settings: ChatSettings, prefix: string): string {
  const enabled = readToggle(settings, def);
  const lines = [
    `${def.emoji} *${def.label}*`,
    '',
    `Estado: ${statusIcon(enabled)} ${enabled ? 'Activado' : 'Desactivado'}`,
  ];
  const extra = def.statusLine?.(settings);
  if (extra) lines.push(extra);
  lines.push('', '📝 Uso:', `• ${prefix}${def.command[0]} on - Activar`, `• ${prefix}${def.command[0]} off - Desactivar`);
  for (const line of def.usageExtra?.(prefix) ?? []) lines.push(`• ${line}`);
  return lines.join('\n');
}

export function createTogglePlugin(def: ToggleDefinition): PluginHandler {
  return {
    command: def.command,
    description: def.description,
    category: 'group',
    help: [`${def.command[0]} on|off - ${def.description}`],
    group: true,
    owner: def.owner,
    admin: def.owner ? undefined : def.admin ?? true,
    botAdmin: def.botAdmin,

    handler: async (ctx: MessageContext) => {
      const { m, text, usedPrefix } = ctx;
      const db = getDatabase();
      const settings = db.getChatSettings(m.chat);
      const word = text.trim().toLowerCase().split(/\s+/)[0] ?? '';

      const extra = def.extra?.[word];
      if (extra) {
        await extra(ctx, settings);
        return;
      }

      const state = parseToggle(word);
      if (state === 'status') {
        await m.reply(statusText(def, settings, usedPrefix));
        return;
      }

      const enable = state === 'on';
      if (enable === readToggle(settings, def)) {
        await m.reply(`ℹ️ ${def.label} ya está ${enable ? 'activado' : 'desactivado'}.`);
        return;
      }

      const updates: Record<string, unknown> = { [def.field]: enable };
      if (enable) Object.assign(updates, def.onEnable?.(settings) ?? {});
      db.updateChatSettings(m.chat, updates as Partial<ChatSettings>);
      await m.reply((enable ? def.onText : def.offText).replace(/{p}/g, usedPrefix));
    },
  };
}

function setAntiLinkMode(mode: AntiLinkMode) {
  return async (ctx: MessageContext): Promise<void> => {
    getDatabase().updateChatSettings(ctx.m.chat, { antiLink: true, antiLinkMode: mode } as Partial<ChatSettings>);
    await ctx.m.reply(mode === 'all'
      ? '✅ *Antilink activado en modo estricto*\n\n🔗 Se eliminará cualquier URL que envíe un usuario que no sea admin.'
      : '✅ *Antilink activado*\n\n🔗 Se eliminarán las invitaciones de WhatsApp y Telegram.');
  };
}

const DEFS = {
  antilink: {
    command: ['antilink'],
    field: 'antiLink',
    label: 'Antilink',
    emoji: '🔗',
    description: 'Elimina enlaces de invitación y advierte al autor (con "all", cualquier URL)',
    onText: '✅ *Antilink activado*\n\n🔗 Las invitaciones de WhatsApp y Telegram serán eliminadas y su autor recibirá una advertencia.',
    offText: '✅ *Antilink desactivado*\n\n🔗 Los enlaces ya no serán eliminados.',
    botAdmin: true,
    extra: { all: setAntiLinkMode('all'), wa: setAntiLinkMode('wa') },
    statusLine: (s) => `Modo: ${getAntiLinkMode(s) === 'all' ? 'cualquier URL (all)' : 'solo invitaciones (wa)'}`,
    usageExtra: (p) => [`${p}antilink all - Bloquear cualquier URL`, `${p}antilink wa - Solo invitaciones`],
  },
  antispam: {
    command: ['antispam'],
    field: 'antiSpam',
    label: 'Antispam',
    emoji: '🚫',
    description: 'Elimina y advierte a quien envíe demasiados mensajes seguidos',
    onText: `✅ *Antispam activado*\n\n🚫 Más de ${CONFIG.protection.maxMessagesPerInterval} mensajes en ${CONFIG.protection.intervalMs / 1000} segundos se eliminan y suman una advertencia.`,
    offText: '✅ *Antispam desactivado*',
    botAdmin: true,
  },
  antidelete: {
    command: ['antidelete', 'antieliminar'],
    field: 'antiDelete',
    label: 'Anti-delete',
    emoji: '🗑️',
    description: 'Reenvía los mensajes que alguien borra',
    onText: '✅ *Anti-delete activado*\n\n🗑️ Los mensajes eliminados se reenviarán al grupo indicando quién los borró.',
    offText: '✅ *Anti-delete desactivado*',
  },
  antibad: {
    command: ['antibad', 'antigroserias', 'antibadword'],
    field: 'antiBad',
    label: 'Anti-groserías',
    emoji: '🤬',
    description: 'Elimina mensajes con palabras prohibidas',
    onText: '✅ *Anti-groserías activado*\n\n🤬 Los mensajes con palabras prohibidas serán eliminados. Edita la lista con {p}addbadword y {p}delbadword.',
    offText: '✅ *Anti-groserías desactivado*',
    botAdmin: true,
    // Sin lista propia el filtro no haría nada; se parte de la lista de CONFIG.
    onEnable: (s) => (s.badWords?.length ? undefined : { badWords: [...CONFIG.defaultBadWords] }),
    statusLine: (s) => `Palabras: ${s.badWords?.length ?? 0}`,
    usageExtra: (p) => [`${p}addbadword <palabra> - Agregar`, `${p}delbadword <palabra> - Quitar`, `${p}listbadwords - Ver lista`],
  },
  autosticker: {
    command: ['autosticker', 'autostiker', 'as'],
    field: 'autoSticker',
    label: 'Auto-sticker',
    emoji: '🎨',
    description: 'Convierte en sticker toda imagen que se envíe',
    onText: '✅ *Auto-sticker activado*\n\n🎨 Las imágenes se convertirán automáticamente en stickers.',
    offText: '✅ *Auto-sticker desactivado*',
  },
  autodownload: {
    command: ['autodownload', 'autodl', 'autodescarga'],
    field: 'autoDownload',
    label: 'Auto-descarga',
    emoji: '📥',
    description: 'Descarga automáticamente los enlaces de redes sociales',
    onText: '✅ *Auto-descarga activada*\n\n📥 Los enlaces de TikTok, Instagram, Facebook, Twitter/X, YouTube, Pinterest y Threads se descargarán solos.',
    offText: '✅ *Auto-descarga desactivada*',
    statusLine: () => 'Plataformas: TikTok, Instagram, Facebook, Twitter/X, YouTube, Pinterest, Threads',
  },
  welcome: {
    command: ['welcome'],
    field: 'welcome',
    label: 'Bienvenidas',
    emoji: '👋',
    description: 'Saluda a quien entra al grupo',
    onText: '✅ *Bienvenidas activadas*\n\n👋 Se enviará un mensaje cuando alguien entre. Personalízalo con {p}setwelcome.',
    offText: '✅ *Bienvenidas desactivadas*',
    extra: { test: previewWelcome },
    usageExtra: (p) => [`${p}welcome test - Vista previa`, `${p}setwelcome <mensaje> - Personalizar`],
  },
  bye: {
    command: ['bye'],
    // El campo se llama `detect` por herencia; el agente de datos lo renombra a `bye` (ver handoff).
    field: 'detect',
    label: 'Despedidas',
    emoji: '🚪',
    description: 'Avisa cuando alguien sale del grupo',
    onText: '✅ *Despedidas activadas*\n\n🚪 Se enviará un mensaje cuando alguien salga. Personalízalo con {p}setbye.',
    offText: '✅ *Despedidas desactivadas*',
    extra: { test: previewBye },
    usageExtra: (p) => [`${p}bye test - Vista previa`, `${p}setbye <mensaje> - Personalizar`],
  },
  autoclear: {
    command: ['autoclear', 'autolimpiar', 'autoclean'],
    field: 'autoClearEnabled',
    label: 'Autoclear',
    emoji: '🧹',
    description: 'Borra los mensajes del bot y los comandos a los 2 minutos',
    onText: '✅ *Autoclear activado*\n\n🧹 Los mensajes del bot y los comandos se eliminarán solos a los 2 minutos.',
    offText: '✅ *Autoclear desactivado*\n\n🧹 Usa {p}clear para limpiar a mano.',
    botAdmin: true,
  },
  compacto: {
    command: ['compacto', 'compact', 'silencioso', 'quiet'],
    field: 'compactMode',
    label: 'Modo compacto',
    emoji: '🔇',
    description: 'El bot confirma con reacciones en vez de mensajes',
    onText: '✅ *Modo compacto activado*\n\n🔇 Las confirmaciones serán reacciones; solo se envían mensajes importantes.',
    offText: '✅ *Modo compacto desactivado*\n\n🔊 El bot vuelve a confirmar con mensajes.',
  },
  automute: {
    command: ['automute', 'autosilencio'],
    field: 'autoMuteEnabled',
    label: 'Automute',
    emoji: '🔇',
    description: 'Borra los mensajes de los usuarios silenciados con {p}mute',
    onText: '✅ *Automute activado*\n\n🔇 Los mensajes de los usuarios silenciados se eliminarán. {p}mute lo activa solo si hace falta.',
    offText: '✅ *Automute desactivado*\n\n🔊 Los silenciados vuelven a poder escribir (la lista se conserva).',
    botAdmin: true,
  },
  bot: {
    // "bot" también es alias de /ia; mientras no se retire de ahí, usar botgrupo (ver handoff).
    command: ['bot', 'botgrupo'],
    field: 'enabled',
    label: 'Bot en este grupo',
    emoji: '🤖',
    description: 'Apaga el bot en el grupo; solo el owner y "bot on" siguen funcionando',
    onText: '✅ *Bot activado en este grupo*',
    offText: '😴 *Bot desactivado en este grupo*\n\nSolo el owner puede usarlo. Un admin lo reactiva con {p}bot on.',
    defaultOn: true,
  },
} satisfies Record<string, ToggleDefinition>;

export const TOGGLES: readonly ToggleDefinition[] = Object.values(DEFS);

export const antiLinkPlugin = createTogglePlugin(DEFS.antilink);
export const antiSpamPlugin = createTogglePlugin(DEFS.antispam);
export const antiDeletePlugin = createTogglePlugin(DEFS.antidelete);
export const antiBadPlugin = createTogglePlugin(DEFS.antibad);
export const autoStickerPlugin = createTogglePlugin(DEFS.autosticker);
export const autoDownloadPlugin = createTogglePlugin(DEFS.autodownload);
export const welcomeTogglePlugin = createTogglePlugin(DEFS.welcome);
export const byeTogglePlugin = createTogglePlugin(DEFS.bye);
export const autoClearPlugin = createTogglePlugin(DEFS.autoclear);
export const compactPlugin = createTogglePlugin(DEFS.compacto);
export const automutePlugin = createTogglePlugin(DEFS.automute);
export const botTogglePlugin = createTogglePlugin(DEFS.bot);

/** Entradas listas para ENTRIES.grupos en plugins/index.ts. */
export const TOGGLE_ENTRIES: readonly [name: string, plugin: PluginHandler][] = [
  ['group-antilink', antiLinkPlugin],
  ['group-antispam', antiSpamPlugin],
  ['group-antidelete', antiDeletePlugin],
  ['group-antibad', antiBadPlugin],
  ['group-autosticker', autoStickerPlugin],
  ['group-autodownload', autoDownloadPlugin],
  ['group-welcome', welcomeTogglePlugin],
  ['group-bye', byeTogglePlugin],
  ['group-autoclear', autoClearPlugin],
  ['group-compact', compactPlugin],
  ['group-automute', automutePlugin],
  ['group-bot', botTogglePlugin],
];

/** true salvo que un admin haya apagado el bot en el grupo con `bot off`. */
export function isBotEnabled(settings: ChatSettings): boolean {
  return readToggle(settings, DEFS.bot);
}
