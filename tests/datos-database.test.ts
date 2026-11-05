import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setLogLevel } from '../src/lib/logger.js';
import { Database, migrateUser, removeClassBaseStats } from '../src/lib/database.js';
import { DEFAULT_USER, type UserRPG } from '../src/types/user.js';
import { DEFAULT_CHAT_SETTINGS } from '../src/types/database.js';
import { CLASSES } from '../src/types/rpg.js';

setLogLevel('error');

async function withDb(fn: (db: Database, dir: string) => Promise<void>, seed?: unknown): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'cyalbot-db-'));
  const file = join(dir, 'database.json');
  if (seed !== undefined) {
    await writeFile(file, typeof seed === 'string' ? seed : JSON.stringify(seed), 'utf-8');
  }
  const db = new Database(file);
  try {
    await db.init();
    await fn(db, dir);
  } finally {
    await db.stop();
    await rm(dir, { recursive: true, force: true });
  }
}

test('DEFAULT_USER no contiene claves con valor undefined', () => {
  for (const [key, value] of Object.entries(DEFAULT_USER)) {
    assert.notEqual(value, undefined, `DEFAULT_USER.${key} es undefined`);
  }
  for (const [key, value] of Object.entries(DEFAULT_CHAT_SETTINGS)) {
    assert.notEqual(value, undefined, `DEFAULT_CHAT_SETTINGS.${key} es undefined`);
  }
});

test('dos usuarios nuevos no comparten objetos anidados', async () => {
  await withDb(async (db) => {
    const a = db.getUser('a@s.whatsapp.net');
    const b = db.getUser('b@s.whatsapp.net');
    a.inventory.push({ itemId: 'palo_madera', quantity: 1 });
    a.achievements.push('primero');
    a.combatStats.totalKills = 7;
    a.equipment.weapon = 'palo_madera';

    assert.equal(b.inventory.length, 0);
    assert.equal(b.achievements.length, 0);
    assert.equal(b.combatStats.totalKills, 0);
    assert.equal(b.equipment.weapon, null);
    assert.equal(DEFAULT_USER.inventory.length, 0);
  });
});

test('dos chats nuevos no comparten warnings', async () => {
  await withDb(async (db) => {
    const warning = { odBy: 'admin', odTo: 'x@s.whatsapp.net', reason: 'spam', timestamp: 1 };
    assert.equal(db.addWarning('g1@g.us', warning), 1);
    assert.equal(db.getAllWarnings('g2@g.us').length, 0);
    assert.equal(DEFAULT_CHAT_SETTINGS.warnings.length, 0);
    db.getChatSettings('g2@g.us').badWords.push('x');
    assert.equal(db.getChatSettings('g1@g.us').badWords.length, 0);
  });
});

test('getUser repetido sobre un usuario completo no marca dirty', async () => {
  await withDb(async (db) => {
    db.getUser('c@s.whatsapp.net');
    assert.equal(db.isDirty, true);
    assert.equal(await db.save(), true);
    assert.equal(db.isDirty, false);
    db.getUser('c@s.whatsapp.net');
    db.getUser('c@s.whatsapp.net');
    assert.equal(db.isDirty, false);
  });
});

test('migrateUser rellena campos faltantes y numéricos inválidos con clones', () => {
  const user = { name: 'x', level: 'abc', maxHealth: NaN, inventory: null } as unknown as UserRPG;
  assert.equal(migrateUser(user), true);
  assert.equal(user.level, 0);
  assert.equal(user.maxHealth, 100);
  assert.deepEqual(user.inventory, []);
  assert.notEqual(user.kissStats, DEFAULT_USER.kissStats);
  assert.equal(user.playerClass, null);
  assert.equal(migrateUser(user), false);
});

test('migrateUser funde elixir_experiencia en elixir_exp', () => {
  const user = structuredClone(DEFAULT_USER);
  user.inventory.push({ itemId: 'elixir_experiencia', quantity: 2 }, { itemId: 'elixir_exp', quantity: 1 });
  assert.equal(migrateUser(user), true);
  assert.deepEqual(user.inventory, [{ itemId: 'elixir_exp', quantity: 3 }]);
});

test('usuarios cargados del disco se migran y conservan sus datos', async () => {
  const seed = {
    users: { 'old@s.whatsapp.net': { name: 'Viejo', registered: true, level: 4, exp: 999, money: 50 } },
    chats: { 'g@g.us': { welcome: false } },
    stats: {},
    settings: { autoRead: false, selfMode: false, publicMode: true, botMode: 'public' }
  };
  await withDb(async (db) => {
    const user = db.getUser('old@s.whatsapp.net');
    assert.equal(user.name, 'Viejo');
    assert.equal(user.level, 4);
    assert.deepEqual(user.inventory, []);
    assert.equal(user.maxHealth, 100);
    const chat = db.getChatSettings('g@g.us');
    assert.equal(chat.welcome, false);
    assert.deepEqual(chat.warnings, []);
    assert.equal(chat.bettingSystem, undefined);
  }, seed);
});

test('resetUser deja un clon limpio independiente', async () => {
  await withDb(async (db) => {
    const jid = 'r@s.whatsapp.net';
    db.updateUser(jid, { money: 999, registered: true });
    const fresh = db.resetUser(jid);
    assert.equal(fresh.money, DEFAULT_USER.money);
    assert.equal(fresh.registered, false);
    fresh.titles.push('nuevo');
    assert.equal(DEFAULT_USER.titles.length, 1);
    assert.equal(db.getUser(jid), fresh);
  });
});

test('init recupera desde .bak si el JSON está corrupto y aparta el archivo dañado', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cyalbot-db-'));
  const file = join(dir, 'database.json');
  const backup = {
    users: { 'bak@s.whatsapp.net': { ...structuredClone(DEFAULT_USER), name: 'Respaldo', registered: true } },
    chats: {},
    stats: {},
    settings: { autoRead: false, selfMode: false, publicMode: true, botMode: 'public' }
  };
  await writeFile(file, '{ esto no es json', 'utf-8');
  await writeFile(`${file}.bak`, JSON.stringify(backup), 'utf-8');

  const db = new Database(file);
  try {
    await db.init();
    assert.equal(db.getUser('bak@s.whatsapp.net').name, 'Respaldo');
    const files = await readdir(dir);
    assert.ok(files.some(f => f.startsWith('database.json.corrupt-')), `sin archivo corrupt-*: ${files.join(', ')}`);
    assert.equal(db.isDirty, true);
    assert.equal(await db.save(), true);
    const written = JSON.parse(await readFile(file, 'utf-8'));
    assert.equal(written.users['bak@s.whatsapp.net'].name, 'Respaldo');
  } finally {
    await db.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

test('init reemplaza secciones raíz que no son objetos planos', async () => {
  const seed = { users: [], chats: 'nope', stats: null, settings: 42 };
  await withDb(async (db) => {
    assert.deepEqual(db.data.users, {});
    assert.deepEqual(db.data.chats, {});
    assert.deepEqual(db.data.stats, {});
    assert.deepEqual(db.data.guilds, {});
    assert.equal(db.getSettings().botMode, 'public');
  }, seed);
});

test('save crea respaldo .bak y devuelve false si no puede escribir', async () => {
  await withDb(async (db, dir) => {
    db.getUser('s@s.whatsapp.net');
    assert.equal(await db.save(), true);
    db.markDirty();
    assert.equal(await db.save(), true);
    const files = await readdir(dir);
    assert.ok(files.includes('database.json.bak'));
  });

  const broken = new Database(join(tmpdir(), 'cyalbot-no-existe-' + Date.now(), 'sub', 'db.json'));
  broken.markDirty();
  assert.equal(await broken.save(), false);
  assert.equal(broken.isDirty, true);
});

test('gremios: getGuild/saveGuild/deleteGuild/listGuilds marcan dirty', async () => {
  await withDb(async (db) => {
    await db.save();
    assert.equal(db.getGuild('g1'), null);
    db.saveGuild({
      id: 'g1', name: 'Lobos', tag: 'LOB', leader: 'l@s.whatsapp.net', members: ['l@s.whatsapp.net'],
      treasury: 0, level: 1, exp: 0, createdAt: 1, description: ''
    });
    assert.equal(db.isDirty, true);
    assert.equal(db.getGuild('g1')?.name, 'Lobos');
    assert.equal(db.listGuilds().length, 1);
    assert.equal(db.deleteGuild('g1'), true);
    assert.equal(db.deleteGuild('g1'), false);
    assert.equal(db.listGuilds().length, 0);
  });
});

test('removeClassBaseStats resta los bonus de clase con mínimos y recorta stats actuales', () => {
  const user = structuredClone(DEFAULT_USER);
  user.playerClass = 'guerrero';
  const base = CLASSES.guerrero.baseStats;
  user.maxHealth = 200 + base.healthBonus;
  user.health = user.maxHealth;
  user.attack = 10 + base.attackBonus;
  user.defense = 5 + base.defenseBonus;
  user.maxStamina = 100 + base.staminaBonus;
  user.stamina = user.maxStamina;

  assert.equal(removeClassBaseStats(user), true);
  assert.equal(user.maxHealth, 200);
  assert.equal(user.health, 200);
  assert.equal(user.attack, 10);
  assert.equal(user.defense, 5);
  assert.equal(user.maxStamina, 100);
  assert.equal(user.stamina, 100);
  assert.equal(user.maxMana, DEFAULT_USER.maxMana);

  const sinClase = structuredClone(DEFAULT_USER);
  assert.equal(removeClassBaseStats(sinClase), false);
});

test('betting: cada usuario tiene su propio betting y followTipster respeta el límite', async () => {
  await withDb(async (db) => {
    const chat = 'bet@g.us';
    const a = db.betting.getUserBetting('a@s.whatsapp.net');
    const b = db.betting.getUserBetting('b@s.whatsapp.net');
    a.favoriteTipsters.push('x');
    assert.equal(b.favoriteTipsters.length, 0);

    for (let i = 0; i < 19; i++) b.favoriteTipsters.push(`t${i}`);
    assert.equal(db.betting.followTipster(chat, 'Tipster Veinte', 'b@s.whatsapp.net'), true);
    assert.equal(db.betting.followTipster(chat, 'Tipster Veintiuno', 'b@s.whatsapp.net'), false);
    assert.deepEqual(db.betting.getTipsterFollowers(chat, 'Tipster Veintiuno'), []);
    assert.equal(db.followTipster(chat, 'Tipster Veinte', 'b@s.whatsapp.net'), false);
  });
});

test('betting: resolvePick aplica maxHistory', async () => {
  await withDb(async (db) => {
    const chat = 'hist@g.us';
    db.betting.updateBettingSystem(chat, { maxHistory: 2 });
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      ids.push(db.betting.registerPick(chat, {
        tipster: '', tipsterOriginal: 'Pro', description: `pick ${i}`, units: 1,
        status: 'pending', createdAt: i, createdBy: 'c', followers: []
      }).id);
    }
    for (const id of ids) {
      assert.ok(db.betting.resolvePick(chat, id, true, 'admin'));
    }
    const system = db.betting.getBettingSystem(chat);
    assert.equal(system.picks.filter(p => p.status !== 'pending').length, 2);
    assert.equal(db.betting.getTipster(chat, 'Pro')?.wins, 4);
  });
});
