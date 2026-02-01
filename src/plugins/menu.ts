/**
 * 📋 Plugin de Menú - CYALTRONIC
 * Menú simplificado por categorías con mejoras
 */

import type { PluginHandler, MessageContext } from '../types/message.js';
import { CONFIG } from '../config.js';
import { EMOJI, pickRandom } from '../lib/utils.js';
import { getDatabase } from '../lib/database.js';

/**
 * Categorías del menú
 */
interface MenuCategory {
  id: string;
  emoji: string;
  name: string;
  commands: string[];
  adminOnly?: boolean;
  ownerOnly?: boolean;
}

/**
 * Comando con descripción
 */
interface CommandDetail {
  cmd: string;
  aliases: string[];
  desc: string;
  usage: string;
}

/**
 * Tips aleatorios para el menú
 */
const MENU_TIPS = [
  '💡 Usa /perfil para ver tu progreso',
  '💡 /daily te da recompensas gratis cada día',
  '💡 Mina materiales con /minar para /forja',
  '💡 Elige una clase con /clase para habilidades',
  '💡 Los dungeons dan mejor loot: /dungeon',
  '💡 Deposita en /banco para proteger tu dinero',
  '💡 Modo /pasivo te protege de robos',
  '💡 /slot y /blackjack para apostar',
  '💡 Reporta bugs con /bug <descripción>',
  '💡 /s convierte imágenes en stickers',
  '💡 Mejora tu equipo con /forja mejorar',
  '💡 /ranking muestra los mejores jugadores'
];

/**
 * Comandos rápidos (más usados)
 */
const QUICK_COMMANDS = [
  { cmd: 'perfil', emoji: '👤' },
  { cmd: 'daily', emoji: '🎁' },
  { cmd: 'work', emoji: '💼' },
  { cmd: 'minar', emoji: '⛏️' },
  { cmd: 'atacar', emoji: '⚔️' },
  { cmd: 'tienda', emoji: '🏪' },
  { cmd: 'inventario', emoji: '🎒' },
  { cmd: 'forja', emoji: '⚒️' }
];

/**
 * Comandos NUEVOS (categoría especial)
 */
const NEW_COMMANDS: CommandDetail[] = [
  { cmd: 'dl', aliases: ['download', 'descargar'], desc: 'Descargador universal - detecta automáticamente la plataforma', usage: '/dl <url>' },
  { cmd: 'cobalt', aliases: ['cb'], desc: 'Descargar con Cobalt API (soporta 20+ sitios)', usage: '/cobalt <url> [-a] [-q=720]' },
  { cmd: 'threads', aliases: ['th'], desc: 'Descargar videos/imágenes de Threads', usage: '/threads <url>' },
  { cmd: 'antidelete', aliases: ['antieliminar'], desc: 'Reenvía mensajes eliminados al grupo', usage: '/antidelete on|off' },
  { cmd: 'mode', aliases: ['modo'], desc: 'Cambiar modo del bot (público/privado/grupo/inbox)', usage: '/mode public|private|group|inbox' },
  { cmd: 'antibad', aliases: ['antigroserias'], desc: 'Filtro de groserías automático', usage: '/antibad on|off' },
  { cmd: 'autosticker', aliases: ['as'], desc: 'Convierte imágenes a stickers automáticamente', usage: '/autosticker on|off' },
  { cmd: 'autodownload', aliases: ['autodl'], desc: 'Descarga automática de URLs de redes sociales', usage: '/autodownload on|off' },
  { cmd: 'tts', aliases: ['voz', 'speak'], desc: 'Convierte texto a voz (audio)', usage: '/tts [idioma] <texto>' },
  { cmd: 'addbadword', aliases: [], desc: 'Agregar palabra prohibida al filtro', usage: '/addbadword <palabra>' },
  { cmd: 'delbadword', aliases: [], desc: 'Quitar palabra prohibida del filtro', usage: '/delbadword <palabra>' },
  { cmd: 'listbadwords', aliases: ['badwords'], desc: 'Ver lista de palabras prohibidas', usage: '/listbadwords' }
];

/**
 * Categorías del menú
 */
const CATEGORIES: MenuCategory[] = [
  {
    id: 'rpg',
    emoji: '🎮',
    name: 'RPG Básico',
    commands: ['verificar', 'perfil', 'nivel', 'daily', 'work', 'minar']
  },
  {
    id: 'combat',
    emoji: '⚔️',
    name: 'Combate',
    commands: ['atacar', 'duelo', 'robar', 'bombardear', 'deuda', 'pagardeuda']
  },
  {
    id: 'dungeon',
    emoji: '🏰',
    name: 'Dungeons',
    commands: ['dungeons', 'dungeon', 'a', 'd', 'h', 'i', 'huir', 'estado']
  },
  {
    id: 'inventory',
    emoji: '🎒',
    name: 'Inventario',
    commands: ['inventario', 'equipar', 'desequipar', 'usar', 'iteminfo']
  },
  {
    id: 'shop',
    emoji: '🏪',
    name: 'Tienda',
    commands: ['tienda', 'comprar', 'vender', 'comprard']
  },
  {
    id: 'forge',
    emoji: '⚒️',
    name: 'Forja',
    commands: ['forja', 'fumar']
  },
  {
    id: 'economy',
    emoji: '💰',
    name: 'Economía',
    commands: ['economia', 'banco', 'transferir', 'esclavizar', 'liberar', 'esclavos', 'pasivo']
  },
  {
    id: 'class',
    emoji: '🎭',
    name: 'Clases',
    commands: ['clases', 'clase', 'habilidades']
  },
  {
    id: 'progress',
    emoji: '🏆',
    name: 'Progreso',
    commands: ['ranking', 'logros', 'reclamarlogro', 'misiones', 'reclamarmision', 'stats', 'titulo']
  },
  {
    id: 'fun',
    emoji: '🎪',
    name: 'Diversión',
    commands: ['slot', 'amor', 'gay', 'beso', 'misbesos', 'topbesos', 'abrazo', 'kissall', 'gudmornin', 'poka', 'ctm', 'hazana']
  },
  {
    id: 'casino',
    emoji: '🃏',
    name: 'Casino',
    commands: ['blackjack', 'jugar', 'pedir', 'plantarse', 'doblar', 'bjmesa', 'bjinfo', 'ruleta', 'apostar', 'girar', 'ruletainfo']
  },
  {
    id: 'media',
    emoji: '🎵',
    name: 'Media',
    commands: ['play', 's', 'toimg', 'tovideo', 'togif']
  },
  {
    id: 'download',
    emoji: '📥',
    name: 'Descargas',
    commands: ['dl', 'cobalt', 'tiktok', 'ig', 'fb', 'twitter', 'pinterest', 'threads']
  },
  {
    id: 'tools',
    emoji: '🔧',
    name: 'Herramientas',
    commands: ['translate', 'clima', 'bug', 'feat', 'id', 'tts']
  },
  {
    id: 'admin',
    emoji: '👑',
    name: 'Admin Grupo',
    commands: ['kick', 'promote', 'demote', 'mute', 'unmute', 'warn', 'unwarn', 'listwarn', 'antilink', 'antispam', 'antibad', 'addbadword', 'delbadword', 'listbadwords', 'antidelete', 'autosticker', 'autodownload', 'welcome', 'bye', 'setwelcome', 'setbye', 'tagall', 'hidetag', 'delete', 'clear', 'pin', 'close', 'open', 'compacto'],
    adminOnly: true
  },
  {
    id: 'customize',
    emoji: '✏️',
    name: 'Personalizar',
    commands: ['addpoka', 'delpoka', 'listpoka', 'clearpoka', 'addctm', 'delctm', 'listctm', 'clearctm'],
    adminOnly: true
  },
  {
    id: 'owner',
    emoji: '🔐',
    name: 'Owner',
    commands: ['restart', 'gitpull', 'logs', 'mode', 'rpgowner', 'rpgdar', 'rpgquitar', 'rpgset', 'rpgdaritem', 'rpgbonus', 'rpgrobolibre', 'rpgevento', 'rpgpvp', 'rpgcaos', 'rpgdesactivar', 'rpgresetcd', 'rpgsetclase', 'rpgfullstats', 'rpgmaxlevel', 'rpginfo', 'rpgdaratodos', 'rpglluviamoney', 'rpgborrar', 'rpgtop', 'rpgautoevents'],
    ownerOnly: true
  }
];

/**
 * Detalles de comandos
 */
const COMMANDS: Record<string, CommandDetail> = {
  // RPG Básico
  verificar: { cmd: 'verificar', aliases: ['registrar', 'register'], desc: 'Registrarte en el juego', usage: '/verificar nombre.edad' },
  perfil: { cmd: 'perfil', aliases: ['profile', 'p'], desc: 'Ver tu perfil o el de alguien', usage: '/perfil [@usuario]' },
  nivel: { cmd: 'nivel', aliases: ['lvl', 'levelup'], desc: 'Subir de nivel', usage: '/nivel' },
  daily: { cmd: 'daily', aliases: ['claim', 'diario'], desc: 'Recompensa diaria', usage: '/daily' },
  work: { cmd: 'work', aliases: ['trabajar', 'w'], desc: 'Trabajar para ganar XP', usage: '/work' },
  minar: { cmd: 'minar', aliases: ['mine', 'picar'], desc: 'Minar minerales y materiales', usage: '/minar' },

  // Combate
  atacar: { cmd: 'atacar', aliases: ['attack', 'hunt'], desc: 'Luchar contra monstruos', usage: '/atacar' },
  duelo: { cmd: 'duelo', aliases: ['duel', 'pvp'], desc: 'Desafiar a otro jugador', usage: '/duelo @usuario [apuesta]' },
  robar: { cmd: 'robar', aliases: ['rob', 'steal'], desc: 'Robar a otro jugador', usage: '/robar @usuario' },
  bombardear: { cmd: 'bombardear', aliases: ['bomba', 'bomb'], desc: 'Lanzar bomba a jugador', usage: '/bombardear @usuario' },
  deuda: { cmd: 'deuda', aliases: ['debt', 'imss'], desc: 'Ver tu deuda IMSS', usage: '/deuda' },
  pagardeuda: { cmd: 'pagardeuda', aliases: ['pagarimss'], desc: 'Pagar deuda IMSS', usage: '/pagardeuda [cantidad]' },

  // Dungeon
  dungeons: { cmd: 'dungeons', aliases: ['mazmorras'], desc: 'Ver dungeons disponibles', usage: '/dungeons' },
  dungeon: { cmd: 'dungeon', aliases: ['mazmorra'], desc: 'Entrar a dungeon interactivo', usage: '/dungeon [nombre]' },
  a: { cmd: 'a', aliases: [], desc: 'Atacar en dungeon', usage: '/a' },
  d: { cmd: 'd', aliases: [], desc: 'Defenderse en dungeon', usage: '/d' },
  h: { cmd: 'h', aliases: [], desc: 'Usar habilidad en dungeon', usage: '/h [num]' },
  i: { cmd: 'i', aliases: [], desc: 'Usar item en dungeon', usage: '/i [num]' },
  huir: { cmd: 'huir', aliases: ['escapar', 'flee'], desc: 'Escapar del dungeon', usage: '/huir' },
  estado: { cmd: 'estado', aliases: ['status'], desc: 'Ver estado en dungeon', usage: '/estado' },

  // Inventario
  inventario: { cmd: 'inventario', aliases: ['inv', 'items'], desc: 'Ver tu inventario', usage: '/inventario [tipo]' },
  equipar: { cmd: 'equipar', aliases: ['equip'], desc: 'Equipar un item', usage: '/equipar [item]' },
  desequipar: { cmd: 'desequipar', aliases: ['unequip'], desc: 'Quitar item equipado', usage: '/desequipar [slot]' },
  usar: { cmd: 'usar', aliases: ['use', 'consumir'], desc: 'Usar consumible', usage: '/usar [item]' },
  iteminfo: { cmd: 'iteminfo', aliases: ['item'], desc: 'Info de un item', usage: '/iteminfo [nombre]' },

  // Tienda
  tienda: { cmd: 'tienda', aliases: ['shop', 'store'], desc: 'Ver items en venta', usage: '/tienda [categoria]' },
  comprar: { cmd: 'comprar', aliases: ['buy'], desc: 'Comprar un item', usage: '/comprar [item] [cantidad]' },
  vender: { cmd: 'vender', aliases: ['sell'], desc: 'Vender items', usage: '/vender [item] [cantidad]' },
  comprard: { cmd: 'comprard', aliases: ['buydiamonds'], desc: 'Comprar con diamantes', usage: '/comprard [item]' },

  // Forja
  forja: { cmd: 'forja', aliases: ['forge', 'herreria'], desc: 'Sistema de forja completo', usage: '/forja [subcomando]' },
  fumar: { cmd: 'fumar', aliases: ['smoke', 'piedra'], desc: 'Fumar piedra (50/50)', usage: '/fumar' },

  // Economía
  economia: { cmd: 'economia', aliases: ['economy', 'wallet'], desc: 'Ver estado económico', usage: '/economia' },
  banco: { cmd: 'banco', aliases: ['bank', 'depositar'], desc: 'Depositar al banco', usage: '/banco [cantidad]' },
  transferir: { cmd: 'transferir', aliases: ['transfer', 'pay'], desc: 'Transferir dinero', usage: '/transferir @user [cant]' },
  esclavizar: { cmd: 'esclavizar', aliases: ['enslave'], desc: 'Esclavizar usuario', usage: '/esclavizar @user' },
  liberar: { cmd: 'liberar', aliases: ['free'], desc: 'Liberar esclavo', usage: '/liberar @user' },
  esclavos: { cmd: 'esclavos', aliases: ['slaves'], desc: 'Ver tus esclavos', usage: '/esclavos' },
  pasivo: { cmd: 'pasivo', aliases: ['passive', 'paz'], desc: 'Modo pasivo on/off', usage: '/pasivo on|off' },

  // Clases
  clases: { cmd: 'clases', aliases: ['classes'], desc: 'Ver todas las clases', usage: '/clases' },
  clase: { cmd: 'clase', aliases: ['class'], desc: 'Elegir/ver tu clase', usage: '/clase [nombre]' },
  habilidades: { cmd: 'habilidades', aliases: ['skills'], desc: 'Ver tus habilidades', usage: '/habilidades' },

  // Progreso
  ranking: { cmd: 'ranking', aliases: ['top', 'leaderboard'], desc: 'Ver mejores jugadores', usage: '/ranking [categoria]' },
  logros: { cmd: 'logros', aliases: ['achievements'], desc: 'Ver tus logros', usage: '/logros' },
  reclamarlogro: { cmd: 'reclamarlogro', aliases: ['claimachievement'], desc: 'Reclamar logro', usage: '/reclamarlogro' },
  misiones: { cmd: 'misiones', aliases: ['quests'], desc: 'Ver misiones activas', usage: '/misiones' },
  reclamarmision: { cmd: 'reclamarmision', aliases: ['claimquest'], desc: 'Reclamar misión', usage: '/reclamarmision' },
  stats: { cmd: 'stats', aliases: ['estadisticas'], desc: 'Estadísticas detalladas', usage: '/stats' },
  titulo: { cmd: 'titulo', aliases: ['title'], desc: 'Cambiar tu título', usage: '/titulo [nombre]' },

  // Diversión
  slot: { cmd: 'slot', aliases: ['tragamonedas'], desc: 'Jugar tragamonedas', usage: '/slot [apuesta]' },
  amor: { cmd: 'amor', aliases: ['love', 'ship'], desc: 'Calculadora de amor', usage: '/amor @usuario' },
  gay: { cmd: 'gay', aliases: ['gaytest'], desc: 'Test de gayedad', usage: '/gay [@usuario]' },
  beso: { cmd: 'beso', aliases: ['kiss', 'muah'], desc: 'Dar un beso', usage: '/beso @usuario' },
  misbesos: { cmd: 'misbesos', aliases: ['mykisses'], desc: 'Ver tus besos', usage: '/misbesos' },
  topbesos: { cmd: 'topbesos', aliases: ['topkiss'], desc: 'Ranking de besos', usage: '/topbesos' },
  abrazo: { cmd: 'abrazo', aliases: ['hug', 'abrazar'], desc: 'Dar un abrazo', usage: '/abrazo @usuario' },
  kissall: { cmd: 'kissall', aliases: ['besartodos'], desc: 'Besar a todos', usage: '/kissall' },
  gudmornin: { cmd: 'gudmornin', aliases: ['buenosdias', 'gm'], desc: 'Buenos días', usage: '/gudmornin @usuario' },
  poka: { cmd: 'poka', aliases: ['limosna'], desc: 'Pedir limosna', usage: '/poka' },
  ctm: { cmd: 'ctm', aliases: ['chingatumadre'], desc: 'Insultar creativamente', usage: '/ctm @usuario' },
  hazana: { cmd: 'hazana', aliases: ['hazaña', 'carlitos'], desc: 'Sticker de Carlitos', usage: '/hazana' },

  // Casino
  blackjack: { cmd: 'blackjack', aliases: ['bj'], desc: 'Abrir mesa Blackjack', usage: '/blackjack [apuesta_min]' },
  jugar: { cmd: 'jugar', aliases: ['unirse'], desc: 'Unirse a mesa', usage: '/jugar [apuesta]' },
  pedir: { cmd: 'pedir', aliases: ['hit'], desc: 'Pedir carta', usage: '/pedir' },
  plantarse: { cmd: 'plantarse', aliases: ['stand'], desc: 'Plantarse', usage: '/plantarse' },
  doblar: { cmd: 'doblar', aliases: ['double'], desc: 'Doblar apuesta', usage: '/doblar' },
  bjmesa: { cmd: 'bjmesa', aliases: ['vermesa'], desc: 'Ver mesa BJ', usage: '/bjmesa' },
  bjinfo: { cmd: 'bjinfo', aliases: ['blackjackinfo'], desc: 'Info Blackjack', usage: '/bjinfo' },
  ruleta: { cmd: 'ruleta', aliases: ['roulette'], desc: 'Abrir mesa Ruleta', usage: '/ruleta [apuesta_min]' },
  apostar: { cmd: 'apostar', aliases: ['bet'], desc: 'Apostar en ruleta', usage: '/apostar <tipo> <cant>' },
  girar: { cmd: 'girar', aliases: ['spin'], desc: 'Girar ruleta', usage: '/girar' },
  ruletainfo: { cmd: 'ruletainfo', aliases: ['rouletteinfo'], desc: 'Info Ruleta', usage: '/ruletainfo' },

  // Media
  play: { cmd: 'play', aliases: ['musica', 'music'], desc: 'Descargar música', usage: '/play [nombre/URL]' },
  s: { cmd: 's', aliases: ['sticker', 'stick'], desc: 'Crear sticker', usage: '/s (responder a imagen)' },
  toimg: { cmd: 'toimg', aliases: ['toimage', 'img'], desc: 'Sticker a imagen', usage: '/toimg' },
  tovideo: { cmd: 'tovideo', aliases: ['tovid'], desc: 'Sticker a video', usage: '/tovideo' },
  togif: { cmd: 'togif', aliases: ['gif'], desc: 'Sticker a GIF', usage: '/togif' },

  // Descargas
  dl: { cmd: 'dl', aliases: ['download', 'descargar', 'bajar'], desc: 'Descarga universal (auto-detecta)', usage: '/dl <url>' },
  cobalt: { cmd: 'cobalt', aliases: ['cb'], desc: 'Descargar con Cobalt (all-in-one)', usage: '/cobalt <url> [-a] [-q=720]' },
  tiktok: { cmd: 'tiktok', aliases: ['tt'], desc: 'Descargar de TikTok', usage: '/tiktok <url>' },
  ig: { cmd: 'ig', aliases: ['instagram'], desc: 'Descargar de Instagram', usage: '/ig <url>' },
  fb: { cmd: 'fb', aliases: ['facebook'], desc: 'Descargar de Facebook', usage: '/fb <url>' },
  twitter: { cmd: 'twitter', aliases: ['tw', 'x'], desc: 'Descargar de Twitter/X', usage: '/twitter <url>' },
  pinterest: { cmd: 'pinterest', aliases: ['pin'], desc: 'Buscar/descargar de Pinterest', usage: '/pinterest <url|búsqueda>' },
  threads: { cmd: 'threads', aliases: ['th'], desc: 'Descargar de Threads', usage: '/threads <url>' },

  // Herramientas
  translate: { cmd: 'translate', aliases: ['traducir', 'tr'], desc: 'Traducir texto', usage: '/translate <idioma> <texto>' },
  clima: { cmd: 'clima', aliases: ['weather'], desc: 'Ver clima', usage: '/clima <ciudad>' },
  bug: { cmd: 'bug', aliases: ['reportar'], desc: 'Reportar bug', usage: '/bug <descripcion>' },
  feat: { cmd: 'feat', aliases: ['sugerencia'], desc: 'Sugerir función', usage: '/feat <descripcion>' },
  id: { cmd: 'id', aliases: ['chatid'], desc: 'Ver ID del chat', usage: '/id' },
  tts: { cmd: 'tts', aliases: ['voz', 'speak'], desc: 'Texto a voz', usage: '/tts [idioma] <texto>' },

  // Admin
  kick: { cmd: 'kick', aliases: ['expulsar', 'ban'], desc: 'Expulsar usuario', usage: '/kick @usuario' },
  promote: { cmd: 'promote', aliases: ['admin'], desc: 'Hacer admin', usage: '/promote @usuario' },
  demote: { cmd: 'demote', aliases: ['quitaradmin'], desc: 'Quitar admin', usage: '/demote @usuario' },
  mute: { cmd: 'mute', aliases: ['silenciar'], desc: 'Silenciar usuario', usage: '/mute @usuario' },
  unmute: { cmd: 'unmute', aliases: ['desilenciar'], desc: 'Quitar silencio', usage: '/unmute @usuario' },
  warn: { cmd: 'warn', aliases: ['advertir'], desc: 'Advertir usuario', usage: '/warn @usuario [razón]' },
  unwarn: { cmd: 'unwarn', aliases: ['quitarwarn'], desc: 'Quitar warn', usage: '/unwarn @usuario' },
  listwarn: { cmd: 'listwarn', aliases: ['warns'], desc: 'Ver warns', usage: '/listwarn' },
  antilink: { cmd: 'antilink', aliases: [], desc: 'Anti-enlaces', usage: '/antilink on|off' },
  antispam: { cmd: 'antispam', aliases: [], desc: 'Anti-spam', usage: '/antispam on|off' },
  antibad: { cmd: 'antibad', aliases: ['antigroserias'], desc: 'Anti-groserías', usage: '/antibad on|off' },
  addbadword: { cmd: 'addbadword', aliases: [], desc: 'Agregar grosería', usage: '/addbadword <palabra>' },
  delbadword: { cmd: 'delbadword', aliases: [], desc: 'Quitar grosería', usage: '/delbadword <palabra>' },
  listbadwords: { cmd: 'listbadwords', aliases: ['badwords'], desc: 'Ver groserías', usage: '/listbadwords' },
  antidelete: { cmd: 'antidelete', aliases: ['antieliminar'], desc: 'Anti-eliminación', usage: '/antidelete on|off' },
  autosticker: { cmd: 'autosticker', aliases: ['as'], desc: 'Auto-sticker', usage: '/autosticker on|off' },
  autodownload: { cmd: 'autodownload', aliases: ['autodl'], desc: 'Auto-descarga URLs', usage: '/autodownload on|off' },
  welcome: { cmd: 'welcome', aliases: [], desc: 'Bienvenidas on/off', usage: '/welcome on|off' },
  bye: { cmd: 'bye', aliases: [], desc: 'Despedidas on/off', usage: '/bye on|off' },
  setwelcome: { cmd: 'setwelcome', aliases: ['bienvenida'], desc: 'Mensaje bienvenida', usage: '/setwelcome <msg>' },
  setbye: { cmd: 'setbye', aliases: ['despedida'], desc: 'Mensaje despedida', usage: '/setbye <msg>' },
  tagall: { cmd: 'tagall', aliases: ['todos'], desc: 'Mencionar a todos', usage: '/tagall [msg]' },
  hidetag: { cmd: 'hidetag', aliases: ['ht'], desc: 'Mención oculta', usage: '/hidetag [msg]' },
  delete: { cmd: 'delete', aliases: ['del', 'borrar'], desc: 'Eliminar mensaje', usage: '/delete' },
  clear: { cmd: 'clear', aliases: ['limpiar'], desc: 'Limpiar mensajes', usage: '/clear [cantidad]' },
  pin: { cmd: 'pin', aliases: ['fijar'], desc: 'Fijar mensaje', usage: '/pin' },
  close: { cmd: 'close', aliases: ['cerrar'], desc: 'Cerrar grupo', usage: '/close' },
  open: { cmd: 'open', aliases: ['abrir'], desc: 'Abrir grupo', usage: '/open' },
  compacto: { cmd: 'compacto', aliases: ['compact', 'quiet'], desc: 'Modo compacto', usage: '/compacto on|off' },

  // Personalizar
  addpoka: { cmd: 'addpoka', aliases: [], desc: 'Agregar frase poka', usage: '/addpoka <frase>' },
  delpoka: { cmd: 'delpoka', aliases: [], desc: 'Eliminar frase poka', usage: '/delpoka <num>' },
  listpoka: { cmd: 'listpoka', aliases: [], desc: 'Ver frases poka', usage: '/listpoka' },
  clearpoka: { cmd: 'clearpoka', aliases: [], desc: 'Borrar frases poka', usage: '/clearpoka' },
  addctm: { cmd: 'addctm', aliases: [], desc: 'Agregar frase ctm', usage: '/addctm <frase>' },
  delctm: { cmd: 'delctm', aliases: [], desc: 'Eliminar frase ctm', usage: '/delctm <num>' },
  listctm: { cmd: 'listctm', aliases: [], desc: 'Ver frases ctm', usage: '/listctm' },
  clearctm: { cmd: 'clearctm', aliases: [], desc: 'Borrar frases ctm', usage: '/clearctm' },

  // Owner
  mode: { cmd: 'mode', aliases: ['modo'], desc: 'Modo del bot', usage: '/mode public|private|group|inbox' },
  restart: { cmd: 'restart', aliases: ['reiniciar'], desc: 'Reiniciar bot', usage: '/restart' },
  gitpull: { cmd: 'gitpull', aliases: ['update'], desc: 'Actualizar código', usage: '/gitpull' },
  logs: { cmd: 'logs', aliases: ['errorlogs'], desc: 'Ver logs errores', usage: '/logs [n]' },
  rpgowner: { cmd: 'rpgowner', aliases: ['rpgadmin'], desc: 'Panel RPG', usage: '/rpgowner' },
  rpgdar: { cmd: 'rpgdar', aliases: ['rpggive'], desc: 'Dar recursos', usage: '/rpgdar @u tipo cant' },
  rpgquitar: { cmd: 'rpgquitar', aliases: ['rpgtake'], desc: 'Quitar recursos', usage: '/rpgquitar @u tipo cant' },
  rpgset: { cmd: 'rpgset', aliases: [], desc: 'Establecer stat', usage: '/rpgset @u stat val' },
  rpgdaritem: { cmd: 'rpgdaritem', aliases: [], desc: 'Dar item', usage: '/rpgdaritem @u item cant' },
  rpgbonus: { cmd: 'rpgbonus', aliases: [], desc: 'Modo bonus', usage: '/rpgbonus xp $ tiempo' },
  rpgrobolibre: { cmd: 'rpgrobolibre', aliases: [], desc: 'Robo sin CD', usage: '/rpgrobolibre tiempo' },
  rpgevento: { cmd: 'rpgevento', aliases: [], desc: 'Evento especial', usage: '/rpgevento "nombre" mult tiempo' },
  rpgpvp: { cmd: 'rpgpvp', aliases: [], desc: 'Modo PVP', usage: '/rpgpvp mult tiempo' },
  rpgcaos: { cmd: 'rpgcaos', aliases: [], desc: 'Modo caos', usage: '/rpgcaos mult tiempo' },
  rpgdesactivar: { cmd: 'rpgdesactivar', aliases: ['rpgoff'], desc: 'Desactivar modos', usage: '/rpgdesactivar modo' },
  rpgresetcd: { cmd: 'rpgresetcd', aliases: [], desc: 'Reset cooldowns', usage: '/rpgresetcd @u tipo' },
  rpgsetclase: { cmd: 'rpgsetclase', aliases: [], desc: 'Cambiar clase', usage: '/rpgsetclase @u clase' },
  rpgfullstats: { cmd: 'rpgfullstats', aliases: ['rpggod'], desc: 'Stats máximos', usage: '/rpgfullstats @u' },
  rpgmaxlevel: { cmd: 'rpgmaxlevel', aliases: [], desc: 'Establecer nivel', usage: '/rpgmaxlevel @u lvl' },
  rpginfo: { cmd: 'rpginfo', aliases: [], desc: 'Info usuario', usage: '/rpginfo @u' },
  rpgdaratodos: { cmd: 'rpgdaratodos', aliases: [], desc: 'Dar a todos', usage: '/rpgdaratodos tipo cant' },
  rpglluviamoney: { cmd: 'rpglluviamoney', aliases: [], desc: 'Lluvia dinero', usage: '/rpglluviamoney cant' },
  rpgborrar: { cmd: 'rpgborrar', aliases: ['rpgreset'], desc: 'Borrar progreso', usage: '/rpgborrar @u confirmar' },
  rpgtop: { cmd: 'rpgtop', aliases: [], desc: 'Rankings', usage: '/rpgtop tipo' },
  rpgautoevents: { cmd: 'rpgautoevents', aliases: [], desc: 'Auto eventos', usage: '/rpgautoevents on|off' }
};

/**
 * Genera el menú principal
 */
function generateMainMenu(userName: string, userLevel: number, isOwner: boolean, isAdmin: boolean): string {
  // Header con info del usuario
  let menu = `
╭━━━━━━━━━━━━━━━━━━━━━╮
┃  ${EMOJI.bot} *${CONFIG.botName}*
┃  _Hola, ${userName}!_
╰━━━━━━━━━━━━━━━━━━━━━╯

`;

  // Comandos rápidos
  menu += `⚡ *RÁPIDO:* `;
  menu += QUICK_COMMANDS.map(q => `${q.emoji}/${q.cmd}`).join(' ');
  menu += `\n\n`;

  // Categoría de NUEVOS primero
  menu += `🆕 *NUEVOS* → /menu nuevos\n`;
  menu += `━━━━━━━━━━━━━━━━━━━━━\n`;

  // Categorías
  menu += `📋 *CATEGORÍAS*\n\n`;

  for (const cat of CATEGORIES) {
    if (cat.adminOnly && !isAdmin && !isOwner) continue;
    if (cat.ownerOnly && !isOwner) continue;

    const cmdCount = cat.commands.length;
    menu += `${cat.emoji} *${cat.name}* _(${cmdCount})_\n`;
    menu += `   → /menu ${cat.id}\n`;
  }

  // Tip aleatorio
  menu += `\n━━━━━━━━━━━━━━━━━━━━━\n`;
  menu += pickRandom(MENU_TIPS);

  return menu;
}

/**
 * Genera menú de comandos nuevos
 */
function getNewCommandsMenu(): string {
  let menu = `
🆕 *COMANDOS NUEVOS*
━━━━━━━━━━━━━━━━━━━━━

`;

  for (const cmd of NEW_COMMANDS) {
    menu += `▸ */${cmd.cmd}*\n`;
    menu += `   ${cmd.desc}\n`;
    menu += `   _${cmd.usage}_\n\n`;
  }

  menu += `━━━━━━━━━━━━━━━━━━━━━
💡 */menu* - Volver al menú`;

  return menu;
}

/**
 * Genera menú de una categoría
 */
function getCategoryMenu(catId: string, isOwner: boolean, isAdmin: boolean): string | null {
  const cat = CATEGORIES.find(c =>
    c.id === catId.toLowerCase() ||
    c.name.toLowerCase() === catId.toLowerCase() ||
    c.name.toLowerCase().includes(catId.toLowerCase())
  );

  if (!cat) return null;
  if (cat.adminOnly && !isAdmin && !isOwner) return null;
  if (cat.ownerOnly && !isOwner) return null;

  let menu = `
${cat.emoji} *${cat.name.toUpperCase()}*
━━━━━━━━━━━━━━━━━━━━━

`;

  for (const cmdName of cat.commands) {
    const cmd = COMMANDS[cmdName];
    if (cmd) {
      menu += `▸ */${cmd.cmd}*\n`;
      menu += `   ${cmd.desc}\n`;
      menu += `   _${cmd.usage}_\n\n`;
    }
  }

  menu += `━━━━━━━━━━━━━━━━━━━━━
💡 */menu* - Menú principal
💡 */menu [comando]* - Detalles`;

  return menu;
}

/**
 * Genera detalles de un comando
 */
function getCommandDetails(cmdName: string): string | null {
  const cmdLower = cmdName.toLowerCase();

  // Buscar en comandos nuevos primero
  const newCmd = NEW_COMMANDS.find(c => c.cmd === cmdLower || c.aliases.includes(cmdLower));
  if (newCmd) {
    let catName = 'Nuevos';
    let catEmoji = '🆕';

    // Buscar categoría real
    for (const cat of CATEGORIES) {
      if (cat.commands.includes(newCmd.cmd)) {
        catName = cat.name;
        catEmoji = cat.emoji;
        break;
      }
    }

    let details = `
🆕 */${newCmd.cmd}* _(NUEVO)_
━━━━━━━━━━━━━━━━━━━━━

📝 *Descripción:*
   ${newCmd.desc}

🔧 *Uso:*
   ${newCmd.usage}
`;

    if (newCmd.aliases.length > 0) {
      details += `
🏷️ *Alias:*
   ${newCmd.aliases.map(a => `/${a}`).join(', ')}
`;
    }

    details += `
📁 *Categoría:* ${catEmoji} ${catName}
`;

    return details;
  }

  // Buscar en comandos normales
  let cmd: CommandDetail | undefined;
  for (const [key, val] of Object.entries(COMMANDS)) {
    if (key === cmdLower || val.aliases.includes(cmdLower)) {
      cmd = val;
      break;
    }
  }

  if (!cmd) return null;

  // Encontrar categoría
  let catName = '';
  let catEmoji = '';
  for (const cat of CATEGORIES) {
    if (cat.commands.includes(cmd.cmd)) {
      catName = cat.name;
      catEmoji = cat.emoji;
      break;
    }
  }

  let details = `
${catEmoji} */${cmd.cmd}*
━━━━━━━━━━━━━━━━━━━━━

📝 *Descripción:*
   ${cmd.desc}

🔧 *Uso:*
   ${cmd.usage}
`;

  if (cmd.aliases.length > 0) {
    details += `
🏷️ *Alias:*
   ${cmd.aliases.map(a => `/${a}`).join(', ')}
`;
  }

  details += `
📁 *Categoría:* ${catName}
`;

  return details;
}

/**
 * Plugin: Menu
 */
export const menuPlugin: PluginHandler = {
  command: ['menu', 'help', 'ayuda', 'comandos', '?'],
  tags: ['utilidad'],
  help: [
    'menu - Ver menú principal',
    'menu nuevos - Ver comandos nuevos',
    'menu [categoría] - Ver comandos de categoría',
    'menu [comando] - Ver detalles de comando'
  ],

  handler: async (ctx: MessageContext) => {
    const { m, text, isOwner, isAdmin } = ctx;
    const query = text.trim().toLowerCase();
    const db = getDatabase();
    const user = db.getUser(m.sender);

    // Obtener nombre y nivel del usuario
    const userName = user.name || m.pushName || 'Aventurero';
    const userLevel = user.level || 0;

    if (query) {
      // Categoría especial: nuevos
      if (query === 'nuevos' || query === 'new' || query === 'nuevo') {
        await m.reply(getNewCommandsMenu());
        return;
      }

      // Buscar como categoría
      const catMenu = getCategoryMenu(query, isOwner, isAdmin);
      if (catMenu) {
        await m.reply(catMenu);
        return;
      }

      // Buscar como comando
      const cmdDetails = getCommandDetails(query);
      if (cmdDetails) {
        await m.reply(cmdDetails);
        return;
      }

      await m.reply(
        `${EMOJI.error} No encontré "*${query}*"\n\n` +
        `📋 Usa */menu* para ver las categorías.`
      );
      return;
    }

    // Menú principal
    const menu = generateMainMenu(userName, userLevel, isOwner, isAdmin);
    await m.reply(menu);
    await m.react('📋');
  }
};

export default menuPlugin;
