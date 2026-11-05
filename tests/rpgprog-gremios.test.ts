import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setLogLevel } from '../src/lib/logger.js';
import { Database, initDatabase } from '../src/lib/database.js';
import { GUILD } from '../src/constants/rpg.js';
import { addGuildExp, removeGuildExp, guildExpForMoney, gremioPlugin, GUILD_MONEY_PER_EXP } from '../src/plugins/rpg-gremios.js';
import type { Guild } from '../src/types/database.js';
import type { MessageContext } from '../src/types/message.js';

setLogLevel('error');

async function withDb(fn: (db: Database) => Promise<void> | void): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'cyalbot-rpgprog-gremios-'));
  // Los handlers leen la BD global con getDatabase()
  const db = await initDatabase(join(dir, 'database.json'));
  try {
    await fn(db);
  } finally {
    await db.stop();
    await rm(dir, { recursive: true, force: true });
  }
}

function guild(overrides: Partial<Guild> = {}): Guild {
  return { id: 'g1', name: 'Prueba', tag: 'PRU', leader: 'l', members: ['l'], treasury: 0, level: 1, exp: 0, createdAt: 1, description: '', ...overrides };
}

function fakeCtx(db: Database, sender: string, args: string[]): { ctx: MessageContext; replies: string[] } {
  const replies: string[] = [];
  const m = {
    key: {}, sender, chat: 'grupo@g.us', text: args.join(' '), fromMe: false, isGroup: true, pushName: 'Lider', mentionedJid: [],
    reply: async (text: string) => { replies.push(text); return undefined; },
    react: async () => {}
  };
  const ctx = {
    conn: {}, m, text: args.join(' '), args, command: 'gremio', usedPrefix: '/', isOwner: false, isAdmin: false, isBotAdmin: false, isGroup: true,
    handler: { isCompactMode: () => false }, chatSettings: {},
    get user() { return db.getUser(sender); },
    send: async () => undefined,
    target: () => null
  } as unknown as MessageContext;
  return { ctx, replies };
}

test('removeGuildExp deshace exactamente la XP de addGuildExp, bajando de nivel si hace falta', () => {
  const g = guild();
  const gained = addGuildExp(g, GUILD.XP_PER_LEVEL + 10); // nivel 2 con 10 XP
  assert.equal(gained, 1);
  assert.equal(g.level, 2);
  assert.equal(g.exp, 10);

  const lost = removeGuildExp(g, GUILD.XP_PER_LEVEL + 10);
  assert.equal(lost, 1);
  assert.equal(g.level, 1);
  assert.equal(g.exp, 0);

  // Nunca por debajo de nivel 1 / 0 XP
  assert.equal(removeGuildExp(g, 99_999), 0);
  assert.equal(g.level, 1);
  assert.equal(g.exp, 0);

  assert.equal(guildExpForMoney(GUILD_MONEY_PER_EXP * 7 + 99), 7);
});

test('gremio: el ciclo depositar todo / retirar todo no farmea XP ni niveles', async () => {
  await withDb(async (db) => {
    const leader = 'lider@s.whatsapp.net';
    db.updateUser(leader, { registered: true, name: 'Lider', money: GUILD.CREATE_COST + 100_000, level: 60 });

    await gremioPlugin.handler(fakeCtx(db, leader, ['crear', 'Farmeo']).ctx);
    const created = db.listGuilds()[0];
    assert.ok(created);
    assert.equal(db.getUser(leader).money, 100_000);

    for (let i = 0; i < 5; i++) {
      await gremioPlugin.handler(fakeCtx(db, leader, ['depositar', 'todo']).ctx);
      await gremioPlugin.handler(fakeCtx(db, leader, ['retirar', 'todo']).ctx);
    }

    const after = db.getGuild(created.id)!;
    assert.equal(db.getUser(leader).money, 100_000);
    assert.equal(after.treasury, 0);
    assert.equal(after.level, 1);
    assert.equal(after.exp, 0);

    // Un depósito que se queda sí cuenta
    await gremioPlugin.handler(fakeCtx(db, leader, ['depositar', '50000']).ctx);
    const kept = db.getGuild(created.id)!;
    assert.equal(kept.treasury, 50_000);
    assert.equal(kept.exp, guildExpForMoney(50_000));
  });
});
