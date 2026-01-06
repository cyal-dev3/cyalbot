/**
 * Anti-Spam Mejorado para CyalBot
 * Detecta múltiples patrones de spam sin machine learning
 * By @Cyal
 */

import * as fs from 'fs';

// Almacén temporal para tracking de mensajes por usuario
const userMessageHistory = new Map();
const userWarnings = new Map();

// Configuración de detección
const CONFIG = {
  // Límites de tiempo (en ms)
  TIME_WINDOW: 10000,          // Ventana de 10 segundos para contar mensajes
  FLOOD_THRESHOLD: 5,          // Máximo de mensajes en la ventana de tiempo

  // Límites de contenido
  MAX_EMOJIS: 30,              // Máximo de emojis por mensaje
  MAX_MENTIONS: 10,            // Máximo de menciones por mensaje
  MAX_REPEATED_CHARS: 20,      // Máximo de caracteres repetidos consecutivos
  MAX_CAPS_PERCENT: 80,        // Porcentaje máximo de mayúsculas
  MIN_TEXT_FOR_CAPS: 15,       // Mínimo de caracteres para evaluar mayúsculas
  MAX_LINKS: 3,                // Máximo de enlaces por mensaje
  MAX_LINE_BREAKS: 30,         // Máximo de saltos de línea

  // Advertencias
  MAX_WARNINGS: 3,             // Advertencias antes de acción
  WARNING_EXPIRE: 3600000,     // Las advertencias expiran en 1 hora
};

// Patrones de spam comunes
const SPAM_PATTERNS = [
  // Texto repetitivo
  /(.)\1{15,}/gi,                              // Mismo caracter 15+ veces
  /(\w{2,})\1{5,}/gi,                          // Misma palabra corta 5+ veces

  // Patrones de publicidad/scam
  /gan[a@]r?\s*d[i1]ner[o0]/gi,               // "ganar dinero"
  /100%\s*real/gi,                             // "100% real"
  /no\s*es\s*broma/gi,                         // "no es broma"
  /env[i1][a@]\s*a\s*\d+\s*grupos?/gi,        // "envia a X grupos"
  /reenvi[a@]/gi,                              // "reenvia"
  /c[o0]mpart[i1]r?\s*[a@]\s*\d+/gi,          // "compartir a X"
  /whatsapp\s*se\s*v[a@]\s*[a@]\s*c[o0]br[a@]r/gi, // "whatsapp se va a cobrar"
  /cuentas?\s*premium\s*gratis/gi,             // "cuentas premium gratis"
  /netflix\s*gratis/gi,                        // "netflix gratis"
  /hack(ear|eo|s)?/gi,                         // "hackear/hackeo"
  /curs[o0]\s*grat[i1]s/gi,                   // "curso gratis"

  // Caracteres invisibles/zalgo
  /[\u0300-\u036f]{5,}/g,                      // Diacríticos combinados (zalgo)
  /[\u200B-\u200D\uFEFF]{3,}/g,               // Caracteres de ancho cero
];

/**
 * Limpia el historial antiguo de un usuario
 */
function cleanOldMessages(sender) {
  const history = userMessageHistory.get(sender) || [];
  const now = Date.now();
  const filtered = history.filter(msg => now - msg.timestamp < CONFIG.TIME_WINDOW);
  userMessageHistory.set(sender, filtered);
  return filtered;
}

/**
 * Limpia advertencias expiradas
 */
function cleanExpiredWarnings(sender) {
  const warnings = userWarnings.get(sender) || { count: 0, lastWarning: 0 };
  if (Date.now() - warnings.lastWarning > CONFIG.WARNING_EXPIRE) {
    warnings.count = 0;
  }
  return warnings;
}

/**
 * Cuenta emojis en el texto
 */
function countEmojis(text) {
  const emojiRegex = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]/gu;
  const matches = text.match(emojiRegex);
  return matches ? matches.length : 0;
}

/**
 * Cuenta menciones en el texto
 */
function countMentions(text) {
  const mentionRegex = /@\d+/g;
  const matches = text.match(mentionRegex);
  return matches ? matches.length : 0;
}

/**
 * Cuenta enlaces en el texto
 */
function countLinks(text) {
  const linkRegex = /https?:\/\/[^\s]+|www\.[^\s]+/gi;
  const matches = text.match(linkRegex);
  return matches ? matches.length : 0;
}

/**
 * Calcula porcentaje de mayúsculas
 */
function getCapsPercentage(text) {
  const letters = text.replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑ]/g, '');
  if (letters.length < CONFIG.MIN_TEXT_FOR_CAPS) return 0;
  const caps = letters.replace(/[^A-ZÁÉÍÓÚÑ]/g, '').length;
  return (caps / letters.length) * 100;
}

/**
 * Detecta caracteres repetidos consecutivos
 */
function getMaxRepeatedChars(text) {
  let maxRepeat = 1;
  let currentRepeat = 1;

  for (let i = 1; i < text.length; i++) {
    if (text[i] === text[i - 1]) {
      currentRepeat++;
      maxRepeat = Math.max(maxRepeat, currentRepeat);
    } else {
      currentRepeat = 1;
    }
  }

  return maxRepeat;
}

/**
 * Verifica patrones de spam conocidos
 */
function matchesSpamPatterns(text) {
  for (const pattern of SPAM_PATTERNS) {
    if (pattern.test(text)) {
      return true;
    }
  }
  return false;
}

/**
 * Analiza el mensaje y retorna los problemas encontrados
 */
function analyzeMessage(text, sender) {
  const issues = [];

  // 1. Verificar flood (muchos mensajes seguidos)
  const history = cleanOldMessages(sender);
  if (history.length >= CONFIG.FLOOD_THRESHOLD) {
    issues.push({ type: 'flood', severity: 2 });
  }

  // 2. Verificar exceso de emojis
  const emojiCount = countEmojis(text);
  if (emojiCount > CONFIG.MAX_EMOJIS) {
    issues.push({ type: 'emojis', severity: 1, count: emojiCount });
  }

  // 3. Verificar exceso de menciones
  const mentionCount = countMentions(text);
  if (mentionCount > CONFIG.MAX_MENTIONS) {
    issues.push({ type: 'mentions', severity: 2, count: mentionCount });
  }

  // 4. Verificar caracteres repetidos
  const maxRepeated = getMaxRepeatedChars(text);
  if (maxRepeated > CONFIG.MAX_REPEATED_CHARS) {
    issues.push({ type: 'repeated', severity: 1, count: maxRepeated });
  }

  // 5. Verificar exceso de mayúsculas (GRITAR)
  const capsPercent = getCapsPercentage(text);
  if (capsPercent > CONFIG.MAX_CAPS_PERCENT) {
    issues.push({ type: 'caps', severity: 1, percent: capsPercent });
  }

  // 6. Verificar exceso de enlaces
  const linkCount = countLinks(text);
  if (linkCount > CONFIG.MAX_LINKS) {
    issues.push({ type: 'links', severity: 2, count: linkCount });
  }

  // 7. Verificar exceso de saltos de línea
  const lineBreaks = (text.match(/\n/g) || []).length;
  if (lineBreaks > CONFIG.MAX_LINE_BREAKS) {
    issues.push({ type: 'linebreaks', severity: 1, count: lineBreaks });
  }

  // 8. Verificar patrones de spam conocidos
  if (matchesSpamPatterns(text)) {
    issues.push({ type: 'pattern', severity: 3 });
  }

  return issues;
}

/**
 * Genera mensaje de advertencia según los problemas
 */
function getWarningMessage(issues, traductor) {
  const messages = [];

  for (const issue of issues) {
    switch (issue.type) {
      case 'flood':
        messages.push(traductor.flood || 'Estás enviando mensajes muy rápido');
        break;
      case 'emojis':
        messages.push(traductor.emojis || `Demasiados emojis (${issue.count})`);
        break;
      case 'mentions':
        messages.push(traductor.mentions || `Demasiadas menciones (${issue.count})`);
        break;
      case 'repeated':
        messages.push(traductor.repeated || 'Caracteres repetidos detectados');
        break;
      case 'caps':
        messages.push(traductor.caps || 'Demasiado texto en MAYÚSCULAS');
        break;
      case 'links':
        messages.push(traductor.links || `Demasiados enlaces (${issue.count})`);
        break;
      case 'linebreaks':
        messages.push(traductor.linebreaks || 'Demasiados saltos de línea');
        break;
      case 'pattern':
        messages.push(traductor.pattern || 'Contenido sospechoso detectado');
        break;
    }
  }

  return messages;
}

export async function before(m, { conn, isAdmin, isBotAdmin }) {
  // Cargar idioma
  const datas = global;
  const idioma = datas.db.data.users[m.sender]?.language || global.defaultLenguaje || 'es';

  let traductor = {};
  try {
    const _translate = JSON.parse(fs.readFileSync(`./src/languages/${idioma}.json`));
    traductor = _translate.plugins._antispam || {};
  } catch {
    traductor = {};
  }

  // Ignorar mensajes propios del bot
  if (m.isBaileys && m.fromMe) return true;

  // Solo funciona en grupos
  if (!m.isGroup) return false;

  // Obtener configuración del chat
  const chat = global.db.data.chats[m.chat];

  // Verificar si antispam está activado
  if (!chat?.antispam) return false;

  // Los admins están exentos
  if (isAdmin) return false;

  // Si no hay texto, ignorar
  if (!m.text || m.text.length < 3) return false;

  // Registrar mensaje en historial
  const history = userMessageHistory.get(m.sender) || [];
  history.push({ timestamp: Date.now(), text: m.text });
  userMessageHistory.set(m.sender, history);

  // Analizar mensaje
  const issues = analyzeMessage(m.text, m.sender);

  // Si no hay problemas, continuar
  if (issues.length === 0) return false;

  // Calcular severidad total
  const totalSeverity = issues.reduce((sum, issue) => sum + issue.severity, 0);

  // Solo actuar si hay problemas significativos
  if (totalSeverity < 2) return false;

  // Gestionar advertencias
  let warnings = cleanExpiredWarnings(m.sender);
  warnings.count++;
  warnings.lastWarning = Date.now();
  userWarnings.set(m.sender, warnings);

  // Obtener mensajes de advertencia
  const warningMessages = getWarningMessage(issues, traductor);
  const name = await conn.getName(m.sender);

  const header = traductor.header || '_*< ANTI-SPAM />*_';
  const warningText = traductor.warning || 'Advertencia';

  // Si alcanzó el límite de advertencias
  if (warnings.count >= CONFIG.MAX_WARNINGS) {
    if (isBotAdmin) {
      // Eliminar mensaje
      await conn.sendMessage(m.chat, {
        delete: {
          remoteJid: m.chat,
          fromMe: false,
          id: m.key.id,
          participant: m.key.participant
        }
      });

      // Expulsar usuario
      const kickMsg = traductor.kick || 'ha sido expulsado por spam';
      await conn.sendMessage(m.chat, {
        text: `${header}\n\n*[ ℹ️ ]* @${m.sender.split('@')[0]} ${kickMsg}\n\n*${traductor.reasons || 'Razones'}:*\n${warningMessages.map(msg => `• ${msg}`).join('\n')}`,
        mentions: [m.sender]
      });

      await conn.groupParticipantsUpdate(m.chat, [m.sender], 'remove');

      // Resetear advertencias
      userWarnings.delete(m.sender);
    } else {
      await conn.sendMessage(m.chat, {
        text: `${header}\n\n*[ ⚠️ ]* ${traductor.nobotadmin || 'No soy administrador, no puedo tomar acciones.'}`,
      });
    }
  } else {
    // Enviar advertencia
    const remainingWarnings = CONFIG.MAX_WARNINGS - warnings.count;

    if (isBotAdmin) {
      // Eliminar mensaje spam
      await conn.sendMessage(m.chat, {
        delete: {
          remoteJid: m.chat,
          fromMe: false,
          id: m.key.id,
          participant: m.key.participant
        }
      });
    }

    await conn.sendMessage(m.chat, {
      text: `${header}\n\n*[ ⚠️ ]* @${m.sender.split('@')[0]}\n\n*${warningText}:* ${warnings.count}/${CONFIG.MAX_WARNINGS}\n\n*${traductor.detected || 'Detectado'}:*\n${warningMessages.map(msg => `• ${msg}`).join('\n')}\n\n_${(traductor.remaining || 'Te quedan %s advertencias antes de ser expulsado').replace('%s', remainingWarnings)}_`,
      mentions: [m.sender]
    });
  }

  return true;
}

export default before;
