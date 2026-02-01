/**
 * 🔄 Plugin de Administracion del Servidor
 * Comandos: restart, reiniciar, gitpull, update
 * Solo para el owner del bot
 */

import { exec } from 'child_process';
import type { PluginHandler } from '../types/message.js';

/**
 * Plugin: Restart - Reinicia el bot usando pm2
 */
export const restartPlugin: PluginHandler = {
  command: ['restart', 'reiniciar', 'reboot'],
  tags: ['owner'],
  help: ['restart - Reinicia el servidor del bot (solo owner)'],
  owner: true,

  handler: async (ctx) => {
    await ctx.m.reply('🔄 *Reiniciando servidor...*\n\nEl bot se desconectara momentaneamente.');

    // Dar tiempo para que el mensaje se envie
    setTimeout(() => {
      exec('pm2 restart CYALTRONIC', (error, stdout, stderr) => {
        if (error) {
          console.error('Error al reiniciar con pm2:', error);
          // El mensaje de error no llegara porque el bot ya se reinicio o fallo
        }
      });
    }, 1500);
  }
};

/**
 * Plugin: GitPull - Jala los ultimos cambios de GitHub
 */
export const gitPullPlugin: PluginHandler = {
  command: ['gitpull', 'pull', 'update', 'actualizar'],
  tags: ['owner'],
  help: ['gitpull - Descarga los ultimos cambios de GitHub (solo owner)'],
  owner: true,

  handler: async (ctx) => {
    await ctx.m.reply('📥 *Descargando cambios de GitHub...*');

    const gitCommand = 'cd /home/dev3/cyalbot/ && sudo -u dev3 git pull';

    exec(gitCommand, (error, stdout, stderr) => {
      if (error) {
        console.error('Error en git pull:', error);
        ctx.m.reply(`❌ *Error al hacer git pull:*\n\n\`\`\`${error.message}\`\`\``);
        return;
      }

      const output = stdout || stderr || 'Sin cambios';

      // Verificar si hay cambios
      if (output.includes('Already up to date') || output.includes('Ya esta actualizado')) {
        ctx.m.reply('✅ *Ya tienes la ultima version*\n\nNo hay cambios nuevos en el repositorio.');
      } else {
        ctx.m.reply(`✅ *Cambios descargados exitosamente*\n\n\`\`\`${output}\`\`\`\n\n💡 Usa */restart* para aplicar los cambios.`);
      }
    });
  }
};

/**
 * Plugin: Logs - Ver los logs de errores del servidor
 */
export const logsPlugin: PluginHandler = {
  command: ['logs', 'errorlogs', 'errors', 'serverlogs'],
  tags: ['owner'],
  help: [
    'logs - Ver los ultimos 20 errores del servidor',
    'logs [numero] - Ver los ultimos N errores (max 100)'
  ],
  owner: true,

  handler: async (ctx) => {
    const { m, args } = ctx;

    // Numero de lineas a mostrar (default 20, max 100)
    let lines = 20;
    if (args[0]) {
      const requested = parseInt(args[0]);
      if (!isNaN(requested) && requested > 0) {
        lines = Math.min(requested, 100);
      }
    }

    await m.reply(`📋 *Obteniendo ultimos ${lines} errores...*`);

    // Usar pm2 logs con --err para solo errores y --nostream para no bloquear
    const logsCommand = `pm2 logs CYALTRONIC --err --lines ${lines} --nostream`;

    exec(logsCommand, { maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        console.error('Error al obtener logs:', error);
        m.reply(`❌ *Error al obtener logs:*\n\n\`\`\`${error.message}\`\`\``);
        return;
      }

      const output = stdout || stderr || 'Sin errores recientes';

      // Truncar si es muy largo para WhatsApp (max ~4000 chars)
      let logOutput = output.trim();
      if (logOutput.length > 4000) {
        logOutput = logOutput.substring(logOutput.length - 4000);
        logOutput = '...(truncado)\n\n' + logOutput;
      }

      if (!logOutput || logOutput === 'Sin errores recientes' || logOutput.length < 10) {
        m.reply('✅ *No hay errores recientes*\n\nEl servidor está funcionando correctamente.');
      } else {
        m.reply(`📋 *LOGS DE ERRORES (ultimos ${lines}):*\n\n\`\`\`${logOutput}\`\`\``);
      }
    });
  }
};
