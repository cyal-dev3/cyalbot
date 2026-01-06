/**
 * 📋 Plugin de Menú
 * Comando: menu - Muestra todos los comandos disponibles
 */

import type { PluginHandler, MessageContext } from '../types/message.js';
import { CONFIG } from '../config.js';
import { EMOJI } from '../lib/utils.js';

/**
 * Estructura de comandos organizados por categoría
 */
interface CommandInfo {
  cmd: string;
  aliases: string[];
  description: string;
  usage?: string;
}

interface MenuCategory {
  emoji: string;
  name: string;
  description: string;
  commands: CommandInfo[];
}

/**
 * Catálogo completo de comandos
 */
const MENU_CATEGORIES: MenuCategory[] = [
  {
    emoji: '🎮',
    name: 'RPG Básico',
    description: 'Comandos básicos del juego',
    commands: [
      {
        cmd: 'verificar',
        aliases: ['registrar', 'register'],
        description: 'Registrarte en el juego',
        usage: '/verificar nombre.edad'
      },
      {
        cmd: 'perfil',
        aliases: ['profile', 'p'],
        description: 'Ver tu perfil o el de alguien',
        usage: '/perfil [@usuario]'
      },
      {
        cmd: 'nivel',
        aliases: ['lvl', 'levelup', 'subir'],
        description: 'Subir de nivel',
        usage: '/nivel'
      },
      {
        cmd: 'daily',
        aliases: ['claim', 'reclamar', 'diario'],
        description: 'Recompensa diaria',
        usage: '/daily'
      },
      {
        cmd: 'work',
        aliases: ['trabajar', 'chambear', 'w'],
        description: 'Trabajar para ganar XP',
        usage: '/work'
      }
    ]
  },
  {
    emoji: '⚔️',
    name: 'Combate',
    description: 'Pelea contra monstruos y jugadores',
    commands: [
      {
        cmd: 'atacar',
        aliases: ['attack', 'cazar', 'hunt'],
        description: 'Luchar contra monstruos',
        usage: '/atacar'
      },
      {
        cmd: 'duelo',
        aliases: ['duel', 'pvp', 'retar'],
        description: 'Desafiar a otro jugador',
        usage: '/duelo @usuario [apuesta]'
      },
      {
        cmd: 'robar',
        aliases: ['rob', 'steal', 'asaltar'],
        description: 'Robar a otro jugador',
        usage: '/robar @usuario'
      }
    ]
  },
  {
    emoji: '🎭',
    name: 'Clases',
    description: 'Sistema de clases y habilidades',
    commands: [
      {
        cmd: 'clases',
        aliases: ['classes', 'verclases'],
        description: 'Ver todas las clases',
        usage: '/clases'
      },
      {
        cmd: 'clase',
        aliases: ['class', 'elegirclase'],
        description: 'Elegir o ver tu clase',
        usage: '/clase [guerrero/mago/ladron/arquero]'
      },
      {
        cmd: 'habilidades',
        aliases: ['skills', 'spells'],
        description: 'Ver tus habilidades',
        usage: '/habilidades'
      }
    ]
  },
  {
    emoji: '🎒',
    name: 'Inventario',
    description: 'Items y equipamiento',
    commands: [
      {
        cmd: 'inventario',
        aliases: ['inv', 'items', 'mochila'],
        description: 'Ver tu inventario',
        usage: '/inventario [tipo]'
      },
      {
        cmd: 'equipar',
        aliases: ['equip', 'poner'],
        description: 'Equipar un item',
        usage: '/equipar [nombre item]'
      },
      {
        cmd: 'usar',
        aliases: ['use', 'consumir', 'beber'],
        description: 'Usar consumible',
        usage: '/usar [nombre item]'
      },
      {
        cmd: 'iteminfo',
        aliases: ['veritem', 'item'],
        description: 'Info de un item',
        usage: '/iteminfo [nombre]'
      }
    ]
  },
  {
    emoji: '🏪',
    name: 'Tienda',
    description: 'Compra y vende items',
    commands: [
      {
        cmd: 'tienda',
        aliases: ['shop', 'store', 'mercado'],
        description: 'Ver items en venta',
        usage: '/tienda [categoría]'
      },
      {
        cmd: 'comprar',
        aliases: ['buy', 'purchase'],
        description: 'Comprar un item',
        usage: '/comprar [item] [cantidad]'
      },
      {
        cmd: 'vender',
        aliases: ['sell'],
        description: 'Vender items',
        usage: '/vender [item] [cantidad]'
      }
    ]
  },
  {
    emoji: '🏰',
    name: 'Dungeons',
    description: 'Explora mazmorras peligrosas',
    commands: [
      {
        cmd: 'dungeons',
        aliases: ['mazmorras'],
        description: 'Ver dungeons disponibles',
        usage: '/dungeons'
      },
      {
        cmd: 'dungeon',
        aliases: ['mazmorra', 'explorar', 'd'],
        description: 'Entrar a un dungeon',
        usage: '/dungeon [nombre]'
      }
    ]
  },
  {
    emoji: '🏆',
    name: 'Rankings',
    description: 'Clasificaciones y logros',
    commands: [
      {
        cmd: 'ranking',
        aliases: ['top', 'leaderboard'],
        description: 'Ver mejores jugadores',
        usage: '/ranking [categoría]'
      },
      {
        cmd: 'logros',
        aliases: ['achievements', 'medallas'],
        description: 'Ver tus logros',
        usage: '/logros'
      },
      {
        cmd: 'stats',
        aliases: ['estadisticas'],
        description: 'Estadísticas detalladas',
        usage: '/stats'
      },
      {
        cmd: 'titulo',
        aliases: ['title'],
        description: 'Cambiar tu título',
        usage: '/titulo [nombre]'
      }
    ]
  },
  {
    emoji: '📜',
    name: 'Misiones',
    description: 'Misiones diarias y semanales',
    commands: [
      {
        cmd: 'misiones',
        aliases: ['quests', 'tareas'],
        description: 'Ver misiones activas',
        usage: '/misiones'
      },
      {
        cmd: 'reclamarmision',
        aliases: ['claimquest'],
        description: 'Reclamar recompensas',
        usage: '/reclamarmision'
      }
    ]
  },
  {
    emoji: '👑',
    name: 'Admin',
    description: 'Comandos de administración',
    commands: [
      {
        cmd: 'promote',
        aliases: ['admin', 'haceradmin'],
        description: 'Hacer admin',
        usage: '/promote @usuario'
      },
      {
        cmd: 'demote',
        aliases: ['quitaradmin'],
        description: 'Quitar admin',
        usage: '/demote @usuario'
      },
      {
        cmd: 'kick',
        aliases: ['expulsar', 'ban'],
        description: 'Expulsar usuario',
        usage: '/kick @usuario'
      },
      {
        cmd: 'mute',
        aliases: ['silenciar'],
        description: 'Silenciar usuario',
        usage: '/mute @usuario'
      },
      {
        cmd: 'pin',
        aliases: ['fijar'],
        description: 'Fijar mensaje',
        usage: '/pin [duración]'
      },
      {
        cmd: 'notify',
        aliases: ['n', 'todos'],
        description: 'Mencionar a todos',
        usage: '/notify [mensaje]'
      }
    ]
  },
  {
    emoji: '🎵',
    name: 'Media',
    description: 'Multimedia',
    commands: [
      {
        cmd: 'play',
        aliases: ['musica', 'music', 'cancion'],
        description: 'Descargar música',
        usage: '/play [nombre]'
      }
    ]
  }
];

/**
 * Genera el menú principal
 */
function generateMainMenu(isOwner: boolean, isAdmin: boolean): string {
  const header = `
╭━━━━━━━━━━━━━━━━━━━━━╮
┃  ${EMOJI.bot} *${CONFIG.botName}* v${CONFIG.version}
┃  _Tu compañero de aventuras_
╰━━━━━━━━━━━━━━━━━━━━━╯

📋 *MENÚ DE COMANDOS*
━━━━━━━━━━━━━━━━━━━━━
`;

  let menuContent = '';

  for (const category of MENU_CATEGORIES) {
    // Filtrar categorías según permisos
    if (category.name === 'Admin' && !isAdmin && !isOwner) continue;

    menuContent += `\n${category.emoji} *${category.name}*\n`;

    for (const cmd of category.commands) {
      menuContent += `   ▸ */${cmd.cmd}* - ${cmd.description}\n`;
    }
  }

  const footer = `
━━━━━━━━━━━━━━━━━━━━━
💡 */menu [comando]* - Ver detalles
💡 */menu [categoría]* - Ver categoría

📝 *Prefijos:* / ! # .
`;

  return header + menuContent + footer;
}

/**
 * Genera información detallada de un comando
 */
function getCommandDetails(commandName: string): string | null {
  const cmdLower = commandName.toLowerCase();

  for (const category of MENU_CATEGORIES) {
    for (const cmd of category.commands) {
      if (cmd.cmd === cmdLower || cmd.aliases.includes(cmdLower)) {
        let details = `
${category.emoji} *Comando: /${cmd.cmd}*
━━━━━━━━━━━━━━━━━━━━━

📝 *Descripción:*
   ${cmd.description}

🔧 *Uso:*
   ${cmd.usage || `/${cmd.cmd}`}
`;

        if (cmd.aliases.length > 0) {
          details += `
🏷️ *Alias:*
   ${cmd.aliases.map(a => `/${a}`).join(', ')}
`;
        }

        details += `
📁 *Categoría:* ${category.name}
`;

        return details;
      }
    }
  }

  return null;
}

/**
 * Genera menú de una categoría específica
 */
function getCategoryMenu(categoryName: string): string | null {
  const catLower = categoryName.toLowerCase();

  const category = MENU_CATEGORIES.find(
    c => c.name.toLowerCase() === catLower ||
         c.name.toLowerCase().includes(catLower)
  );

  if (!category) return null;

  let menu = `
${category.emoji} *${category.name}*
━━━━━━━━━━━━━━━━━━━━━
_${category.description}_

`;

  for (const cmd of category.commands) {
    menu += `▸ */${cmd.cmd}*\n`;
    menu += `   ${cmd.description}\n`;
    menu += `   _Uso: ${cmd.usage || `/${cmd.cmd}`}_\n`;
    if (cmd.aliases.length > 0) {
      menu += `   Alias: ${cmd.aliases.map(a => `/${a}`).join(', ')}\n`;
    }
    menu += '\n';
  }

  return menu;
}

/**
 * Plugin: Menu - Ver todos los comandos
 */
export const menuPlugin: PluginHandler = {
  command: ['menu', 'help', 'ayuda', 'comandos', 'cmds', '?'],
  tags: ['utilidad'],
  help: [
    'menu - Ver todos los comandos',
    'menu [comando] - Ver detalles de un comando',
    'menu [categoría] - Ver comandos de una categoría'
  ],

  handler: async (ctx: MessageContext) => {
    const { m, text, isOwner, isAdmin } = ctx;

    // Si se proporciona un argumento, buscar comando o categoría
    if (text.trim()) {
      const query = text.trim();

      // Primero buscar como comando
      const cmdDetails = getCommandDetails(query);
      if (cmdDetails) {
        await m.reply(cmdDetails);
        return;
      }

      // Luego buscar como categoría
      const catMenu = getCategoryMenu(query);
      if (catMenu) {
        await m.reply(catMenu);
        return;
      }

      // No encontrado
      await m.reply(
        `${EMOJI.error} No encontré el comando o categoría "*${query}*".\n\n` +
        `📋 Usa */menu* para ver todos los comandos.`
      );
      return;
    }

    // Mostrar menú principal
    const menu = generateMainMenu(isOwner, isAdmin);
    await m.reply(menu);
    await m.react('📋');
  }
};

export default menuPlugin;
