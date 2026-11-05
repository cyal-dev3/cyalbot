import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WASocket, proto, GroupMetadata } from 'baileys';

process.env.BOT_OWNERS = '5210000000001';
process.env.BOT_PREFIX = '!/.';
delete process.env.ANTHROPIC_API_KEY;

const { setLogLevel } = await import('../src/lib/logger.js');
setLogLevel('error');
const { MessageHandler } = await import('../src/handler.js');
const { initDatabase } = await import('../src/lib/database.js');
const { invalidateGroupMetadata } = await import('../src/lib/group-events.js');
const { registerCombatContexts } = await import('../src/plugins/rpg-combate-router.js');
const { activeDuels, createDuel, cancelDuel } = await import('../src/plugins/rpg-duelo.js');
const { activeDungeons, cancelDungeon, stopDungeonCleanup } = await import('../src/plugins/rpg-dungeon-interactivo.js');
const { clearBusy, setBusy, getBusy } = await import('../src/lib/rpg-combat.js');
const { addItem, addMaterial, countItem } = await import('../src/lib/rpg-inventory.js');
const { LIMITS } = await import('../src/constants/rpg.js');
type PluginHandler = import('../src/types/message.js').PluginHandler;

const A = '5210000000002@s.whatsapp.net';
const B = '5210000000003@s.whatsapp.net';
const BOT = '5210000000099@s.whatsapp.net';
const GROUP = '120363000000000001@g.us';
const GROUP2 = '120363000000000002@g.us';

interface Sent {
  jid: string;
  text: string;
}

function fakeConn(): { sent: Sent[]; conn: WASocket } {
  const sent: Sent[] = [];
  const metadata = (id: string): GroupMetadata => ({
    id,
    subject: 'Grupo',
    owner: A,
    participants: [
      { id: A, admin: null },
      { id: B, admin: null },
      { id: BOT, admin: 'admin' }
    ]
  } as unknown as GroupMetadata);
  let counter = 0;
  const conn = {
    user: { id: BOT },
    sendMessage: async (jid: string, content: Record<string, unknown>) => {
      sent.push({ jid, text: String(content.text ?? '') });
      return { key: { remoteJid: jid, fromMe: true, id: `BOT${++counter}` } };
    },
    groupMetadata: async (id: string) => metadata(id),
    updateMediaMessage: async (m: proto.IWebMessageInfo) => m,
    sendPresenceUpdate: async () => {},
    groupParticipantsUpdate: async () => []
  } as unknown as WASocket;
  return { sent, conn };
}

let msgCounter = 0;
function message(text: string, sender: string = A, chat: string = GROUP): proto.IWebMessageInfo {
  return {
    key: { remoteJid: chat, fromMe: false, id: `MSG${++msgCounter}`, participant: sender },
    pushName: 'Tester',
    message: { extendedTextMessage: { text } }
  };
}

type HandlerInstance = InstanceType<typeof MessageHandler>;
type Db = Awaited<ReturnType<typeof initDatabase>>;

async function withHandler(fn: (h: HandlerInstance, sent: Sent[], db: Db) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'cyalbot-ctx-'));
  const db = await initDatabase(join(dir, 'database.json'));
  const fake = fakeConn();
  invalidateGroupMetadata(GROUP);
  invalidateGroupMetadata(GROUP2);
  const h = new MessageHandler(fake.conn, db);
  registerCombatContexts(h);
  try {
    await fn(h, fake.sent, db);
  } finally {
    for (const jid of [A, B]) {
      if (activeDungeons.has(jid)) await cancelDungeon(jid);
      clearBusy(jid);
    }
    activeDuels.clear();
    stopDungeonCleanup();
    h.stop();
    await db.stop();
    await rm(dir, { recursive: true, force: true });
  }
}

function seed(db: Db, jid: string, over: Record<string, unknown> = {}) {
  const user = db.getUser(jid);
  Object.assign(user, {
    registered: true, name: jid.split('@')[0], level: 10, money: 5000, health: 500, maxHealth: 500,
    mana: 100, maxMana: 100, stamina: 100, maxStamina: 100, attack: 40, defense: 10, critChance: 0
  }, over);
  db.updateUser(jid, user);
  return db.getUser(jid);
}

async function withRandom<T>(value: number, fn: () => Promise<T>): Promise<T> {
  const original = Math.random;
  Math.random = () => value;
  try {
    return await fn();
  } finally {
    Math.random = original;
  }
}

test('duelo: "golpe brutal" sin prefijo lanza la habilidad y "a ver que pasa" no es un ataque', async () => {
  await withHandler(async (h, sent, db) => {
    seed(db, A, { playerClass: 'guerrero' });
    seed(db, B);
    const duel = createDuel({ jid: A, user: db.getUser(A) }, { jid: B, user: db.getUser(B) }, GROUP, 0);
    activeDuels.set(GROUP, duel);
    setBusy(A, 'duel');
    setBusy(B, 'duel');

    await withRandom(0.5, async () => {
      await h.handle([message('golpe brutal')]);
      assert.equal(duel.totalActions, 1);
      assert.match(duel.log.at(-1) ?? '', /Golpe Brutal/);
      assert.ok(duel.players.challenger.mana < 100, 'gastó maná');

      duel.players.challenger.lastAction = 0;
      await h.handle([message('a ver que pasa'), message('d nada'), message('estado del tiempo')]);
      assert.equal(duel.totalActions, 1, 'frases normales no son acciones');

      await h.handle([message('a')]);
      assert.equal(duel.totalActions, 2);
      assert.match(duel.log.at(-1) ?? '', /ataca/);

      duel.players.challenger.lastAction = 0;
      await h.handle([message('/a mas texto')]);
      assert.equal(duel.totalActions, 3, 'con prefijo se acepta aunque lleve texto');
    });

    // El rival en otro grupo no actúa sobre este duelo
    duel.players.target.lastAction = 0;
    await h.handle([message('a', B, GROUP2)]);
    assert.equal(duel.totalActions, 3);
    assert.ok(sent.every(s => s.jid === GROUP));
  });
});

test('aceptar: sin reto pendiente el alias queda libre para otros juegos; con reto el duelo arranca con escrow', async () => {
  await withHandler(async (h, sent, db) => {
    const calls: string[] = [];
    const juego: PluginHandler = { command: ['aceptar', 'acepto'], handler: async (ctx) => { calls.push(ctx.m.sender); } };
    h.registerPlugin('game-aceptar', juego);
    assert.equal(h.findPlugin('aceptar')?.name, 'game-aceptar', 'el área no registra aceptar globalmente');

    seed(db, A);
    seed(db, B);
    await h.handle([message('/aceptar', B)]);
    assert.deepEqual(calls, [B]);
    assert.equal(sent.length, 0, 'el duelo no responde sin reto');

    await h.handle([message(`/duelo ${B.split('@')[0]} 100`, A)]);
    assert.match(sent.at(-1)?.text ?? '', /DESAFÍO/);
    await h.handle([message('/aceptar', B, GROUP2)]);
    assert.equal(activeDuels.has(GROUP), false, 'aceptar desde otro grupo no vale');
    await h.handle([message('/aceptar', B)]);
    assert.equal(activeDuels.has(GROUP), true);
    assert.deepEqual(calls, [B], 'con reto pendiente lo resuelve el duelo, no el juego');
    assert.equal(db.getUser(A).money, 4900);
    assert.equal(db.getUser(B).money, 4900);
    assert.equal(activeDuels.get(GROUP)?.pot, 200);

    const refund = cancelDuel(db, GROUP);
    assert.equal(refund?.reason, 'refund');
    assert.equal(db.getUser(A).money, 5000);
    assert.equal(getBusy(A), null);
  });
});

test('dungeon: las acciones solo valen en el chat de la sesión y los turnos perdidos se reinician al actuar', async () => {
  await withHandler(async (h, sent, db) => {
    seed(db, A, { level: 1 });
    await h.handle([message('/dungeon cueva_slimes')]);
    const session = activeDungeons.get(A);
    assert.ok(session, 'la sesión se creó');
    assert.equal(getBusy(A), 'dungeon');
    const monsterHealth = session.monsterHealth;

    await h.handle([message('a', A, GROUP2), message('a lo mejor', A, GROUP)]);
    assert.equal(session.monsterHealth, monsterHealth, 'ni otro chat ni frases normales atacan');
    assert.ok(sent.every(s => s.jid === GROUP));

    session.timeouts = 2;
    await h.handle([message('a')]);
    assert.ok(session.monsterHealth < monsterHealth || session.monstersKilled > 0, 'el ataque llegó');
    assert.equal(session.timeouts, 0, 'una acción reinicia los turnos perdidos seguidos');
  });
});

test('forja: la confirmación sobrevive a mensajes en otros chats, "si claro" no confirma y "si" sí', async () => {
  await withHandler(async (h, sent, db) => {
    const user = seed(db, A, { money: 100_000 });
    addItem(user, 'espada_hierro', 1, { enhanceLevel: 5 });
    user.equipment.weapon = 'espada_hierro';
    addMaterial(user, 'titanio', 5);
    addMaterial(user, 'rubi', 1);
    db.updateUser(A, user);

    await h.handle([message('/forja mejorar arma')]);
    console.log('DBG', JSON.stringify(sent));
    assert.match(sent.at(-1)?.text ?? '', /MEJORA PELIGROSA/);
    const level = () => db.getUser(A).inventory.find(e => e.itemId === 'espada_hierro')?.enhanceLevel;

    await h.handle([message('hola a todos', A, GROUP2), message('si claro', A, GROUP)]);
    assert.equal(level(), 5, 'ni otro chat ni "si claro" tocan la mejora');

    await withRandom(0, async () => {
      await h.handle([message('si')]);
    });
    assert.equal(level(), 6, 'el "si" a secas sigue vigente y confirma');
    assert.match(sent.at(-1)?.text ?? '', /MEJORA EXITOSA/);

    // Con prefijo también vale, para cuando el contexto no está registrado
    await h.handle([message('/forja mejorar arma'), message('/forja cancelar')]);
    assert.match(sent.at(-1)?.text ?? '', /cancelada/);
  });
});

test('forja: craftear con el inventario lleno no cobra ni consume', async () => {
  await withHandler(async (h, sent, db) => {
    const user = seed(db, A, { money: 1000 });
    addItem(user, 'vendaje', LIMITS.MAX_INVENTORY_SIZE);
    addMaterial(user, 'hierro', 5);
    addMaterial(user, 'carbon', 3);
    addMaterial(user, 'cuero', 1);
    db.updateUser(A, user);

    await h.handle([message('/forja craftear espada_hierro')]);
    assert.match(sent.at(-1)?.text ?? '', /lleno/);
    assert.equal(db.getUser(A).money, 1000);
    assert.equal(db.getUser(A).forgeMaterials.hierro, 5);
    assert.equal(countItem(db.getUser(A), 'espada_hierro'), 0);
  });
});
