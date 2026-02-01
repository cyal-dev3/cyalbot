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
      },
      {
        cmd: 'minar',
        aliases: ['mine', 'picar', 'excavar'],
        description: 'Minar para ganar dinero y XP',
        usage: '/minar'
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
        cmd: 'aceptar',
        aliases: ['accept', 'si'],
        description: '🆕 Aceptar desafío de duelo',
        usage: '/aceptar'
      },
      {
        cmd: 'rechazar',
        aliases: ['decline', 'no', 'negar'],
        description: '🆕 Rechazar desafío de duelo',
        usage: '/rechazar'
      },
      {
        cmd: 'golpe',
        aliases: ['golpear', 'hit', 'g'],
        description: '🆕 Atacar en duelo',
        usage: '/golpe'
      },
      {
        cmd: 'bloquear',
        aliases: ['block', 'defender', 'b'],
        description: '🆕 Bloquear ataque en duelo',
        usage: '/bloquear'
      },
      {
        cmd: 'poder',
        aliases: ['habilidad', 'skill', 'p'],
        description: '🆕 Usar habilidad especial en duelo',
        usage: '/poder'
      },
      {
        cmd: 'rendirse',
        aliases: ['surrender', 'abandonar', 'huir'],
        description: '🆕 Abandonar duelo',
        usage: '/rendirse'
      },
      {
        cmd: 'robar',
        aliases: ['rob', 'steal', 'asaltar'],
        description: 'Robar a otro jugador',
        usage: '/robar @usuario'
      },
      {
        cmd: 'bombardear',
        aliases: ['bomba', 'bomb', 'granada'],
        description: 'Lanzar bomba a jugador',
        usage: '/bombardear @usuario'
      },
      {
        cmd: 'deuda',
        aliases: ['debt', 'imss'],
        description: 'Ver tu deuda con el IMSS',
        usage: '/deuda'
      },
      {
        cmd: 'pagardeuda',
        aliases: ['pagarimss', 'paydebt'],
        description: 'Pagar tu deuda del IMSS',
        usage: '/pagardeuda [cantidad]'
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
        cmd: 'desequipar',
        aliases: ['unequip', 'quitar', 'remove'],
        description: '🆕 Quitar item equipado',
        usage: '/desequipar [nombre item]'
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
      },
      {
        cmd: 'comprard',
        aliases: ['buyd', 'comprardiamantes', 'buydiamonds'],
        description: '🆕 Comprar diamantes con dinero',
        usage: '/comprard [cantidad]'
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
        aliases: ['mazmorras', 'exploraciones'],
        description: 'Ver dungeons disponibles',
        usage: '/dungeons'
      },
      {
        cmd: 'dungeon',
        aliases: ['mazmorra', 'explorar'],
        description: '🆕 Entrar a dungeon INTERACTIVO',
        usage: '/dungeon [nombre]'
      },
      {
        cmd: 'a',
        aliases: ['atacar', 'attack', 'atk'],
        description: '🆕 Atacar monstruo (en dungeon)',
        usage: '/a'
      },
      {
        cmd: 'd',
        aliases: ['defender', 'defend', 'def'],
        description: '🆕 Defenderse (-50% daño, +maná)',
        usage: '/d'
      },
      {
        cmd: 'h',
        aliases: ['habilidad', 'skill', 'poder'],
        description: '🆕 Usar habilidad de clase',
        usage: '/h [número/nombre]'
      },
      {
        cmd: 'i',
        aliases: ['item', 'pocion', 'usar'],
        description: '🆕 Usar item/poción',
        usage: '/i [número/nombre]'
      },
      {
        cmd: 'huir',
        aliases: ['escapar', 'flee', 'salir'],
        description: '🆕 Escapar del dungeon',
        usage: '/huir'
      },
      {
        cmd: 'estado',
        aliases: ['status', 'st'],
        description: '🆕 Ver estado del combate',
        usage: '/estado'
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
        cmd: 'reclamarlogro',
        aliases: ['claimachievement', 'reclamar'],
        description: '🆕 Reclamar recompensa de logro',
        usage: '/reclamarlogro'
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
    emoji: '💰',
    name: 'Economía',
    description: '🆕 Sistema económico avanzado',
    commands: [
      {
        cmd: 'economia',
        aliases: ['economy', 'mieconomia', 'wallet'],
        description: '🆕 Ver estado económico completo',
        usage: '/economia'
      },
      {
        cmd: 'banco',
        aliases: ['bank', 'depositar'],
        description: '🆕 Depositar dinero al banco',
        usage: '/banco [cantidad]'
      },
      {
        cmd: 'transferir',
        aliases: ['transfer', 'enviar', 'pay'],
        description: '🆕 Transferir dinero a otro',
        usage: '/transferir @usuario [cantidad]'
      },
      {
        cmd: 'esclavizar',
        aliases: ['enslave', 'slave'],
        description: '🆕 Esclavizar a otro usuario',
        usage: '/esclavizar @usuario'
      },
      {
        cmd: 'liberar',
        aliases: ['free', 'liberarse', 'libertad'],
        description: '🆕 Liberar a un esclavo',
        usage: '/liberar @usuario'
      },
      {
        cmd: 'esclavos',
        aliases: ['slaves', 'misesclavos'],
        description: '🆕 Ver tus esclavos',
        usage: '/esclavos'
      },
      {
        cmd: 'pasivo',
        aliases: ['passive', 'pacifico', 'paz'],
        description: '🆕 Modo pasivo (sin robo)',
        usage: '/pasivo on/off'
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
        cmd: 'unmute',
        aliases: ['desilenciar', 'hablar'],
        description: '🆕 Quitar silencio a usuario',
        usage: '/unmute @usuario'
      },
      {
        cmd: 'automute',
        aliases: ['autosilencio'],
        description: '🆕 Auto-silenciar nuevos miembros',
        usage: '/automute on/off'
      },
      {
        cmd: 'listmute',
        aliases: ['mutelist', 'silenciados'],
        description: '🆕 Ver usuarios silenciados',
        usage: '/listmute'
      },
      {
        cmd: 'pin',
        aliases: ['fijar'],
        description: 'Fijar mensaje',
        usage: '/pin [duración]'
      },
      {
        cmd: 'unpin',
        aliases: ['desfijar', 'desanclar'],
        description: '🆕 Desfijar mensaje',
        usage: '/unpin (responder a mensaje)'
      },
      {
        cmd: 'notify',
        aliases: ['n', 'todos'],
        description: 'Mencionar a todos',
        usage: '/notify [mensaje]'
      },
      {
        cmd: 'hidetag',
        aliases: ['ht', 'notificar'],
        description: '🆕 Mencionar a todos sin mostrar lista',
        usage: '/hidetag [mensaje]'
      },
      {
        cmd: 'delete',
        aliases: ['del', 'eliminar', 'borrar'],
        description: 'Eliminar un mensaje',
        usage: '/delete (responder a mensaje)'
      },
      {
        cmd: 'clear',
        aliases: ['limpiar', 'clean'],
        description: '🆕 Eliminar mensajes del bot y comandos',
        usage: '/clear [cantidad]'
      },
      {
        cmd: 'autoclear',
        aliases: ['autolimpiar', 'autoclean'],
        description: '🆕 Auto-eliminar después de 2 min',
        usage: '/autoclear on/off'
      },
      {
        cmd: 'close',
        aliases: ['cerrar', 'cerrargrupo'],
        description: 'Cerrar grupo (solo admins escriben)',
        usage: '/close'
      },
      {
        cmd: 'open',
        aliases: ['abrir', 'abrirgrupo'],
        description: 'Abrir grupo (todos escriben)',
        usage: '/open'
      },
      {
        cmd: 'welcome',
        aliases: [],
        description: '🆕 Activar/desactivar bienvenidas',
        usage: '/welcome on/off'
      },
      {
        cmd: 'bye',
        aliases: [],
        description: '🆕 Activar/desactivar despedidas',
        usage: '/bye on/off'
      },
      {
        cmd: 'compacto',
        aliases: ['compact', 'silencioso', 'quiet'],
        description: '🆕 Modo compacto (menos spam)',
        usage: '/compacto on/off'
      }
    ]
  },
  {
    emoji: '🔧',
    name: 'Owner',
    description: 'Comandos exclusivos del dueño',
    commands: [
      {
        cmd: 'restart',
        aliases: ['reiniciar', 'reboot'],
        description: 'Reiniciar el bot',
        usage: '/restart'
      },
      {
        cmd: 'gitpull',
        aliases: ['pull', 'update', 'actualizar'],
        description: 'Actualizar desde GitHub',
        usage: '/gitpull'
      }
    ]
  },
  {
    emoji: '👑',
    name: 'Owner RPG',
    description: 'Control total del sistema RPG',
    commands: [
      {
        cmd: 'rpgowner',
        aliases: ['ownerrpg', 'rpgadmin', 'rpgmenu'],
        description: 'Panel de control RPG',
        usage: '/rpgowner'
      },
      {
        cmd: 'rpgdar',
        aliases: ['rpggive', 'rpgadd'],
        description: 'Dar recursos a usuario',
        usage: '/rpgdar @user [tipo] [cantidad]'
      },
      {
        cmd: 'rpgquitar',
        aliases: ['rpgremove', 'rpgtake'],
        description: 'Quitar recursos a usuario',
        usage: '/rpgquitar @user [tipo] [cantidad]'
      },
      {
        cmd: 'rpgset',
        aliases: ['rpgsetstat'],
        description: 'Establecer stats',
        usage: '/rpgset @user [stat] [valor]'
      },
      {
        cmd: 'rpgdaritem',
        aliases: ['rpggiveitem'],
        description: 'Dar items a usuario',
        usage: '/rpgdaritem @user [itemId] [cantidad]'
      },
      {
        cmd: 'rpgbonus',
        aliases: ['bonusmode', 'modobonus'],
        description: 'Activar modo bonus global',
        usage: '/rpgbonus [xp] [dinero] [mana] [tiempo]'
      },
      {
        cmd: 'rpgrobolibre',
        aliases: ['freerobo', 'modorobo'],
        description: 'Robo sin cooldown',
        usage: '/rpgrobolibre [tiempo]'
      },
      {
        cmd: 'rpgevento',
        aliases: ['rpgevent'],
        description: 'Activar evento especial',
        usage: '/rpgevento "nombre" [dropMult] [tiempo]'
      },
      {
        cmd: 'rpgpvp',
        aliases: ['modopvp'],
        description: 'Daño aumentado en duelos',
        usage: '/rpgpvp [mult] [tiempo]'
      },
      {
        cmd: 'rpgcaos',
        aliases: ['modocaos', 'chaosmode'],
        description: 'Modo caos: TODO multiplicado',
        usage: '/rpgcaos [mult] [tiempo]'
      },
      {
        cmd: 'rpgdesactivar',
        aliases: ['rpgoff'],
        description: 'Desactivar modos especiales',
        usage: '/rpgdesactivar [modo]'
      },
      {
        cmd: 'rpgresetcd',
        aliases: ['resetcooldown'],
        description: 'Resetear cooldowns',
        usage: '/rpgresetcd @user [tipo]'
      },
      {
        cmd: 'rpgresetcdall',
        aliases: ['resetcdall'],
        description: '🆕 Resetear cooldowns de todos',
        usage: '/rpgresetcdall [tipo]'
      },
      {
        cmd: 'rpgsetclase',
        aliases: ['rpgsetclass'],
        description: 'Establecer clase de usuario',
        usage: '/rpgsetclase @user [clase]'
      },
      {
        cmd: 'rpgfullstats',
        aliases: ['rpgmaxstats', 'rpggod'],
        description: 'Dar stats máximos (MODO DIOS)',
        usage: '/rpgfullstats @user'
      },
      {
        cmd: 'rpgmaxlevel',
        aliases: ['rpgsetlevel'],
        description: 'Establecer nivel',
        usage: '/rpgmaxlevel @user [nivel]'
      },
      {
        cmd: 'rpginfo',
        aliases: ['rpgcheck'],
        description: 'Ver info completa de usuario',
        usage: '/rpginfo @user'
      },
      {
        cmd: 'rpgdaratodos',
        aliases: ['rpggiveall'],
        description: 'Dar recursos a TODOS',
        usage: '/rpgdaratodos [tipo] [cantidad]'
      },
      {
        cmd: 'rpglluviamoney',
        aliases: ['rpgrainmoney'],
        description: 'Lluvia de dinero en grupo',
        usage: '/rpglluviamoney [cantidad]'
      },
      {
        cmd: 'rpgborrar',
        aliases: ['rpgdelete', 'rpgreset'],
        description: 'Eliminar progreso de usuario',
        usage: '/rpgborrar @user confirmar'
      },
      {
        cmd: 'rpgtop',
        aliases: ['rpgranking'],
        description: 'Ver rankings RPG',
        usage: '/rpgtop [tipo]'
      },
      {
        cmd: 'rpglistitems',
        aliases: ['rpgitems'],
        description: 'Lista todos los items',
        usage: '/rpglistitems [categoria]'
      },
      {
        cmd: 'rpgautoevents',
        aliases: ['autoevents', 'autoeventos'],
        description: 'Activar/desactivar eventos aleatorios',
        usage: '/rpgautoevents [on/off]'
      },
      {
        cmd: 'rpgaddgrupo',
        aliases: ['rpgaddgroup', 'eventaddgroup'],
        description: 'Agregar grupo a anuncios de eventos',
        usage: '/rpgaddgrupo'
      },
      {
        cmd: 'rpgremovegrupo',
        aliases: ['rpgremovegroup', 'eventremovegroup'],
        description: 'Remover grupo de anuncios',
        usage: '/rpgremovegrupo'
      },
      {
        cmd: 'rpgeventinterval',
        aliases: ['eventinterval', 'intervaloeventos'],
        description: 'Configurar intervalo entre eventos',
        usage: '/rpgeventinterval [min] [max]'
      },
      {
        cmd: 'rpgforceevent',
        aliases: ['forceevent', 'forzarevento'],
        description: 'Forzar evento aleatorio ahora',
        usage: '/rpgforceevent'
      },
      {
        cmd: 'rpgeventstatus',
        aliases: ['eventstatus', 'estadoeventos'],
        description: 'Ver estado de eventos automáticos',
        usage: '/rpgeventstatus'
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
        usage: '/play [nombre/URL]'
      }
    ]
  },
  {
    emoji: '🎨',
    name: 'Stickers',
    description: 'Crear y convertir stickers',
    commands: [
      {
        cmd: 's',
        aliases: ['sticker', 'stiker', 'stick'],
        description: 'Crear sticker de imagen/video',
        usage: '/s (responde a imagen/video)'
      },
      {
        cmd: 'toimg',
        aliases: ['toimage', 'img', 'imagen'],
        description: 'Sticker a imagen PNG',
        usage: '/toimg (responde a sticker)'
      },
      {
        cmd: 'tovideo',
        aliases: ['tovid', 'video'],
        description: 'Sticker animado a video',
        usage: '/tovideo (responde a sticker)'
      },
      {
        cmd: 'togif',
        aliases: ['gif'],
        description: 'Sticker animado a GIF',
        usage: '/togif (responde a sticker)'
      }
    ]
  },
  {
    emoji: '🛡️',
    name: 'Protección',
    description: 'Protección de grupos',
    commands: [
      {
        cmd: 'antilink',
        aliases: [],
        description: 'Activar/desactivar anti-enlaces',
        usage: '/antilink on/off'
      },
      {
        cmd: 'antispam',
        aliases: [],
        description: 'Activar/desactivar anti-spam',
        usage: '/antispam on/off'
      },
      {
        cmd: 'warn',
        aliases: ['advertir'],
        description: 'Advertir a un usuario',
        usage: '/warn @usuario [razón]'
      },
      {
        cmd: 'unwarn',
        aliases: ['quitarwarn'],
        description: 'Quitar advertencia',
        usage: '/unwarn @usuario'
      },
      {
        cmd: 'listwarn',
        aliases: ['warns', 'advertencias'],
        description: 'Ver usuarios con advertencias',
        usage: '/listwarn'
      },
      {
        cmd: 'clearwarn',
        aliases: ['limpiarwarn'],
        description: '🆕 Limpiar todas las advertencias',
        usage: '/clearwarn @usuario'
      },
      {
        cmd: 'setwelcome',
        aliases: ['bienvenida'],
        description: 'Configurar mensaje de bienvenida',
        usage: '/setwelcome <mensaje>'
      },
      {
        cmd: 'setbye',
        aliases: ['despedida'],
        description: 'Configurar mensaje de despedida',
        usage: '/setbye <mensaje>'
      },
      {
        cmd: 'tagall',
        aliases: ['todos', 'invocar'],
        description: 'Mencionar a todos',
        usage: '/tagall [mensaje]'
      }
    ]
  },
  {
    emoji: '📥',
    name: 'Descargas',
    description: 'Descargar contenido de redes sociales',
    commands: [
      {
        cmd: 'tiktok',
        aliases: ['tt', 'ttdl'],
        description: 'Descargar video de TikTok',
        usage: '/tiktok <url>'
      },
      {
        cmd: 'ig',
        aliases: ['instagram', 'igdl'],
        description: 'Descargar de Instagram',
        usage: '/ig <url>'
      },
      {
        cmd: 'fb',
        aliases: ['facebook', 'fbdl'],
        description: 'Descargar video de Facebook',
        usage: '/fb <url>'
      },
      {
        cmd: 'twitter',
        aliases: ['tw', 'x', 'twdl'],
        description: 'Descargar video de Twitter/X',
        usage: '/twitter <url>'
      },
      {
        cmd: 'pinterest',
        aliases: ['pin'],
        description: 'Buscar imágenes en Pinterest',
        usage: '/pinterest <búsqueda>'
      }
    ]
  },
  {
    emoji: '🔧',
    name: 'Herramientas',
    description: 'Herramientas útiles',
    commands: [
      {
        cmd: 'translate',
        aliases: ['traducir', 'tr'],
        description: 'Traducir texto',
        usage: '/translate <idioma> <texto>'
      },
      {
        cmd: 'clima',
        aliases: ['weather', 'tiempo'],
        description: 'Ver clima de una ciudad',
        usage: '/clima <ciudad>'
      },
      {
        cmd: 'id',
        aliases: ['chatid', 'groupid'],
        description: '🆕 Ver ID del chat/grupo',
        usage: '/id'
      },
      {
        cmd: 'bug',
        aliases: ['reportar', 'reporte'],
        description: '🆕 Reportar un bug',
        usage: '/bug <descripción>'
      },
      {
        cmd: 'feat',
        aliases: ['feature', 'sugerencia', 'idea'],
        description: '🆕 Sugerir una función',
        usage: '/feat <descripción>'
      }
    ]
  },
  {
    emoji: '🎮',
    name: 'Diversión',
    description: 'Juegos y entretenimiento',
    commands: [
      {
        cmd: 'slot',
        aliases: ['tragamonedas', 'casino'],
        description: 'Jugar tragamonedas',
        usage: '/slot [apuesta]'
      },
      {
        cmd: 'slotinfo',
        aliases: ['slotayuda'],
        description: '🆕 Info sobre la tragamonedas',
        usage: '/slotinfo'
      },
      {
        cmd: 'amor',
        aliases: ['love', 'ship', 'compatibilidad'],
        description: 'Calculadora de amor',
        usage: '/amor @usuario'
      },
      {
        cmd: 'gay',
        aliases: ['gaytest'],
        description: 'Test de gayedad (broma)',
        usage: '/gay [@usuario]'
      },
      {
        cmd: 'beso',
        aliases: ['kiss', 'besito', 'muah'],
        description: 'Dale un beso a alguien',
        usage: '/beso @usuario'
      },
      {
        cmd: 'misbesos',
        aliases: ['mykisses', 'besostats'],
        description: 'Ver tus estadísticas de besos',
        usage: '/misbesos'
      },
      {
        cmd: 'topbesos',
        aliases: ['topkiss', 'besucones', 'rankingbesos'],
        description: 'Ranking de besucones del grupo',
        usage: '/topbesos'
      },
      {
        cmd: 'abrazo',
        aliases: ['hug', 'abrazar', 'apapacho'],
        description: '🆕 Dale un abrazo a alguien',
        usage: '/abrazo @usuario'
      },
      {
        cmd: 'kissall',
        aliases: ['besartodos', 'besoatodos'],
        description: '🆕 Besar a todos del grupo',
        usage: '/kissall'
      },
      {
        cmd: 'gudmornin',
        aliases: ['buenosdias', 'gm', 'goodmorning'],
        description: '🆕 Buenos días a alguien',
        usage: '/gudmornin @usuario'
      },
      {
        cmd: 'poka',
        aliases: ['limosna', 'pobre'],
        description: '🆕 Pedir limosna con estilo',
        usage: '/poka'
      },
      {
        cmd: 'chingatumadre',
        aliases: ['ctm', 'fuck', 'insultar'],
        description: '🆕 Insultar en 5 idiomas',
        usage: '/chingatumadre @usuario'
      },
      {
        cmd: 'hazana',
        aliases: ['hazaña', 'carlitos', 'feria'],
        description: '🆕 Sticker de Carlitos',
        usage: '/hazana'
      }
    ]
  },
  {
    emoji: '🃏',
    name: 'Casino',
    description: 'Juegos de casino multiplayer',
    commands: [
      {
        cmd: 'blackjack',
        aliases: ['bj', 'mesa'],
        description: 'Abrir mesa de Blackjack',
        usage: '/blackjack [apuesta_min]'
      },
      {
        cmd: 'jugar',
        aliases: ['unirse', 'entrar'],
        description: 'Unirse a mesa de Blackjack',
        usage: '/jugar [apuesta]'
      },
      {
        cmd: 'pedir',
        aliases: ['hit', 'carta'],
        description: 'Pedir carta en Blackjack',
        usage: '/pedir'
      },
      {
        cmd: 'plantarse',
        aliases: ['stand', 'quedar'],
        description: 'Plantarse en Blackjack',
        usage: '/plantarse'
      },
      {
        cmd: 'doblar',
        aliases: ['double', 'dd'],
        description: 'Doblar apuesta en Blackjack',
        usage: '/doblar'
      },
      {
        cmd: 'bjmesa',
        aliases: ['vermesa', 'bjstatus'],
        description: 'Ver estado de la mesa',
        usage: '/bjmesa'
      },
      {
        cmd: 'bjsalir',
        aliases: ['salirmesa', 'bjleave'],
        description: 'Salir de la mesa (en espera)',
        usage: '/bjsalir'
      },
      {
        cmd: 'bjinfo',
        aliases: ['blackjackinfo', 'bjayuda'],
        description: 'Info sobre Blackjack',
        usage: '/bjinfo'
      },
      {
        cmd: 'ruleta',
        aliases: ['roulette', 'ruletamesa'],
        description: 'Abrir mesa de Ruleta',
        usage: '/ruleta [apuesta_min]'
      },
      {
        cmd: 'apostar',
        aliases: ['bet', 'ap'],
        description: 'Apostar en la ruleta',
        usage: '/apostar <tipo> <cantidad>'
      },
      {
        cmd: 'girar',
        aliases: ['spin', 'tirar'],
        description: 'Girar ruleta (creador)',
        usage: '/girar'
      },
      {
        cmd: 'mesaruleta',
        aliases: ['vermesa', 'ruletastatus'],
        description: 'Ver estado de la ruleta',
        usage: '/mesaruleta'
      },
      {
        cmd: 'ruletasalir',
        aliases: ['rsalir', 'cancelarapuesta'],
        description: 'Cancelar tus apuestas',
        usage: '/ruletasalir'
      },
      {
        cmd: 'ruletainfo',
        aliases: ['rouletteinfo', 'ruletaayuda'],
        description: 'Info sobre la Ruleta',
        usage: '/ruletainfo'
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
    if (category.name === 'Owner' && !isOwner) continue;
    if (category.name === 'Owner RPG' && !isOwner) continue;

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
