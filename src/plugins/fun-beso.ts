/**
 * 💋 Plugin de Besos
 * Comando: /beso, /kiss
 */

import type { PluginHandler, MessageContext } from '../types/message.js';
import type { KissRecord } from '../types/user.js';
import { getDatabase } from '../lib/database.js';
import { LIMITS } from '../constants/rpg.js';

// Tipos de besos con diferentes niveles de intensidad
const KISS_TYPES = [
  { emoji: '😗', type: 'tierno', desc: 'un besito tierno en la mejilla' },
  { emoji: '😚', type: 'dulce', desc: 'un dulce beso en la frente' },
  { emoji: '😘', type: 'coqueto', desc: 'un beso coqueto volado' },
  { emoji: '💋', type: 'apasionado', desc: 'un beso apasionado' },
  { emoji: '😍', type: 'enamorado', desc: 'un beso lleno de amor' },
  { emoji: '🥰', type: 'cariñoso', desc: 'un beso súper cariñoso' },
  { emoji: '😏', type: 'travieso', desc: 'un beso travieso' },
  { emoji: '🫦', type: 'intenso', desc: 'un beso MUY intenso' },
  { emoji: '💕', type: 'romántico', desc: 'un beso romántico de película' },
  { emoji: '✨', type: 'mágico', desc: 'un beso mágico que hace brillar todo' },
];

// Mensajes especiales según el número de besos entre dos personas
const MILESTONE_MESSAGES: Record<number, string> = {
  1: '¡Primer beso! El inicio de algo especial...',
  5: '¡Ya van 5 besos! Parece que hay química...',
  10: '¡10 besos! Esto se está poniendo serio...',
  25: '¡25 besos! ¿Ya son novios o qué?',
  50: '¡50 BESOS! Son la pareja del grupo',
  100: '¡¡100 BESOS!! Amor verdadero confirmado',
  200: '¡¡¡200 BESOS!!! Leyendas del romance',
  500: '¡¡¡500 BESOS!!! Almas gemelas eternas',
  1000: '¡¡¡1000 BESOS!!! Récord mundial de amor',
};

/**
 * Obtiene un tipo de beso aleatorio
 */
function getRandomKiss(): { emoji: string; type: string; desc: string } {
  return KISS_TYPES[Math.floor(Math.random() * KISS_TYPES.length)];
}

/**
 * Obtiene mensaje de milestone si aplica
 */
function getMilestoneMessage(count: number): string | null {
  return MILESTONE_MESSAGES[count] || null;
}

/**
 * Genera título de relación basado en cantidad de besos
 */
function getRelationshipTitle(count: number): string {
  if (count >= 1000) return '💍 Almas Gemelas Eternas';
  if (count >= 500) return '💖 Amor Verdadero';
  if (count >= 200) return '💕 Pareja Legendaria';
  if (count >= 100) return '💗 Enamorados';
  if (count >= 50) return '💓 Novios del Grupo';
  if (count >= 25) return '💞 Crush Confirmado';
  if (count >= 10) return '💘 Hay Química';
  if (count >= 5) return '💝 Coqueteo';
  return '💋 Conocidos';
}

/**
 * Comando /beso - Dar un beso a alguien
 */
export const besoPlugin: PluginHandler = {
  command: ['beso', 'kiss', 'besito', 'muah'],
  description: 'Dale un beso a alguien especial',
  category: 'fun',

  async handler(ctx: MessageContext) {
    const { m, conn } = ctx;
    const db = getDatabase();

    // Obtener usuario objetivo
    let targetJid: string | null = null;
    let targetName: string;

    if (m.mentionedJid && m.mentionedJid.length > 0) {
      targetJid = m.mentionedJid[0];
      targetName = targetJid.split('@')[0];
    } else if (m.quoted) {
      targetJid = m.quoted.sender;
      targetName = targetJid.split('@')[0];
    } else {
      await m.reply(
        `💋 *SISTEMA DE BESOS*\n\n` +
        `📝 Uso:\n` +
        `• /beso @usuario\n` +
        `• Citar mensaje + /beso\n\n` +
        `📊 Otros comandos:\n` +
        `• /misbesos - Ver tus estadísticas\n` +
        `• /topbesos - Ranking de besucones`
      );
      return;
    }

    // No puedes besarte a ti mismo
    if (targetJid === m.sender) {
      await m.reply('😅 No puedes besarte a ti mismo... ¿o sí? 🪞');
      return;
    }

    const senderName = m.pushName || m.sender.split('@')[0];

    // Obtener datos de ambos usuarios
    const senderData = db.getUser(m.sender);
    const targetData = db.getUser(targetJid);

    // Inicializar kissStats si no existe
    if (!senderData.kissStats) {
      senderData.kissStats = { totalGiven: 0, totalReceived: 0, kissHistory: [] };
    }
    if (!targetData.kissStats) {
      targetData.kissStats = { totalGiven: 0, totalReceived: 0, kissHistory: [] };
    }

    // Actualizar estadísticas del que da el beso
    senderData.kissStats.totalGiven++;

    // Buscar o crear registro en historial del sender
    let senderRecord = senderData.kissStats.kissHistory.find((r: KissRecord) => r.jid === targetJid);
    if (!senderRecord) {
      senderRecord = { jid: targetJid, count: 0, lastKiss: 0 };
      senderData.kissStats.kissHistory.push(senderRecord);

      // Limitar tamaño del historial (eliminar los más antiguos)
      if (senderData.kissStats.kissHistory.length > LIMITS.MAX_KISS_HISTORY) {
        senderData.kissStats.kissHistory.sort((a, b) => b.lastKiss - a.lastKiss);
        senderData.kissStats.kissHistory = senderData.kissStats.kissHistory.slice(0, LIMITS.MAX_KISS_HISTORY);
      }
    }
    senderRecord.count++;
    senderRecord.lastKiss = Date.now();

    // Actualizar estadísticas del que recibe el beso
    targetData.kissStats.totalReceived++;

    // Buscar o crear registro en historial del target (para tracking mutuo)
    let targetRecord = targetData.kissStats.kissHistory.find((r: KissRecord) => r.jid === m.sender);
    if (!targetRecord) {
      targetRecord = { jid: m.sender, count: 0, lastKiss: 0 };
      targetData.kissStats.kissHistory.push(targetRecord);

      // Limitar tamaño del historial (eliminar los más antiguos)
      if (targetData.kissStats.kissHistory.length > LIMITS.MAX_KISS_HISTORY) {
        targetData.kissStats.kissHistory.sort((a, b) => b.lastKiss - a.lastKiss);
        targetData.kissStats.kissHistory = targetData.kissStats.kissHistory.slice(0, LIMITS.MAX_KISS_HISTORY);
      }
    }
    // No incrementamos count aquí porque es beso recibido, no dado

    // Guardar cambios
    db.updateUser(m.sender, { kissStats: senderData.kissStats });
    db.updateUser(targetJid, { kissStats: targetData.kissStats });

    // Generar respuesta
    const kiss = getRandomKiss();
    const kissCount = senderRecord.count;
    const milestone = getMilestoneMessage(kissCount);
    const relationTitle = getRelationshipTitle(kissCount);

    let response =
      `${kiss.emoji} *¡BESO!* ${kiss.emoji}\n\n` +
      `👤 *${senderName}* le dio ${kiss.desc} a *${targetName}*\n\n` +
      `💋 Besos entre ustedes: *${kissCount}*\n` +
      `${relationTitle}\n`;

    if (milestone) {
      response += `\n🎉 *${milestone}*\n`;
    }

    response += `\n📊 Total de besos dados por ${senderName}: *${senderData.kissStats.totalGiven}*`;

    await conn.sendMessage(m.chat, {
      text: response,
      mentions: [m.sender, targetJid]
    }, { quoted: m.rawMessage });
  }
};

/**
 * Comando /misbesos - Ver estadísticas de besos
 */
export const misbesosPlugin: PluginHandler = {
  command: ['misbesos', 'mykisses', 'besostats'],
  description: 'Ver tus estadísticas de besos',
  category: 'fun',

  async handler(ctx: MessageContext) {
    const { m, conn } = ctx;
    const db = getDatabase();

    const userData = db.getUser(m.sender);
    const userName = m.pushName || m.sender.split('@')[0];

    if (!userData.kissStats || (userData.kissStats.totalGiven === 0 && userData.kissStats.totalReceived === 0)) {
      await m.reply(
        `💋 *ESTADÍSTICAS DE BESOS*\n\n` +
        `👤 ${userName}\n\n` +
        `😢 ¡Aún no has dado ni recibido besos!\n` +
        `Usa /beso @usuario para empezar`
      );
      return;
    }

    const stats = userData.kissStats;

    // Top 3 personas más besadas
    const topKissed = [...stats.kissHistory]
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);

    let response =
      `💋 *ESTADÍSTICAS DE BESOS*\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n` +
      `👤 ${userName}\n\n` +
      `💋 Besos dados: *${stats.totalGiven}*\n` +
      `💕 Besos recibidos: *${stats.totalReceived}*\n` +
      `👥 Personas besadas: *${stats.kissHistory.length}*\n\n`;

    if (topKissed.length > 0) {
      response += `🏆 *TUS FAVORITOS:*\n`;
      const medals = ['🥇', '🥈', '🥉'];

      for (let i = 0; i < topKissed.length; i++) {
        const record = topKissed[i];
        const name = record.jid.split('@')[0];
        const title = getRelationshipTitle(record.count);
        response += `${medals[i]} @${name} - ${record.count} besos (${title})\n`;
      }
    }

    const mentions = topKissed.map(r => r.jid);
    mentions.push(m.sender);

    await conn.sendMessage(m.chat, {
      text: response,
      mentions
    }, { quoted: m.rawMessage });
  }
};

/**
 * Comando /topbesos - Ranking de besucones del grupo
 */
export const topbesosPlugin: PluginHandler = {
  command: ['topbesos', 'topkiss', 'besucones', 'rankingbesos'],
  description: 'Ver el ranking de besucones',
  category: 'fun',
  group: true,

  async handler(ctx: MessageContext) {
    const { m, conn } = ctx;
    const db = getDatabase();

    // Obtener participantes del grupo
    const groupMetadata = await conn.groupMetadata(m.chat);
    const participants = groupMetadata.participants.map(p => p.id);

    // Recolectar estadísticas
    const kissRanking: Array<{ jid: string; given: number; received: number }> = [];

    for (const jid of participants) {
      const userData = db.getUser(jid);
      if (userData.kissStats && (userData.kissStats.totalGiven > 0 || userData.kissStats.totalReceived > 0)) {
        kissRanking.push({
          jid,
          given: userData.kissStats.totalGiven,
          received: userData.kissStats.totalReceived
        });
      }
    }

    if (kissRanking.length === 0) {
      await m.reply(
        `💋 *RANKING DE BESOS*\n\n` +
        `😢 ¡Nadie ha dado besos en este grupo!\n` +
        `Sean el primero con /beso @usuario`
      );
      return;
    }

    // Ordenar por besos dados
    kissRanking.sort((a, b) => b.given - a.given);
    const top10 = kissRanking.slice(0, 10);

    const medals = ['🥇', '🥈', '🥉'];
    let response =
      `💋 *RANKING DE BESUCONES*\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n\n`;

    for (let i = 0; i < top10.length; i++) {
      const { jid, given, received } = top10[i];
      const name = jid.split('@')[0];
      const medal = medals[i] || `${i + 1}.`;
      response += `${medal} @${name}\n`;
      response += `   💋 Dados: ${given} | 💕 Recibidos: ${received}\n\n`;
    }

    const mentions = top10.map(r => r.jid);

    await conn.sendMessage(m.chat, {
      text: response,
      mentions
    }, { quoted: m.rawMessage });
  }
};
