/**
 * Registro de plugins.
 *
 * Cada entrada es [nombre, plugin]. El nombre solo sirve para logs y para
 * identificar el plugin en errores; los comandos que responde los define el
 * propio plugin en `command`. Para añadir un comando nuevo: crea el archivo en
 * esta carpeta, impórtalo y agrégalo a la lista de su categoría.
 */

import type { MessageHandler } from '../handler.js';
import type { PluginHandler } from '../types/message.js';
import { createLogger } from '../lib/logger.js';

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
import { registerGroupAdminPlugins } from './group-admin.js';
import { registerGroupMutePlugins } from './group-mute.js';
import { registerGroupDeletePlugins } from './group-delete.js';
import { registerGroupPinPlugins } from './group-pin.js';
import { registerGroupLockPlugins } from './group-lock.js';
import { registerGroupCompactPlugin } from './group-compact.js';
import { antiLinkPlugin, antiSpamPlugin } from './group-protection.js';
import { warnPlugin, unwarnPlugin, listWarnPlugin, clearWarnPlugin } from './group-warn.js';
import { setWelcomePlugin, setByePlugin, welcomeTogglePlugin, byeTogglePlugin } from './group-welcome.js';
import { tagAllPlugin, hideTagPlugin } from './group-tagall.js';
import { antiDeletePlugin } from './group-antidelete.js';
import { antiBadPlugin, addBadWordPlugin, delBadWordPlugin, listBadWordsPlugin } from './group-antibad.js';
import { autoStickerPlugin } from './group-autosticker.js';
import { autoDownloadPlugin } from './group-autodownload.js';

// Admin / owner
import { notifyPlugin } from './admin-notify.js';
import { restartPlugin, gitPullPlugin, logsPlugin } from './admin-restart.js';
import { modePlugin } from './admin-mode.js';
import { adminStatsPlugin } from './admin-stats.js';

// Media, stickers, descargas
import { playPlugin } from './media-play.js';
import { stickerPlugin } from './sticker-sticker.js';
import { toImagePlugin } from './sticker-toimg.js';
import { toVideoPlugin, toGifPlugin } from './sticker-tovideo.js';
import { tiktokPlugin } from './download-tiktok.js';
import { instagramPlugin } from './download-instagram.js';
import { facebookPlugin } from './download-facebook.js';
import { twitterPlugin } from './download-twitter.js';
import { pinterestPlugin } from './download-pinterest.js';
import { threadsPlugin } from './download-threads.js';
import { universalDownloadPlugin, cobaltPlugin, audioDownloadPlugin, downloadStatusPlugin } from './download-universal.js';

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

const log = createLogger('plugins');

type Entry = [name: string, plugin: PluginHandler];

/**
 * Secciones en orden de registro. El orden importa: cuando dos plugins comparten
 * un alias (usar, ranking, stats, pin, remove, notificar...) gana el que se
 * registró primero. `register` son módulos que añaden varios comandos de golpe.
 */
interface Section {
  category: string;
  entries?: Entry[];
  register?: (handler: MessageHandler) => void;
}

const ENTRIES: Record<string, Entry[]> = {
  ia: [
    ['ai-chat', aiPlugin],
    ['ai-toggle', aiToggleAdminPlugin],
    ['ai-stats', aiStatsPlugin],
    ['ai-resumen', resumenPlugin],
  ],
  rpg: [
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
    ...ownerRpgPlugins.map((p, i): Entry => [`owner-rpg-${i}`, p]),
  ],
  admin: [
    ['admin-notify', notifyPlugin],
    ['admin-restart', restartPlugin],
    ['admin-gitpull', gitPullPlugin],
    ['admin-logs', logsPlugin],
    ['admin-mode', modePlugin],
    ['admin-stats', adminStatsPlugin],
  ],
  grupos: [
    ['group-antilink', antiLinkPlugin],
    ['group-antispam', antiSpamPlugin],
    ['group-warn', warnPlugin],
    ['group-unwarn', unwarnPlugin],
    ['group-listwarn', listWarnPlugin],
    ['group-clearwarn', clearWarnPlugin],
    ['group-antidelete', antiDeletePlugin],
    ['group-antibad', antiBadPlugin],
    ['group-addbadword', addBadWordPlugin],
    ['group-delbadword', delBadWordPlugin],
    ['group-listbadwords', listBadWordsPlugin],
    ['group-autosticker', autoStickerPlugin],
    ['group-autodownload', autoDownloadPlugin],
    ['group-setwelcome', setWelcomePlugin],
    ['group-setbye', setByePlugin],
    ['group-welcome', welcomeTogglePlugin],
    ['group-bye', byeTogglePlugin],
    ['group-tagall', tagAllPlugin],
    ['group-hidetag', hideTagPlugin],
  ],
  media: [
    ['media-play', playPlugin],
    ['sticker-sticker', stickerPlugin],
    ['sticker-toimg', toImagePlugin],
    ['sticker-tovideo', toVideoPlugin],
    ['sticker-togif', toGifPlugin],
    ['download-tiktok', tiktokPlugin],
    ['download-instagram', instagramPlugin],
    ['download-facebook', facebookPlugin],
    ['download-twitter', twitterPlugin],
    ['download-pinterest', pinterestPlugin],
    ['download-threads', threadsPlugin],
    ['download-universal', universalDownloadPlugin],
    ['download-cobalt', cobaltPlugin],
    ['download-audio', audioDownloadPlugin],
    ['download-status', downloadStatusPlugin],
  ],
  herramientas: [
    ['menu', menuPlugin],
    ['tools-translate', translatePlugin],
    ['tools-clima', climaPlugin],
    ['tools-bug', bugPlugin],
    ['tools-feat', featPlugin],
    ['tools-id', idPlugin],
    ['tools-tts', ttsPlugin],
  ],
  juegos: [
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
  betting: [
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
};

const SECTIONS: Section[] = [
  { category: 'inventario', register: registerInventoryPlugins },
  { category: 'tienda', register: registerShopPlugins },
  { category: 'ia', entries: ENTRIES.ia },
  { category: 'rpg', entries: ENTRIES.rpg },
  { category: 'ranking', register: registerRankingPlugins },
  { category: 'grupos-admin', register: registerGroupAdminPlugins },
  { category: 'grupos-mute', register: registerGroupMutePlugins },
  { category: 'grupos-delete', register: registerGroupDeletePlugins },
  { category: 'grupos-compact', register: registerGroupCompactPlugin },
  { category: 'grupos-pin', register: registerGroupPinPlugins },
  { category: 'grupos-lock', register: registerGroupLockPlugins },
  { category: 'admin', entries: ENTRIES.admin },
  { category: 'grupos', entries: ENTRIES.grupos },
  { category: 'media', entries: ENTRIES.media },
  { category: 'herramientas', entries: ENTRIES.herramientas },
  { category: 'juegos', entries: ENTRIES.juegos },
  { category: 'betting', entries: ENTRIES.betting },
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
  log.info(`${total} plugins cargados (${summary.join(', ')})`);
  return total;
}

/** Lista de comandos (primer alias) de cada plugin, útil para menús y para la IA. */
export function listCommands(handler: MessageHandler): { name: string; commands: string[]; help?: string[] }[] {
  const out: { name: string; commands: string[]; help?: string[] }[] = [];
  for (const [name, plugin] of handler.getPlugins()) {
    out.push({ name, commands: commandAliases(plugin), help: plugin.help });
  }
  return out;
}

export function commandAliases(plugin: PluginHandler): string[] {
  if (Array.isArray(plugin.command)) return plugin.command;
  // Regex del estilo /^(a|b|c)$/i -> a, b, c
  const match = plugin.command.source.match(/\(([^()]+)\)/);
  return match ? match[1].split('|').map((s) => s.replace(/\\/g, '')) : [plugin.command.source];
}
