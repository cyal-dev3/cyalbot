import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TIPSTER_REGEX, extractTipsterName, extractTipsterNameLegacy, tipsterMetrics, formatRecord, findPickFromContext, describePendingPicks, pendingIndex, renderFavoriteTipsters,
} from '../src/lib/betting-parser.js';
import { BettingStore, normalizeTipsterName, MAX_FAVORITE_TIPSTERS } from '../src/lib/betting-store.js';
import type { BettingPick, TipsterStats, BettingSystem } from '../src/types/database.js';
import { DEFAULT_TIPSTER_STATS, DEFAULT_BETTING_SYSTEM } from '../src/types/database.js';
import { DEFAULT_USER_BETTING } from '../src/types/user.js';

test('TIPSTER_REGEX exige letra inicial y al menos 3 caracteres al inicio de la primera línea', () => {
  assert.equal(extractTipsterName('#Tipster1 Over 2.5'), 'Tipster1');
  assert.equal(extractTipsterName('#Ñandú-Pro apuesta'), 'Ñandú-Pro');
  assert.equal(extractTipsterName('#a_b'), 'a_b');
  assert.equal(extractTipsterName('#1 pick'), null);
  assert.equal(extractTipsterName('#ok'), null);
  assert.equal(extractTipsterName('hola #Tipster1'), null);
  assert.equal(extractTipsterName('primera línea\n#Tipster1'), null);
  assert.equal(extractTipsterName('  #Tipster1\nsegunda'), 'Tipster1');
  assert.equal(extractTipsterName(''), null);
  assert.equal(extractTipsterName(null), null);
  assert.ok(TIPSTER_REGEX.unicode);
});

test('extractTipsterNameLegacy acepta el formato antiguo con 🎫', () => {
  assert.equal(extractTipsterNameLegacy('🎫 Viejo Tipster\nOver'), 'Viejo Tipster');
  assert.equal(extractTipsterNameLegacy('#Nuevo\n🎫 Viejo'), 'Nuevo');
  assert.equal(extractTipsterNameLegacy('nada'), null);
});

function tipster(overrides: Partial<TipsterStats>): TipsterStats {
  return { ...structuredClone(DEFAULT_TIPSTER_STATS), name: 'T', normalized: 't', ...overrides };
}

test('tipsterMetrics y formatRecord', () => {
  const t = tipster({ wins: 6, losses: 4, totalUnits: 10, wonUnits: 7, lostUnits: 4, currentStreak: 2 });
  const m = tipsterMetrics(t);
  assert.equal(m.total, 10);
  assert.equal(m.winrate, 60);
  assert.equal(m.roi, 30);
  assert.equal(m.profit, 3);
  assert.equal(m.streak, 2);
  assert.equal(formatRecord(t), '6W - 4L (60.0%)');
  assert.equal(formatRecord(tipster({})), 'Sin historial');
  assert.equal(formatRecord(null), 'Sin historial');
  assert.equal(tipsterMetrics(tipster({})).winrate, 0);
});

function pick(id: string, tipsterName: string, messageId?: string): BettingPick {
  return {
    id: `pick_${id}`, tipster: normalizeTipsterName(tipsterName), tipsterOriginal: tipsterName, description: '', units: 1,
    status: 'pending', createdAt: 0, createdBy: 'u', followers: [], messageId,
  };
}

function fakeStore(pending: BettingPick[]): BettingStore {
  return {
    normalizeTipsterName,
    getPendingPicks: () => pending,
    getPickByMessageId: (_chat: string, messageId: string) => pending.find((p) => p.messageId === messageId) ?? null,
  } as unknown as BettingStore;
}

test('findPickFromContext localiza por cita, número, final del id y tipster', () => {
  const picks = [pick('1700_aaaa1111', 'Alpha', 'msg-1'), pick('1700_bbbb2222', 'Beta'), pick('1700_cccc1111', 'Beta')];
  const store = fakeStore(picks);
  assert.equal(findPickFromContext(store, 'g', 'msg-1', ''), picks[0]);
  assert.equal(findPickFromContext(store, 'g', undefined, '2'), picks[1]);
  assert.equal(findPickFromContext(store, 'g', undefined, '9'), null);
  assert.equal(findPickFromContext(store, 'g', undefined, 'bbb2222'), picks[1]);
  assert.equal(findPickFromContext(store, 'g', undefined, 'BBBB2222'), picks[1]);
  // Dos ids acaban en 1111: ambiguo.
  assert.equal(findPickFromContext(store, 'g', undefined, '1111'), null);
  // Menos de 4 caracteres no busca por id.
  assert.equal(findPickFromContext(store, 'g', undefined, '222'), null);
  assert.equal(findPickFromContext(store, 'g', undefined, 'alpha'), picks[0]);
  assert.equal(findPickFromContext(store, 'g', undefined, 'Beta'), null);
  assert.equal(findPickFromContext(store, 'g', undefined, 'zeta'), null);
});

test('findPickFromContext sin pista solo acierta si hay un único pendiente', () => {
  const single = [pick('1', 'Alpha')];
  assert.equal(findPickFromContext(fakeStore(single), 'g', undefined, undefined), single[0]);
  assert.equal(findPickFromContext(fakeStore([pick('1', 'A'), pick('2', 'B')]), 'g', undefined, '  '), null);
  assert.equal(findPickFromContext(fakeStore([]), 'g', undefined, undefined), null);
});

test('describePendingPicks numera los pendientes con el prefijo real', () => {
  const text = describePendingPicks([pick('abcdefgh', 'Alpha'), pick('ijklmnop', 'Beta')], '!', 'verde');
  assert.match(text, /1\. \*Alpha\*/);
  assert.match(text, /2\. \*Beta\*/);
  assert.match(text, /!verde <número>/);
  assert.match(describePendingPicks([], '.', 'roja'), /No hay picks pendientes/);
});

test('renderFavoriteTipsters ordena por winrate y marca los desconocidos', () => {
  const system: BettingSystem = { ...structuredClone(DEFAULT_BETTING_SYSTEM), tipsters: {
    bueno: tipster({ name: 'Bueno', normalized: 'bueno', wins: 8, losses: 2, totalUnits: 10, wonUnits: 9, lostUnits: 2 }),
    malo: tipster({ name: 'Malo', normalized: 'malo', wins: 2, losses: 8, pending: 1 }),
  } };
  const betting = { ...structuredClone(DEFAULT_USER_BETTING), favoriteTipsters: ['malo', 'bueno', 'fantasma'] };
  const text = renderFavoriteTipsters(betting, system, { usedPrefix: '/', showNotify: true });
  assert.ok(text.indexOf('Bueno') < text.indexOf('Malo'));
  assert.match(text, /fantasma _\(sin datos/);
  assert.match(text, /⏳ 1/);
  assert.match(text, /\/tipster avisos/);
  assert.match(text, /\(3\/20\)/);
});

test('findPickFromContext con cita que no es de ningún pick y sin más pista devuelve null', () => {
  const single = [pick('1', 'Alpha', 'msg-1')];
  assert.equal(findPickFromContext(fakeStore(single), 'g', 'otro-mensaje', ''), null);
  // Con número o id explícito la cita equivocada no estorba.
  assert.equal(findPickFromContext(fakeStore(single), 'g', 'otro-mensaje', '1'), single[0]);
});

test('describePendingPicks y pendingIndex usan la numeración de la lista completa', () => {
  const all = [pick('aaaaaaaa', 'Alpha'), pick('bbbbbbbb', 'Beta'), pick('cccccccc', 'Beta')];
  const onlyBeta = all.filter((p) => p.tipster === 'beta');
  assert.equal(pendingIndex(all, onlyBeta[0]), 2);
  const text = describePendingPicks(onlyBeta, '/', 'verde', all);
  assert.match(text, /2\. \*Beta\*/);
  assert.match(text, /3\. \*Beta\*/);
  assert.doesNotMatch(text, /1\. /);
});

function fakeDatabase() {
  const chats: Record<string, { bettingSystem?: BettingSystem }> = {};
  const users: Record<string, { betting?: ReturnType<typeof structuredClone<typeof DEFAULT_USER_BETTING>> }> = {};
  return {
    data: { chats, users },
    dirty: 0,
    markDirty() { this.dirty++; },
    getChatSettings(chatId: string) { return (chats[chatId] ??= {}); },
    getUser(jid: string) { return (users[jid] ??= {}); },
  };
}

function storeFor(enabled = true) {
  const db = fakeDatabase();
  const store = new BettingStore(db as never);
  store.updateBettingSystem('g', { enabled });
  return { db, store };
}

test('normalizeTipsterName rechaza claves reservadas del prototipo y el store no las indexa', () => {
  for (const name of ['__proto__', 'constructor', 'prototype', '!!!', '']) {
    assert.equal(normalizeTipsterName(name), '', name);
  }
  // En minúsculas ya no coincide con nada heredado, así que es una clave normal.
  assert.equal(normalizeTipsterName('hasOwnProperty'), 'hasownproperty');
  assert.equal(normalizeTipsterName('Tipster Uno'), 'tipster_uno');

  const { store } = storeFor();
  assert.equal(store.getTipster('g', 'constructor'), null);
  assert.equal(store.getTipster('g', '__proto__'), null);
  assert.throws(() => store.getOrCreateTipster('g', '__proto__'), /inválido/);
  assert.throws(() => store.registerPick('g', {
    tipster: '', tipsterOriginal: '__proto__', description: '', units: 1, status: 'pending', createdAt: 0, createdBy: 'u', followers: [],
  }), /inválido/);
  assert.equal(({} as { pending?: number }).pending, undefined, 'Object.prototype intacto');
  assert.equal(store.followTipster('g', 'constructor', 'u@s.whatsapp.net'), 'invalid');
  assert.equal(store.followTipster('g', '__proto__', 'u@s.whatsapp.net'), 'invalid');
  assert.deepEqual(store.getPendingPicks('g', '__proto__'), []);
});

test('followTipster no crea el tipster cuando el usuario está al límite o el nombre no vale', () => {
  const { store } = storeFor();
  const user = 'u@s.whatsapp.net';
  for (let i = 0; i < MAX_FAVORITE_TIPSTERS; i++) assert.equal(store.followTipster('g', `Tip${i}`, user), 'ok');
  assert.equal(Object.keys(store.getBettingSystem('g').tipsters).length, MAX_FAVORITE_TIPSTERS);
  assert.equal(store.followTipster('g', 'Basura', user), 'limit');
  assert.equal(store.followTipster('g', 'x'.repeat(41), user), 'invalid');
  assert.equal(Object.keys(store.getBettingSystem('g').tipsters).length, MAX_FAVORITE_TIPSTERS, 'no se crearon tipsters de más');
  assert.equal(store.followTipster('g', 'Tip0', user), 'already');
  assert.equal(store.followTipster('g', 'Tip0', 'otro@s.whatsapp.net'), 'ok');
});
