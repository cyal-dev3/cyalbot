import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setLogLevel } from '../src/lib/logger.js';
import { Database } from '../src/lib/database.js';
import type { MessageContext } from '../src/types/message.js';
import { ITEMS, type Item } from '../src/types/rpg.js';
import { PVP, SPECIAL_ITEMS } from '../src/constants/rpg.js';
import { addItem, countItem } from '../src/lib/rpg-inventory.js';
import { getDropLuck, getExpMultiplier } from '../src/lib/rpg-combat.js';
import { useSpecialItem, isSpecialItem, permanentExpStacks, mysteryBoxPool } from '../src/plugins/rpg-items-especiales.js';

setLogLevel('error');

const ME = '5210000000001@s.whatsapp.net';
const OTHER = '5210000000002@s.whatsapp.net';
const ADMIN = '5210000000003@s.whatsapp.net';
const GROUP = 'grupo@g.us';

async function withDb(fn: (db: Database) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'cyalbot-items-'));
  const db = new Database(join(dir, 'database.json'));
  try {
    await db.init();
    await fn(db);
  } finally {
    await db.stop();
    await rm(dir, { recursive: true, force: true });
  }
}

interface FakeCalls {
  muted: string[];
  kicked: string[];
  autoMute: boolean[];
}

function fakeCtx(over: Partial<{ isGroup: boolean; isBotAdmin: boolean; mentioned: string[]; participants: string[]; admins: string[] }> = {}): { ctx: MessageContext; calls: FakeCalls } {
  const calls: FakeCalls = { muted: [], kicked: [], autoMute: [] };
  const isGroup = over.isGroup ?? true;
  const ctx = {
    m: { sender: ME, chat: isGroup ? GROUP : ME, mentionedJid: over.mentioned ?? [], quoted: undefined, text: '', isGroup, reply: async () => undefined, react: async () => undefined },
    args: [],
    text: '',
    isGroup,
    isBotAdmin: over.isBotAdmin ?? true,
    isOwner: false,
    isAdmin: false,
    participants: over.participants ?? [ME, OTHER, ADMIN],
    groupAdmins: over.admins ?? [ADMIN],
    handler: {
      muteUser: (_g: string, jid: string) => calls.muted.push(jid),
      unmuteUser: () => true,
      setAutoMute: (_g: string, enabled: boolean) => calls.autoMute.push(enabled)
    },
    conn: {
      user: { id: '5210000000099@s.whatsapp.net' },
      groupParticipantsUpdate: async (_g: string, jids: string[]) => { calls.kicked.push(...jids); }
    }
  } as unknown as MessageContext;
  return { ctx, calls };
}

function give(db: Database, jid: string, itemId: string, over: Record<string, unknown> = {}) {
  const user = db.getUser(jid);
  Object.assign(user, { registered: true, name: jid.split('@')[0], money: 1000 }, over);
  addItem(user, itemId, 1);
  db.updateUser(jid, user);
  return user;
}

test('todos los items especiales de la tienda de diamantes tienen handler', () => {
  for (const id of ['ticket_muteo', 'ticket_kick', 'bomba_dinero', 'escudo_robo', 'escudo_antibombas', 'seguro_vida', 'cofre_oro', 'pocion_suerte', 'caja_misteriosa', 'cambio_nombre', 'reset_clase', 'doble_exp_permanente']) {
    assert.equal(isSpecialItem(id), true, id);
  }
  assert.equal(isSpecialItem('pocion_salud'), false);
});

test('un item sin efecto implementado no se consume', async () => {
  await withDb(async (db) => {
    const user = give(db, ME, 'vendaje');
    const fake: Item = { ...ITEMS.vendaje, id: 'misterio_sin_efecto', consumeEffect: {} };
    user.inventory.push({ itemId: fake.id, quantity: 1 });
    const result = await useSpecialItem(fakeCtx().ctx, db, user, fake, '');
    assert.equal(result.consumed, false);
    assert.equal(user.inventory.find(i => i.itemId === fake.id)?.quantity, 1);
  });
});

test('cofre_oro da dinero y consume; escudos y seguro fijan las protecciones', async () => {
  await withDb(async (db) => {
    const user = give(db, ME, 'cofre_oro', { money: 100 });
    const original = Math.random;
    Math.random = () => 0.5;
    try {
      const result = await useSpecialItem(fakeCtx().ctx, db, user, ITEMS.cofre_oro, '');
      assert.equal(result.consumed, true);
      assert.equal(db.getUser(ME).money, 100 + 10_000);
      assert.equal(countItem(db.getUser(ME), 'cofre_oro'), 0);
    } finally {
      Math.random = original;
    }

    const before = Date.now();
    for (const [id, field, duration] of [
      ['escudo_robo', 'shieldRobo', PVP.SHIELD_DURATION],
      ['escudo_antibombas', 'shieldBombas', PVP.SHIELD_DURATION],
      ['seguro_vida', 'seguroVida', SPECIAL_ITEMS.LIFE_INSURANCE_DURATION]
    ] as const) {
      const u = give(db, ME, id);
      const r = await useSpecialItem(fakeCtx().ctx, db, u, ITEMS[id], '');
      assert.equal(r.consumed, true, id);
      const value = db.getUser(ME)[field];
      assert.ok(value >= before + duration && value <= Date.now() + duration, `${id} fija ${field}`);
      assert.equal(countItem(db.getUser(ME), id), 0);
    }
  });
});

test('pocion_suerte crea el buff dropLuck que leen los drops', async () => {
  await withDb(async (db) => {
    const user = give(db, ME, 'pocion_suerte');
    const result = await useSpecialItem(fakeCtx().ctx, db, user, ITEMS.pocion_suerte, '');
    assert.equal(result.consumed, true);
    assert.equal(getDropLuck(db.getUser(ME)), SPECIAL_ITEMS.LUCK_POTION.DROP_BONUS);
  });
});

test('doble_exp_permanente acumula hasta 3 y la cuarta se rechaza sin consumir', async () => {
  await withDb(async (db) => {
    const user = give(db, ME, 'doble_exp_permanente');
    user.inventory[0].quantity = 4;
    db.updateUser(ME, user);
    for (let i = 1; i <= 3; i++) {
      const r = await useSpecialItem(fakeCtx().ctx, db, db.getUser(ME), ITEMS.doble_exp_permanente, '');
      assert.equal(r.consumed, true);
      assert.equal(permanentExpStacks(db.getUser(ME)), i);
    }
    assert.equal(Number(getExpMultiplier(db.getUser(ME)).toFixed(2)), 1.75);
    const fourth = await useSpecialItem(fakeCtx().ctx, db, db.getUser(ME), ITEMS.doble_exp_permanente, '');
    assert.equal(fourth.consumed, false);
    assert.equal(countItem(db.getUser(ME), 'doble_exp_permanente'), 1);
  });
});

test('cambio_nombre exige nombre válido; reset_clase exige tener clase', async () => {
  await withDb(async (db) => {
    const user = give(db, ME, 'cambio_nombre');
    const empty = await useSpecialItem(fakeCtx().ctx, db, user, ITEMS.cambio_nombre, '');
    assert.equal(empty.consumed, false);
    const tooLong = await useSpecialItem(fakeCtx().ctx, db, user, ITEMS.cambio_nombre, 'x'.repeat(SPECIAL_ITEMS.NAME_LENGTH.MAX + 1));
    assert.equal(tooLong.consumed, false);
    const ok = await useSpecialItem(fakeCtx().ctx, db, user, ITEMS.cambio_nombre, 'Nuevo Nombre');
    assert.equal(ok.consumed, true);
    assert.equal(db.getUser(ME).name, 'Nuevo Nombre');

    const noClass = give(db, ME, 'reset_clase', { playerClass: null });
    assert.equal((await useSpecialItem(fakeCtx().ctx, db, noClass, ITEMS.reset_clase, '')).consumed, false);
    const withClass = give(db, ME, 'reset_clase', { playerClass: 'mago', mana: 500 });
    const reset = await useSpecialItem(fakeCtx().ctx, db, withClass, ITEMS.reset_clase, '');
    assert.equal(reset.consumed, true);
    assert.equal(db.getUser(ME).playerClass, null);
    assert.ok(db.getUser(ME).mana <= db.getUser(ME).maxMana, 'el maná se recorta al nuevo máximo');
  });
});

test('caja_misteriosa entrega un equipable raro o mejor que no sea exclusivo de diamantes', async () => {
  await withDb(async (db) => {
    const pool = mysteryBoxPool();
    assert.ok(pool.length > 0);
    assert.ok(pool.every(i => i.rarity !== 'comun' && ['weapon', 'armor', 'accessory'].includes(i.type)));
    assert.ok(!pool.some(i => ['espada_celestial', 'armadura_celestial', 'corona_reyes'].includes(i.id)));

    const user = give(db, ME, 'caja_misteriosa');
    const result = await useSpecialItem(fakeCtx().ctx, db, user, ITEMS.caja_misteriosa, '');
    assert.equal(result.consumed, true);
    const saved = db.getUser(ME);
    assert.equal(countItem(saved, 'caja_misteriosa'), 0);
    assert.ok(saved.inventory.some(i => pool.some(p => p.id === i.itemId)));
  });
});

test('ticket_muteo: requiere grupo, bot admin y un objetivo válido; nunca admins ni el bot', async () => {
  await withDb(async (db) => {
    give(db, OTHER, 'vendaje');
    const user = give(db, ME, 'ticket_muteo');

    assert.equal((await useSpecialItem(fakeCtx({ isGroup: false }).ctx, db, user, ITEMS.ticket_muteo, '')).consumed, false);
    assert.equal((await useSpecialItem(fakeCtx({ isBotAdmin: false, mentioned: [OTHER] }).ctx, db, user, ITEMS.ticket_muteo, '')).consumed, false);
    assert.equal((await useSpecialItem(fakeCtx().ctx, db, user, ITEMS.ticket_muteo, '')).consumed, false, 'sin objetivo');
    assert.equal((await useSpecialItem(fakeCtx({ mentioned: [ADMIN] }).ctx, db, user, ITEMS.ticket_muteo, '')).consumed, false, 'admin protegido');
    assert.equal((await useSpecialItem(fakeCtx({ mentioned: ['5210000000099@s.whatsapp.net'], participants: [ME, '5210000000099@s.whatsapp.net'] }).ctx, db, user, ITEMS.ticket_muteo, '')).consumed, false, 'bot protegido');
    assert.equal(countItem(db.getUser(ME), 'ticket_muteo'), 1);

    const good = fakeCtx({ mentioned: [OTHER] });
    const result = await useSpecialItem(good.ctx, db, user, ITEMS.ticket_muteo, '');
    assert.equal(result.consumed, true);
    assert.deepEqual(good.calls.muted, [OTHER]);
    assert.deepEqual(good.calls.autoMute, [true]);
    assert.equal(countItem(db.getUser(ME), 'ticket_muteo'), 0);
  });
});

test('ticket_kick expulsa al objetivo y se consume', async () => {
  await withDb(async (db) => {
    give(db, OTHER, 'vendaje');
    const user = give(db, ME, 'ticket_kick');
    const good = fakeCtx({ mentioned: [OTHER] });
    const result = await useSpecialItem(good.ctx, db, user, ITEMS.ticket_kick, '');
    assert.equal(result.consumed, true);
    assert.deepEqual(good.calls.kicked, [OTHER]);
    assert.equal(countItem(db.getUser(ME), 'ticket_kick'), 0);
  });
});

test('bomba_dinero roba a los registrados del grupo y respeta modo pasivo y escudo', async () => {
  await withDb(async (db) => {
    const now = Date.now();
    give(db, OTHER, 'vendaje', { money: 5000 });
    give(db, ADMIN, 'vendaje', { money: 5000, shieldRobo: now + 60_000 });
    const passive = '5210000000004@s.whatsapp.net';
    give(db, passive, 'vendaje', { money: 5000, passiveMode: true, passiveModeUntil: now + 60_000 });
    const user = give(db, ME, 'bomba_dinero', { money: 0 });

    const original = Math.random;
    Math.random = () => 0.5;
    try {
      const good = fakeCtx({ participants: [ME, OTHER, ADMIN, passive] });
      const result = await useSpecialItem(good.ctx, db, user, ITEMS.bomba_dinero, '');
      assert.equal(result.consumed, true);
      const stolen = Math.floor(0.5 * (SPECIAL_ITEMS.MONEY_BOMB.MAX - SPECIAL_ITEMS.MONEY_BOMB.MIN + 1)) + SPECIAL_ITEMS.MONEY_BOMB.MIN;
      assert.equal(db.getUser(OTHER).money, 5000 - stolen);
      assert.equal(db.getUser(ADMIN).money, 5000, 'escudo anti-robo');
      assert.equal(db.getUser(passive).money, 5000, 'modo pasivo');
      assert.equal(db.getUser(ME).money, stolen);
    } finally {
      Math.random = original;
    }

    // Sin víctimas posibles no se consume
    const again = give(db, ME, 'bomba_dinero');
    const empty = fakeCtx({ participants: [ME, ADMIN, passive] });
    assert.equal((await useSpecialItem(empty.ctx, db, again, ITEMS.bomba_dinero, '')).consumed, false);
    assert.equal(countItem(db.getUser(ME), 'bomba_dinero'), 1);
    assert.equal((await useSpecialItem(fakeCtx({ isGroup: false }).ctx, db, again, ITEMS.bomba_dinero, '')).consumed, false);
  });
});
