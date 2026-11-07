import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setLogLevel } from '../src/lib/logger.js';
import { Database, migrateUser, removeClassBaseStats } from '../src/lib/database.js';
import { mkdir } from 'node:fs/promises';
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

test('init importa la BD JSON antigua una sola vez y la renombra a .migrated', async () => {
  const seed = {
    users: { 'old@s.whatsapp.net': { ...structuredClone(DEFAULT_USER), name: 'Importado', registered: true, money: 123 } },
    chats: {},
    stats: {},
    settings: { autoRead: false, selfMode: false, publicMode: true, botMode: 'public' },
    birthdays: { 'old@s.whatsapp.net': '03-14' }
  };
  await withDb(async (db, dir) => {
    assert.equal(db.getUser('old@s.whatsapp.net').money, 123);
    assert.equal(db.data.birthdays?.['old@s.whatsapp.net'], '03-14');
    const files = await readdir(dir);
    assert.ok(files.includes('database.json.migrated'), files.join(', '));
    assert.ok(!files.includes('database.json'));
    assert.ok(files.includes('database.sqlite'));
    // Una segunda instancia lee de SQLite, no del JSON ya renombrado
    const again = new Database(join(dir, 'database.json'));
    await again.init();
    try {
      assert.equal(again.getUser('old@s.whatsapp.net').name, 'Importado');
      assert.equal(again.data.birthdays?.['old@s.whatsapp.net'], '03-14');
    } finally {
      await again.stop();
    }
  }, seed);
});

test('init aparta un JSON antiguo corrupto y arranca con una base vacía', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cyalbot-db-'));
  const file = join(dir, 'database.json');
  await writeFile(file, '{ esto no es json', 'utf-8');
  const db = new Database(file);
  try {
    await db.init();
    assert.deepEqual(db.data.users, {});
    const files = await readdir(dir);
    assert.ok(files.some(f => f.startsWith('database.json.corrupt-')), `sin archivo corrupt-*: ${files.join(', ')}`);
    assert.equal(await db.save(), true);
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

test('save solo escribe las filas que cambiaron y devuelve false si no puede abrir el archivo', async () => {
  await withDb(async (db) => {
    db.getUser('s@s.whatsapp.net');
    db.getUser('t@s.whatsapp.net');
    assert.equal(await db.save(), true);
    const sqlite = (db as unknown as { sqlite: import('better-sqlite3').Database }).sqlite;
    const count = () => (sqlite.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
    assert.equal(count(), 2);
    db.updateUser('s@s.whatsapp.net', { money: 42 });
    assert.equal(await db.save(), true);
    const row = sqlite.prepare('SELECT data FROM users WHERE key = ?').get('s@s.whatsapp.net') as { data: string };
    assert.equal(JSON.parse(row.data).money, 42);
    delete db.data.users['t@s.whatsapp.net'];
    db.markDirty();
    assert.equal(await db.save(), true);
    assert.equal(count(), 1);
  });

  const broken = new Database(join(tmpdir(), 'cyalbot-no-existe-' + Date.now(), 'sub', 'db.sqlite'));
  await assert.rejects(broken.init());
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
    assert.equal(db.betting.followTipster(chat, 'Tipster Veinte', 'b@s.whatsapp.net'), 'ok');
    assert.equal(db.betting.followTipster(chat, 'Tipster Veintiuno', 'b@s.whatsapp.net'), 'limit');
    assert.deepEqual(db.betting.getTipsterFollowers(chat, 'Tipster Veintiuno'), []);
    assert.equal(db.betting.followTipster(chat, 'Tipster Veinte', 'b@s.whatsapp.net'), 'already');
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

test('migrateUser descarta entradas corruptas del inventario', () => {
  const user = structuredClone(DEFAULT_USER);
  (user.inventory as unknown[]).push(null, 'texto', { itemId: 'palo_madera' }, { itemId: 'palo_madera', quantity: 1 });
  assert.equal(migrateUser(user), true);
  assert.deepEqual(user.inventory, [{ itemId: 'palo_madera', quantity: 1 }]);
  assert.equal(migrateUser(user), false);
});

test('migrateUser repone un stat actual corrupto con el máximo del propio usuario', () => {
  const user = { ...structuredClone(DEFAULT_USER), maxHealth: 40, health: null, stamina: NaN } as unknown as UserRPG;
  assert.equal(migrateUser(user), true);
  assert.equal(user.health, 40);
  assert.equal(user.stamina, DEFAULT_USER.maxStamina);
  assert.equal(user.mana, DEFAULT_USER.mana);
});

test('migrateUser repara la estructura de betting sin crearla', () => {
  const sinBetting = structuredClone(DEFAULT_USER);
  assert.equal(migrateUser(sinBetting), false);
  assert.equal(sinBetting.betting, undefined);

  const user = { ...structuredClone(DEFAULT_USER), betting: { favoriteTipsters: ['a'] } } as unknown as UserRPG;
  assert.equal(migrateUser(user), true);
  assert.deepEqual(user.betting?.favoriteTipsters, ['a']);
  assert.deepEqual(user.betting?.stats, { totalFollowed: 0, wonFollowed: 0, lostFollowed: 0 });
  assert.equal(user.betting?.notifyOnFavorite, true);
  assert.equal(migrateUser(user), false);

  const roto = { ...structuredClone(DEFAULT_USER), betting: { stats: { totalFollowed: 3 }, favoriteTipsters: 'x' } } as unknown as UserRPG;
  migrateUser(roto);
  assert.deepEqual(roto.betting?.favoriteTipsters, []);
  assert.equal(roto.betting?.stats.totalFollowed, 3);
  assert.equal(roto.betting?.stats.wonFollowed, 0);
});

test('followPick funciona con un betting persistido sin stats', async () => {
  const seed = {
    users: { 'u@s.whatsapp.net': { ...structuredClone(DEFAULT_USER), registered: true, betting: { favoriteTipsters: ['a'] } } },
    chats: {},
    stats: {},
    settings: { autoRead: false, selfMode: false, publicMode: true, botMode: 'public' }
  };
  await withDb(async (db) => {
    const chat = 'p@g.us';
    const pick = db.betting.registerPick(chat, {
      tipster: '', tipsterOriginal: 'Pro', description: 'pick', units: 1,
      status: 'pending', createdAt: 1, createdBy: 'c', followers: []
    });
    assert.equal(db.betting.followPick(chat, pick.id, 'u@s.whatsapp.net'), true);
    assert.equal(db.betting.getUserBetting('u@s.whatsapp.net').stats.totalFollowed, 1);
    assert.ok(db.betting.resolvePick(chat, pick.id, true, 'admin'));
    assert.equal(db.betting.getUserBetting('u@s.whatsapp.net').stats.wonFollowed, 1);
  }, seed);
});

test('updateUser clona los objetos que no son del propio usuario', async () => {
  await withDb(async (db) => {
    const jid = 'reset@s.whatsapp.net';
    db.updateUser(jid, { ...DEFAULT_USER });
    const user = db.getUser(jid);
    user.inventory.push({ itemId: 'palo_madera', quantity: 1 });
    user.combatStats.totalKills = 3;
    assert.equal(DEFAULT_USER.inventory.length, 0);
    assert.equal(DEFAULT_USER.combatStats.totalKills, 0);
    assert.equal(db.getUser('nuevo@s.whatsapp.net').inventory.length, 0);

    // Pasar las referencias del propio usuario no las sustituye por copias
    const inventory = user.inventory;
    db.updateUser(jid, { inventory: user.inventory, money: 5 });
    assert.equal(db.getUser(jid).inventory, inventory);
  });
});

test('init propaga errores de E/S en vez de tratarlos como corrupción', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cyalbot-db-'));
  const asDirectory = join(dir, 'database.json');
  await mkdir(asDirectory);
  const db = new Database(asDirectory);
  try {
    await assert.rejects(db.init(), (error: NodeJS.ErrnoException) => error.code === 'EISDIR');
    const files = await readdir(dir);
    assert.ok(files.includes('database.json'));
    assert.ok(!files.some(f => f.includes('corrupt') || f.includes('migrated')));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('la migración de clase sanea primero usuarios incompletos', () => {
  const user = { playerClass: 'guerrero', health: 50 } as unknown as UserRPG;
  migrateUser(user);
  assert.equal(removeClassBaseStats(user), true);
  assert.equal(user.maxHealth, DEFAULT_USER.maxHealth);
  assert.equal(user.attack, DEFAULT_USER.attack);
  assert.equal(user.health, 50);
  assert.ok(Number.isFinite(user.maxMana));

  const crudo = { playerClass: 'guerrero' } as unknown as UserRPG;
  assert.equal(removeClassBaseStats(crudo), true);
  assert.equal(crudo.maxHealth, DEFAULT_USER.maxHealth);
  assert.equal(crudo.health, DEFAULT_USER.maxHealth);
});

test('stop escribe los cambios pendientes y otra instancia los lee', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cyalbot-db-'));
  const file = join(dir, 'database.sqlite');
  const db = new Database(file);
  try {
    await db.init();
    db.updateUser('early@s.whatsapp.net', { money: 15 });
    const inFlight = db.save();
    db.updateUser('late@s.whatsapp.net', { money: 777 });
    db.saveGuild({
      id: 'g1', name: 'Lobos', tag: 'LOB', leader: 'l@s.whatsapp.net', members: ['l@s.whatsapp.net'],
      treasury: 0, level: 1, exp: 0, createdAt: 1, description: ''
    });
    db.updateSettings({ botMode: 'group' });
    await db.stop();
    assert.equal(await inFlight, true);
    assert.equal(db.isDirty, false);

    const again = new Database(file);
    await again.init();
    try {
      assert.equal(again.getUser('early@s.whatsapp.net').money, 15);
      assert.equal(again.getUser('late@s.whatsapp.net').money, 777);
      assert.equal(again.getGuild('g1')?.name, 'Lobos');
      assert.equal(again.getSettings().botMode, 'group');
    } finally {
      await again.stop();
    }
  } finally {
    await db.stop();
    await rm(dir, { recursive: true, force: true });
  }
});
