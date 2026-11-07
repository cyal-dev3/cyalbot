import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WASocket } from 'baileys';

process.env.BOT_OWNERS = '5210000000001';
delete process.env.ANTHROPIC_API_KEY;

const { setLogLevel } = await import('../src/lib/logger.js');
setLogLevel('error');
const { MessageHandler } = await import('../src/handler.js');
const { initDatabase } = await import('../src/lib/database.js');
// Importar el registro no debe arrancar nada: ni conectar a WhatsApp ni dejar timers vivos.
const { loadPlugins } = await import('../src/plugins/index.js');
const { commandAliases } = await import('../src/lib/command-suggest.js');

async function withRegistry(fn: (handler: InstanceType<typeof MessageHandler>) => void | Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'integracion-registry-'));
  const db = await initDatabase(join(dir, 'db.json'));
  const conn = {
    user: { id: '5210000000099:7@s.whatsapp.net', lid: '777000111@lid' },
    sendMessage: async () => ({ key: { remoteJid: 'x', fromMe: true, id: 'BOT' } }),
    groupMetadata: async () => { throw new Error('sin red'); },
  } as unknown as WASocket;
  const handler = new MessageHandler(conn, db);
  try {
    assert.doesNotThrow(() => loadPlugins(handler));
    await fn(handler);
  } finally {
    handler.stop();
    await db.stop();
    await rm(dir, { recursive: true, force: true });
  }
}

test('loadPlugins carga el registro completo sin lanzar y con un volumen razonable', async () => {
  await withRegistry((handler) => {
    assert.ok(handler.getPlugins().size > 150, `solo ${handler.getPlugins().size} plugins`);
    const names = [...handler.getPlugins().keys()];
    for (const name of [
      'group-bot', 'group-grupo', 'group-tempmute', 'group-setwarns', 'download-tiktok', 'download-info', 'media-tomp3', 'media-comprimir',
      'game-casino', 'game-dados', 'game-trivia', 'rpg-boss', 'rpg-pescar', 'rpg-eventos', 'tools-calc', 'tools-recordar', 'admin-bridge', 'rpg-inventario',
    ]) {
      assert.ok(names.includes(name), `falta ${name}`);
    }
    for (const retired of ['admin-notify', 'download-cobalt', 'group-protection', 'rpg-bombardear', 'rpg-esclavizar', 'fun-gay', 'fun-kissall', 'fun-chingatumadre', 'betting-mistipsters']) {
      assert.ok(!names.includes(retired), `${retired} no debería registrarse`);
    }
  });
});

test('cada plugin responde al menos a un alias (o a un patrón) y tiene description o help', async () => {
  await withRegistry((handler) => {
    const problems: string[] = [];
    for (const [name, plugin] of handler.getPlugins()) {
      const aliases = commandAliases(plugin);
      const hasPattern = plugin.command instanceof RegExp && plugin.command.source.length > 0;
      if (aliases.length === 0 && !hasPattern) problems.push(`${name}: sin alias`);
      if (!plugin.description && !(plugin.help && plugin.help.length > 0)) problems.push(`${name}: sin description ni help`);
    }
    assert.deepEqual(problems, []);
  });
});

test('ningún alias colisiona entre plugins y los contextos de juego están registrados', async () => {
  await withRegistry((handler) => {
    const collisions = handler.getAliasCollisions().map((c) => `${c.alias}: ${c.winner} > ${c.loser}`);
    assert.deepEqual(collisions, [], 'alias repetidos entre plugins: cambiar el alias o moverlo a un contexto');
    const contexts = handler.getContexts().map((c) => c.name);
    for (const name of ['duelo', 'dungeon', 'blackjack', 'trivia']) assert.ok(contexts.includes(name), `falta el contexto ${name}`);
  });
});
