/**
 * 🐛 Plugin de GitHub Issues - CYALTRONIC
 * Comandos: /bug, /feat
 * Permite a usuarios reportar bugs y solicitar features creando issues en GitHub
 */

import type { PluginHandler, MessageContext } from '../types/message.js';

// Configuración de GitHub
const GITHUB_OWNER = 'cyal-dev3';
const GITHUB_REPO = 'cyalbot';
const GITHUB_API_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/issues`;

// Requisitos mínimos de caracteres
const MIN_CHARS_BUG = 50;
const MIN_CHARS_FEAT = 80;

/**
 * Crea un issue en GitHub
 */
async function createGitHubIssue(
  title: string,
  body: string,
  labels: string[]
): Promise<{ success: boolean; url?: string; error?: string }> {
  const token = process.env.GITHUB_TOKEN;

  if (!token) {
    return {
      success: false,
      error: 'Token de GitHub no configurado. Contacta al administrador.'
    };
  }

  try {
    const response = await fetch(GITHUB_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      body: JSON.stringify({
        title,
        body,
        labels
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('GitHub API Error:', response.status, errorData);
      return {
        success: false,
        error: `Error de GitHub API: ${response.status}`
      };
    }

    const data = await response.json() as { html_url: string };
    return {
      success: true,
      url: data.html_url
    };
  } catch (error) {
    console.error('Error creating GitHub issue:', error);
    return {
      success: false,
      error: 'Error de conexión con GitHub'
    };
  }
}

/**
 * Formatea la fecha actual
 */
function getCurrentDate(): string {
  return new Date().toLocaleString('es-MX', {
    timeZone: 'America/Mexico_City',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

/**
 * Comando /bug - Reportar un bug
 */
export const bugPlugin: PluginHandler = {
  command: ['bug', 'reportar', 'reporte'],
  description: 'Reportar un bug encontrado en el bot',
  category: 'tools',
  group: true,

  async handler(ctx: MessageContext) {
    const { m, text } = ctx;

    // Verificar que se proporcionó descripción
    if (!text.trim()) {
      await m.reply(
        `🐛 *REPORTAR BUG*\n\n` +
        `📝 *Uso:* .bug <descripción detallada>\n\n` +
        `📌 *Requisitos:*\n` +
        `• Mínimo *${MIN_CHARS_BUG} caracteres*\n` +
        `• Describe qué comando usaste\n` +
        `• Explica qué esperabas que pasara\n` +
        `• Describe qué pasó realmente\n\n` +
        `📋 *Ejemplo:*\n` +
        `.bug Cuando uso el comando .daily me dice que ya lo usé pero no he recibido las recompensas. ` +
        `Esto pasa desde ayer y ya intenté varias veces.`
      );
      return;
    }

    // Verificar longitud mínima
    if (text.trim().length < MIN_CHARS_BUG) {
      await m.reply(
        `❌ *Descripción muy corta*\n\n` +
        `Tu reporte tiene *${text.trim().length}* caracteres.\n` +
        `Se requieren mínimo *${MIN_CHARS_BUG}* caracteres.\n\n` +
        `💡 *Tip:* Incluye más detalles como:\n` +
        `• ¿Qué comando usaste?\n` +
        `• ¿Qué esperabas?\n` +
        `• ¿Qué ocurrió?`
      );
      return;
    }

    await m.react('⏳');

    // Construir el issue
    const reporterName = m.pushName || 'Usuario';
    const reporterPhone = m.sender.split('@')[0];
    const groupId = m.chat;

    const issueTitle = `[BUG] ${text.substring(0, 60)}${text.length > 60 ? '...' : ''}`;

    const issueBody = `## Reporte de Bug

### Descripción
${text}

---

### Información del reporte
| Campo | Valor |
|-------|-------|
| **Reportado por** | ${reporterName} |
| **ID Usuario** | \`${reporterPhone}\` |
| **Grupo** | \`${groupId}\` |
| **Fecha** | ${getCurrentDate()} |

---

*Este issue fue creado automáticamente desde WhatsApp usando CYALTRONIC.*`;

    const result = await createGitHubIssue(issueTitle, issueBody, ['bug', 'from-whatsapp']);

    if (result.success) {
      await m.react('✅');
      await m.reply(
        `✅ *BUG REPORTADO*\n\n` +
        `Gracias por tu reporte, *${reporterName}*!\n\n` +
        `🔗 *Issue creado:*\n${result.url}\n\n` +
        `📋 El equipo revisará tu reporte pronto.`
      );
    } else {
      await m.react('❌');
      await m.reply(
        `❌ *Error al crear reporte*\n\n` +
        `${result.error}\n\n` +
        `Por favor intenta más tarde o contacta al administrador.`
      );
    }
  }
};

/**
 * Comando /feat - Solicitar una nueva función
 */
export const featPlugin: PluginHandler = {
  command: ['feat', 'feature', 'sugerencia', 'sugerir', 'idea'],
  description: 'Sugerir una nueva función para el bot',
  category: 'tools',
  group: true,

  async handler(ctx: MessageContext) {
    const { m, text } = ctx;

    // Verificar que se proporcionó descripción
    if (!text.trim()) {
      await m.reply(
        `💡 *SUGERIR FUNCIÓN*\n\n` +
        `📝 *Uso:* .feat <descripción detallada>\n\n` +
        `📌 *Requisitos:*\n` +
        `• Mínimo *${MIN_CHARS_FEAT} caracteres*\n` +
        `• Describe qué función quieres\n` +
        `• Explica por qué sería útil\n` +
        `• Da ejemplos de uso\n\n` +
        `📋 *Ejemplo:*\n` +
        `.feat Me gustaría un comando .clima que muestre el clima de cualquier ciudad. ` +
        `Sería útil para saber si va a llover antes de salir. ` +
        `Se usaría como: .clima Ciudad de México`
      );
      return;
    }

    // Verificar longitud mínima
    if (text.trim().length < MIN_CHARS_FEAT) {
      await m.reply(
        `❌ *Descripción muy corta*\n\n` +
        `Tu sugerencia tiene *${text.trim().length}* caracteres.\n` +
        `Se requieren mínimo *${MIN_CHARS_FEAT}* caracteres.\n\n` +
        `💡 *Tip:* Incluye más detalles como:\n` +
        `• ¿Qué función quieres?\n` +
        `• ¿Por qué sería útil?\n` +
        `• ¿Cómo se usaría?`
      );
      return;
    }

    await m.react('⏳');

    // Construir el issue
    const reporterName = m.pushName || 'Usuario';
    const reporterPhone = m.sender.split('@')[0];
    const groupId = m.chat;

    const issueTitle = `[FEAT] ${text.substring(0, 60)}${text.length > 60 ? '...' : ''}`;

    const issueBody = `## Solicitud de Nueva Función

### Descripción
${text}

---

### Información de la solicitud
| Campo | Valor |
|-------|-------|
| **Sugerido por** | ${reporterName} |
| **ID Usuario** | \`${reporterPhone}\` |
| **Grupo** | \`${groupId}\` |
| **Fecha** | ${getCurrentDate()} |

---

*Este issue fue creado automáticamente desde WhatsApp usando CYALTRONIC.*`;

    const result = await createGitHubIssue(issueTitle, issueBody, ['enhancement', 'from-whatsapp']);

    if (result.success) {
      await m.react('✅');
      await m.reply(
        `✅ *SUGERENCIA ENVIADA*\n\n` +
        `Gracias por tu idea, *${reporterName}*!\n\n` +
        `🔗 *Issue creado:*\n${result.url}\n\n` +
        `📋 El equipo evaluará tu sugerencia.`
      );
    } else {
      await m.react('❌');
      await m.reply(
        `❌ *Error al enviar sugerencia*\n\n` +
        `${result.error}\n\n` +
        `Por favor intenta más tarde o contacta al administrador.`
      );
    }
  }
};
