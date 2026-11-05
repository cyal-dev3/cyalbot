import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ChatSettings } from '../src/types/database.js';
import { DEFAULT_CHAT_SETTINGS } from '../src/types/database.js';
import { isMutedNow, parseMuteDuration, getMutedUntil } from '../src/plugins/group-mute.js';

const USER_PN = '5210000000003@s.whatsapp.net';

function settings(mutedUsers: string[], mutedUntil?: Record<string, number>): ChatSettings {
  return { ...structuredClone(DEFAULT_CHAT_SETTINGS), mutedUsers, ...(mutedUntil ? { mutedUntil } : {}) } as ChatSettings;
}

test('isMutedNow: mute permanente, con sufijo de dispositivo y sin coincidencia', () => {
  const s = settings([USER_PN]);
  assert.equal(isMutedNow(s, USER_PN), true);
  assert.equal(isMutedNow(s, '5210000000003:4@s.whatsapp.net'), true);
  assert.equal(isMutedNow(s, '5210000000004@s.whatsapp.net'), false);
  assert.equal(isMutedNow(settings([]), USER_PN), false);
});

test('isMutedNow: el mute temporal vence sin tocar la configuración', () => {
  const now = 1_000_000;
  const s = settings([USER_PN], { [USER_PN]: now + 60_000 });
  assert.equal(isMutedNow(s, USER_PN, now), true);
  assert.equal(isMutedNow(s, USER_PN, now + 60_000), false);
  assert.equal(isMutedNow(s, USER_PN, now + 1), true);
  assert.deepEqual(s.mutedUsers, [USER_PN]);
  assert.deepEqual(getMutedUntil(s), { [USER_PN]: now + 60_000 });
  assert.deepEqual(getMutedUntil(settings([])), {});
});

test('parseMuteDuration acepta m/h/d con límites de 1 minuto a 30 días', () => {
  assert.equal(parseMuteDuration('10m'), 10 * 60_000);
  assert.equal(parseMuteDuration('2H'), 2 * 3_600_000);
  assert.equal(parseMuteDuration('1d'), 86_400_000);
  assert.equal(parseMuteDuration('30 min'), 30 * 60_000);
  assert.equal(parseMuteDuration('90s'), 90_000);
  assert.equal(parseMuteDuration('30s'), null);
  assert.equal(parseMuteDuration('31d'), null);
  assert.equal(parseMuteDuration('10'), null);
  assert.equal(parseMuteDuration('@5210000000003'), null);
  assert.equal(parseMuteDuration(''), null);
  assert.equal(parseMuteDuration(undefined), null);
});
