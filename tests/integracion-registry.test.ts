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
 * Pares (ganador, perdedor) cuyas colisiones de alias se toleran en la ronda 1.
 * Se comparan por nombre de plugin y no por alias porque las áreas en curso
 * siguen renombrando comandos; la ronda 2 debe dejar esta lista vacía.
 */
const ALLOWED_COLLISION_PAIRS: Record<string, string> = {
  // RPG combate: los comandos de duelo y dungeon pasan a CommandContext (registerCombatContexts) y
  // salen del registro global; mientras, los exports @deprecated conviven con el ataque PvE.
  'rpg-atacar>rpg-atacar-duelo': 'atacar/attack del duelo vs ataque PvE',
  'rpg-atacar>rpg-dungeon-atacar': 'atacar/attack del dungeon vs ataque PvE',
  'rpg-atacar-duelo>rpg-dungeon-atacar': 'a/atk: misma acción en duelo y dungeon',
  'rpg-bloquear-duelo>rpg-dungeon-defender': 'd/b/defender/bloquear: misma acción en duelo y dungeon',
  'rpg-rendirse>rpg-dungeon-huir': 'huir/salir/rendirse/escapar: misma acción en duelo y dungeon',
  // RPG combate: el dungeon interactivo y el rápido comparten alias (gana el interactivo a propósito) y
  // los exports @deprecated registran además el mismo plugin bajo dos nombres.
  'rpg-dungeons-interactivo>rpg-dungeon-interactivo': 'dungeon/dungeons/mazmorra/dr duplicados por el export deprecado',
  'rpg-dungeons-interactivo>rpg-dungeon': 'dungeon rápido sombreado por el interactivo (solo /dr lo alcanza hoy)',
  'rpg-dungeons-interactivo>rpg-dungeons': 'listado del dungeon rápido sombreado por el interactivo',
  // IA (ai-chat.ts, área herramientas): debe quitar el alias `bot` de aiPlugin para que /bot on|off llegue
  // al interruptor de grupo; mientras, el interruptor se anuncia como /botgrupo.
  'ai-chat>group-bot': 'alias bot de la IA vs interruptor del bot por grupo',
  // Herramientas: misTipstersPlugin es un export @deprecated del mismo tipsterPlugin; al borrar la entrada
  // 'betting-mistipsters' de plugins/index.ts desaparecen las cinco colisiones.
  'betting-tipster>betting-mistipsters': 'tipster/tip/mistipsters/misfavoritos/mytipsters duplicados por el export deprecado',
};

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

test('las colisiones de alias son solo las toleradas de las áreas en curso', async (t) => {
  await withRegistry((handler) => {
    const collisions = handler.getAliasCollisions();
    const unexpected = collisions
      .filter((c) => !(`${c.winner}>${c.loser}` in ALLOWED_COLLISION_PAIRS))
      .map((c) => `${c.alias}: ${c.winner} > ${c.loser}`);
    assert.deepEqual(unexpected, [], 'colisiones nuevas: documentarlas en ALLOWED_COLLISION_PAIRS o resolverlas');
    assert.ok(collisions.every((c) => c.winner !== c.loser), 'un alias repetido dentro de un plugin no es colisión');
    const seen = new Set(collisions.map((c) => `${c.winner}>${c.loser}`));
    for (const pair of Object.keys(ALLOWED_COLLISION_PAIRS)) {
      if (!seen.has(pair)) t.diagnostic(`par tolerado ya sin colisiones, quitar de la lista: ${pair}`);
    }
    t.diagnostic(`${collisions.length} colisiones toleradas: ${collisions.map((c) => c.alias).join(', ')}`);
  });
});
