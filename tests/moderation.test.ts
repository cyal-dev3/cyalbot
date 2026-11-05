import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GroupMetadata } from 'baileys';
import type { ChatSettings, UserWarning } from '../src/types/database.js';
import { DEFAULT_CHAT_SETTINGS } from '../src/types/database.js';
import { CONFIG } from '../src/config.js';
import {
  findBadWord, foldText, isForbiddenLink, getMaxWarnings, applyAutoWarning, SYSTEM_WARNER, type AutoWarningDeps,
} from '../src/lib/moderation.js';

const WORDS = ['puta', 'culo', 'hdp', 'hijo de puta'];

test('detecta palabra completa aunque cambie mayúsculas o acentos', () => {
  assert.equal(findBadWord('eres una PUTA', WORDS), 'puta');
  assert.equal(findBadWord('qué pùta suerte', WORDS), 'puta');
  assert.equal(findBadWord('vete al culo.', WORDS), 'culo');
});

test('no dispara con palabras que solo contienen el término', () => {
  assert.equal(findBadWord('la computadora nueva', WORDS), null);
  assert.equal(findBadWord('hay una disputa legal', WORDS), null);
  assert.equal(findBadWord('manda el vínculo del grupo', WORDS), null);
  assert.equal(findBadWord('oculos', WORDS), null);
});

test('detecta frases de varias palabras', () => {
  assert.equal(findBadWord('ese hijo de puta otra vez', ['hijo de puta']), 'hijo de puta');
  // La puntuación entre palabras no evita la detección.
  assert.equal(findBadWord('hijo, de puta madre el partido', ['hijo de puta']), 'hijo de puta');
  // Con varias entradas gana la primera de la lista que aparezca.
  assert.equal(findBadWord('ese hijo de puta otra vez', WORDS), 'puta');
});

test('lista vacía o texto vacío no detecta nada', () => {
  assert.equal(findBadWord('', WORDS), null);
  assert.equal(findBadWord('hola', []), null);
});

test('foldText quita acentos y pasa a minúsculas', () => {
  assert.equal(foldText('Canción Ñoña'), 'cancion nona');
});

test('isForbiddenLink: modo wa solo invitaciones de WhatsApp y Telegram', () => {
  assert.equal(isForbiddenLink('entra https://chat.whatsapp.com/AbCdEfGhIjKlMnOpQrS', 'wa'), true);
  assert.equal(isForbiddenLink('chat.whatsapp.com/AbCdEfGhIjKlMnOpQrS', 'wa'), true);
  assert.equal(isForbiddenLink('mi canal t.me/micanal', 'wa'), true);
  assert.equal(isForbiddenLink('https://t.me/+AbC123', 'wa'), true);
  assert.equal(isForbiddenLink('mira https://youtube.com/watch?v=x', 'wa'), false);
  assert.equal(isForbiddenLink('escribe a soporte@empresa.com', 'wa'), false);
  assert.equal(isForbiddenLink('', 'wa'), false);
  // Sin modo, el default es wa.
  assert.equal(isForbiddenLink('https://ejemplo.com'), false);
});

test('isForbiddenLink: modo all detecta cualquier URL pero no texto normal', () => {
  assert.equal(isForbiddenLink('mira https://youtube.com/watch?v=x', 'all'), true);
  assert.equal(isForbiddenLink('entra a www.ejemplo.com ya', 'all'), true);
  assert.equal(isForbiddenLink('está en ejemplo.com/ruta', 'all'), true);
  assert.equal(isForbiddenLink('te lo mando por t.me/canal', 'all'), true);
  assert.equal(isForbiddenLink('hola, ¿cómo estás? 3.5 puntos', 'all'), false);
  assert.equal(isForbiddenLink('ver el archivo.txt y el main.ts', 'all'), false);
});

test('getMaxWarnings usa el campo del chat si es válido y si no CONFIG', () => {
  const base = structuredClone(DEFAULT_CHAT_SETTINGS);
  assert.equal(getMaxWarnings(base), CONFIG.protection.maxWarnings);
  assert.equal(getMaxWarnings({ ...base, maxWarnings: 5 } as ChatSettings), 5);
  assert.equal(getMaxWarnings({ ...base, maxWarnings: 0 } as ChatSettings), CONFIG.protection.maxWarnings);
  assert.equal(getMaxWarnings({ ...base, maxWarnings: 2.5 } as ChatSettings), CONFIG.protection.maxWarnings);
});

interface FakeDeps {
  warnings: UserWarning[];
  cleared: string[];
  sent: { text?: string; mentions?: string[] }[];
  kicks: string[][];
  kickStatus: string;
}

function fakeDeps(metadata: GroupMetadata | null, kickStatus = '200'): FakeDeps & { deps: AutoWarningDeps } {
  const state: FakeDeps = { warnings: [], cleared: [], sent: [], kicks: [], kickStatus };
  const deps: AutoWarningDeps = {
    db: {
      addWarning: (_chat, w) => { state.warnings.push(w); return state.warnings.filter((x) => x.odTo === w.odTo).length; },
      clearWarnings: (_chat, user) => { state.cleared.push(user); const before = state.warnings.length; state.warnings = state.warnings.filter((w) => w.odTo !== user); return before - state.warnings.length; },
    },
    conn: {
      sendMessage: (async (_chat: string, content: { text?: string; mentions?: string[] }) => { state.sent.push(content); return undefined; }) as unknown as AutoWarningDeps['conn']['sendMessage'],
      groupParticipantsUpdate: (async (_chat: string, jids: string[]) => { state.kicks.push(jids); return jids.map((jid) => ({ status: state.kickStatus, jid, content: {} })); }) as unknown as AutoWarningDeps['conn']['groupParticipantsUpdate'],
    },
    metadata,
    maxWarnings: 2,
  };
  return { ...state, deps, get warnings() { return state.warnings; }, get cleared() { return state.cleared; }, get sent() { return state.sent; }, get kicks() { return state.kicks; } };
}

const LID_METADATA = {
  participants: [{ id: '100000000000004@lid', jid: '5210000000003@s.whatsapp.net', admin: null }],
} as unknown as GroupMetadata;

test('applyAutoWarning registra como SISTEMA con el jid canónico y avisa sin expulsar', async () => {
  const f = fakeDeps(LID_METADATA);
  const result = await applyAutoWarning(f.deps, 'g@g.us', '5210000000003@s.whatsapp.net', 'Enviar enlace');
  assert.deepEqual(result, { target: '100000000000004@lid', count: 1, max: 2, kicked: false, kickFailed: false });
  assert.equal(f.warnings[0].odBy, SYSTEM_WARNER);
  assert.equal(f.warnings[0].odTo, '100000000000004@lid');
  assert.equal(f.kicks.length, 0);
  assert.match(f.sent[0].text ?? '', /@100000000000004 advertencia 1\/2: Enviar enlace/);
  assert.deepEqual(f.sent[0].mentions, ['100000000000004@lid']);
});

test('applyAutoWarning expulsa al llegar al máximo y limpia las advertencias', async () => {
  const f = fakeDeps(null);
  await applyAutoWarning(f.deps, 'g@g.us', 'u@s.whatsapp.net', 'spam');
  const result = await applyAutoWarning(f.deps, 'g@g.us', 'u@s.whatsapp.net', 'spam');
  assert.equal(result.kicked, true);
  assert.equal(result.count, 2);
  assert.deepEqual(f.kicks, [['u@s.whatsapp.net']]);
  assert.deepEqual(f.cleared, ['u@s.whatsapp.net']);
  assert.match(f.sent[1].text ?? '', /expulsado/);
});

test('applyAutoWarning conserva el conteo si WhatsApp rechaza la expulsión', async () => {
  const f = fakeDeps(null, '403');
  await applyAutoWarning(f.deps, 'g@g.us', 'u@s.whatsapp.net', 'spam');
  const result = await applyAutoWarning(f.deps, 'g@g.us', 'u@s.whatsapp.net', 'spam');
  assert.equal(result.kicked, false);
  assert.equal(result.kickFailed, true);
  assert.equal(f.cleared.length, 0);
  assert.equal(f.warnings.length, 2);
  assert.match(f.sent[1].text ?? '', /no pude expulsarlo/);
});
