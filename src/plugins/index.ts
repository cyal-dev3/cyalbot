/**
 * Registro de plugins.
 *
 * Cada entrada es [nombre, plugin]. El nombre identifica al plugin en logs,
 * errores y estadísticas; los comandos que responde los define el propio
 * plugin en `command`. Para añadir un comando nuevo: crea el archivo en esta
 * carpeta, impórtalo y agrégalo a la sección que le corresponda.
 */

import type { MessageHandler } from '../handler.js';
import type { PluginHandler, PluginRegistry } from '../types/message.js';
import { createLogger } from '../lib/logger.js';
import { commandAliases } from '../lib/command-suggest.js';

// RPG
import { verificarPlugin } from './rpg-verificar.js';
import { perfilPlugin } from './rpg-perfil.js';
import { nivelPlugin } from './rpg-nivel.js';
import { dailyPlugin } from './rpg-daily.js';
import { workPlugin } from './rpg-work.js';
import { minePlugin } from './rpg-minar.js';
import { robarPlugin } from './rpg-robar.js';
import { atacarPlugin } from './rpg-atacar.js';
import {
  dueloPlugin, aceptarPlugin, rechazarPlugin, atacarDueloPlugin, bloquearDueloPlugin,
  poderDueloPlugin, skillDetectorPlugin, rendirsePlugin,
} from './rpg-duelo.js';
import { bombardearPlugin, pagarDeudaPlugin, verDeudaPlugin } from './rpg-bombardear.js';
import { registerInventoryPlugins } from './rpg-inventario.js';
import { registerShopPlugins } from './rpg-tienda.js';
import { clasePlugin, clasesPlugin, habilidadesPlugin } from './rpg-clase.js';
import { dungeonPlugin, dungeonsPlugin } from './rpg-dungeon.js';
import {
  dungeonsInteractivoPlugin, dungeonInteractivoPlugin, atacarDungeonPlugin, defenderDungeonPlugin,
  habilidadDungeonPlugin, itemDungeonPlugin, huirDungeonPlugin, estadoDungeonPlugin,
} from './rpg-dungeon-interactivo.js';
import { registerRankingPlugins } from './rpg-ranking.js';
import { misionesPlugin, reclamarMisionPlugin } from './rpg-misiones.js';
import { fumarPlugin } from './rpg-fumar.js';
import forjaMenuPlugin from './rpg-forja.js';
import {
  bancoPlugin, transferirPlugin, esclavizarPlugin, liberarPlugin, esclavosPlugin, pasivoPlugin, estadoEconomiaPlugin,
} from './rpg-economia.js';
import { adoptarPlugin, mascotaPlugin, alimentarPlugin, entrenarPlugin } from './rpg-mascotas.js';
import { gremioPlugin } from './rpg-gremios.js';
import ownerRpgPlugins from './owner-rpg.js';

// Grupos
import { TOGGLE_ENTRIES } from './group-toggles.js';
import {
  grupoPlugin, linkPlugin, revokePlugin, setNamePlugin, setDescPlugin, setPicPlugin, adminsPlugin, leavePlugin,
} from './group-tools.js';
import { promotePlugin, demotePlugin, kickPlugin } from './group-admin.js';
import { mutePlugin, tempMutePlugin, unmutePlugin, listMutePlugin } from './group-mute.js';
import { warnPlugin, unwarnPlugin, listWarnPlugin, clearWarnPlugin, setWarnsPlugin } from './group-warn.js';
import { deletePlugin, clearPlugin } from './group-delete.js';
import { pinPlugin, unpinPlugin } from './group-pin.js';
import { closePlugin, openPlugin } from './group-lock.js';
import { addBadWordPlugin, delBadWordPlugin, listBadWordsPlugin } from './group-antibad.js';
import { setWelcomePlugin, setByePlugin } from './group-welcome.js';
import { tagAllPlugin, hideTagPlugin } from './group-tagall.js';

// Admin / owner
import { restartPlugin, gitPullPlugin, logsPlugin } from './admin-restart.js';
import { modePlugin } from './admin-mode.js';
import { adminStatsPlugin } from './admin-stats.js';

// Media, stickers, descargas
import { playPlugin } from './media-play.js';
import { stickerPlugin } from './sticker-sticker.js';
import { toImagePlugin } from './sticker-toimg.js';
import { toVideoPlugin, toGifPlugin } from './sticker-tovideo.js';
import { toMp3Plugin } from './media-tomp3.js';
import { comprimirPlugin } from './media-comprimir.js';
import { mediaInfoPlugin } from './media-info.js';
import { platformDownloadPlugins } from './download-platform.js';
import { universalDownloadPlugin, audioDownloadPlugin, downloadStatusPlugin } from './download-universal.js';

// Herramientas
import { menuPlugin } from './menu.js';
import { translatePlugin } from './tools-translate.js';
import { climaPlugin } from './tools-clima.js';
import { bugPlugin, featPlugin } from './tools-github.js';
import { idPlugin } from './tools-id.js';
import { ttsPlugin } from './tools-tts.js';

// IA (Claude)
import { aiPlugin, aiToggleAdminPlugin, aiStatsPlugin, resumenPlugin } from './ai-chat.js';

// Juegos y social
import { slotPlugin, slotInfoPlugin } from './game-slot.js';
import {
  blackjackPlugin, jugarPlugin, pedirPlugin, plantarsePlugin, doblarPlugin, bjMesaPlugin, bjSalirPlugin, bjInfoPlugin,
} from './game-blackjack.js';
import {
  ruletaPlugin, apostarPlugin, ruletaMesaPlugin, ruletaSalirPlugin, ruletaInfoPlugin, girarPlugin,
} from './game-roulette.js';
import { amorPlugin, gayPlugin } from './fun-amor.js';
import { besoPlugin, misbesosPlugin, topbesosPlugin } from './fun-beso.js';
import {
  abrazoPlugin, kissallPlugin, gudmorninPlugin, pokaPlugin, chingatumadrePlugin, hazanaPlugin,
  addPokaPlugin, listPokaPlugin, delPokaPlugin, clearPokaPlugin,
  addCtmPlugin, listCtmPlugin, delCtmPlugin, clearCtmPlugin,
} from './fun-social.js';

// Betting / tipsters
import { pickPlugin, verdePlugin, rojaPlugin, pendientesPlugin, seguirPickPlugin, cancelarPlugin } from './betting-pick.js';
import { tipsterPlugin, misTipstersPlugin, tipstersDePlugin } from './betting-tipster.js';
import {
  tipstatsPlugin, rankingTipstersPlugin, historialPlugin, bettingPlugin, bettingStatsPlugin, clearPicksPlugin,
} from './betting-stats.js';
import { myBetsPlugin } from './betting-mybets.js';

export { commandAliases };

const log = createLogger('plugins');

type Entry = [name: string, plugin: PluginHandler];

/**
 * Secciones en orden de registro. El orden importa: cuando dos plugins comparten
 * un alias gana el que se registró primero (el handler lo avisa en el log y lo
 * expone en getAliasCollisions). `register` son módulos que añaden varios
 * comandos de golpe con sus propios nombres.
 */
interface Section {
  category: string;
  entries?: Entry[];
  register?: (handler: MessageHandler) => void;
}

const SECTIONS: Section[] = [
  { category: 'inventario', register: registerInventoryPlugins },
  { category: 'tienda', register: registerShopPlugins },
  {
    category: 'ia',
    entries: [
      ['ai-chat', aiPlugin],
      ['ai-toggle', aiToggleAdminPlugin],
      ['ai-stats', aiStatsPlugin],
      ['ai-resumen', resumenPlugin],
    ],
  },
  {
    category: 'rpg',
    entries: [
      ['rpg-verificar', verificarPlugin],
      ['rpg-perfil', perfilPlugin],
      ['rpg-nivel', nivelPlugin],
      ['rpg-daily', dailyPlugin],
      ['rpg-work', workPlugin],
      ['rpg-minar', minePlugin],
      ['rpg-robar', robarPlugin],
      ['rpg-atacar', atacarPlugin],
      ['rpg-duelo', dueloPlugin],
      ['rpg-aceptar', aceptarPlugin],
      ['rpg-rechazar', rechazarPlugin],
      ['rpg-atacar-duelo', atacarDueloPlugin],
      ['rpg-bloquear-duelo', bloquearDueloPlugin],
      ['rpg-poder-duelo', poderDueloPlugin],
      ['rpg-skill-detector', skillDetectorPlugin],
      ['rpg-rendirse', rendirsePlugin],
      ['rpg-bombardear', bombardearPlugin],
      ['rpg-pagardeuda', pagarDeudaPlugin],
      ['rpg-verdeuda', verDeudaPlugin],
      ['rpg-clase', clasePlugin],
      ['rpg-clases', clasesPlugin],
      ['rpg-habilidades', habilidadesPlugin],
      // El dungeon interactivo va antes que el rápido: comparten alias y gana el primero.
      ['rpg-dungeons-interactivo', dungeonsInteractivoPlugin],
      ['rpg-dungeon-interactivo', dungeonInteractivoPlugin],
      ['rpg-dungeon-atacar', atacarDungeonPlugin],
      ['rpg-dungeon-defender', defenderDungeonPlugin],
      ['rpg-dungeon-habilidad', habilidadDungeonPlugin],
      ['rpg-dungeon-item', itemDungeonPlugin],
      ['rpg-dungeon-huir', huirDungeonPlugin],
      ['rpg-dungeon-estado', estadoDungeonPlugin],
      ['rpg-dungeon', dungeonPlugin],
      ['rpg-dungeons', dungeonsPlugin],
      ['rpg-misiones', misionesPlugin],
      ['rpg-reclamarmision', reclamarMisionPlugin],
      ['rpg-forja', forjaMenuPlugin],
      ['rpg-fumar', fumarPlugin],
      ['rpg-banco', bancoPlugin],
      ['rpg-transferir', transferirPlugin],
      ['rpg-esclavizar', esclavizarPlugin],
      ['rpg-liberar', liberarPlugin],
      ['rpg-esclavos', esclavosPlugin],
      ['rpg-pasivo', pasivoPlugin],
      ['rpg-economia', estadoEconomiaPlugin],
      ['rpg-adoptar', adoptarPlugin],
      ['rpg-mascota', mascotaPlugin],
      ['rpg-alimentar', alimentarPlugin],
      ['rpg-entrenar', entrenarPlugin],
      ['rpg-gremio', gremioPlugin],
      ...ownerRpgPlugins.map((p, i): Entry => [`owner-rpg-${commandAliases(p)[0] ?? i}`, p]),
    ],
  },
  { category: 'ranking', register: registerRankingPlugins },
  {
    category: 'admin',
    entries: [
      ['admin-restart', restartPlugin],
      ['admin-gitpull', gitPullPlugin],
      ['admin-logs', logsPlugin],
      ['admin-mode', modePlugin],
      ['admin-stats', adminStatsPlugin],
    ],
  },
  {
    category: 'grupos',
    entries: [
      ...TOGGLE_ENTRIES,
      ['group-grupo', grupoPlugin],
      ['group-promote', promotePlugin],
      ['group-demote', demotePlugin],
      ['group-kick', kickPlugin],
      ['group-mute', mutePlugin],
      ['group-tempmute', tempMutePlugin],
      ['group-unmute', unmutePlugin],
      ['group-listmute', listMutePlugin],
      ['group-warn', warnPlugin],
      ['group-unwarn', unwarnPlugin],
      ['group-listwarn', listWarnPlugin],
      ['group-clearwarn', clearWarnPlugin],
      ['group-setwarns', setWarnsPlugin],
      ['group-delete', deletePlugin],
      ['group-clear', clearPlugin],
      ['group-pin', pinPlugin],
      ['group-unpin', unpinPlugin],
      ['group-close', closePlugin],
      ['group-open', openPlugin],
      ['group-addbadword', addBadWordPlugin],
      ['group-delbadword', delBadWordPlugin],
      ['group-listbadwords', listBadWordsPlugin],
      ['group-setwelcome', setWelcomePlugin],
      ['group-setbye', setByePlugin],
      ['group-tagall', tagAllPlugin],
      ['group-hidetag', hideTagPlugin],
      ['group-link', linkPlugin],
      ['group-revoke', revokePlugin],
      ['group-setname', setNamePlugin],
      ['group-setdesc', setDescPlugin],
      ['group-setpic', setPicPlugin],
      ['group-admins', adminsPlugin],
      ['group-leave', leavePlugin],
    ],
  },
  {
    category: 'media',
    entries: [
      ['media-play', playPlugin],
      ['sticker-sticker', stickerPlugin],
      ['sticker-toimg', toImagePlugin],
      ['sticker-tovideo', toVideoPlugin],
      ['sticker-togif', toGifPlugin],
      ['media-tomp3', toMp3Plugin],
      ['media-comprimir', comprimirPlugin],
      ...platformDownloadPlugins,
      ['download-universal', universalDownloadPlugin],
      ['download-audio', audioDownloadPlugin],
      ['download-info', mediaInfoPlugin],
      ['download-status', downloadStatusPlugin],
    ],
  },
  {
    category: 'herramientas',
    entries: [
      ['menu', menuPlugin],
      ['tools-translate', translatePlugin],
      ['tools-clima', climaPlugin],
      ['tools-bug', bugPlugin],
      ['tools-feat', featPlugin],
      ['tools-id', idPlugin],
      ['tools-tts', ttsPlugin],
    ],
  },
  {
    category: 'juegos',
    entries: [
      ['game-slot', slotPlugin],
      ['game-slotinfo', slotInfoPlugin],
      ['game-blackjack', blackjackPlugin],
      ['game-bj-jugar', jugarPlugin],
      ['game-bj-pedir', pedirPlugin],
      ['game-bj-plantarse', plantarsePlugin],
      ['game-bj-doblar', doblarPlugin],
      ['game-bj-mesa', bjMesaPlugin],
      ['game-bj-salir', bjSalirPlugin],
      ['game-bj-info', bjInfoPlugin],
      ['game-ruleta', ruletaPlugin],
      ['game-apostar', apostarPlugin],
      ['game-ruleta-mesa', ruletaMesaPlugin],
      ['game-ruleta-salir', ruletaSalirPlugin],
      ['game-ruleta-info', ruletaInfoPlugin],
      ['game-girar', girarPlugin],
      ['fun-amor', amorPlugin],
      ['fun-gay', gayPlugin],
      ['fun-beso', besoPlugin],
      ['fun-misbesos', misbesosPlugin],
      ['fun-topbesos', topbesosPlugin],
      ['fun-abrazo', abrazoPlugin],
      ['fun-kissall', kissallPlugin],
      ['fun-gudmornin', gudmorninPlugin],
      ['fun-poka', pokaPlugin],
      ['fun-chingatumadre', chingatumadrePlugin],
      ['fun-hazana', hazanaPlugin],
      ['fun-addpoka', addPokaPlugin],
      ['fun-listpoka', listPokaPlugin],
      ['fun-delpoka', delPokaPlugin],
      ['fun-clearpoka', clearPokaPlugin],
      ['fun-addctm', addCtmPlugin],
      ['fun-listctm', listCtmPlugin],
      ['fun-delctm', delCtmPlugin],
      ['fun-clearctm', clearCtmPlugin],
    ],
  },
  {
    category: 'betting',
    entries: [
      ['betting-pick', pickPlugin],
      ['betting-verde', verdePlugin],
      ['betting-roja', rojaPlugin],
      ['betting-pendientes', pendientesPlugin],
      ['betting-seguir', seguirPickPlugin],
      ['betting-cancelar', cancelarPlugin],
      ['betting-mybets', myBetsPlugin],
      ['betting-tipster', tipsterPlugin],
      ['betting-mistipsters', misTipstersPlugin],
      ['betting-tipstersde', tipstersDePlugin],
      ['betting-tipstats', tipstatsPlugin],
      ['betting-ranking', rankingTipstersPlugin],
      ['betting-historial', historialPlugin],
      ['betting-toggle', bettingPlugin],
      ['betting-stats', bettingStatsPlugin],
      ['betting-clearpicks', clearPicksPlugin],
    ],
  },
];

/** Registra todos los plugins en el handler y devuelve cuántos quedaron cargados. */
export function loadPlugins(handler: MessageHandler): number {
  const before = handler.getPlugins().size;
  const summary: string[] = [];

  for (const section of SECTIONS) {
    const start = handler.getPlugins().size;
    section.register?.(handler);
    for (const [name, plugin] of section.entries ?? []) {
      handler.registerPlugin(name, plugin);
    }
    summary.push(`${section.category}=${handler.getPlugins().size - start}`);
  }

  const total = handler.getPlugins().size - before;
  const collisions = handler.getAliasCollisions().length;
  log.info(`${total} plugins cargados (${summary.join(', ')})${collisions ? `, ${collisions} alias en colisión` : ''}`);
  return total;
}

export interface CommandInfo {
  /** Nombre de registro (clave del PluginRegistry). */
  name: string;
  /** Alias en minúsculas; el primero es el principal. Vacío si el RegExp no es una alternancia simple. */
  commands: string[];
  description: string;
  help: string[];
  usage: string[];
  category?: string;
  tags: string[];
  owner: boolean;
  admin: boolean;
  botAdmin: boolean;
  group: boolean;
  register: boolean;
  plugin: PluginHandler;
}

/** Descripción corta de un plugin: `description`, o la primera línea de `help` sin el "cmd - ". */
export function describePlugin(plugin: PluginHandler): string {
  if (plugin.description) return plugin.description;
  const first = plugin.help?.[0] ?? '';
  return first.replace(/^\S+(\s+\S+)*?\s+-\s+/, '').trim();
}

/** Lista los plugins registrados con sus alias y metadatos, para menús y para la IA. */
export function listCommands(handler: { getPlugins(): PluginRegistry }): CommandInfo[] {
  const out: CommandInfo[] = [];
  for (const [name, plugin] of handler.getPlugins()) {
    out.push({
      name,
      commands: commandAliases(plugin),
      description: describePlugin(plugin),
      help: plugin.help ?? [],
      usage: plugin.usage ?? [],
      category: plugin.category,
      tags: plugin.tags ?? [],
      owner: Boolean(plugin.owner),
      admin: Boolean(plugin.admin),
      botAdmin: Boolean(plugin.botAdmin),
      group: Boolean(plugin.group),
      register: Boolean(plugin.register),
      plugin,
    });
  }
  return out;
}
