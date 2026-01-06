/**
 * 🔌 Cargador de Plugins - CYALTRONIC
 * Registra todos los plugins disponibles en el handler
 */

import type { MessageHandler } from '../handler.js';

// Importar plugins RPG
import { verificarPlugin } from './rpg-verificar.js';
import { perfilPlugin } from './rpg-perfil.js';
import { nivelPlugin } from './rpg-nivel.js';
import { dailyPlugin } from './rpg-daily.js';
import { workPlugin } from './rpg-work.js';

// Importar plugins de administración de grupos
import { registerGroupAdminPlugins } from './group-admin.js';
import { registerGroupMutePlugins } from './group-mute.js';
import { registerGroupDeletePlugins } from './group-delete.js';
import { notifyPlugin } from './admin-notify.js';

// Importar plugins de media
import { playPlugin } from './media-play.js';

/**
 * Lista de plugins RPG básicos
 */
const rpgPlugins = [
  { name: 'rpg-verificar', plugin: verificarPlugin },
  { name: 'rpg-perfil', plugin: perfilPlugin },
  { name: 'rpg-nivel', plugin: nivelPlugin },
  { name: 'rpg-daily', plugin: dailyPlugin },
  { name: 'rpg-work', plugin: workPlugin }
];

/**
 * Carga todos los plugins en el handler
 * @param handler - Instancia del MessageHandler
 */
export function loadPlugins(handler: MessageHandler): void {
  console.log('');
  console.log('🔌 Cargando plugins...');
  console.log('');

  // Cargar plugins RPG
  console.log('   📜 RPG:');
  for (const { name, plugin } of rpgPlugins) {
    handler.registerPlugin(name, plugin);
    console.log(`      ✅ ${name}`);
  }

  // Cargar plugins de administración de grupos
  console.log('');
  console.log('   👑 Administración de Grupos:');
  registerGroupAdminPlugins(handler);
  console.log('      ✅ promote, demote, kick');

  registerGroupMutePlugins(handler);
  console.log('      ✅ mute, unmute, automute, listmute');

  registerGroupDeletePlugins(handler);
  console.log('      ✅ delete, clear');

  handler.registerPlugin('admin-notify', notifyPlugin);
  console.log('      ✅ notify (n, notificar, avisar)');

  // Cargar plugins de media
  console.log('');
  console.log('   🎵 Media:');
  handler.registerPlugin('media-play', playPlugin);
  console.log('      ✅ play (musica, music, song, cancion)');

  const totalPlugins = rpgPlugins.length + 11; // 5 RPG + 3 admin + 4 mute + 2 delete + 1 notify + 1 play
  console.log('');
  console.log(`📦 Total: ${totalPlugins} comandos cargados`);
  console.log('');
}

/**
 * Obtiene información de los plugins cargados
 */
export function getPluginsInfo(): { name: string; commands: string[] }[] {
  return rpgPlugins.map(({ name, plugin }) => {
    let commands: string[] = [];

    if (plugin.command instanceof RegExp) {
      // Extraer comandos del RegExp
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
