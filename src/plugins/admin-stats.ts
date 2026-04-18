/**
 * 📊 Plugin admin-stats - CYALTRONIC
 * Dashboard owner-only con métricas del bot para monitoreo en VPS.
 */

import { statSync } from 'node:fs';
import type { PluginHandler, MessageContext } from '../types/message.js';
import { formatNumber } from '../lib/utils.js';
import { getDatabase } from '../lib/database.js';
import { getReconnectStats } from '../index.js';
import { getCleanupStats } from '../lib/cleanup-scheduler.js';

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const min = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${d}d ${h}h ${min}m ${sec}s`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export const adminStatsPlugin: PluginHandler = {
  command: /^(stats|adminstats|botstats)$/i,
  tags: ['admin'],
  help: ['stats — Dashboard del bot (solo owner)'],
  owner: true,
  handler: async (ctx: MessageContext) => {
    const { m } = ctx;
    const db = getDatabase();

    const users = Object.entries(db.data.users).filter(([_, u]) => u.registered);
    const totalUsers = users.length;

    const topRich = [...users]
      .sort(([, a], [, b]) => (b.money + b.bank) - (a.money + a.bank))
      .slice(0, 10);
    const topDungeon = [...users]
      .sort(([, a], [, b]) => (b.combatStats?.dungeonsCompleted ?? 0) - (a.combatStats?.dungeonsCompleted ?? 0))
      .slice(0, 5);

    let dbSize = 0;
    try { dbSize = statSync('database.json').size; } catch { /* ignore */ }

    const mem = process.memoryUsage();
    const reconnect = getReconnectStats();
    const cleanup = getCleanupStats();

    const richBody = topRich
      .map(([jid, u], i) => `${i + 1}. @${jid.split('@')[0]} — ${formatNumber(u.money + u.bank)} 💰`)
      .join('\n');
    const dungBody = topDungeon
      .map(([jid, u], i) => `${i + 1}. @${jid.split('@')[0]} — ${u.combatStats?.dungeonsCompleted ?? 0} dungeons`)
      .join('\n') || '  (sin datos)';

    const mentions = [...topRich, ...topDungeon].map(([jid]) => jid);

    const lastCleanup = cleanup.lastRunAt
      ? new Date(cleanup.lastRunAt).toLocaleString('es-MX')
      : 'nunca';

    const body =
      `📊 *CYALTRONIC — Dashboard*\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `👥 Usuarios registrados: *${formatNumber(totalUsers)}*\n` +
      `💾 database.json: *${formatBytes(dbSize)}*\n` +
      `🧠 RSS: *${formatBytes(mem.rss)}* · Heap: *${formatBytes(mem.heapUsed)}* / ${formatBytes(mem.heapTotal)}\n` +
      `⏱️ Uptime: *${formatUptime(process.uptime() * 1000)}*\n` +
      `🔄 Reconexiones: *${reconnect.count}* (intentos: ${reconnect.attempts})\n` +
      `🧹 Último cleanup: ${lastCleanup}\n` +
      `🧹 Liberado total: ${formatBytes(cleanup.totalBytesFreed)} · ${cleanup.totalFilesDeleted} archivos\n\n` +
      `💰 *Top 10 Ricos:*\n${richBody || '  (sin datos)'}\n\n` +
      `🏰 *Top 5 Dungeons:*\n${dungBody}`;

    await ctx.conn.sendMessage(m.chat, { text: body, mentions });
  }
};
