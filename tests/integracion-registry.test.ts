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

/**
 * Colisiones de alias toleradas en la ronda 1 ("alias ganador perdedor"). Todas
 * son de áreas que siguen en curso; la ronda 2 debe dejar esta lista vacía.
 */
const ALLOWED_COLLISIONS = new Set<string>([
  // RPG combate: los comandos de duelo y dungeon pasan a CommandContext (registerCombatContexts)
  // y dejan de estar en el registro global; mientras, conviven con los exports @deprecated.
  'atacar rpg-atacar rpg-atacar-duelo',
  'attack rpg-atacar rpg-atacar-duelo',
  'atacar rpg-atacar rpg-dungeon-atacar',
  'attack rpg-atacar rpg-dungeon-atacar',
  'a rpg-atacar-duelo rpg-dungeon-atacar',
  'd rpg-bloquear-duelo rpg-dungeon-defender',
  'defender rpg-bloquear-duelo rpg-dungeon-defender',
  'b rpg-bloquear-duelo rpg-dungeon-defender',
  'bloquear rpg-bloquear-duelo rpg-dungeon-defender',
  'huir rpg-rendirse rpg-dungeon-huir',
  'salir rpg-rendirse rpg-dungeon-huir',
  'rendirse rpg-rendirse rpg-dungeon-huir',
  // RPG combate: el dungeon interactivo y el rápido comparten alias (gana el interactivo a propósito);
  // los exports @deprecated duplican además el plugin bajo dos nombres.
  'dungeon rpg-dungeons-interactivo rpg-dungeon-interactivo',
  'dungeons rpg-dungeons-interactivo rpg-dungeon-interactivo',
  'mazmorra rpg-dungeons-interactivo rpg-dungeon-interactivo',
  'dr rpg-dungeons-interactivo rpg-dungeon-interactivo',
  'dungeon rpg-dungeons-interactivo rpg-dungeon',
  'dungeons rpg-dungeons-interactivo rpg-dungeon',
  'mazmorra rpg-dungeons-interactivo rpg-dungeon',
  'dr rpg-dungeons-interactivo rpg-dungeon',
  'dungeon rpg-dungeons-interactivo rpg-dungeons',
  'dungeons rpg-dungeons-interactivo rpg-dungeons',
  'mazmorra rpg-dungeons-interactivo rpg-dungeons',
  'dr rpg-dungeons-interactivo rpg-dungeons',
  // IA (ai-chat.ts, área herramientas): debe quitar el alias `bot` de aiPlugin para que /bot on|off
  // llegue al interruptor de grupo; mientras, el interruptor se anuncia como /botgrupo.
  'bot ai-chat group-bot',
  // Herramientas: misTipstersPlugin es un export @deprecated del mismo tipsterPlugin; al borrar la
  // entrada 'betting-mistipsters' de plugins/index.ts desaparecen las cinco.
  'tipster betting-tipster betting-mistipsters',
  'tip betting-tipster betting-mistipsters',
  'mistipsters betting-tipster betting-mistipsters',
  'misfavoritos betting-tipster betting-mistipsters',
  'mytipsters betting-tipster betting-mistipsters',
]);

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
    for (const name of ['group-bot', 'group-grupo', 'group-tempmute', 'group-setwarns', 'download-tiktok', 'download-info', 'media-tomp3', 'media-comprimir']) {
      assert.ok(names.includes(name), `falta ${name}`);
    }
    for (const retired of ['admin-notify', 'download-cobalt', 'group-protection']) {
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

test('las colisiones de alias son solo las toleradas de las áreas en curso', async () => {
  await withRegistry((handler) => {
    const found = handler.getAliasCollisions().map((c) => `${c.alias} ${c.winner} ${c.loser}`);
    const unexpected = found.filter((c) => !ALLOWED_COLLISIONS.has(c));
    assert.deepEqual(unexpected, [], 'colisiones nuevas: documentarlas o resolverlas');
    // Si una colisión tolerada desaparece, hay que sacarla de la lista para no dejarla vieja.
    const stale = [...ALLOWED_COLLISIONS].filter((c) => !found.includes(c));
    assert.deepEqual(stale, [], 'colisiones ya resueltas: quitarlas de ALLOWED_COLLISIONS');
  });
});
