/**
 * Plugin de Tragamonedas
 * Comando: /slot
 */

import type { PluginHandler, MessageContext } from '../types/message.js';
import { getDatabase } from '../lib/database.js';

// Símbolos del slot con sus multiplicadores
const SLOT_SYMBOLS = [
  { emoji: '🍒', name: 'Cereza', multiplier: 2 },
  { emoji: '🍋', name: 'Limón', multiplier: 3 },
  { emoji: '🍊', name: 'Naranja', multiplier: 4 },
  { emoji: '🍇', name: 'Uvas', multiplier: 5 },
  { emoji: '🔔', name: 'Campana', multiplier: 7 },
  { emoji: '💎', name: 'Diamante', multiplier: 10 },
  { emoji: '7️⃣', name: 'Siete', multiplier: 15 },
  { emoji: '⭐', name: 'Estrella', multiplier: 20 },
];

// Probabilidades (más alto = más común)
const WEIGHTS = [30, 25, 20, 15, 10, 7, 5, 3];

/**
 * Obtiene un símbolo aleatorio basado en probabilidades
 */
function getRandomSymbol(): typeof SLOT_SYMBOLS[0] {
  const totalWeight = WEIGHTS.reduce((a, b) => a + b, 0);
  let random = Math.random() * totalWeight;

  for (let i = 0; i < SLOT_SYMBOLS.length; i++) {
    random -= WEIGHTS[i];
    if (random <= 0) {
      return SLOT_SYMBOLS[i];
    }
  }
  return SLOT_SYMBOLS[0];
}

/**
 * Comando /slot - Jugar a la tragamonedas
 */
export const slotPlugin: PluginHandler = {
  command: ['slot', 'tragamonedas', 'casino'],
  description: 'Jugar a la tragamonedas con tu dinero del RPG',
  category: 'game',
  register: true,

  async handler(ctx: MessageContext) {
    const { m, text } = ctx;
    const db = getDatabase();
    const user = db.getUser(m.sender);

    // Obtener apuesta
    let bet = parseInt(text) || 100;

    // Validaciones
    if (bet < 50) {
      await m.reply('❌ La apuesta mínima es de 50 monedas.');
      return;
    }

    if (bet > 10000) {
      await m.reply('❌ La apuesta máxima es de 10,000 monedas.');
      return;
    }

    if (user.money < bet) {
      await m.reply(`❌ No tienes suficiente dinero.\n\n💰 Tu balance: ${user.money.toLocaleString()} monedas\n🎲 Apuesta: ${bet.toLocaleString()} monedas`);
      return;
    }

    // Generar resultado
    const slot1 = getRandomSymbol();
    const slot2 = getRandomSymbol();
    const slot3 = getRandomSymbol();

    // Calcular ganancias
    let winnings = 0;
    let message = '';

    if (slot1 === slot2 && slot2 === slot3) {
      // ¡JACKPOT! Tres iguales
      winnings = bet * slot1.multiplier;
      message = `🎉 *¡¡¡JACKPOT!!!* 🎉\n\n¡Tres ${slot1.name}s!\nMultiplicador: x${slot1.multiplier}`;
    } else if (slot1 === slot2 || slot2 === slot3 || slot1 === slot3) {
      // Dos iguales
      const matchingSymbol = slot1 === slot2 ? slot1 : (slot2 === slot3 ? slot2 : slot1);
      winnings = Math.floor(bet * (matchingSymbol.multiplier / 3));
      message = `🎊 *¡Dos ${matchingSymbol.name}s!*\n\nMultiplicador: x${(matchingSymbol.multiplier / 3).toFixed(1)}`;
    } else {
      // Perdiste
      winnings = -bet;
      message = '💔 *¡Mejor suerte la próxima!*';
    }

    // Actualizar balance
    const newBalance = user.money + winnings;
    db.updateUser(m.sender, { money: newBalance });

    // Construir animación del slot
    const slotDisplay = `
╔═══════════════╗
║  🎰 *SLOT*  🎰  ║
╠═══════════════╣
║   ${slot1.emoji}  │  ${slot2.emoji}  │  ${slot3.emoji}   ║
╚═══════════════╝`;

    // Construir respuesta
    let response = slotDisplay + '\n\n';
    response += message + '\n\n';

    if (winnings > 0) {
      response += `💵 *Ganaste:* +${winnings.toLocaleString()} monedas\n`;
    } else {
      response += `💸 *Perdiste:* ${Math.abs(winnings).toLocaleString()} monedas\n`;
    }

    response += `💰 *Balance:* ${newBalance.toLocaleString()} monedas\n`;
    response += `\n📝 Usa /slot <cantidad> para apostar`;

    await m.reply(response);
  }
};

/**
 * Comando /slotinfo - Información del slot
 */
export const slotInfoPlugin: PluginHandler = {
  command: ['slotinfo', 'slotayuda'],
  description: 'Ver información sobre la tragamonedas',
  category: 'game',

  async handler(ctx: MessageContext) {
    const { m } = ctx;

    let info = '🎰 *INFORMACIÓN DEL SLOT*\n\n';
    info += '📊 *Multiplicadores:*\n';

    for (const symbol of SLOT_SYMBOLS) {
      info += `${symbol.emoji} ${symbol.name}: x${symbol.multiplier}\n`;
    }

    info += '\n📖 *Reglas:*\n';
    info += '• 3 símbolos iguales = Multiplicador completo\n';
    info += '• 2 símbolos iguales = Multiplicador / 3\n';
    info += '• Sin coincidencias = Pierdes la apuesta\n';
    info += '\n💰 Apuesta: Mínimo 50, Máximo 10,000';

    await m.reply(info);
  }
};
