/**
 * /bug y /feat: crean issues en GitHub desde WhatsApp. Al issue solo va el
 * nombre visible y los últimos 4 dígitos del número; nunca el JID del grupo.
 */

import type { PluginHandler } from '../types/message.js';
import { createLogger } from '../lib/logger.js';
import { RateLimiter } from '../lib/rate-limit.js';
import { normalizeNumber } from '../config.js';

const log = createLogger('tools');

/** Repositorio destino de los issues, en formato owner/repo (configurable por GITHUB_REPO). */
const GITHUB_REPO = process.env.GITHUB_REPO || 'cyal-dev3/cyalbot';
const GITHUB_API_URL = `https://api.github.com/repos/${GITHUB_REPO}/issues`;
const TIMEOUT_MS = 15_000;
const TITLE_MAX = 70;

const perUser = new RateLimiter(3, 60 * 60_000);
const global = new RateLimiter(20, 24 * 60 * 60_000);
const GLOBAL_KEY = 'all';

interface IssueResult {
  ok: boolean;
  number?: number;
  url?: string;
  error?: string;
}

async function createGitHubIssue(title: string, body: string, labels: string[]): Promise<IssueResult> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return { ok: false, error: 'El reporte a GitHub no está configurado en este bot (falta GITHUB_TOKEN).' };

  try {
    const response = await fetch(GITHUB_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'cyalbot',
      },
      body: JSON.stringify({ title, body, labels }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      log.error(`GitHub respondió ${response.status}:`, detail.slice(0, 300));
      return { ok: false, error: `GitHub respondió con error ${response.status}.` };
    }
    const data = (await response.json()) as { number: number; html_url: string };
    return { ok: true, number: data.number, url: data.html_url };
  } catch (error) {
    log.error('no se pudo crear el issue:', error instanceof Error ? error.message : error);
    return { ok: false, error: 'No pude conectar con GitHub.' };
  }
}

/** Primera línea del texto, sin saltos ni espacios repetidos, recortada para el título. */
export function issueTitle(prefix: string, text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const cut = flat.length > TITLE_MAX ? `${flat.slice(0, TITLE_MAX - 1).trimEnd()}…` : flat;
  return `${prefix} ${cut}`;
}

/** Nombre visible y últimos 4 dígitos: suficiente para reconocerse, sin exponer el número completo. */
export function reporterLabel(pushName: string, sender: string): string {
  const digits = normalizeNumber(sender);
  const suffix = digits.length >= 4 ? `…${digits.slice(-4)}` : 'sin número';
  return `${pushName.trim() || 'Usuario'} (${suffix})`;
}

export interface IssueCommand {
  kind: 'bug' | 'feat';
  minChars: number;
  labels: string[];
  titlePrefix: string;
}

export function makeIssueCommand(spec: IssueCommand): PluginHandler {
  const isBug = spec.kind === 'bug';
  const name = spec.kind;
  const what = isBug ? 'el bug' : 'la función';
  const checklist = isBug
    ? '• ¿Qué comando usaste?\n• ¿Qué esperabas?\n• ¿Qué pasó en realidad?'
    : '• ¿Qué función quieres?\n• ¿Por qué sería útil?\n• ¿Cómo se usaría?';
  const example = isBug
    ? 'Cuando uso daily me dice que ya lo usé pero no recibí las recompensas. Pasa desde ayer y ya probé varias veces.'
    : 'Me gustaría un comando clima que muestre el clima de cualquier ciudad para saber si va a llover antes de salir. Se usaría como: clima Ciudad de México';

  return {
    command: isBug ? ['bug', 'reportar', 'reporte'] : ['feat', 'feature', 'sugerencia', 'sugerir', 'idea'],
    description: isBug ? 'Reporta un bug del bot (crea un issue en GitHub)' : 'Sugiere una función para el bot (crea un issue en GitHub)',
    category: 'herramientas',
    help: [`${name} <descripción> - ${isBug ? 'Reportar un bug' : 'Sugerir una función'} (mínimo ${spec.minChars} caracteres)`],
    usage: [`${name} ${example.slice(0, 40)}…`],

    handler: async ({ m, text, usedPrefix }) => {
      const description = text.trim();
      if (!description) {
        return m.reply(`*${usedPrefix}${name} <descripción>* (mínimo ${spec.minChars} caracteres). Cuenta:\n${checklist}\n\nEjemplo: *${usedPrefix}${name} ${example}*`);
      }
      if (description.length < spec.minChars) {
        return m.reply(`Muy corto: ${description.length} caracteres y se necesitan ${spec.minChars}. Añade detalle:\n${checklist}`);
      }

      const user = perUser.try(m.sender);
      if (!user.ok) return m.reply(`Ya enviaste 3 reportes en la última hora. Vuelve a intentarlo en ${Math.ceil(user.retryInMs / 60_000)} min.`);
      const everyone = global.try(GLOBAL_KEY);
      if (!everyone.ok) {
        perUser.reset(m.sender);
        return m.reply('Hoy ya se enviaron demasiados reportes al equipo. Inténtalo mañana.');
      }

      await m.react('⏳');
      const reporter = reporterLabel(m.pushName, m.sender);
      const where = m.isGroup ? 'grupo' : 'chat privado';
      const date = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'short', timeStyle: 'short' });
      const body =
        `## ${isBug ? 'Reporte de bug' : 'Solicitud de función'}\n\n${description}\n\n---\n\n` +
        `| Campo | Valor |\n|---|---|\n| Reportado por | ${reporter} |\n| Desde | ${where} |\n| Fecha | ${date} |\n\n` +
        `_Creado automáticamente desde WhatsApp._`;

      const result = await createGitHubIssue(issueTitle(spec.titlePrefix, description), body, spec.labels);
      if (!result.ok) {
        perUser.reset(m.sender);
        await m.react('❌');
        return m.reply(`❌ No pude crear ${what}: ${result.error}`);
      }
      await m.react('✅');
      await m.reply(`✅ ${isBug ? 'Bug reportado' : 'Sugerencia enviada'} como issue *#${result.number}*. Gracias, ${m.pushName || 'crack'}.\n${result.url}`);
    },
  };
}

export const bugPlugin = makeIssueCommand({ kind: 'bug', minChars: 50, labels: ['bug', 'from-whatsapp'], titlePrefix: '[BUG]' });
export const featPlugin = makeIssueCommand({ kind: 'feat', minChars: 80, labels: ['enhancement', 'from-whatsapp'], titlePrefix: '[FEAT]' });
