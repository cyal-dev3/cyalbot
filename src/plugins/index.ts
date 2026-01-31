/**
 * 🔌 Cargador de Plugins - CYALTRONIC
 * Registra todos los plugins disponibles en el handler
 */

import type { MessageHandler } from '../handler.js';

// Importar plugins RPG básicos
import { verificarPlugin } from './rpg-verificar.js';
import { perfilPlugin } from './rpg-perfil.js';
import { nivelPlugin } from './rpg-nivel.js';
import { dailyPlugin } from './rpg-daily.js';
import { workPlugin } from './rpg-work.js';
import { minePlugin } from './rpg-minar.js';
import { robarPlugin } from './rpg-robar.js';

// Importar plugins RPG avanzados
import { atacarPlugin } from './rpg-atacar.js';
import { dueloPlugin, aceptarPlugin, rechazarPlugin, atacarDueloPlugin, bloquearDueloPlugin, poderDueloPlugin, skillDetectorPlugin, rendirsePlugin } from './rpg-duelo.js';
import { bombardearPlugin, pagarDeudaPlugin, verDeudaPlugin } from './rpg-bombardear.js';
import { registerInventoryPlugins } from './rpg-inventario.js';
import { registerShopPlugins } from './rpg-tienda.js';
import { clasePlugin, clasesPlugin, habilidadesPlugin } from './rpg-clase.js';
import { dungeonPlugin, dungeonsPlugin } from './rpg-dungeon.js';
import { registerRankingPlugins } from './rpg-ranking.js';
import { misionesPlugin, reclamarMisionPlugin } from './rpg-misiones.js';

// Importar plugins de administración de grupos
import { registerGroupAdminPlugins } from './group-admin.js';
import { registerGroupMutePlugins } from './group-mute.js';
import { registerGroupDeletePlugins } from './group-delete.js';
import { registerGroupPinPlugins } from './group-pin.js';
import { registerGroupLockPlugins } from './group-lock.js';
import { notifyPlugin } from './admin-notify.js';
import { restartPlugin, gitPullPlugin } from './admin-restart.js';

// Importar plugins de utilidad
import { menuPlugin } from './menu.js';

// Importar plugins de media
import { playPlugin } from './media-play.js';

// Importar plugins de stickers
import { stickerPlugin } from './sticker-sticker.js';
import { toImagePlugin } from './sticker-toimg.js';
import { toVideoPlugin, toGifPlugin } from './sticker-tovideo.js';

// Importar plugins de protección de grupos
import { antiLinkPlugin, antiSpamPlugin } from './group-protection.js';
import { warnPlugin, unwarnPlugin, listWarnPlugin, clearWarnPlugin } from './group-warn.js';
import { setWelcomePlugin, setByePlugin, welcomeTogglePlugin, byeTogglePlugin } from './group-welcome.js';
import { tagAllPlugin, hideTagPlugin } from './group-tagall.js';

// Importar plugins de descarga
import { tiktokPlugin } from './download-tiktok.js';
import { instagramPlugin } from './download-instagram.js';
import { facebookPlugin } from './download-facebook.js';
import { twitterPlugin } from './download-twitter.js';
import { pinterestPlugin } from './download-pinterest.js';

// Importar plugins de herramientas
import { translatePlugin } from './tools-translate.js';
import { climaPlugin } from './tools-clima.js';
import { bugPlugin, featPlugin } from './tools-github.js';
import { idPlugin } from './tools-id.js';

// Importar plugins de diversión
import { slotPlugin, slotInfoPlugin } from './game-slot.js';
import { blackjackPlugin, jugarPlugin, pedirPlugin, plantarsePlugin, doblarPlugin, bjMesaPlugin, bjSalirPlugin, bjInfoPlugin } from './game-blackjack.js';
import { ruletaPlugin, apostarPlugin, ruletaMesaPlugin, ruletaSalirPlugin, ruletaInfoPlugin, girarPlugin } from './game-roulette.js';
import { amorPlugin, gayPlugin } from './fun-amor.js';
import { besoPlugin, misbesosPlugin, topbesosPlugin } from './fun-beso.js';

// Importar plugins de owner
import ownerRpgPlugins from './owner-rpg.js';

/**
 * Lista de plugins RPG básicos
 */
const rpgBasicPlugins = [
  { name: 'rpg-verificar', plugin: verificarPlugin },
  { name: 'rpg-perfil', plugin: perfilPlugin },
  { name: 'rpg-nivel', plugin: nivelPlugin },
  { name: 'rpg-daily', plugin: dailyPlugin },
  { name: 'rpg-work', plugin: workPlugin },
  { name: 'rpg-minar', plugin: minePlugin },
  { name: 'rpg-robar', plugin: robarPlugin }
];

/**
 * Lista de plugins RPG de combate
 */
const rpgCombatPlugins = [
  { name: 'rpg-atacar', plugin: atacarPlugin },
  { name: 'rpg-duelo', plugin: dueloPlugin },
  { name: 'rpg-aceptar', plugin: aceptarPlugin },
  { name: 'rpg-rechazar', plugin: rechazarPlugin },
  { name: 'rpg-atacar-duelo', plugin: atacarDueloPlugin },
  { name: 'rpg-bloquear-duelo', plugin: bloquearDueloPlugin },
  { name: 'rpg-poder-duelo', plugin: poderDueloPlugin },
  { name: 'rpg-skill-detector', plugin: skillDetectorPlugin },
  { name: 'rpg-rendirse', plugin: rendirsePlugin },
  { name: 'rpg-bombardear', plugin: bombardearPlugin },
  { name: 'rpg-pagardeuda', plugin: pagarDeudaPlugin },
  { name: 'rpg-verdeuda', plugin: verDeudaPlugin }
];

/**
 * Lista de plugins RPG de clase
 */
const rpgClassPlugins = [
  { name: 'rpg-clase', plugin: clasePlugin },
  { name: 'rpg-clases', plugin: clasesPlugin },
  { name: 'rpg-habilidades', plugin: habilidadesPlugin }
];

/**
 * Lista de plugins RPG de dungeon
 */
const rpgDungeonPlugins = [
  { name: 'rpg-dungeon', plugin: dungeonPlugin },
  { name: 'rpg-dungeons', plugin: dungeonsPlugin }
];

/**
 * Lista de plugins RPG de misiones
 */
const rpgQuestPlugins = [
  { name: 'rpg-misiones', plugin: misionesPlugin },
  { name: 'rpg-reclamarmision', plugin: reclamarMisionPlugin }
];

/**
 * Carga todos los plugins en el handler
 * @param handler - Instancia del MessageHandler
 */
export function loadPlugins(handler: MessageHandler): void {
  console.log('');
  console.log('🔌 Cargando plugins...');
  console.log('');

  // Cargar plugins RPG básicos
  console.log('   📜 RPG Básico:');
  for (const { name, plugin } of rpgBasicPlugins) {
    handler.registerPlugin(name, plugin);
  }
  console.log('      ✅ verificar, perfil, nivel, daily, work, minar, robar');

  // Cargar plugins RPG de combate
  console.log('');
  console.log('   ⚔️ RPG Combate:');
  for (const { name, plugin } of rpgCombatPlugins) {
    handler.registerPlugin(name, plugin);
  }
  console.log('      ✅ atacar, duelo, aceptar, rechazar, habilidad, rendirse');
  console.log('      ✅ bombardear, pagardeuda, deuda');

  // Cargar plugins de inventario y tienda
  console.log('');
  console.log('   🎒 RPG Inventario:');
  registerInventoryPlugins(handler);
  console.log('      ✅ inventario, equipar, desequipar, usar, iteminfo');

  registerShopPlugins(handler);
  console.log('      ✅ tienda, comprar, vender');

  // Cargar plugins de clase
  console.log('');
  console.log('   🎭 RPG Clases:');
  for (const { name, plugin } of rpgClassPlugins) {
    handler.registerPlugin(name, plugin);
  }
  console.log('      ✅ clase, clases, habilidades');

  // Cargar plugins de dungeon
  console.log('');
  console.log('   🏰 RPG Dungeons:');
  for (const { name, plugin } of rpgDungeonPlugins) {
    handler.registerPlugin(name, plugin);
  }
  console.log('      ✅ dungeon, dungeons');

  // Cargar plugins de ranking y logros
  console.log('');
  console.log('   🏆 RPG Rankings:');
  registerRankingPlugins(handler);
  console.log('      ✅ ranking, logros, reclamarlogro, titulo, stats');

  // Cargar plugins de misiones
  console.log('');
  console.log('   📜 RPG Misiones:');
  for (const { name, plugin } of rpgQuestPlugins) {
    handler.registerPlugin(name, plugin);
  }
  console.log('      ✅ misiones, reclamarmision');

  // Cargar plugins de administración de grupos
  console.log('');
  console.log('   👑 Administración de Grupos:');
  registerGroupAdminPlugins(handler);
  console.log('      ✅ promote, demote, kick');

  registerGroupMutePlugins(handler);
  console.log('      ✅ mute, unmute, automute, listmute');

  registerGroupDeletePlugins(handler);
  console.log('      ✅ delete, clear');

  registerGroupPinPlugins(handler);
  console.log('      ✅ pin, unpin, pinned');

  registerGroupLockPlugins(handler);
  console.log('      ✅ close, open (cerrar, abrir)');

  handler.registerPlugin('admin-notify', notifyPlugin);
  console.log('      ✅ notify (n, notificar, avisar)');

  handler.registerPlugin('admin-restart', restartPlugin);
  handler.registerPlugin('admin-gitpull', gitPullPlugin);
  console.log('      ✅ restart, gitpull (reiniciar, update, actualizar)');

  // Cargar plugins de media
  console.log('');
  console.log('   🎵 Media:');
  handler.registerPlugin('media-play', playPlugin);
  console.log('      ✅ play (musica, music, song, cancion)');

  // Cargar plugins de stickers
  console.log('');
  console.log('   🎨 Stickers:');
  handler.registerPlugin('sticker-sticker', stickerPlugin);
  handler.registerPlugin('sticker-toimg', toImagePlugin);
  handler.registerPlugin('sticker-tovideo', toVideoPlugin);
  handler.registerPlugin('sticker-togif', toGifPlugin);
  console.log('      ✅ s, sticker, toimg, tovideo, togif');

  // Cargar plugins de utilidad
  console.log('');
  console.log('   📋 Utilidades:');
  handler.registerPlugin('menu', menuPlugin);
  console.log('      ✅ menu (help, ayuda, comandos)');

  // Cargar plugins de protección de grupos
  console.log('');
  console.log('   🛡️ Protección de Grupos:');
  handler.registerPlugin('group-antilink', antiLinkPlugin);
  handler.registerPlugin('group-antispam', antiSpamPlugin);
  handler.registerPlugin('group-warn', warnPlugin);
  handler.registerPlugin('group-unwarn', unwarnPlugin);
  handler.registerPlugin('group-listwarn', listWarnPlugin);
  handler.registerPlugin('group-clearwarn', clearWarnPlugin);
  console.log('      ✅ antilink, antispam, warn, unwarn, listwarn, clearwarn');

  // Cargar plugins de bienvenida
  console.log('');
  console.log('   👋 Bienvenida/Despedida:');
  handler.registerPlugin('group-setwelcome', setWelcomePlugin);
  handler.registerPlugin('group-setbye', setByePlugin);
  handler.registerPlugin('group-welcome', welcomeTogglePlugin);
  handler.registerPlugin('group-bye', byeTogglePlugin);
  handler.registerPlugin('group-tagall', tagAllPlugin);
  handler.registerPlugin('group-hidetag', hideTagPlugin);
  console.log('      ✅ setwelcome, setbye, welcome, bye, tagall, hidetag');

  // Cargar plugins de descarga
  console.log('');
  console.log('   📥 Descargadores:');
  handler.registerPlugin('download-tiktok', tiktokPlugin);
  handler.registerPlugin('download-instagram', instagramPlugin);
  handler.registerPlugin('download-facebook', facebookPlugin);
  handler.registerPlugin('download-twitter', twitterPlugin);
  handler.registerPlugin('download-pinterest', pinterestPlugin);
  console.log('      ✅ tiktok, ig, fb, twitter, pinterest');

  // Cargar plugins de herramientas
  console.log('');
  console.log('   🔧 Herramientas:');
  handler.registerPlugin('tools-translate', translatePlugin);
  handler.registerPlugin('tools-clima', climaPlugin);
  handler.registerPlugin('tools-bug', bugPlugin);
  handler.registerPlugin('tools-feat', featPlugin);
  handler.registerPlugin('tools-id', idPlugin);
  console.log('      ✅ translate, clima, bug, feat, id');

  // Cargar plugins de diversión
  console.log('');
  console.log('   🎮 Diversión:');
  handler.registerPlugin('game-slot', slotPlugin);
  handler.registerPlugin('game-slotinfo', slotInfoPlugin);
  handler.registerPlugin('game-blackjack', blackjackPlugin);
  handler.registerPlugin('game-bj-jugar', jugarPlugin);
  handler.registerPlugin('game-bj-pedir', pedirPlugin);
  handler.registerPlugin('game-bj-plantarse', plantarsePlugin);
  handler.registerPlugin('game-bj-doblar', doblarPlugin);
  handler.registerPlugin('game-bj-mesa', bjMesaPlugin);
  handler.registerPlugin('game-bj-salir', bjSalirPlugin);
  handler.registerPlugin('game-bj-info', bjInfoPlugin);
  handler.registerPlugin('fun-amor', amorPlugin);
  handler.registerPlugin('fun-gay', gayPlugin);
  handler.registerPlugin('fun-beso', besoPlugin);
  handler.registerPlugin('fun-misbesos', misbesosPlugin);
  handler.registerPlugin('fun-topbesos', topbesosPlugin);
  handler.registerPlugin('game-ruleta', ruletaPlugin);
  handler.registerPlugin('game-apostar', apostarPlugin);
  handler.registerPlugin('game-ruleta-mesa', ruletaMesaPlugin);
  handler.registerPlugin('game-ruleta-salir', ruletaSalirPlugin);
  handler.registerPlugin('game-ruleta-info', ruletaInfoPlugin);
  handler.registerPlugin('game-girar', girarPlugin);
  console.log('      ✅ slot, slotinfo, amor, gay, beso, misbesos, topbesos');
  console.log('      ✅ blackjack, jugar, pedir, plantarse, doblar, bjmesa, bjsalir, bjinfo');
  console.log('      ✅ ruleta, apostar, vermesa, ruletasalir, ruletainfo, girar');

  // Cargar plugins de owner RPG
  console.log('');
  console.log('   👑 Owner RPG:');
  for (let i = 0; i < ownerRpgPlugins.length; i++) {
    handler.registerPlugin(`owner-rpg-${i}`, ownerRpgPlugins[i]);
  }
  console.log('      ✅ rpgowner, rpgdar, rpgquitar, rpgset, rpgdaritem');
  console.log('      ✅ rpgbonus, rpgrobolibre, rpgevento, rpgpvp, rpgcaos');
  console.log('      ✅ rpgresetcd, rpgsetclase, rpgfullstats, rpgmaxlevel');
  console.log('      ✅ rpginfo, rpgdaratodos, rpglluviamoney, rpgborrar, rpgtop');

  // Calcular total de plugins
  const totalPlugins =
    rpgBasicPlugins.length +       // 7 - RPG básico
    rpgCombatPlugins.length +      // 11 - RPG combate (incluye bombardear, deuda)
    5 +                            // inventario
    3 +                            // tienda
    rpgClassPlugins.length +       // 3 - clases
    rpgDungeonPlugins.length +     // 2 - dungeons
    5 +                            // ranking
    rpgQuestPlugins.length +       // 2 - misiones
    3 +                            // group admin
    4 +                            // group mute
    2 +                            // group delete
    3 +                            // group pin
    2 +                            // close, open
    1 +                            // notify
    2 +                            // restart, gitpull
    1 +                            // play
    4 +                            // stickers
    1 +                            // menu
    6 +                            // protección (antilink, antispam, warn, unwarn, listwarn, clearwarn)
    6 +                            // bienvenida (setwelcome, setbye, welcome, bye, tagall, hidetag)
    5 +                            // descargadores
    4 +                            // herramientas (translate, clima, bug, feat)
    21 +                           // diversión (slot, slotinfo, blackjack x8, amor, gay, beso x3, ruleta x6)
    ownerRpgPlugins.length;        // owner RPG (22 comandos)

  console.log('');
  console.log(`📦 Total: ${totalPlugins} comandos cargados`);
  console.log('');
}

/**
 * Obtiene información de los plugins cargados
 */
export function getPluginsInfo(): { name: string; commands: string[] }[] {
  return rpgBasicPlugins.map(({ name, plugin }) => {
    let commands: string[] = [];

    if (plugin.command instanceof RegExp) {
      const match = plugin.command.source.match(/\(([^)]+)\)/);
      if (match) {
        commands = match[1].split('|');
      }
    } else if (Array.isArray(plugin.command)) {
      commands = plugin.command;
    }

    return { name, commands };
  });
}