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

// Frases por defecto para poka
const DEFAULT_POKA_RESPONSES = [
  `🥫💰 *{name}* está pidiendo limosna...\n\n_"Una monedita para el taco, jefe..."_`,
  `🥫🪙 *{name}* sacó su latita...\n\n_"Cualquier cosa ayuda, mi buen..."_`,
  `🥫💵 *{name}* extiende la mano...\n\n_"Pa' la coca, carnal..."_`,
  `🥫🤲 *{name}* hace cara de perrito triste...\n\n_"Ando bien poka, ayuda..."_`,
  `🥫😢 *{name}* muestra su cartera vacía...\n\n_"No me alcanza ni pa'l camión..."_`,
];

/**
 * Comando /poka - Pedir limosna
 */
export const pokaPlugin: PluginHandler = {
  command: ['poka', 'limosna', 'pobre'],
  description: 'Pide limosna con estilo',
  category: 'fun',

  async handler(ctx: MessageContext) {
    const { m } = ctx;
    const db = getDatabase();
    const senderName = m.pushName || m.sender.split('@')[0];

    // Obtener frases personalizadas del grupo si existen
    let responses: string[];
    if (m.isGroup) {
      const chatSettings = db.getChatSettings(m.chat);
      if (chatSettings.customPoka && chatSettings.customPoka.length > 0) {
        responses = chatSettings.customPoka;
      } else {
        responses = DEFAULT_POKA_RESPONSES;
      }
    } else {
      responses = DEFAULT_POKA_RESPONSES;
    }

    // Reemplazar {name} con el nombre del usuario
    const selectedResponse = pickRandom(responses).replace(/{name}/g, senderName);
    await m.reply(selectedResponse);
  }
};

// Frases por defecto para ctm (si hay personalizadas, reemplazan todo)
const DEFAULT_CTM_RESPONSE = (senderName: string, targetName: string) => {
  let response = `🤬 *${senderName}* le menta la madre a *${targetName}* en 5 idiomas:\n\n`;
  response += `🇲🇽 *Español:*\n${pickRandom(INSULTS.spanish).replace('{target}', targetName)}\n\n`;
  response += `🇺🇸 *English:*\n${pickRandom(INSULTS.english).replace('{target}', targetName)}\n\n`;
  response += `🇫🇷 *Français:*\n${pickRandom(INSULTS.french).replace('{target}', targetName)}\n\n`;
  response += `🇩🇪 *Deutsch:*\n${pickRandom(INSULTS.german).replace('{target}', targetName)}\n\n`;
  response += `🇮🇹 *Italiano:*\n${pickRandom(INSULTS.italian).replace('{target}', targetName)}`;
  return response;
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
    const db = getDatabase();

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

    // Verificar si hay frases personalizadas del grupo
    let response: string;
    if (m.isGroup) {
      const chatSettings = db.getChatSettings(m.chat);
      if (chatSettings.customCtm && chatSettings.customCtm.length > 0) {
        // Usar frase personalizada aleatoria
        response = pickRandom(chatSettings.customCtm)
          .replace(/{name}/g, senderName)
          .replace(/{target}/g, targetName);
      } else {
        response = DEFAULT_CTM_RESPONSE(senderName, targetName);
      }
    } else {
      response = DEFAULT_CTM_RESPONSE(senderName, targetName);
    }

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

/**
 * Comando /addpoka - Agregar frase personalizada para poka
 */
export const addPokaPlugin: PluginHandler = {
  command: ['addpoka', 'agregarpoka'],
  description: 'Agrega una frase personalizada para .poka',
  category: 'fun',
  group: true,
  admin: true,

  async handler(ctx: MessageContext) {
    const { m, args } = ctx;
    const db = getDatabase();

    const phrase = args.join(' ').trim();
    if (!phrase) {
      await m.reply(
        `📝 *AGREGAR FRASE POKA*\n\n` +
        `Uso: /addpoka <frase>\n\n` +
        `Variables disponibles:\n` +
        `• {name} - Nombre del usuario\n\n` +
        `Ejemplo: /addpoka 🥫 *{name}* anda bien poka...`
      );
      return;
    }

    const chatSettings = db.getChatSettings(m.chat);
    if (!chatSettings.customPoka) {
      chatSettings.customPoka = [];
    }

    chatSettings.customPoka.push(phrase);
    db.updateChatSettings(m.chat, { customPoka: chatSettings.customPoka });

    await m.reply(
      `✅ *Frase agregada para .poka*\n\n` +
      `📝 "${phrase}"\n\n` +
      `📊 Total de frases: *${chatSettings.customPoka.length}*`
    );
  }
};

/**
 * Comando /listpoka - Ver frases personalizadas de poka
 */
export const listPokaPlugin: PluginHandler = {
  command: ['listpoka', 'verpoka', 'frasespoka'],
  description: 'Ver frases personalizadas de .poka',
  category: 'fun',
  group: true,

  async handler(ctx: MessageContext) {
    const { m } = ctx;
    const db = getDatabase();

    const chatSettings = db.getChatSettings(m.chat);
    const phrases = chatSettings.customPoka || [];

    if (phrases.length === 0) {
      await m.reply(
        `📋 *FRASES POKA*\n\n` +
        `No hay frases personalizadas.\n` +
        `Se usan las frases por defecto.\n\n` +
        `💡 Usa /addpoka para agregar frases.`
      );
      return;
    }

    let response = `📋 *FRASES POKA PERSONALIZADAS*\n\n`;
    phrases.forEach((phrase, i) => {
      response += `${i + 1}. ${phrase}\n\n`;
    });
    response += `\n💡 Usa /delpoka <número> para eliminar una frase.`;

    await m.reply(response);
  }
};

/**
 * Comando /delpoka - Eliminar frase de poka
 */
export const delPokaPlugin: PluginHandler = {
  command: ['delpoka', 'borrarpoka', 'removepoka'],
  description: 'Elimina una frase personalizada de .poka',
  category: 'fun',
  group: true,
  admin: true,

  async handler(ctx: MessageContext) {
    const { m, args } = ctx;
    const db = getDatabase();

    const index = parseInt(args[0]) - 1;
    const chatSettings = db.getChatSettings(m.chat);

    if (!chatSettings.customPoka || chatSettings.customPoka.length === 0) {
      await m.reply('❌ No hay frases personalizadas para eliminar.');
      return;
    }

    if (isNaN(index) || index < 0 || index >= chatSettings.customPoka.length) {
      await m.reply(`❌ Número inválido. Usa un número del 1 al ${chatSettings.customPoka.length}`);
      return;
    }

    const removed = chatSettings.customPoka.splice(index, 1)[0];
    db.updateChatSettings(m.chat, { customPoka: chatSettings.customPoka });

    await m.reply(
      `✅ *Frase eliminada*\n\n` +
      `📝 "${removed}"\n\n` +
      `📊 Frases restantes: *${chatSettings.customPoka.length}*`
    );
  }
};

/**
 * Comando /clearpoka - Limpiar todas las frases de poka
 */
export const clearPokaPlugin: PluginHandler = {
  command: ['clearpoka', 'limpiarpoka', 'resetpoka'],
  description: 'Elimina todas las frases personalizadas de .poka',
  category: 'fun',
  group: true,
  admin: true,

  async handler(ctx: MessageContext) {
    const { m } = ctx;
    const db = getDatabase();

    db.updateChatSettings(m.chat, { customPoka: [] });
    await m.reply('✅ Todas las frases personalizadas de .poka han sido eliminadas.');
  }
};

/**
 * Comando /addctm - Agregar frase personalizada para ctm
 */
export const addCtmPlugin: PluginHandler = {
  command: ['addctm', 'agregarctm'],
  description: 'Agrega una frase personalizada para .ctm',
  category: 'fun',
  group: true,
  admin: true,

  async handler(ctx: MessageContext) {
    const { m, args } = ctx;
    const db = getDatabase();

    const phrase = args.join(' ').trim();
    if (!phrase) {
      await m.reply(
        `📝 *AGREGAR FRASE CTM*\n\n` +
        `Uso: /addctm <frase>\n\n` +
        `Variables disponibles:\n` +
        `• {name} - Nombre del que usa el comando\n` +
        `• {target} - Nombre del objetivo\n\n` +
        `Ejemplo: /addctm 🤬 *{name}* le dice a *{target}*: ¡Chingas a tu madre!`
      );
      return;
    }

    const chatSettings = db.getChatSettings(m.chat);
    if (!chatSettings.customCtm) {
      chatSettings.customCtm = [];
    }

    chatSettings.customCtm.push(phrase);
    db.updateChatSettings(m.chat, { customCtm: chatSettings.customCtm });

    await m.reply(
      `✅ *Frase agregada para .ctm*\n\n` +
      `📝 "${phrase}"\n\n` +
      `📊 Total de frases: *${chatSettings.customCtm.length}*`
    );
  }
};

/**
 * Comando /listctm - Ver frases personalizadas de ctm
 */
export const listCtmPlugin: PluginHandler = {
  command: ['listctm', 'verctm', 'frasesctm'],
  description: 'Ver frases personalizadas de .ctm',
  category: 'fun',
  group: true,

  async handler(ctx: MessageContext) {
    const { m } = ctx;
    const db = getDatabase();

    const chatSettings = db.getChatSettings(m.chat);
    const phrases = chatSettings.customCtm || [];

    if (phrases.length === 0) {
      await m.reply(
        `📋 *FRASES CTM*\n\n` +
        `No hay frases personalizadas.\n` +
        `Se usa el insulto multilingüe por defecto.\n\n` +
        `💡 Usa /addctm para agregar frases.`
      );
      return;
    }

    let response = `📋 *FRASES CTM PERSONALIZADAS*\n\n`;
    phrases.forEach((phrase, i) => {
      response += `${i + 1}. ${phrase}\n\n`;
    });
    response += `\n💡 Usa /delctm <número> para eliminar una frase.`;

    await m.reply(response);
  }
};

/**
 * Comando /delctm - Eliminar frase de ctm
 */
export const delCtmPlugin: PluginHandler = {
  command: ['delctm', 'borrarctm', 'removectm'],
  description: 'Elimina una frase personalizada de .ctm',
  category: 'fun',
  group: true,
  admin: true,

  async handler(ctx: MessageContext) {
    const { m, args } = ctx;
    const db = getDatabase();

    const index = parseInt(args[0]) - 1;
    const chatSettings = db.getChatSettings(m.chat);

    if (!chatSettings.customCtm || chatSettings.customCtm.length === 0) {
      await m.reply('❌ No hay frases personalizadas para eliminar.');
      return;
    }

    if (isNaN(index) || index < 0 || index >= chatSettings.customCtm.length) {
      await m.reply(`❌ Número inválido. Usa un número del 1 al ${chatSettings.customCtm.length}`);
      return;
    }

    const removed = chatSettings.customCtm.splice(index, 1)[0];
    db.updateChatSettings(m.chat, { customCtm: chatSettings.customCtm });

    await m.reply(
      `✅ *Frase eliminada*\n\n` +
      `📝 "${removed}"\n\n` +
      `📊 Frases restantes: *${chatSettings.customCtm.length}*`
    );
  }
};

/**
 * Comando /clearctm - Limpiar todas las frases de ctm
 */
export const clearCtmPlugin: PluginHandler = {
  command: ['clearctm', 'limpiarctm', 'resetctm'],
  description: 'Elimina todas las frases personalizadas de .ctm',
  category: 'fun',
  group: true,
  admin: true,

  async handler(ctx: MessageContext) {
    const { m } = ctx;
    const db = getDatabase();

    db.updateChatSettings(m.chat, { customCtm: [] });
    await m.reply('✅ Todas las frases personalizadas de .ctm han sido eliminadas.');
  }
};

export default [
  abrazoPlugin,
  kissallPlugin,
  gudmorninPlugin,
  pokaPlugin,
  chingatumadrePlugin,
  hazanaPlugin,
  addPokaPlugin,
  listPokaPlugin,
  delPokaPlugin,
  clearPokaPlugin,
  addCtmPlugin,
  listCtmPlugin,
  delCtmPlugin,
  clearCtmPlugin
];
