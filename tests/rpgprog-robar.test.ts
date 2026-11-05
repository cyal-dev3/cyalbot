import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setLogLevel } from '../src/lib/logger.js';
import { initDatabase, type Database } from '../src/lib/database.js';
import { xpRange } from '../src/lib/levelling.js';
import { ROB, PVP } from '../src/constants/rpg.js';
import { calculateRobAttempt, applyRobTransfer, hasStealableResources, robarPlugin } from '../src/plugins/rpg-robar.js';
import { DEFAULT_USER, type UserRPG } from '../src/types/user.js';
import type { MessageContext } from '../src/types/message.js';

setLogLevel('error');

function user(overrides: Partial<UserRPG> = {}): UserRPG {
  return { ...structuredClone(DEFAULT_USER), ...overrides };
}

/** rand determinista: devuelve los valores de la cola en orden, luego el máximo */
function scripted(values: number[]): (min: number, max: number) => number {
  const queue = [...values];
  return (min, max) => {
    const v = queue.shift();
    return v === undefined ? max : Math.max(min, Math.min(max, v));
  };
}

test('un robo exitoso de dinero nunca supera el dinero real de la víctima', () => {
  const thief = user({ level: 10 });
  const victim = user({ level: 5, money: 150 });
  // éxito (roll 1), recurso dinero (roll 1), cantidad: el máximo del rango
  const r = calculateRobAttempt(thief, victim, { rand: scripted([1, 1]), amountBonus: 500 });
  assert.equal(r.success, true);
  assert.equal(r.resource, 'money');
  assert.ok(r.amount >= 1 && r.amount <= victim.money);
});

test('applyRobTransfer: el ladrón gana exactamente lo que la víctima pierde (dinero, XP, maná)', () => {
  const thief = user({ level: 10, money: 100, exp: xpRange(10).min, mana: 10, maxMana: 20 });
  const victim = user({ level: 8, money: 500, exp: xpRange(8).min + 300, mana: 40, maxMana: 60 });

  const money = applyRobTransfer(thief, victim, 'money', 9999);
  assert.equal(money, 500);
  assert.equal(thief.money + victim.money, 600);

  // La XP robada no baja a la víctima del mínimo de su nivel
  const beforeThief = thief.exp;
  const exp = applyRobTransfer(thief, victim, 'exp', 1000);
  assert.equal(exp, 300);
  assert.equal(victim.exp, xpRange(8).min);
  assert.equal(thief.exp, beforeThief + 300);

  // El maná robado se limita al hueco del ladrón (max 20, tiene 10)
  const mana = applyRobTransfer(thief, victim, 'mana', 40);
  assert.equal(mana, 10);
  assert.equal(thief.mana, 20);
  assert.equal(victim.mana, 30);
});

test('la probabilidad de éxito queda acotada por ROB.MIN/MAX y el fallo devuelve la multa', () => {
  const weak = user({ level: PVP.MIN_LEVEL_PVP });
  const strong = user({ level: 500, money: 10000 });
  const fail = calculateRobAttempt(weak, strong, { rand: scripted([100, 300]) });
  assert.equal(fail.success, false);
  assert.equal(fail.successChance, ROB.MIN_SUCCESS_CHANCE);
  assert.ok(fail.amount >= ROB.FAIL_PENALTY.MIN && fail.amount <= ROB.FAIL_PENALTY.MAX);

  const god = user({ level: 500 });
  const ok = calculateRobAttempt(god, weak, { rand: scripted([1, 1]) });
  assert.equal(ok.successChance, ROB.MAX_SUCCESS_CHANCE);
});

test('hasStealableResources distingue víctimas pobres', () => {
  assert.equal(hasStealableResources(user({ money: 0, exp: 0, mana: 0 })), false);
  assert.equal(hasStealableResources(user({ money: ROB.MIN_VICTIM_RESOURCES.MONEY })), true);
});

interface FakeCtxOptions {
  sender: string;
  target: string | null;
}

function fakeCtx(db: Database, opts: FakeCtxOptions): { ctx: MessageContext; replies: string[]; sent: string[] } {
  const replies: string[] = [];
  const sent: string[] = [];
  const m = {
    key: {},
    sender: opts.sender,
    chat: 'grupo@g.us',
    text: '',
    fromMe: false,
    isGroup: true,
    pushName: 'Ladron',
    mentionedJid: opts.target ? [opts.target] : [],
    reply: async (text: string) => { replies.push(text); return undefined; },
    react: async () => {}
  };
  const ctx = {
    conn: {},
    m,
    text: '',
    args: [],
    command: 'robar',
    usedPrefix: '/',
    isOwner: false,
    isAdmin: false,
    isBotAdmin: false,
    isGroup: true,
    handler: { isCompactMode: () => false },
    chatSettings: {},
    get user() { return db.getUser(opts.sender); },
    send: async (content: { text?: string }) => { sent.push(content.text ?? ''); return undefined; },
    target: () => opts.target
  } as unknown as MessageContext;
  return { ctx, replies, sent };
}

test('robar: el escudo anti-robo y el modo pasivo bloquean el robo sin mover recursos', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cyalbot-rpgprog-robar-'));
  const db = await initDatabase(join(dir, 'database.json'));
  try {
    const thiefJid = 'ladron@s.whatsapp.net';
    const victimJid = 'victima@s.whatsapp.net';
    const now = Date.now();
    db.updateUser(thiefJid, { registered: true, name: 'Ladron', level: 20, money: 1000, lastRob: 0 });
    db.updateUser(victimJid, { registered: true, name: 'Victima', level: 20, money: 5000, shieldRobo: now + 3600000 });

    const shielded = fakeCtx(db, { sender: thiefJid, target: victimJid });
    await robarPlugin.handler(shielded.ctx);
    assert.ok(shielded.replies.some(r => r.includes('escudo anti-robo')));
    assert.equal(db.getUser(victimJid).money, 5000);
    assert.equal(db.getUser(thiefJid).money, 1000);
    assert.equal(db.getUser(thiefJid).lastRob, 0, 'un robo bloqueado no consume el cooldown');

    db.updateUser(victimJid, { shieldRobo: 0, passiveMode: true, passiveModeUntil: 0 });
    const passive = fakeCtx(db, { sender: thiefJid, target: victimJid });
    await robarPlugin.handler(passive.ctx);
    assert.ok(passive.replies.some(r => r.includes('modo pasivo')));
    assert.equal(db.getUser(victimJid).money, 5000);

    db.updateUser(victimJid, { passiveMode: false });
    db.updateUser(thiefJid, { passiveMode: true });
    const selfPassive = fakeCtx(db, { sender: thiefJid, target: victimJid });
    await robarPlugin.handler(selfPassive.ctx);
    assert.ok(selfPassive.replies.some(r => r.includes('Estás en *modo pasivo*')));
  } finally {
    await db.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

test('robar: un robo real conserva la suma de dinero entre ladrón y víctima', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cyalbot-rpgprog-robar2-'));
  const db = await initDatabase(join(dir, 'database.json'));
  try {
    const thiefJid = 'ladron2@s.whatsapp.net';
    const victimJid = 'victima2@s.whatsapp.net';
    db.updateUser(thiefJid, { registered: true, name: 'Ladron', level: 20, money: 1000, exp: xpRange(20).min, lastRob: 0 });
    db.updateUser(victimJid, { registered: true, name: 'Victima', level: 20, money: 5000, exp: xpRange(20).min, mana: 0 });

    const totalMoney = 6000;
    const { ctx, sent } = fakeCtx(db, { sender: thiefJid, target: victimJid });
    await robarPlugin.handler(ctx);

    const thief = db.getUser(thiefJid);
    const victim = db.getUser(victimJid);
    assert.equal(sent.length, 1);
    assert.ok(thief.lastRob > 0);
    if (sent[0].includes('ROBO EXITOSO')) {
      // XP o dinero: en ambos casos la suma de dinero se conserva (la XP no crea dinero)
      assert.equal(thief.money + victim.money, totalMoney);
    } else {
      // Fallo: solo el ladrón paga la multa
      assert.equal(victim.money, 5000);
      assert.ok(thief.money <= 1000);
    }
  } finally {
    await db.stop();
    await rm(dir, { recursive: true, force: true });
  }
});
