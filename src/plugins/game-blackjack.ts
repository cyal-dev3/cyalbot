/**
 * 🃏 Plugin de Blackjack Multiplayer
 * Comando: /blackjack, /jugar, /pedir, /plantarse, /doblar
 */

import type { PluginHandler, MessageContext } from '../types/message.js';
import { getDatabase } from '../lib/database.js';

// ============================================
// 🎴 SISTEMA DE CARTAS
// ============================================

interface Card {
  suit: string;
  rank: string;
  value: number;
  emoji: string;
}

const SUITS = [
  { name: 'Corazones', emoji: '♥️' },
  { name: 'Diamantes', emoji: '♦️' },
  { name: 'Treboles', emoji: '♣️' },
  { name: 'Picas', emoji: '♠️' }
];

const RANKS = [
  { rank: 'A', value: 11, display: 'A' },
  { rank: '2', value: 2, display: '2' },
  { rank: '3', value: 3, display: '3' },
  { rank: '4', value: 4, display: '4' },
  { rank: '5', value: 5, display: '5' },
  { rank: '6', value: 6, display: '6' },
  { rank: '7', value: 7, display: '7' },
  { rank: '8', value: 8, display: '8' },
  { rank: '9', value: 9, display: '9' },
  { rank: '10', value: 10, display: '10' },
  { rank: 'J', value: 10, display: 'J' },
  { rank: 'Q', value: 10, display: 'Q' },
  { rank: 'K', value: 10, display: 'K' }
];

/**
 * Crea un mazo completo de 52 cartas (o varios mazos)
 */
function createDeck(numDecks: number = 4): Card[] {
  const deck: Card[] = [];

  for (let d = 0; d < numDecks; d++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        deck.push({
          suit: suit.name,
          rank: rank.rank,
          value: rank.value,
          emoji: `${rank.display}${suit.emoji}`
        });
      }
    }
  }

  return deck;
}

/**
 * Baraja el mazo usando Fisher-Yates con crypto random
 */
function shuffleDeck(deck: Card[]): Card[] {
  const shuffled = [...deck];

  // Múltiples pasadas de barajeo para mayor aleatoriedad
  for (let pass = 0; pass < 7; pass++) {
    for (let i = shuffled.length - 1; i > 0; i--) {
      // Usar múltiples fuentes de aleatoriedad
      const randomSeed = Math.random() * Date.now() * Math.random();
      const j = Math.floor((randomSeed % 1) * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
  }

  // Cortar el mazo en un punto aleatorio
  const cutPoint = Math.floor(Math.random() * shuffled.length);
  return [...shuffled.slice(cutPoint), ...shuffled.slice(0, cutPoint)];
}

/**
 * Calcula el valor de una mano considerando Ases
 */
function calculateHandValue(hand: Card[]): number {
  let value = 0;
  let aces = 0;

  for (const card of hand) {
    value += card.value;
    if (card.rank === 'A') aces++;
  }

  // Ajustar Ases de 11 a 1 si nos pasamos
  while (value > 21 && aces > 0) {
    value -= 10;
    aces--;
  }

  return value;
}

/**
 * Verifica si es blackjack natural
 */
function isBlackjack(hand: Card[]): boolean {
  return hand.length === 2 && calculateHandValue(hand) === 21;
}

/**
 * Formatea las cartas para mostrar
 */
function formatHand(hand: Card[], hideSecond: boolean = false): string {
  if (hideSecond && hand.length >= 2) {
    return `[ ${hand[0].emoji} ] [ 🂠 ]`;
  }
  return hand.map(c => `[ ${c.emoji} ]`).join(' ');
}

// ============================================
// 🎰 SISTEMA DE MESAS
// ============================================

interface BlackjackPlayer {
  jid: string;
  name: string;
  bet: number;
  hand: Card[];
  status: 'waiting' | 'playing' | 'stand' | 'bust' | 'blackjack' | 'win' | 'lose' | 'push';
  doubled: boolean;
  insurance: number;
}

interface BlackjackTable {
  groupId: string;
  creatorJid: string;
  players: Map<string, BlackjackPlayer>;
  deck: Card[];
  dealerHand: Card[];
  phase: 'joining' | 'playing' | 'dealer' | 'finished';
  currentPlayerIndex: number;
  playerOrder: string[];
  minBet: number;
  maxBet: number;
  startTime: number;
  joinTimeout: NodeJS.Timeout | null;
  turnTimeout: NodeJS.Timeout | null;
}

// Almacén de mesas activas por grupo
const activeTables: Map<string, BlackjackTable> = new Map();

// Tiempo para unirse a la mesa (30 segundos)
const JOIN_TIME = 30000;

// Tiempo máximo por turno (45 segundos)
const TURN_TIME = 45000;

// ============================================
// 📊 UTILIDADES
// ============================================

/**
 * Obtiene el nombre corto de un jugador
 */
function getShortName(jid: string, ctx: MessageContext): string {
  const db = getDatabase();
  const user = db.getUser(jid);
  if (user.name) return user.name;

  // Extraer número del JID
  const num = jid.split('@')[0];
  return num.slice(-4);
}

/**
 * Limpia una mesa
 */
function cleanupTable(groupId: string) {
  const table = activeTables.get(groupId);
  if (table) {
    if (table.joinTimeout) clearTimeout(table.joinTimeout);
    if (table.turnTimeout) clearTimeout(table.turnTimeout);
    activeTables.delete(groupId);
  }
}

// ============================================
// 🎮 COMANDOS
// ============================================

/**
 * Comando /blackjack - Abrir una nueva mesa
 */
export const blackjackPlugin: PluginHandler = {
  command: ['blackjack', 'bj', 'mesa'],
  description: 'Abrir una mesa de Blackjack',
  category: 'game',
  group: true,
  register: true,

  async handler(ctx: MessageContext) {
    const { m, text, conn } = ctx;
    const groupId = m.chat;
    const db = getDatabase();
    const user = db.getUser(m.sender);

    // Verificar si ya hay mesa activa
    if (activeTables.has(groupId)) {
      const table = activeTables.get(groupId)!;
      if (table.phase === 'joining') {
        await m.reply(`🃏 *Ya hay una mesa abierta!*\n\nUsa .jugar <cantidad> para unirte\n⏰ Tiempo restante: ${Math.ceil((JOIN_TIME - (Date.now() - table.startTime)) / 1000)}s`);
      } else {
        await m.reply('🃏 Hay una partida en curso. Espera a que termine.');
      }
      return;
    }

    // Obtener apuesta mínima del creador
    const minBet = parseInt(text) || 100;

    if (minBet < 50) {
      await m.reply('❌ La apuesta mínima es de 50 monedas.');
      return;
    }

    if (minBet > 50000) {
      await m.reply('❌ La apuesta máxima para abrir mesa es de 50,000 monedas.');
      return;
    }

    if (user.money < minBet) {
      await m.reply(`❌ No tienes suficiente dinero.\n\n💰 Tu balance: ${user.money.toLocaleString()} monedas\n🎲 Apuesta mínima: ${minBet.toLocaleString()} monedas`);
      return;
    }

    // Crear nueva mesa
    const table: BlackjackTable = {
      groupId,
      creatorJid: m.sender,
      players: new Map(),
      deck: shuffleDeck(createDeck(4)),
      dealerHand: [],
      phase: 'joining',
      currentPlayerIndex: 0,
      playerOrder: [],
      minBet,
      maxBet: minBet * 10,
      startTime: Date.now(),
      joinTimeout: null,
      turnTimeout: null
    };

    // El creador se une automáticamente
    table.players.set(m.sender, {
      jid: m.sender,
      name: getShortName(m.sender, ctx),
      bet: minBet,
      hand: [],
      status: 'waiting',
      doubled: false,
      insurance: 0
    });
    table.playerOrder.push(m.sender);

    // Descontar apuesta del creador
    db.updateUser(m.sender, { money: user.money - minBet });

    activeTables.set(groupId, table);

    // Mensaje de apertura
    let openMsg = `
╔══════════════════════════╗
║   🃏 *BLACKJACK* 🃏      ║
╠══════════════════════════╣
║  La mesa esta abierta!   ║
╠══════════════════════════╣
║ 💰 Apuesta: ${minBet.toLocaleString().padEnd(13)}║
║ ⏰ Tiempo: 30 segundos    ║
╠══════════════════════════╣
║ 📝 Usa *.jugar <monto>*  ║
║    para unirte           ║
╚══════════════════════════╝

👤 *Jugadores:*
1. ${getShortName(m.sender, ctx)} - ${minBet.toLocaleString()} monedas
`;

    await m.reply(openMsg);

    // Temporizador para iniciar el juego
    table.joinTimeout = setTimeout(async () => {
      const currentTable = activeTables.get(groupId);
      if (!currentTable || currentTable.phase !== 'joining') return;

      if (currentTable.players.size < 1) {
        // Devolver dinero si nadie más se unió
        for (const [jid, player] of currentTable.players) {
          const playerUser = db.getUser(jid);
          db.updateUser(jid, { money: playerUser.money + player.bet });
        }
        cleanupTable(groupId);
        await conn.sendMessage(groupId, { text: '🃏 Mesa cerrada por falta de jugadores.' });
        return;
      }

      // Iniciar el juego
      await startBlackjackGame(groupId, ctx);
    }, JOIN_TIME);
  }
};

/**
 * Comando /jugar - Unirse a una mesa
 */
export const jugarPlugin: PluginHandler = {
  command: ['jugar', 'unirse', 'entrar'],
  description: 'Unirse a una mesa de Blackjack',
  category: 'game',
  group: true,
  register: true,

  async handler(ctx: MessageContext) {
    const { m, text } = ctx;
    const groupId = m.chat;
    const db = getDatabase();
    const user = db.getUser(m.sender);

    // Verificar si hay mesa activa
    const table = activeTables.get(groupId);
    if (!table) {
      await m.reply('🃏 No hay ninguna mesa abierta.\n\nUsa *.blackjack <apuesta>* para abrir una.');
      return;
    }

    if (table.phase !== 'joining') {
      await m.reply('🃏 La partida ya comenzó. Espera a que termine.');
      return;
    }

    // Verificar si ya está en la mesa
    if (table.players.has(m.sender)) {
      await m.reply('🃏 Ya estás en esta mesa!');
      return;
    }

    // Límite de jugadores
    if (table.players.size >= 7) {
      await m.reply('🃏 La mesa está llena (máximo 7 jugadores).');
      return;
    }

    // Obtener cantidad a apostar
    const bet = parseInt(text) || table.minBet;

    if (bet < table.minBet) {
      await m.reply(`❌ La apuesta mínima es ${table.minBet.toLocaleString()} monedas.`);
      return;
    }

    if (bet > table.maxBet) {
      await m.reply(`❌ La apuesta máxima es ${table.maxBet.toLocaleString()} monedas.`);
      return;
    }

    if (user.money < bet) {
      await m.reply(`❌ No tienes suficiente dinero.\n\n💰 Tu balance: ${user.money.toLocaleString()} monedas`);
      return;
    }

    // Unirse a la mesa
    table.players.set(m.sender, {
      jid: m.sender,
      name: getShortName(m.sender, ctx),
      bet,
      hand: [],
      status: 'waiting',
      doubled: false,
      insurance: 0
    });
    table.playerOrder.push(m.sender);

    // Descontar apuesta
    db.updateUser(m.sender, { money: user.money - bet });

    // Mostrar jugadores actuales
    let playersMsg = `🃏 *${getShortName(m.sender, ctx)}* se unió!\n\n👥 *Jugadores (${table.players.size}/7):*\n`;
    let i = 1;
    for (const [, player] of table.players) {
      playersMsg += `${i}. ${player.name} - ${player.bet.toLocaleString()} monedas\n`;
      i++;
    }

    const timeLeft = Math.ceil((JOIN_TIME - (Date.now() - table.startTime)) / 1000);
    playersMsg += `\n⏰ Tiempo restante: ${timeLeft}s`;

    await m.reply(playersMsg);
  }
};

/**
 * Inicia el juego de blackjack
 */
async function startBlackjackGame(groupId: string, ctx: MessageContext) {
  const table = activeTables.get(groupId);
  if (!table) return;

  table.phase = 'playing';

  // Repartir 2 cartas a cada jugador y al dealer
  for (const [, player] of table.players) {
    player.hand.push(table.deck.pop()!);
    player.hand.push(table.deck.pop()!);
    player.status = 'playing';
  }

  table.dealerHand.push(table.deck.pop()!);
  table.dealerHand.push(table.deck.pop()!);

  // Mostrar estado inicial
  let gameMsg = `
╔═══════════════════════════════╗
║    🃏 *BLACKJACK INICIADO* 🃏  ║
╚═══════════════════════════════╝

🎩 *DEALER:*
${formatHand(table.dealerHand, true)}
Mostrando: ${calculateHandValue([table.dealerHand[0]])}

━━━━━━━━━━━━━━━━━━━━━━━━━━━

👥 *JUGADORES:*
`;

  // Verificar blackjacks y mostrar manos
  for (const [, player] of table.players) {
    const value = calculateHandValue(player.hand);
    const hasBlackjack = isBlackjack(player.hand);

    if (hasBlackjack) {
      player.status = 'blackjack';
    }

    gameMsg += `\n🎰 *${player.name}* (${player.bet.toLocaleString()})\n`;
    gameMsg += `${formatHand(player.hand)}\n`;
    gameMsg += `Valor: ${value}${hasBlackjack ? ' 🎉 *BLACKJACK!*' : ''}\n`;
  }

  await ctx.conn.sendMessage(groupId, { text: gameMsg });

  // Buscar el primer jugador que necesite jugar
  await processNextPlayer(groupId, ctx);
}

/**
 * Procesa el siguiente jugador o termina el juego
 */
async function processNextPlayer(groupId: string, ctx: MessageContext) {
  const table = activeTables.get(groupId);
  if (!table) return;

  // Limpiar timeout anterior
  if (table.turnTimeout) {
    clearTimeout(table.turnTimeout);
    table.turnTimeout = null;
  }

  // Buscar siguiente jugador activo
  while (table.currentPlayerIndex < table.playerOrder.length) {
    const currentJid = table.playerOrder[table.currentPlayerIndex];
    const player = table.players.get(currentJid);

    if (player && player.status === 'playing') {
      // Turno de este jugador
      let turnMsg = `
🎯 *Turno de ${player.name}*

${formatHand(player.hand)}
Valor: ${calculateHandValue(player.hand)}

📝 *Opciones:*
• *.pedir* - Tomar otra carta
• *.plantarse* - Quedarse con esta mano
• *.doblar* - Doblar apuesta (solo primera jugada)

⏰ Tienes 45 segundos...`;

      await ctx.conn.sendMessage(groupId, { text: turnMsg });

      // Timeout del turno
      table.turnTimeout = setTimeout(async () => {
        const currentTable = activeTables.get(groupId);
        if (!currentTable) return;

        const timeoutPlayer = currentTable.players.get(currentJid);
        if (timeoutPlayer && timeoutPlayer.status === 'playing') {
          timeoutPlayer.status = 'stand';
          await ctx.conn.sendMessage(groupId, { text: `⏰ *${timeoutPlayer.name}* se plantó automáticamente por tiempo.` });
          currentTable.currentPlayerIndex++;
          await processNextPlayer(groupId, ctx);
        }
      }, TURN_TIME);

      return;
    }

    table.currentPlayerIndex++;
  }

  // Todos los jugadores terminaron, turno del dealer
  await dealerPlay(groupId, ctx);
}

/**
 * Turno del dealer
 */
async function dealerPlay(groupId: string, ctx: MessageContext) {
  const table = activeTables.get(groupId);
  if (!table) return;

  table.phase = 'dealer';

  // Verificar si todos se pasaron
  let allBusted = true;
  for (const [, player] of table.players) {
    if (player.status !== 'bust') {
      allBusted = false;
      break;
    }
  }

  let dealerMsg = `
🎩 *TURNO DEL DEALER*

`;

  if (allBusted) {
    dealerMsg += `Todos los jugadores se pasaron!\n`;
    dealerMsg += `${formatHand(table.dealerHand)}\n`;
    dealerMsg += `Valor: ${calculateHandValue(table.dealerHand)}`;
    await ctx.conn.sendMessage(groupId, { text: dealerMsg });
  } else {
    // Dealer juega
    dealerMsg += `Cartas: ${formatHand(table.dealerHand)}\n`;
    dealerMsg += `Valor: ${calculateHandValue(table.dealerHand)}\n\n`;

    // Dealer pide hasta tener 17 o más
    while (calculateHandValue(table.dealerHand) < 17) {
      const newCard = table.deck.pop()!;
      table.dealerHand.push(newCard);
      dealerMsg += `🎴 Dealer pide: ${newCard.emoji}\n`;
    }

    const dealerValue = calculateHandValue(table.dealerHand);
    dealerMsg += `\n${formatHand(table.dealerHand)}\n`;
    dealerMsg += `*Valor final: ${dealerValue}*`;

    if (dealerValue > 21) {
      dealerMsg += ` 💥 *BUST!*`;
    }

    await ctx.conn.sendMessage(groupId, { text: dealerMsg });
  }

  // Pequeña pausa antes de resultados
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Calcular resultados
  await calculateResults(groupId, ctx);
}

/**
 * Calcula y muestra los resultados
 */
async function calculateResults(groupId: string, ctx: MessageContext) {
  const table = activeTables.get(groupId);
  if (!table) return;

  table.phase = 'finished';
  const db = getDatabase();
  const dealerValue = calculateHandValue(table.dealerHand);
  const dealerBlackjack = isBlackjack(table.dealerHand);
  const dealerBust = dealerValue > 21;

  let resultsMsg = `
╔═══════════════════════════════╗
║     🏆 *RESULTADOS* 🏆        ║
╚═══════════════════════════════╝

🎩 Dealer: ${formatHand(table.dealerHand)} = ${dealerValue}${dealerBust ? ' (BUST)' : ''}

━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;

  for (const [jid, player] of table.players) {
    const user = db.getUser(jid);
    const playerValue = calculateHandValue(player.hand);
    let winnings = 0;
    let result = '';

    if (player.status === 'bust') {
      // Jugador se pasó - pierde
      result = '💔 BUST';
      winnings = 0;
    } else if (player.status === 'blackjack') {
      if (dealerBlackjack) {
        // Ambos blackjack - empate
        result = '🤝 EMPATE (Blackjack)';
        winnings = player.bet;
      } else {
        // Blackjack paga 3:2
        result = '🎉 BLACKJACK!';
        winnings = Math.floor(player.bet * 2.5);
      }
    } else if (dealerBust) {
      // Dealer se pasó - gana
      result = '✅ GANASTE';
      winnings = player.bet * 2;
    } else if (playerValue > dealerValue) {
      // Jugador tiene más - gana
      result = '✅ GANASTE';
      winnings = player.bet * 2;
    } else if (playerValue === dealerValue) {
      // Empate
      result = '🤝 EMPATE';
      winnings = player.bet;
    } else {
      // Dealer tiene más - pierde
      result = '❌ PERDISTE';
      winnings = 0;
    }

    // Actualizar dinero
    const newBalance = user.money + winnings;
    db.updateUser(jid, { money: newBalance });

    resultsMsg += `\n🎰 *${player.name}*\n`;
    resultsMsg += `${formatHand(player.hand)} = ${playerValue}\n`;
    resultsMsg += `${result}\n`;

    if (winnings > player.bet) {
      resultsMsg += `💰 +${(winnings - player.bet).toLocaleString()} monedas\n`;
    } else if (winnings === player.bet) {
      resultsMsg += `💰 Apuesta devuelta\n`;
    } else {
      resultsMsg += `💸 -${player.bet.toLocaleString()} monedas\n`;
    }
    resultsMsg += `📊 Balance: ${newBalance.toLocaleString()}\n`;
  }

  resultsMsg += `
━━━━━━━━━━━━━━━━━━━━━━━━━━━

📝 Usa *.blackjack <apuesta>* para nueva partida`;

  await ctx.conn.sendMessage(groupId, { text: resultsMsg });

  // Limpiar mesa
  cleanupTable(groupId);
}

/**
 * Comando /pedir - Tomar otra carta
 */
export const pedirPlugin: PluginHandler = {
  command: ['pedir', 'hit', 'carta'],
  description: 'Pedir otra carta en Blackjack',
  category: 'game',
  group: true,
  register: true,

  async handler(ctx: MessageContext) {
    const { m } = ctx;
    const groupId = m.chat;

    const table = activeTables.get(groupId);
    if (!table || table.phase !== 'playing') {
      await m.reply('🃏 No hay ninguna partida activa.');
      return;
    }

    const player = table.players.get(m.sender);
    if (!player) {
      await m.reply('🃏 No estás en esta partida.');
      return;
    }

    // Verificar si es su turno
    const currentJid = table.playerOrder[table.currentPlayerIndex];
    if (currentJid !== m.sender) {
      await m.reply('🃏 No es tu turno!');
      return;
    }

    if (player.status !== 'playing') {
      await m.reply('🃏 Ya no puedes pedir más cartas.');
      return;
    }

    // Limpiar timeout
    if (table.turnTimeout) {
      clearTimeout(table.turnTimeout);
      table.turnTimeout = null;
    }

    // Dar carta
    const newCard = table.deck.pop()!;
    player.hand.push(newCard);
    const newValue = calculateHandValue(player.hand);

    let msg = `🎴 *${player.name}* pide carta\n\n`;
    msg += `Nueva carta: ${newCard.emoji}\n`;
    msg += `${formatHand(player.hand)}\n`;
    msg += `Valor: ${newValue}`;

    if (newValue > 21) {
      player.status = 'bust';
      msg += ` 💥 *BUST!*`;
      await ctx.conn.sendMessage(groupId, { text: msg });

      table.currentPlayerIndex++;
      await processNextPlayer(groupId, ctx);
    } else if (newValue === 21) {
      player.status = 'stand';
      msg += ` 🎯 *21!*`;
      await ctx.conn.sendMessage(groupId, { text: msg });

      table.currentPlayerIndex++;
      await processNextPlayer(groupId, ctx);
    } else {
      msg += `\n\n📝 *.pedir* o *.plantarse*`;
      await ctx.conn.sendMessage(groupId, { text: msg });

      // Nuevo timeout
      table.turnTimeout = setTimeout(async () => {
        const currentTable = activeTables.get(groupId);
        if (!currentTable) return;

        const timeoutPlayer = currentTable.players.get(m.sender);
        if (timeoutPlayer && timeoutPlayer.status === 'playing') {
          timeoutPlayer.status = 'stand';
          await ctx.conn.sendMessage(groupId, { text: `⏰ *${timeoutPlayer.name}* se plantó automáticamente.` });
          currentTable.currentPlayerIndex++;
          await processNextPlayer(groupId, ctx);
        }
      }, TURN_TIME);
    }
  }
};

/**
 * Comando /plantarse - Quedarse con la mano actual
 */
export const plantarsePlugin: PluginHandler = {
  command: ['plantarse', 'stand', 'quedar', 'pasar'],
  description: 'Plantarse en Blackjack',
  category: 'game',
  group: true,
  register: true,

  async handler(ctx: MessageContext) {
    const { m } = ctx;
    const groupId = m.chat;

    const table = activeTables.get(groupId);
    if (!table || table.phase !== 'playing') {
      await m.reply('🃏 No hay ninguna partida activa.');
      return;
    }

    const player = table.players.get(m.sender);
    if (!player) {
      await m.reply('🃏 No estás en esta partida.');
      return;
    }

    const currentJid = table.playerOrder[table.currentPlayerIndex];
    if (currentJid !== m.sender) {
      await m.reply('🃏 No es tu turno!');
      return;
    }

    if (player.status !== 'playing') {
      await m.reply('🃏 Ya terminaste tu turno.');
      return;
    }

    // Limpiar timeout
    if (table.turnTimeout) {
      clearTimeout(table.turnTimeout);
      table.turnTimeout = null;
    }

    player.status = 'stand';
    const value = calculateHandValue(player.hand);

    await ctx.conn.sendMessage(groupId, {
      text: `🛑 *${player.name}* se planta con ${value}`
    });

    table.currentPlayerIndex++;
    await processNextPlayer(groupId, ctx);
  }
};

/**
 * Comando /doblar - Doblar la apuesta
 */
export const doblarPlugin: PluginHandler = {
  command: ['doblar', 'double', 'dd'],
  description: 'Doblar apuesta en Blackjack',
  category: 'game',
  group: true,
  register: true,

  async handler(ctx: MessageContext) {
    const { m } = ctx;
    const groupId = m.chat;
    const db = getDatabase();

    const table = activeTables.get(groupId);
    if (!table || table.phase !== 'playing') {
      await m.reply('🃏 No hay ninguna partida activa.');
      return;
    }

    const player = table.players.get(m.sender);
    if (!player) {
      await m.reply('🃏 No estás en esta partida.');
      return;
    }

    const currentJid = table.playerOrder[table.currentPlayerIndex];
    if (currentJid !== m.sender) {
      await m.reply('🃏 No es tu turno!');
      return;
    }

    if (player.status !== 'playing') {
      await m.reply('🃏 Ya terminaste tu turno.');
      return;
    }

    // Solo se puede doblar en la primera jugada (2 cartas)
    if (player.hand.length !== 2) {
      await m.reply('🃏 Solo puedes doblar con tus dos cartas iniciales.');
      return;
    }

    if (player.doubled) {
      await m.reply('🃏 Ya doblaste esta mano.');
      return;
    }

    // Verificar dinero
    const user = db.getUser(m.sender);
    if (user.money < player.bet) {
      await m.reply(`❌ No tienes suficiente dinero para doblar.\n\n💰 Tu balance: ${user.money.toLocaleString()}\n🎲 Necesitas: ${player.bet.toLocaleString()}`);
      return;
    }

    // Limpiar timeout
    if (table.turnTimeout) {
      clearTimeout(table.turnTimeout);
      table.turnTimeout = null;
    }

    // Doblar apuesta
    db.updateUser(m.sender, { money: user.money - player.bet });
    player.bet *= 2;
    player.doubled = true;

    // Dar una carta y terminar turno
    const newCard = table.deck.pop()!;
    player.hand.push(newCard);
    const newValue = calculateHandValue(player.hand);

    let msg = `💰 *${player.name}* DOBLA!\n\n`;
    msg += `Apuesta: ${player.bet.toLocaleString()} monedas\n`;
    msg += `Nueva carta: ${newCard.emoji}\n`;
    msg += `${formatHand(player.hand)}\n`;
    msg += `Valor: ${newValue}`;

    if (newValue > 21) {
      player.status = 'bust';
      msg += ` 💥 *BUST!*`;
    } else {
      player.status = 'stand';
    }

    await ctx.conn.sendMessage(groupId, { text: msg });

    table.currentPlayerIndex++;
    await processNextPlayer(groupId, ctx);
  }
};

/**
 * Comando /bjmesa - Ver estado de la mesa
 */
export const bjMesaPlugin: PluginHandler = {
  command: ['bjmesa', 'vermesa', 'bjstatus'],
  description: 'Ver estado de la mesa de Blackjack',
  category: 'game',
  group: true,

  async handler(ctx: MessageContext) {
    const { m } = ctx;
    const groupId = m.chat;

    const table = activeTables.get(groupId);
    if (!table) {
      await m.reply('🃏 No hay ninguna mesa activa.');
      return;
    }

    let msg = `
🃏 *ESTADO DE LA MESA*
━━━━━━━━━━━━━━━━━━━━━━━━
`;

    if (table.phase === 'joining') {
      const timeLeft = Math.ceil((JOIN_TIME - (Date.now() - table.startTime)) / 1000);
      msg += `📊 Fase: Esperando jugadores\n`;
      msg += `⏰ Tiempo: ${timeLeft}s\n\n`;
      msg += `👥 *Jugadores (${table.players.size}/7):*\n`;
      for (const [, player] of table.players) {
        msg += `• ${player.name} - ${player.bet.toLocaleString()}\n`;
      }
    } else {
      msg += `📊 Fase: ${table.phase}\n\n`;
      msg += `🎩 *Dealer:*\n`;
      msg += table.phase === 'playing' ? formatHand(table.dealerHand, true) : formatHand(table.dealerHand);
      msg += `\n\n👥 *Jugadores:*\n`;

      for (const [, player] of table.players) {
        const isCurrent = table.playerOrder[table.currentPlayerIndex] === player.jid;
        msg += `\n${isCurrent ? '➡️ ' : ''}*${player.name}* (${player.status})\n`;
        msg += `${formatHand(player.hand)} = ${calculateHandValue(player.hand)}\n`;
        msg += `💰 Apuesta: ${player.bet.toLocaleString()}\n`;
      }
    }

    await m.reply(msg);
  }
};

/**
 * Comando /bjsalir - Salirse de la mesa (solo en fase de espera)
 */
export const bjSalirPlugin: PluginHandler = {
  command: ['bjsalir', 'salirmesa', 'bjleave'],
  description: 'Salir de la mesa de Blackjack',
  category: 'game',
  group: true,

  async handler(ctx: MessageContext) {
    const { m } = ctx;
    const groupId = m.chat;
    const db = getDatabase();

    const table = activeTables.get(groupId);
    if (!table) {
      await m.reply('🃏 No hay ninguna mesa activa.');
      return;
    }

    const player = table.players.get(m.sender);
    if (!player) {
      await m.reply('🃏 No estás en esta mesa.');
      return;
    }

    if (table.phase !== 'joining') {
      await m.reply('🃏 No puedes salir una vez iniciada la partida.');
      return;
    }

    // Devolver apuesta
    const user = db.getUser(m.sender);
    db.updateUser(m.sender, { money: user.money + player.bet });

    // Remover de la mesa
    table.players.delete(m.sender);
    table.playerOrder = table.playerOrder.filter(jid => jid !== m.sender);

    await m.reply(`🃏 *${player.name}* salió de la mesa.\n💰 Apuesta devuelta: ${player.bet.toLocaleString()} monedas`);

    // Si no quedan jugadores, cerrar mesa
    if (table.players.size === 0) {
      cleanupTable(groupId);
      await ctx.conn.sendMessage(groupId, { text: '🃏 Mesa cerrada por falta de jugadores.' });
    }
  }
};

/**
 * Comando /bjinfo - Información del blackjack
 */
export const bjInfoPlugin: PluginHandler = {
  command: ['bjinfo', 'blackjackinfo', 'bjayuda'],
  description: 'Información sobre el Blackjack',
  category: 'game',

  async handler(ctx: MessageContext) {
    const { m } = ctx;

    const info = `
🃏 *BLACKJACK - CÓMO JUGAR*
━━━━━━━━━━━━━━━━━━━━━━━━━━━

📋 *Objetivo:*
Conseguir 21 puntos o acercarte más
que el dealer sin pasarte.

🎴 *Valores de cartas:*
• 2-10: Valor nominal
• J, Q, K: 10 puntos
• A: 1 u 11 puntos

📝 *Comandos:*
• *.blackjack <apuesta>* - Abrir mesa
• *.jugar <apuesta>* - Unirse a mesa
• *.pedir* - Tomar otra carta
• *.plantarse* - Quedarse
• *.doblar* - Doblar apuesta (solo inicio)
• *.bjmesa* - Ver estado
• *.bjsalir* - Salir (solo espera)

💰 *Pagos:*
• Blackjack: 3:2 (x2.5)
• Victoria: 1:1 (x2)
• Empate: Apuesta devuelta

⏰ *Tiempos:*
• 30 seg para unirse
• 45 seg por turno

📊 *Límites:*
• Mínimo: 50 monedas
• Máximo mesa: 50,000
• Máximo apuesta: x10 del mínimo
• Jugadores: 1-7
`;

    await m.reply(info);
  }
};
