/**
 * Plugin de Calculadora de Amor
 * Comando: /amor
 */

import type { PluginHandler, MessageContext } from '../types/message.js';

// Mensajes según el porcentaje de compatibilidad
const LOVE_MESSAGES: Array<{ min: number; max: number; emoji: string; message: string }> = [
  { min: 0, max: 10, emoji: '💔', message: '¡Uy! Mejor búscate a alguien más...' },
  { min: 11, max: 20, emoji: '😢', message: 'Esto no pinta bien para ustedes...' },
  { min: 21, max: 30, emoji: '😕', message: 'Hay mejores opciones por ahí...' },
  { min: 31, max: 40, emoji: '🤔', message: 'Podría funcionar... con mucho trabajo.' },
  { min: 41, max: 50, emoji: '😐', message: 'Ni fu ni fa, suerte del 50/50.' },
  { min: 51, max: 60, emoji: '🙂', message: '¡Hay potencial! No está mal.' },
  { min: 61, max: 70, emoji: '😊', message: '¡Buena química! Podrían ser buenos juntos.' },
  { min: 71, max: 80, emoji: '😍', message: '¡Wow! Hacen muy buena pareja.' },
  { min: 81, max: 90, emoji: '💖', message: '¡Casi perfectos! ¡Deberían salir!' },
  { min: 91, max: 99, emoji: '💘', message: '¡INCREÍBLE! ¡Almas gemelas!' },
  { min: 100, max: 100, emoji: '💯', message: '¡¡¡COMPATIBILIDAD PERFECTA!!! ¡El amor verdadero!' },
];

/**
 * Genera un porcentaje "aleatorio" pero consistente basado en los nombres
 */
function calculateLovePercentage(name1: string, name2: string): number {
  // Ordenar nombres para que el resultado sea el mismo independiente del orden
  const sorted = [name1.toLowerCase(), name2.toLowerCase()].sort();
  const combined = sorted.join('');

  // Generar hash simple
  let hash = 0;
  for (let i = 0; i < combined.length; i++) {
    const char = combined.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }

  // Convertir a porcentaje (0-100)
  return Math.abs(hash % 101);
}

/**
 * Obtiene el mensaje correspondiente al porcentaje
 */
function getLoveMessage(percentage: number): { emoji: string; message: string } {
  for (const msg of LOVE_MESSAGES) {
    if (percentage >= msg.min && percentage <= msg.max) {
      return { emoji: msg.emoji, message: msg.message };
    }
  }
  return { emoji: '❓', message: 'Error en el cálculo del amor...' };
}

/**
 * Genera la barra de progreso visual
 */
function generateLoveBar(percentage: number): string {
  const filled = Math.floor(percentage / 10);
  const empty = 10 - filled;
  return '💗'.repeat(filled) + '🖤'.repeat(empty);
}

/**
 * Comando /amor - Calcular compatibilidad amorosa
 */
export const amorPlugin: PluginHandler = {
  command: ['amor', 'love', 'ship', 'compatibilidad'],
  description: 'Calcular compatibilidad amorosa entre dos personas',
  category: 'fun',

  async handler(ctx: MessageContext) {
    const { m, text, conn } = ctx;

    // Obtener los dos usuarios
    let user1: string;
    let user2: string | null = null;
    let user1Name: string;
    let user2Name: string;

    // Caso 1: Mencionar a alguien
    if (m.mentionedJid && m.mentionedJid.length > 0) {
      user1 = m.sender;
      user1Name = m.pushName || m.sender.split('@')[0];

      if (m.mentionedJid.length >= 2) {
        // Dos usuarios mencionados
        user1 = m.mentionedJid[0];
        user2 = m.mentionedJid[1];
        user1Name = user1.split('@')[0];
        user2Name = user2.split('@')[0];
      } else {
        // Un usuario mencionado + quien envía
        user2 = m.mentionedJid[0];
        user2Name = user2.split('@')[0];
      }
    } else if (m.quoted) {
      // Caso 2: Citar mensaje de alguien
      user1 = m.sender;
      user2 = m.quoted.sender;
      user1Name = m.pushName || m.sender.split('@')[0];
      user2Name = user2.split('@')[0];
    } else if (text.trim()) {
      // Caso 3: Escribir nombres
      const names = text.split(/\s+y\s+|\s+&\s+|\s+,\s+|\s+con\s+/i);
      if (names.length >= 2) {
        user1Name = names[0].trim();
        user2Name = names[1].trim();
        user1 = user1Name;
        user2 = user2Name;
      } else {
        user1Name = m.pushName || m.sender.split('@')[0];
        user2Name = names[0].trim();
        user1 = user1Name;
        user2 = user2Name;
      }
    } else {
      await m.reply(
        `💕 *CALCULADORA DE AMOR*\n\n` +
        `📝 Uso:\n` +
        `• /amor @usuario\n` +
        `• /amor @usuario1 @usuario2\n` +
        `• /amor Nombre1 y Nombre2\n` +
        `• Citar mensaje + /amor\n\n` +
        `📌 Ejemplo:\n` +
        `/amor Juan y María`
      );
      return;
    }

    // Calcular compatibilidad
    const percentage = calculateLovePercentage(user1Name, user2Name);
    const { emoji, message } = getLoveMessage(percentage);
    const loveBar = generateLoveBar(percentage);

    // Construir respuesta
    const response =
      `💕 *CALCULADORA DE AMOR* 💕\n\n` +
      `👤 ${user1Name}\n` +
      `❤️ + ❤️\n` +
      `👤 ${user2Name}\n\n` +
      `${loveBar}\n\n` +
      `${emoji} *Compatibilidad:* ${percentage}%\n\n` +
      `💬 ${message}`;

    // Enviar con menciones si son usuarios de WhatsApp
    const mentions: string[] = [];
    if (user1 && user1.includes('@')) mentions.push(user1);
    if (user2 && user2.includes('@')) mentions.push(user2);

    await conn.sendMessage(m.chat, {
      text: response,
      mentions
    }, { quoted: m.rawMessage });
  }
};

/**
 * Comando /gay - Calculadora de gayedad (broma)
 */
export const gayPlugin: PluginHandler = {
  command: ['gay', 'gaytest'],
  description: 'Test de gayedad (broma)',
  category: 'fun',

  async handler(ctx: MessageContext) {
    const { m, conn } = ctx;

    let targetUser = m.sender;
    let targetName = m.pushName || m.sender.split('@')[0];

    // Si menciona a alguien o cita
    if (m.mentionedJid && m.mentionedJid.length > 0) {
      targetUser = m.mentionedJid[0];
      targetName = targetUser.split('@')[0];
    } else if (m.quoted) {
      targetUser = m.quoted.sender;
      targetName = targetUser.split('@')[0];
    }

    // Generar porcentaje basado en el nombre
    const percentage = Math.abs((targetName.charCodeAt(0) * 13 + targetName.length * 7) % 101);

    const bar = '🏳️‍🌈'.repeat(Math.floor(percentage / 20)) + '⬜'.repeat(5 - Math.floor(percentage / 20));

    const response =
      `🏳️‍🌈 *GAY TEST* 🏳️‍🌈\n\n` +
      `👤 @${targetName}\n\n` +
      `${bar}\n\n` +
      `📊 *Resultado:* ${percentage}%\n\n` +
      ``;

    await conn.sendMessage(m.chat, {
      text: response,
      mentions: [targetUser]
    }, { quoted: m.rawMessage });
  }
};
