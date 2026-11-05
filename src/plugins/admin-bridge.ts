import type { PluginHandler } from '../types/message.js';
import {
  getBridgeStatus, restartTelegramBridge, pauseMessageQueue, resumeMessageQueue,
} from '../lib/telegram-bridge.js';
import { msToTime } from '../lib/utils.js';

export const bridgePlugin: PluginHandler = {
  command: ['bridge', 'puente', 'telegram'],
  tags: ['owner'],
  description: 'Estado y control del puente Telegram -> WhatsApp',
  help: ['bridge status|restart|pause|resume - Puente de Telegram (owner)'],
  usage: ['bridge status', 'bridge restart'],
  owner: true,

  handler: async ({ m, args, usedPrefix, conn }) => {
    const sub = (args[0] ?? 'status').toLowerCase();

    if (sub === 'restart' || sub === 'reiniciar') {
      await m.reply('🔄 Reiniciando el puente de Telegram...');
      const client = await restartTelegramBridge(conn);
      await m.reply(client ? '✅ Puente reiniciado y conectado a Telegram.' : '❌ El puente no arrancó. Revisa las variables TELEGRAM_* y los logs.');
      return;
    }
    if (sub === 'pause' || sub === 'pausar') {
      pauseMessageQueue();
      await m.reply(`⏸️ Cola pausada. Reanuda con *${usedPrefix}bridge resume*.`);
      return;
    }
    if (sub === 'resume' || sub === 'reanudar') {
      resumeMessageQueue();
      await m.reply('▶️ Cola reanudada.');
      return;
    }

    const s = getBridgeStatus();
    if (!s.configured) {
      await m.reply('El puente de Telegram no está configurado (faltan variables TELEGRAM_* o WHATSAPP_GROUP_ID en .env).');
      return;
    }
    const telegram = s.reconnecting ? '🔄 reconectando' : s.telegramConnected ? '✅ conectado' : s.reconnectExhausted ? '❌ sin conexión (intentos agotados)' : '❌ desconectado';
    const queue = s.queuePaused ? '⏸️ pausada' : '▶️ activa';
    const oldest = s.queuePending > 0 ? ` (el más antiguo lleva ${msToTime(s.queueOldestAgeMs)})` : '';
    await m.reply(
      `*Puente Telegram*\n` +
      `• Telegram: ${telegram}\n` +
      `• Grupos escuchados: ${s.telegramGroups}\n` +
      `• Destino: ${s.whatsappGroupId}\n` +
      `• Cola: ${queue}, ${s.queuePending} pendiente${s.queuePending === 1 ? '' : 's'}${oldest}\n\n` +
      `*${usedPrefix}bridge restart* · *${usedPrefix}bridge pause* · *${usedPrefix}bridge resume*`,
    );
  },
};
