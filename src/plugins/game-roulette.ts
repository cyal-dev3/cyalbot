/**
 * Plugin de Ruleta Multiplayer
 * Comando: /ruleta, /apostar, /ruletamesa, /ruletainfo
 */

import type { PluginHandler, MessageContext } from '../types/message.js';
import { getDatabase } from '../lib/database.js';

// ============================================
// 🎯 SISTEMA DE RULETA
// ============================================

// Definir los números de la ruleta europea (0-36)
const ROULETTE_NUMBERS = Array.from({ length: 37 }, (_, i) => i);

// Colores de cada número
const RED_NUMBERS = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
const BLACK_NUMBERS = [2, 4, 6, 8, 10, 11, 13, 15, 17, 20, 22, 24, 26, 28, 29, 31, 33, 35];

// Tipos de apuesta disponibles
type BetType =
  | 'numero'      // Apuesta a un número específico (35:1)
  | 'rojo'        // Apuesta a rojo (1:1)
  | 'negro'       // Apuesta a negro (1:1)
  | 'par'         // Apuesta a par (1:1)
  | 'impar'       // Apuesta a impar (1:1)
  | 'bajo'        // 1-18 (1:1)
  | 'alto'        // 19-36 (1:1)
  | 'docena1'     // 1-12 (2:1)
  | 'docena2'     // 13-24 (2:1)
  | 'docena3'     // 25-36 (2:1)
  | 'columna1'    // 1,4,7,10... (2:1)
  | 'columna2'    // 2,5,8,11... (2:1)
  | 'columna3';   // 3,6,9,12... (2:1)

interface RouletteBet {
  type: BetType;
  amount: number;
  specificNumber?: number; // Para apuestas a número específico
}

interface RoulettePlayer {
  jid: string;
  name: string;
  bets: RouletteBet[];
  totalBet: number;
}

interface RouletteTable {
  groupId: string;
  creatorJid: string;
  players: Map<string, RoulettePlayer>;
  phase: 'betting' | 'spinning' | 'finished';
  minBet: number;
  maxBet: number;
  startTime: number;
  bettingTimeout: NodeJS.Timeout | null;
  result?: number;
}

// Almacén de mesas activas por grupo
const activeTables: Map<string, RouletteTable> = new Map();

// Tiempo para apostar (45 segundos)
const BETTING_TIME = 45000;

// ============================================
// 📊 UTILIDADES
// ============================================

/**
 * Obtiene el color de un número
 */
function getNumberColor(num: number): 'verde' | 'rojo' | 'negro' {
  if (num === 0) return 'verde';
  if (RED_NUMBERS.includes(num)) return 'rojo';
  return 'negro';
}

/**
 * Obtiene el emoji del color
 */
function getColorEmoji(num: number): string {
  const color = getNumberColor(num);
  if (color === 'verde') return '🟢';
  if (color === 'rojo') return '🔴';
  return '⚫';
}

/**
 * Obtiene el nombre corto de un jugador
 */
function getShortName(jid: string): string {
  const db = getDatabase();
  const user = db.getUser(jid);
  if (user.name) return user.name;
  const num = jid.split('@')[0];
  return num.slice(-4);
}

/**
 * Limpia una mesa
 */
function cleanupTable(groupId: string) {
  const table = activeTables.get(groupId);
  if (table) {
    if (table.bettingTimeout) clearTimeout(table.bettingTimeout);
    activeTables.delete(groupId);
  }
}

/**
 * Genera un número aleatorio de ruleta con múltiples fuentes de aleatoriedad
 */
function spinRoulette(): number {
  // Múltiples capas de aleatoriedad
  const seed1 = Math.random();
  const seed2 = Date.now() % 1000;
  const seed3 = Math.random();

  // Combinar semillas
  const combined = ((seed1 * 1000) + seed2 + (seed3 * 1000)) % 37;

  // Añadir más aleatoriedad con múltiples "giros"
  let result = Math.floor(combined);
  for (let i = 0; i < 7; i++) {
    result = (result + Math.floor(Math.random() * 37)) % 37;
  }

  return result;
}

/**
 * Calcula el multiplicador de una apuesta
 */
function getBetMultiplier(type: BetType): number {
  switch (type) {
    case 'numero':
      return 36; // Paga 35:1 + apuesta original
    case 'rojo':
    case 'negro':
    case 'par':
    case 'impar':
    case 'bajo':
    case 'alto':
      return 2; // Paga 1:1 + apuesta original
    case 'docena1':
    case 'docena2':
    case 'docena3':
    case 'columna1':
    case 'columna2':
    case 'columna3':
      return 3; // Paga 2:1 + apuesta original
    default:
      return 0;
  }
}

/**
 * Verifica si una apuesta ganó
 */
function checkBetWin(bet: RouletteBet, result: number): boolean {
  if (result === 0 && bet.type !== 'numero') {
    return false; // El 0 pierde en todas las apuestas excepto número directo
  }

  switch (bet.type) {
    case 'numero':
      return bet.specificNumber === result;
    case 'rojo':
      return RED_NUMBERS.includes(result);
    case 'negro':
      return BLACK_NUMBERS.includes(result);
    case 'par':
      return result !== 0 && result % 2 === 0;
    case 'impar':
      return result % 2 === 1;
    case 'bajo':
      return result >= 1 && result <= 18;
    case 'alto':
      return result >= 19 && result <= 36;
    case 'docena1':
      return result >= 1 && result <= 12;
    case 'docena2':
      return result >= 13 && result <= 24;
    case 'docena3':
      return result >= 25 && result <= 36;
    case 'columna1':
      return result > 0 && result % 3 === 1;
    case 'columna2':
      return result > 0 && result % 3 === 2;
    case 'columna3':
      return result > 0 && result % 3 === 0;
    default:
      return false;
  }
}

/**
 * Parsea el tipo de apuesta del texto
 */
function parseBetType(text: string): { type: BetType; number?: number } | null {
  const lowerText = text.toLowerCase().trim();

  // Número específico
  const numMatch = lowerText.match(/^(\d+)$/);
  if (numMatch) {
    const num = parseInt(numMatch[1]);
    if (num >= 0 && num <= 36) {
      return { type: 'numero', number: num };
    }
    return null;
  }

  // Colores
  if (['rojo', 'red', 'r'].includes(lowerText)) return { type: 'rojo' };
  if (['negro', 'black', 'n'].includes(lowerText)) return { type: 'negro' };

  // Par/Impar
  if (['par', 'even'].includes(lowerText)) return { type: 'par' };
  if (['impar', 'odd'].includes(lowerText)) return { type: 'impar' };

  // Alto/Bajo
  if (['bajo', 'low', '1-18'].includes(lowerText)) return { type: 'bajo' };
  if (['alto', 'high', '19-36'].includes(lowerText)) return { type: 'alto' };

  // Docenas
  if (['docena1', 'd1', '1d', 'primera', '1-12'].includes(lowerText)) return { type: 'docena1' };
  if (['docena2', 'd2', '2d', 'segunda', '13-24'].includes(lowerText)) return { type: 'docena2' };
  if (['docena3', 'd3', '3d', 'tercera', '25-36'].includes(lowerText)) return { type: 'docena3' };

  // Columnas
  if (['columna1', 'c1', '1c', 'col1'].includes(lowerText)) return { type: 'columna1' };
  if (['columna2', 'c2', '2c', 'col2'].includes(lowerText)) return { type: 'columna2' };
  if (['columna3', 'c3', '3c', 'col3'].includes(lowerText)) return { type: 'columna3' };

  return null;
}

/**
 * Formatea el nombre de la apuesta
 */
function formatBetName(bet: RouletteBet): string {
  switch (bet.type) {
    case 'numero':
      return `${getColorEmoji(bet.specificNumber!)} ${bet.specificNumber}`;
    case 'rojo':
      return '🔴 Rojo';
    case 'negro':
      return '⚫ Negro';
    case 'par':
      return '2️⃣ Par';
    case 'impar':
      return '1️⃣ Impar';
    case 'bajo':
      return '⬇️ Bajo (1-18)';
    case 'alto':
      return '⬆️ Alto (19-36)';
    case 'docena1':
      return '1️⃣ Docena (1-12)';
    case 'docena2':
      return '2️⃣ Docena (13-24)';
    case 'docena3':
      return '3️⃣ Docena (25-36)';
    case 'columna1':
      return '📊 Col 1';
    case 'columna2':
      return '📊 Col 2';
    case 'columna3':
      return '📊 Col 3';
    default:
      return 'Desconocida';
  }
}

// ============================================
// 🎮 COMANDOS
// ============================================

/**
 * Comando /ruleta - Abrir una nueva mesa de ruleta
 */
export const ruletaPlugin: PluginHandler = {
  command: ['ruleta', 'roulette', 'ruletamesa'],
  description: 'Abrir una mesa de Ruleta',
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
      if (table.phase === 'betting') {
        await m.reply(`🎰 *Ya hay una ruleta abierta!*\n\nUsa .apostar <tipo> <cantidad>\n⏰ Tiempo restante: ${Math.ceil((BETTING_TIME - (Date.now() - table.startTime)) / 1000)}s`);
      } else {
        await m.reply('🎰 La ruleta está girando. Espera al resultado.');
      }
      return;
    }

    // Obtener apuesta mínima
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
    const table: RouletteTable = {
      groupId,
      creatorJid: m.sender,
      players: new Map(),
      phase: 'betting',
      minBet,
      maxBet: minBet * 20,
      startTime: Date.now(),
      bettingTimeout: null
    };

    activeTables.set(groupId, table);

    // Mensaje de apertura
    const openMsg = `
╔═══════════════════════════════╗
║      🎰 *RULETA* 🎰           ║
╠═══════════════════════════════╣
║   La mesa esta abierta!       ║
╠═══════════════════════════════╣
║ 💰 Apuesta min: ${minBet.toLocaleString().padEnd(13)}║
║ 💎 Apuesta max: ${table.maxBet.toLocaleString().padEnd(13)}║
║ ⏰ Tiempo: 45 segundos         ║
╠═══════════════════════════════╣
║ 📝 Usa *.apostar <tipo> <$>*  ║
╚═══════════════════════════════╝

🎯 *TIPOS DE APUESTA:*
━━━━━━━━━━━━━━━━━━━━━━━

📍 *Número directo (35:1)*
   .apostar 7 500

🔴⚫ *Color (1:1)*
   .apostar rojo 500
   .apostar negro 500

🔢 *Par/Impar (1:1)*
   .apostar par 500
   .apostar impar 500

⬆️⬇️ *Alto/Bajo (1:1)*
   .apostar bajo 500  _(1-18)_
   .apostar alto 500  _(19-36)_

📊 *Docenas (2:1)*
   .apostar docena1 500  _(1-12)_
   .apostar docena2 500  _(13-24)_
   .apostar docena3 500  _(25-36)_

📈 *Columnas (2:1)*
   .apostar columna1 500
   .apostar columna2 500
   .apostar columna3 500

━━━━━━━━━━━━━━━━━━━━━━━
⏰ La ruleta girará en 45 segundos...
`;

    await conn.sendMessage(groupId, { text: openMsg });

    // Temporizador para girar la ruleta
    table.bettingTimeout = setTimeout(async () => {
      const currentTable = activeTables.get(groupId);
      if (!currentTable || currentTable.phase !== 'betting') return;

      if (currentTable.players.size < 1) {
        cleanupTable(groupId);
        await conn.sendMessage(groupId, { text: '🎰 Ruleta cerrada. Nadie apostó.' });
        return;
      }

      // Girar la ruleta
      await spinRouletteTable(groupId, ctx);
    }, BETTING_TIME);
  }
};

/**
 * Comando /apostar - Realizar una apuesta
 */
export const apostarPlugin: PluginHandler = {
  command: ['apostar', 'bet', 'ap'],
  description: 'Apostar en la ruleta',
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
      await m.reply('🎰 No hay ninguna ruleta abierta.\n\nUsa *.ruleta <apuesta_min>* para abrir una.');
      return;
    }

    if (table.phase !== 'betting') {
      await m.reply('🎰 La ruleta ya está girando. Espera al resultado.');
      return;
    }

    // Parsear el texto: tipo cantidad
    const args = text.trim().split(/\s+/);
    if (args.length < 2) {
      await m.reply(`❌ Formato: .apostar <tipo> <cantidad>\n\nEjemplo: .apostar rojo 500\n\nUsa .ruletainfo para ver tipos de apuesta.`);
      return;
    }

    const betTypeText = args[0];
    const betAmount = parseInt(args[1]);

    if (isNaN(betAmount) || betAmount <= 0) {
      await m.reply('❌ La cantidad debe ser un número positivo.');
      return;
    }

    // Parsear tipo de apuesta
    const parsedBet = parseBetType(betTypeText);
    if (!parsedBet) {
      await m.reply(`❌ Tipo de apuesta inválido: "${betTypeText}"\n\nUsa .ruletainfo para ver tipos válidos.`);
      return;
    }

    // Verificar límites
    if (betAmount < table.minBet) {
      await m.reply(`❌ La apuesta mínima es ${table.minBet.toLocaleString()} monedas.`);
      return;
    }

    if (betAmount > table.maxBet) {
      await m.reply(`❌ La apuesta máxima es ${table.maxBet.toLocaleString()} monedas.`);
      return;
    }

    // Verificar dinero disponible
    let player = table.players.get(m.sender);
    const currentTotalBet = player?.totalBet || 0;

    if (user.money < betAmount) {
      await m.reply(`❌ No tienes suficiente dinero.\n\n💰 Tu balance: ${user.money.toLocaleString()} monedas`);
      return;
    }

    // Límite de apuestas por jugador
    if (player && player.bets.length >= 10) {
      await m.reply('❌ Máximo 10 apuestas por ronda.');
      return;
    }

    // Crear apuesta
    const newBet: RouletteBet = {
      type: parsedBet.type,
      amount: betAmount,
      specificNumber: parsedBet.number
    };

    // Agregar o actualizar jugador
    if (!player) {
      player = {
        jid: m.sender,
        name: getShortName(m.sender),
        bets: [],
        totalBet: 0
      };
      table.players.set(m.sender, player);
    }

    player.bets.push(newBet);
    player.totalBet += betAmount;

    // Descontar dinero
    db.updateUser(m.sender, { money: user.money - betAmount });

    // Calcular posible ganancia
    const multiplier = getBetMultiplier(newBet.type);
    const potentialWin = betAmount * multiplier;

    // Mensaje de confirmación
    let confirmMsg = `✅ *Apuesta registrada!*\n\n`;
    confirmMsg += `👤 ${player.name}\n`;
    confirmMsg += `🎯 ${formatBetName(newBet)}\n`;
    confirmMsg += `💰 Apostado: ${betAmount.toLocaleString()}\n`;
    confirmMsg += `💎 Posible ganancia: ${potentialWin.toLocaleString()}\n`;
    confirmMsg += `📊 Total apostado: ${player.totalBet.toLocaleString()}\n\n`;

    const timeLeft = Math.ceil((BETTING_TIME - (Date.now() - table.startTime)) / 1000);
    confirmMsg += `⏰ Tiempo restante: ${timeLeft}s`;

    await m.reply(confirmMsg);
  }
};

/**
 * Gira la ruleta y calcula resultados
 */
async function spinRouletteTable(groupId: string, ctx: MessageContext) {
  const table = activeTables.get(groupId);
  if (!table) return;

  table.phase = 'spinning';

  // Mensaje de inicio de giro
  let spinMsg = `
🎰 *LA RULETA ESTÁ GIRANDO...*
━━━━━━━━━━━━━━━━━━━━━━━━━━━

`;

  // Mostrar jugadores y sus apuestas
  spinMsg += `👥 *JUGADORES:*\n`;
  for (const [, player] of table.players) {
    spinMsg += `\n🎲 *${player.name}* (${player.totalBet.toLocaleString()} monedas)\n`;
    for (const bet of player.bets) {
      spinMsg += `   • ${formatBetName(bet)} - ${bet.amount.toLocaleString()}\n`;
    }
  }

  await ctx.conn.sendMessage(groupId, { text: spinMsg });

  // Animación de giro (simulada con pausa)
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Generar resultado
  const result = spinRoulette();
  table.result = result;

  // Mensaje de animación
  const spinAnimation = [
    '🎰 Girando... 🔄',
    '🎰 La bola rueda... 🔄🔄',
    '🎰 Casi ahí... 🔄🔄🔄',
  ];

  for (const anim of spinAnimation) {
    await ctx.conn.sendMessage(groupId, { text: anim });
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Resultado final
  const colorEmoji = getColorEmoji(result);
  const colorName = getNumberColor(result);
  const isEven = result !== 0 && result % 2 === 0;
  const isLow = result >= 1 && result <= 18;

  let resultMsg = `
╔═══════════════════════════════╗
║     🎰 *RESULTADO* 🎰         ║
╚═══════════════════════════════╝

        ${colorEmoji} *${result}* ${colorEmoji}

━━━━━━━━━━━━━━━━━━━━━━━━━━━

📍 Número: ${result}
🎨 Color: ${colorName === 'verde' ? '🟢 Verde' : colorName === 'rojo' ? '🔴 Rojo' : '⚫ Negro'}
${result !== 0 ? `🔢 ${isEven ? 'Par' : 'Impar'}` : ''}
${result !== 0 ? `📊 ${isLow ? 'Bajo (1-18)' : 'Alto (19-36)'}` : ''}
${result !== 0 ? `📈 Docena ${result <= 12 ? '1' : result <= 24 ? '2' : '3'}` : ''}
${result !== 0 ? `📊 Columna ${result % 3 === 1 ? '1' : result % 3 === 2 ? '2' : '3'}` : ''}

━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;

  await ctx.conn.sendMessage(groupId, { text: resultMsg });

  // Pequeña pausa antes de resultados
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Calcular ganancias
  await calculateRouletteResults(groupId, ctx);
}

/**
 * Calcula y muestra los resultados de cada jugador
 */
async function calculateRouletteResults(groupId: string, ctx: MessageContext) {
  const table = activeTables.get(groupId);
  if (!table || table.result === undefined) return;

  table.phase = 'finished';
  const db = getDatabase();
  const result = table.result;

  let resultsMsg = `
╔═══════════════════════════════╗
║     🏆 *GANANCIAS* 🏆         ║
╚═══════════════════════════════╝

`;

  let totalPaidOut = 0;
  let totalLost = 0;

  for (const [jid, player] of table.players) {
    const user = db.getUser(jid);
    let playerWinnings = 0;
    let winningBets: string[] = [];
    let losingBets: string[] = [];

    // Evaluar cada apuesta
    for (const bet of player.bets) {
      const won = checkBetWin(bet, result);
      if (won) {
        const multiplier = getBetMultiplier(bet.type);
        const winAmount = bet.amount * multiplier;
        playerWinnings += winAmount;
        winningBets.push(`✅ ${formatBetName(bet)} +${winAmount.toLocaleString()}`);
      } else {
        losingBets.push(`❌ ${formatBetName(bet)} -${bet.amount.toLocaleString()}`);
      }
    }

    // Actualizar balance del jugador
    const newBalance = user.money + playerWinnings;
    db.updateUser(jid, { money: newBalance });

    const netProfit = playerWinnings - player.totalBet;

    resultsMsg += `\n🎲 *${player.name}*\n`;

    if (winningBets.length > 0) {
      resultsMsg += winningBets.join('\n') + '\n';
    }
    if (losingBets.length > 0) {
      resultsMsg += losingBets.join('\n') + '\n';
    }

    if (netProfit > 0) {
      resultsMsg += `💰 *Ganancia neta: +${netProfit.toLocaleString()}*\n`;
      totalPaidOut += playerWinnings;
    } else if (netProfit < 0) {
      resultsMsg += `💸 *Pérdida: ${netProfit.toLocaleString()}*\n`;
      totalLost += Math.abs(netProfit);
    } else {
      resultsMsg += `🤝 *Sin cambios*\n`;
    }

    resultsMsg += `📊 Balance: ${newBalance.toLocaleString()}\n`;
  }

  resultsMsg += `
━━━━━━━━━━━━━━━━━━━━━━━━━━━

📝 Usa *.ruleta <apuesta>* para nueva partida
`;

  await ctx.conn.sendMessage(groupId, { text: resultsMsg });

  // Limpiar mesa
  cleanupTable(groupId);
}

/**
 * Comando /ruletamesa - Ver estado de la mesa
 */
export const ruletaMesaPlugin: PluginHandler = {
  command: ['vermesa', 'ruletastatus', 'mesaruleta'],
  description: 'Ver estado de la mesa de Ruleta',
  category: 'game',
  group: true,

  async handler(ctx: MessageContext) {
    const { m } = ctx;
    const groupId = m.chat;

    const table = activeTables.get(groupId);
    if (!table) {
      await m.reply('🎰 No hay ninguna ruleta activa.');
      return;
    }

    let msg = `
🎰 *ESTADO DE LA RULETA*
━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;

    if (table.phase === 'betting') {
      const timeLeft = Math.ceil((BETTING_TIME - (Date.now() - table.startTime)) / 1000);
      msg += `📊 Fase: Aceptando apuestas\n`;
      msg += `⏰ Tiempo: ${timeLeft}s\n`;
      msg += `💰 Apuesta min: ${table.minBet.toLocaleString()}\n`;
      msg += `💎 Apuesta max: ${table.maxBet.toLocaleString()}\n\n`;

      if (table.players.size > 0) {
        msg += `👥 *JUGADORES:*\n`;
        for (const [, player] of table.players) {
          msg += `\n🎲 *${player.name}* (${player.totalBet.toLocaleString()})\n`;
          for (const bet of player.bets) {
            msg += `   • ${formatBetName(bet)} - ${bet.amount.toLocaleString()}\n`;
          }
        }
      } else {
        msg += `_Nadie ha apostado aún..._\n`;
      }
    } else if (table.phase === 'spinning') {
      msg += `📊 Fase: ¡Girando!\n`;
      msg += `🎰 Espera el resultado...\n`;
    }

    await m.reply(msg);
  }
};

/**
 * Comando /ruletasalir - Salir de la ruleta (devolver apuestas)
 */
export const ruletaSalirPlugin: PluginHandler = {
  command: ['ruletasalir', 'rsalir', 'cancelarapuesta'],
  description: 'Cancelar tus apuestas de la ruleta',
  category: 'game',
  group: true,

  async handler(ctx: MessageContext) {
    const { m } = ctx;
    const groupId = m.chat;
    const db = getDatabase();

    const table = activeTables.get(groupId);
    if (!table) {
      await m.reply('🎰 No hay ninguna ruleta activa.');
      return;
    }

    const player = table.players.get(m.sender);
    if (!player) {
      await m.reply('🎰 No tienes apuestas en esta ruleta.');
      return;
    }

    if (table.phase !== 'betting') {
      await m.reply('🎰 No puedes salir, la ruleta ya está girando.');
      return;
    }

    // Devolver apuestas
    const user = db.getUser(m.sender);
    db.updateUser(m.sender, { money: user.money + player.totalBet });

    // Remover jugador
    table.players.delete(m.sender);

    await m.reply(`🎰 *${player.name}* canceló sus apuestas.\n💰 Devuelto: ${player.totalBet.toLocaleString()} monedas`);
  }
};

/**
 * Comando /ruletainfo - Información de la ruleta
 */
export const ruletaInfoPlugin: PluginHandler = {
  command: ['ruletainfo', 'rouletteinfo', 'ruletaayuda'],
  description: 'Información sobre la Ruleta',
  category: 'game',

  async handler(ctx: MessageContext) {
    const { m } = ctx;

    const info = `
🎰 *RULETA - CÓMO JUGAR*
━━━━━━━━━━━━━━━━━━━━━━━━━━━

📋 *Objetivo:*
Adivina dónde caerá la bola
cuando la ruleta deje de girar.

🎯 *TIPOS DE APUESTA:*

📍 *Número directo (35:1)*
   Apuesta a un número específico
   Ejemplo: .apostar 17 500

🔴⚫ *Color (1:1)*
   .apostar rojo 500
   .apostar negro 500

🔢 *Par/Impar (1:1)*
   .apostar par 500
   .apostar impar 500

⬆️⬇️ *Alto/Bajo (1:1)*
   .apostar bajo 500  _(1-18)_
   .apostar alto 500  _(19-36)_

📊 *Docenas (2:1)*
   .apostar docena1 500  _(1-12)_
   .apostar docena2 500  _(13-24)_
   .apostar docena3 500  _(25-36)_

📈 *Columnas (2:1)*
   Col1: 1,4,7,10,13,16,19,22,25,28,31,34
   Col2: 2,5,8,11,14,17,20,23,26,29,32,35
   Col3: 3,6,9,12,15,18,21,24,27,30,33,36

📝 *Comandos:*
• *.ruleta <min>* - Abrir mesa
• *.apostar <tipo> <$>* - Apostar
• *.vermesa* - Ver apuestas
• *.ruletasalir* - Cancelar apuestas

⚠️ *Nota:* El 🟢 0 (cero) hace
perder todas las apuestas excepto
las de número directo al 0.

⏰ *Tiempos:*
• 45 seg para apostar
• Máx 10 apuestas por jugador
`;

    await m.reply(info);
  }
};

/**
 * Comando /girar - Forzar giro inmediato (solo creador)
 */
export const girarPlugin: PluginHandler = {
  command: ['girar', 'spin', 'tirar'],
  description: 'Girar la ruleta inmediatamente',
  category: 'game',
  group: true,

  async handler(ctx: MessageContext) {
    const { m } = ctx;
    const groupId = m.chat;

    const table = activeTables.get(groupId);
    if (!table) {
      await m.reply('🎰 No hay ninguna ruleta activa.');
      return;
    }

    if (table.phase !== 'betting') {
      await m.reply('🎰 La ruleta ya está girando.');
      return;
    }

    // Solo el creador puede forzar el giro
    if (m.sender !== table.creatorJid) {
      await m.reply('🎰 Solo quien abrió la mesa puede forzar el giro.');
      return;
    }

    if (table.players.size < 1) {
      await m.reply('🎰 No hay apuestas todavía.');
      return;
    }

    // Limpiar timeout y girar
    if (table.bettingTimeout) {
      clearTimeout(table.bettingTimeout);
      table.bettingTimeout = null;
    }

    await spinRouletteTable(groupId, ctx);
  }
};
