/**
 * 🤗 Plugin de Interacciones Sociales
 * Comandos: abrazo, kissall, gudmornin, poka, chingatumadre, hazaña
 */

import type { PluginHandler, MessageContext } from '../types/message.js';
import { getDatabase } from '../lib/database.js';
import { pickRandom } from '../lib/utils.js';
import { LIMITS } from '../constants/rpg.js';
import * as fs from 'fs';
import * as path from 'path';

// Tipos de abrazos con diferentes niveles de intensidad
const HUG_TYPES = [
  { emoji: '🤗', type: 'cálido', desc: 'un abrazo cálido y reconfortante' },
  { emoji: '🫂', type: 'fuerte', desc: 'un abrazo fuerte y protector' },
  { emoji: '💕', type: 'tierno', desc: 'un abrazo tierno y dulce' },
  { emoji: '🥰', type: 'cariñoso', desc: 'un abrazo lleno de cariño' },
  { emoji: '😊', type: 'amistoso', desc: 'un abrazo amistoso' },
  { emoji: '🌟', type: 'especial', desc: 'un abrazo muy especial' },
  { emoji: '✨', type: 'mágico', desc: 'un abrazo mágico que ilumina el día' },
  { emoji: '🐻', type: 'de oso', desc: 'un abrazo de oso gigante' },
];

// Mensajes de buenos días
const GOOD_MORNING_MESSAGES = [
  'Buenos días {target}, espero que tengas un día increíble!',
  'Buen día {target}! Que la fuerza te acompañe hoy!',
  'Despierta {target}! El mundo te necesita hoy!',
  'Buenos días {target}! Arriba esas vibras!',
  'Hey {target}! Buenos días, crack!',
  'Wakey wakey {target}! Es hora de brillar!',
  'Gud mornin {target}! Hoy va a ser un gran día!',
  'Buenos días {target}! A romperla hoy!',
];

// Insultos multilingües para .chingatumadre
const INSULTS = {
  spanish: [
    '¡Chinga tu madre, {target}!',
    '¡Vete a la verga, {target}!',
    '¡Que te folle un pez, {target}!',
  ],
  english: [
    'Go f*ck yourself, {target}!',
    'Screw you, {target}!',
    'Kiss my a**, {target}!',
  ],
  french: [
    'Va te faire foutre, {target}!',
    'Nique ta mère, {target}!',
    'Casse-toi, {target}!',
  ],
  german: [
    'Leck mich am Arsch, {target}!',
    'Verpiss dich, {target}!',
    'Du Hurensohn, {target}!',
  ],
  italian: [
    'Vaffanculo, {target}!',
    'Figlio di puttana, {target}!',
    'Vai a farti fottere, {target}!',
  ],
};

/**
 * Comando /abrazo - Dar un abrazo a alguien
 */
export const abrazoPlugin: PluginHandler = {
  command: ['abrazo', 'hug', 'abrazar', 'apapacho'],
  description: 'Dale un abrazo a alguien especial',
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
        `🤗 *SISTEMA DE ABRAZOS*\n\n` +
        `📝 Uso:\n` +
        `• /abrazo @usuario\n` +
        `• Citar mensaje + /abrazo\n\n` +
        `💡 ¡Da un abrazo para alegrar el día de alguien!`
      );
      return;
    }

    // No puedes abrazarte a ti mismo
    if (targetJid === m.sender) {
      await m.reply('🤗 *Te das un auto-abrazo*\n\n_A veces uno mismo es su mejor compañía..._');
      return;
    }

    const senderName = m.pushName || m.sender.split('@')[0];

    // Obtener datos de ambos usuarios
    const senderData = db.getUser(m.sender);
    const targetData = db.getUser(targetJid);

    // Inicializar hugStats si no existe
    if (!senderData.hugStats) {
      senderData.hugStats = { totalGiven: 0, totalReceived: 0, hugHistory: [] };
    }
    if (!targetData.hugStats) {
      targetData.hugStats = { totalGiven: 0, totalReceived: 0, hugHistory: [] };
    }

    // Actualizar estadísticas del que da el abrazo
    senderData.hugStats.totalGiven++;

    // Buscar o crear registro en historial del sender
    let senderRecord = senderData.hugStats.hugHistory.find(r => r.jid === targetJid);
    if (!senderRecord) {
      senderRecord = { jid: targetJid, count: 0, lastHug: 0 };
      senderData.hugStats.hugHistory.push(senderRecord);

      // Limitar tamaño del historial
      if (senderData.hugStats.hugHistory.length > (LIMITS?.MAX_KISS_HISTORY || 50)) {
        senderData.hugStats.hugHistory.sort((a, b) => b.lastHug - a.lastHug);
        senderData.hugStats.hugHistory = senderData.hugStats.hugHistory.slice(0, LIMITS?.MAX_KISS_HISTORY || 50);
      }
    }
    senderRecord.count++;
    senderRecord.lastHug = Date.now();

    // Actualizar estadísticas del que recibe el abrazo
    targetData.hugStats.totalReceived++;

    // Guardar cambios
    db.updateUser(m.sender, { hugStats: senderData.hugStats });
    db.updateUser(targetJid, { hugStats: targetData.hugStats });

    // Generar respuesta
    const hug = pickRandom(HUG_TYPES);
    const hugCount = senderRecord.count;

    let response =
      `${hug.emoji} *¡ABRAZO!* ${hug.emoji}\n\n` +
      `👤 *${senderName}* le dio ${hug.desc} a *${targetName}*\n\n` +
      `🤗 Abrazos entre ustedes: *${hugCount}*\n`;

    if (hugCount === 1) {
      response += `\n🎉 *¡Primer abrazo! El inicio de una bonita amistad...*`;
    } else if (hugCount === 10) {
      response += `\n🎉 *¡10 abrazos! Son muy buenos amigos*`;
    } else if (hugCount === 50) {
      response += `\n🎉 *¡50 abrazos! Mejores amigos confirmados*`;
    } else if (hugCount === 100) {
      response += `\n🎉 *¡100 abrazos! Amistad legendaria*`;
    }

    response += `\n\n📊 Total de abrazos dados por ${senderName}: *${senderData.hugStats.totalGiven}*`;

    await conn.sendMessage(m.chat, {
      text: response,
      mentions: [m.sender, targetJid]
    }, { quoted: m.rawMessage });
  }
};

/**
 * Comando /kissall - Besar a todos los registrados
 */
export const kissallPlugin: PluginHandler = {
  command: ['kissall', 'besartodos', 'besoatodos'],
  description: 'Da un beso a todos los registrados del grupo',
  category: 'fun',
  group: true,

  async handler(ctx: MessageContext) {
    const { m, conn } = ctx;
    const db = getDatabase();

    // Obtener participantes del grupo
    const groupMetadata = await conn.groupMetadata(m.chat);
    const participants = groupMetadata.participants.map(p => p.id);

    const senderName = m.pushName || m.sender.split('@')[0];
    const senderData = db.getUser(m.sender);

    // Inicializar kissStats si no existe
    if (!senderData.kissStats) {
      senderData.kissStats = { totalGiven: 0, totalReceived: 0, kissHistory: [] };
    }

    // Contar usuarios registrados
    let registeredCount = 0;
    const kissedUsers: string[] = [];

    for (const jid of participants) {
      if (jid === m.sender) continue; // No te besas a ti mismo

      const userData = db.getUser(jid);
      if (!userData.registered) continue;

      registeredCount++;
      kissedUsers.push(jid);

      // Actualizar estadísticas del sender
      senderData.kissStats.totalGiven++;

      // Buscar o crear registro en historial
      let senderRecord = senderData.kissStats.kissHistory.find(r => r.jid === jid);
      if (!senderRecord) {
        senderRecord = { jid, count: 0, lastKiss: 0 };
        senderData.kissStats.kissHistory.push(senderRecord);
      }
      senderRecord.count++;
      senderRecord.lastKiss = Date.now();

      // Actualizar al receptor
      if (!userData.kissStats) {
        userData.kissStats = { totalGiven: 0, totalReceived: 0, kissHistory: [] };
      }
      userData.kissStats.totalReceived++;
      db.updateUser(jid, { kissStats: userData.kissStats });
    }

    // Limitar historial del sender
    if (senderData.kissStats.kissHistory.length > (LIMITS?.MAX_KISS_HISTORY || 50)) {
      senderData.kissStats.kissHistory.sort((a, b) => b.lastKiss - a.lastKiss);
      senderData.kissStats.kissHistory = senderData.kissStats.kissHistory.slice(0, LIMITS?.MAX_KISS_HISTORY || 50);
    }

    db.updateUser(m.sender, { kissStats: senderData.kissStats });

    if (registeredCount === 0) {
      await m.reply('😢 No hay otros usuarios registrados en el grupo para besar.');
      return;
    }

    const response =
      `💋💋💋 *¡BESO MASIVO!* 💋💋💋\n\n` +
      `👤 *${senderName}* le dio un beso a *${registeredCount}* personas!\n\n` +
      `📊 Total de besos dados: *${senderData.kissStats.totalGiven}*\n\n` +
      `_¡Mucho amor en este grupo!_ 💕`;

    await conn.sendMessage(m.chat, {
      text: response,
      mentions: [m.sender, ...kissedUsers]
    }, { quoted: m.rawMessage });
  }
};

/**
 * Comando /gudmornin - Buenos días personalizado
 */
export const gudmorninPlugin: PluginHandler = {
  command: ['gudmornin', 'buenosdias', 'gm', 'goodmorning'],
  description: 'Desea buenos días a alguien',
  category: 'fun',

  async handler(ctx: MessageContext) {
    const { m, conn } = ctx;

    // Obtener usuario objetivo
    let targetJid: string | null = null;
    let targetName: string;

    if (m.mentionedJid && m.mentionedJid.length > 0) {
      targetJid = m.mentionedJid[0];
      targetName = '@' + targetJid.split('@')[0];
    } else if (m.quoted) {
      targetJid = m.quoted.sender;
      targetName = '@' + targetJid.split('@')[0];
    } else {
      // Sin objetivo = buenos días al grupo
      targetName = 'a todos';
    }

    const senderName = m.pushName || m.sender.split('@')[0];
    const message = pickRandom(GOOD_MORNING_MESSAGES).replace('{target}', targetName);

    const response =
      `☀️ *BUENOS DÍAS* ☀️\n\n` +
      `👤 *${senderName}* dice:\n\n` +
      `"${message}"\n\n` +
      `🌅 _Que tengan un excelente día!_`;

    const mentions = targetJid ? [m.sender, targetJid] : [m.sender];

    await conn.sendMessage(m.chat, {
      text: response,
      mentions
    }, { quoted: m.rawMessage });
  }
};

/**
 * Comando /poka - Pedir limosna
 */
export const pokaPlugin: PluginHandler = {
  command: ['poka', 'limosna', 'pobre'],
  description: 'Pide limosna con estilo',
  category: 'fun',

  async handler(ctx: MessageContext) {
    const { m } = ctx;
    const senderName = m.pushName || m.sender.split('@')[0];

    const responses = [
      `🥫💰 *${senderName}* está pidiendo limosna...\n\n_"Una monedita para el taco, jefe..."_`,
      `🥫🪙 *${senderName}* sacó su latita...\n\n_"Cualquier cosa ayuda, mi buen..."_`,
      `🥫💵 *${senderName}* extiende la mano...\n\n_"Pa' la coca, carnal..."_`,
      `🥫🤲 *${senderName}* hace cara de perrito triste...\n\n_"Ando bien poka, ayuda..."_`,
      `🥫😢 *${senderName}* muestra su cartera vacía...\n\n_"No me alcanza ni pa'l camión..."_`,
    ];

    await m.reply(pickRandom(responses));
  }
};

/**
 * Comando /chingatumadre - Insulto multilingüe
 */
export const chingatumadrePlugin: PluginHandler = {
  command: ['chingatumadre', 'ctm', 'fuck', 'insultar'],
  description: 'Insulta a alguien en 5 idiomas',
  category: 'fun',

  async handler(ctx: MessageContext) {
    const { m, conn } = ctx;

    // Obtener usuario objetivo
    let targetJid: string | null = null;
    let targetName: string;

    if (m.mentionedJid && m.mentionedJid.length > 0) {
      targetJid = m.mentionedJid[0];
      targetName = '@' + targetJid.split('@')[0];
    } else if (m.quoted) {
      targetJid = m.quoted.sender;
      targetName = '@' + targetJid.split('@')[0];
    } else {
      await m.reply(
        `🤬 *INSULTO MULTILINGÜE*\n\n` +
        `📝 Uso: /chingatumadre @usuario\n\n` +
        `_Porque a veces las palabras duelen más en varios idiomas..._`
      );
      return;
    }

    // No puedes insultarte a ti mismo
    if (targetJid === m.sender) {
      await m.reply('🤔 ¿Te quieres insultar a ti mismo? Eso es muy sad...');
      return;
    }

    const senderName = m.pushName || m.sender.split('@')[0];

    // Generar insultos en 5 idiomas
    let response = `🤬 *${senderName}* le menta la madre a *${targetName}* en 5 idiomas:\n\n`;

    response += `🇲🇽 *Español:*\n${pickRandom(INSULTS.spanish).replace('{target}', targetName)}\n\n`;
    response += `🇺🇸 *English:*\n${pickRandom(INSULTS.english).replace('{target}', targetName)}\n\n`;
    response += `🇫🇷 *Français:*\n${pickRandom(INSULTS.french).replace('{target}', targetName)}\n\n`;
    response += `🇩🇪 *Deutsch:*\n${pickRandom(INSULTS.german).replace('{target}', targetName)}\n\n`;
    response += `🇮🇹 *Italiano:*\n${pickRandom(INSULTS.italian).replace('{target}', targetName)}`;

    await conn.sendMessage(m.chat, {
      text: response,
      mentions: [m.sender, targetJid]
    }, { quoted: m.rawMessage });
  }
};

/**
 * Comando /hazaña - Enviar sticker de Carlitos
 */
export const hazanaPlugin: PluginHandler = {
  command: ['hazana', 'hazaña', 'carlitos', 'feria'],
  description: 'Muestra el sticker de Carlitos ganando feria',
  category: 'fun',

  async handler(ctx: MessageContext) {
    const { m, conn } = ctx;

    // Buscar el sticker de Carlitos
    const stickerPath = path.join(process.cwd(), 'assets', 'stickers', 'carlitos.webp');

    // Si existe el sticker, enviarlo
    if (fs.existsSync(stickerPath)) {
      const stickerBuffer = fs.readFileSync(stickerPath);
      await conn.sendMessage(m.chat, {
        sticker: stickerBuffer
      }, { quoted: m.rawMessage });
    } else {
      // Si no existe, enviar mensaje de texto alternativo
      await m.reply(
        `🏆💰 *¡HAZAÑA LEGENDARIA!* 💰🏆\n\n` +
        `Carlitos acaba de ganar un chingo de feria!\n\n` +
        `💵💵💵💵💵💵💵💵💵💵\n` +
        `🎰 JACKPOT 🎰\n` +
        `💵💵💵💵💵💵💵💵💵💵\n\n` +
        `_El sticker de Carlitos no está disponible, pero el espíritu sí!_\n\n` +
        `💡 Para agregar el sticker, coloca un archivo 'carlitos.webp' en assets/stickers/`
      );
    }
  }
};

export default [
  abrazoPlugin,
  kissallPlugin,
  gudmorninPlugin,
  pokaPlugin,
  chingatumadrePlugin,
  hazanaPlugin
];
