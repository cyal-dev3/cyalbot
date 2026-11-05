import { statSync } from 'node:fs';
import type { PluginHandler, MessageContext } from '../types/message.js';
import { CONFIG } from '../config.js';
import { formatNumber, msToTime, mentionTag } from '../lib/utils.js';
import { getDatabase } from '../lib/database.js';
import { runtimeStats } from '../lib/runtime-stats.js';
import { getCleanupStats } from '../lib/cleanup-scheduler.js';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export const adminStatsPlugin: PluginHandler = {
  command: ['botstats', 'adminstats'],
  tags: ['admin'],
  help: ['botstats - Estado del proceso, base de datos y rankings (owner)'],
  owner: true,

  handler: async (ctx: MessageContext) => {
    const { m } = ctx;
    const db = getDatabase();

    const users = db.getRegisteredUsers();
    const topRich = [...users]
      .sort(([, a], [, b]) => (b.money + b.bank) - (a.money + a.bank))
      .slice(0, 10);
    const topDungeon = [...users]
      .sort(([, a], [, b]) => (b.combatStats?.dungeonsCompleted ?? 0) - (a.combatStats?.dungeonsCompleted ?? 0))
      .slice(0, 5);

    let dbSize = 0;
    try {
      dbSize = statSync(CONFIG.databasePath).size;
    } catch {
      // Sin archivo todavía (primera ejecución): se muestra 0.
    }

    const mem = process.memoryUsage();
    const cleanup = getCleanupStats();

    const richBody = topRich
      .map(([jid, u], i) => `${i + 1}. ${mentionTag(jid)} — ${formatNumber(u.money + u.bank)} 💰`)
      .join('\n') || '  (sin datos)';
    const dungBody = topDungeon
      .map(([jid, u], i) => `${i + 1}. ${mentionTag(jid)} — ${u.combatStats?.dungeonsCompleted ?? 0} dungeons`)
      .join('\n') || '  (sin datos)';
    const mentions = [...topRich, ...topDungeon].map(([jid]) => jid);

    const lastCleanup = cleanup.lastRunAt ? new Date(cleanup.lastRunAt).toLocaleString('es-MX') : 'nunca';
    const lastError = runtimeStats.lastErrorAt
      ? `${runtimeStats.lastError} (hace ${msToTime(Date.now() - runtimeStats.lastErrorAt)})`
      : 'ninguno';

    const body =
      `📊 *${CONFIG.botName} — Dashboard*\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `👥 Usuarios registrados: *${formatNumber(users.length)}*\n` +
      `💾 ${CONFIG.databasePath}: *${formatBytes(dbSize)}*\n` +
      `🧠 RSS: *${formatBytes(mem.rss)}* · Heap: *${formatBytes(mem.heapUsed)}* / ${formatBytes(mem.heapTotal)}\n` +
      `⏱️ Uptime: *${msToTime(process.uptime() * 1000)}*\n` +
      `🔄 Reconexiones: *${runtimeStats.reconnects}* (intentos: ${runtimeStats.reconnectAttempts})\n` +
      `🛑 Errores: *${runtimeStats.errors}* · Último: ${lastError}\n` +
      `🧹 Último cleanup: ${lastCleanup}\n` +
      `🧹 Liberado total: ${formatBytes(cleanup.totalBytesFreed)} · ${cleanup.totalFilesDeleted} archivos\n\n` +
      `💰 *Top 10 Ricos:*\n${richBody}\n\n` +
      `🏰 *Top 5 Dungeons:*\n${dungBody}`;

    await ctx.conn.sendMessage(m.chat, { text: body, mentions });
  },
};
