/**
 * Administración del servidor: restart, gitpull, logs.
 * Solo owner. Asume que el bot corre bajo pm2 con el nombre de CONFIG.pm2Name.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { PluginHandler } from '../types/message.js';
import { CONFIG } from '../config.js';

const run = promisify(execFile);

function fence(text: string, max = 3500): string {
  let out = text.trim();
  if (out.length > max) out = '...(truncado)\n' + out.slice(-max);
  return '```' + out + '```';
}

export const restartPlugin: PluginHandler = {
  command: ['restart', 'reiniciar', 'reboot'],
  tags: ['owner'],
  help: ['restart - Reinicia el bot vía pm2'],
  owner: true,

  handler: async (ctx) => {
    await ctx.m.reply('🔄 Reiniciando. El bot se desconectará unos segundos.');
    // Pequeña espera para que el mensaje alcance a salir antes de morir.
    setTimeout(() => {
      execFile('pm2', ['restart', CONFIG.pm2Name], (error) => {
        if (error) {
          console.error('No se pudo reiniciar con pm2:', error.message);
          // Si pm2 no está, salimos y dejamos que el supervisor (docker, systemd) nos levante.
          process.exit(0);
        }
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
      await ctx.m.reply(`✅ Cambios descargados.\n\n${fence(output)}\n\nCompila con \`npm run build\` y usa */restart* para aplicarlos.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await ctx.m.reply(`❌ Error al hacer git pull:\n\n${fence(message)}`);
    }
  },
};

export const logsPlugin: PluginHandler = {
  command: ['logs', 'errorlogs', 'errors', 'serverlogs'],
  tags: ['owner'],
  help: ['logs [n] - Últimas n líneas de error del servidor (máx 100)'],
  owner: true,

  handler: async (ctx) => {
    const { m, args } = ctx;
    const requested = parseInt(args[0] ?? '', 10);
    const lines = Number.isFinite(requested) && requested > 0 ? Math.min(requested, 100) : 20;

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
      await m.reply(`📋 Últimos ${lines} errores:\n\n${fence(output)}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await m.reply(`❌ No se pudieron leer los logs:\n\n${fence(message)}`);
    }
  },
};
