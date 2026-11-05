/**
 * Administración del servidor: restart, gitpull, logs. Solo owner.
 * Si el bot corre bajo pm2 (CONFIG.pm2Name) se usa; si no, se dice.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { PluginHandler } from '../types/message.js';
import { CONFIG } from '../config.js';
import { createLogger } from '../lib/logger.js';
import { getRecentLogLines, formatLogLine, LOG_BUFFER_SIZE } from '../lib/runtime-stats.js';

const log = createLogger('owner');
const run = promisify(execFile);

function fence(text: string, max = 3500): string {
  let out = text.trim();
  if (out.length > max) out = '...(truncado)\n' + out.slice(-max);
  return '```' + out + '```';
}

/** true si pm2 responde y conoce el proceso del bot. */
async function pm2HasProcess(): Promise<boolean> {
  try {
    const { stdout } = await run('pm2', ['jlist'], { maxBuffer: 4 * 1024 * 1024, timeout: 10_000 });
    const list = JSON.parse(stdout) as { name?: string }[];
    return Array.isArray(list) && list.some((p) => p.name === CONFIG.pm2Name);
  } catch {
    return false;
  }
}

export const restartPlugin: PluginHandler = {
  command: ['restart', 'reiniciar', 'reboot'],
  tags: ['owner'],
  help: ['restart - Reinicia el bot vía pm2'],
  owner: true,

  handler: async (ctx) => {
    if (!(await pm2HasProcess())) {
      await ctx.m.reply(
        `❌ No encuentro el proceso *${CONFIG.pm2Name}* en pm2, así que no hay quién me levante si me cierro.\n\n` +
        `Reinicia desde el servidor (pm2, docker o systemd).`,
      );
      return;
    }
    await ctx.m.reply('🔄 Reiniciando. El bot se desconectará unos segundos.');
    // Pequeña espera para que el mensaje alcance a salir antes de morir.
    setTimeout(() => {
      execFile('pm2', ['restart', CONFIG.pm2Name], (error) => {
        if (error) log.error('no se pudo reiniciar con pm2:', error.message);
      });
    }, 1500);
  },
};

export const gitPullPlugin: PluginHandler = {
  command: ['gitpull', 'pull', 'update', 'actualizar'],
  tags: ['owner'],
  help: ['gitpull - Descarga los últimos cambios del repositorio'],
  owner: true,

  handler: async (ctx) => {
    await ctx.m.reply('📥 Descargando cambios...');
    try {
      const { stdout, stderr } = await run('git', ['pull', '--ff-only'], { cwd: process.cwd() });
      const output = (stdout || stderr || '').trim();
      if (/already up to date|ya está actualizado/i.test(output)) {
        await ctx.m.reply('✅ Ya tienes la última versión.');
        return;
      }
      await ctx.m.reply(`✅ Cambios descargados.\n\n${fence(output)}\n\nCompila con \`npm run build\` y usa *${ctx.usedPrefix}restart* para aplicarlos.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await ctx.m.reply(`❌ Error al hacer git pull:\n\n${fence(message)}`);
    }
  },
};

const DEFAULT_LOG_LINES = 20;
const MAX_LOG_LINES = 100;

export const logsPlugin: PluginHandler = {
  command: ['logs', 'errorlogs', 'errors', 'serverlogs'],
  tags: ['owner'],
  help: [`logs [n] - Últimas n líneas warn/error (máx ${MAX_LOG_LINES})`],
  owner: true,

  handler: async (ctx) => {
    const { m, args } = ctx;
    const requested = parseInt(args[0] ?? '', 10);
    const lines = Number.isFinite(requested) && requested > 0 ? Math.min(requested, MAX_LOG_LINES) : DEFAULT_LOG_LINES;

    // Primero el buffer en memoria (lo alimenta logger.write; ver handoff): no depende de pm2 ni de archivos.
    const buffered = getRecentLogLines(lines);
    if (buffered.length > 0) {
      await m.reply(`📋 Últimas ${buffered.length} líneas warn/error (de las ${LOG_BUFFER_SIZE} en memoria):\n\n${fence(buffered.map(formatLogLine).join('\n'))}`);
      return;
    }

    if (!(await pm2HasProcess())) {
      await m.reply('✅ No hay errores en memoria desde el arranque, y no hay pm2 del que leer logs anteriores.');
      return;
    }

    try {
      const { stdout, stderr } = await run(
        'pm2',
        ['logs', CONFIG.pm2Name, '--err', '--lines', String(lines), '--nostream'],
        { maxBuffer: 1024 * 1024 },
      );
      const output = (stdout || stderr || '').trim();
      if (output.length < 10) {
        await m.reply('✅ No hay errores recientes.');
        return;
      }
      await m.reply(`📋 Últimos ${lines} errores (pm2):\n\n${fence(output)}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await m.reply(`❌ No se pudieron leer los logs:\n\n${fence(message)}`);
    }
  },
};
