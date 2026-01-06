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
import { robarPlugin } from './rpg-robar.js';

// Importar plugins RPG avanzados
import { atacarPlugin } from './rpg-atacar.js';
import { dueloPlugin, aceptarPlugin, rechazarPlugin } from './rpg-duelo.js';
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
import { notifyPlugin } from './admin-notify.js';

// Importar plugins de utilidad
import { menuPlugin } from './menu.js';

// Importar plugins de media
import { playPlugin } from './media-play.js';

/**
 * Lista de plugins RPG básicos
 */
const rpgBasicPlugins = [
  { name: 'rpg-verificar', plugin: verificarPlugin },
  { name: 'rpg-perfil', plugin: perfilPlugin },
  { name: 'rpg-nivel', plugin: nivelPlugin },
  { name: 'rpg-daily', plugin: dailyPlugin },
  { name: 'rpg-work', plugin: workPlugin },
  { name: 'rpg-robar', plugin: robarPlugin }
];

/**
 * Lista de plugins RPG de combate
 */
const rpgCombatPlugins = [
  { name: 'rpg-atacar', plugin: atacarPlugin },
  { name: 'rpg-duelo', plugin: dueloPlugin },
  { name: 'rpg-aceptar', plugin: aceptarPlugin },
  { name: 'rpg-rechazar', plugin: rechazarPlugin }
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
  console.log('      ✅ verificar, perfil, nivel, daily, work, robar');

  // Cargar plugins RPG de combate
  console.log('');
  console.log('   ⚔️ RPG Combate:');
  for (const { name, plugin } of rpgCombatPlugins) {
    handler.registerPlugin(name, plugin);
  }
  console.log('      ✅ atacar, duelo, aceptar, rechazar');

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

  handler.registerPlugin('admin-notify', notifyPlugin);
  console.log('      ✅ notify (n, notificar, avisar)');

  // Cargar plugins de media
  console.log('');
  console.log('   🎵 Media:');
  handler.registerPlugin('media-play', playPlugin);
  console.log('      ✅ play (musica, music, song, cancion)');

  // Cargar plugins de utilidad
  console.log('');
  console.log('   📋 Utilidades:');
  handler.registerPlugin('menu', menuPlugin);
  console.log('      ✅ menu (help, ayuda, comandos)');

  // Calcular total de plugins
  const totalPlugins =
    rpgBasicPlugins.length +      // 6
    rpgCombatPlugins.length +     // 4
    5 +                            // inventario (5)
    3 +                            // tienda (3)
    rpgClassPlugins.length +      // 3
    rpgDungeonPlugins.length +    // 2
    5 +                            // ranking (5)
    rpgQuestPlugins.length +      // 2
    3 +                            // group-admin (3)
    4 +                            // group-mute (4)
    2 +                            // group-delete (2)
    3 +                            // group-pin (3)
    1 +                            // notify (1)
    1 +                            // play (1)
    1;                             // menu (1)

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
