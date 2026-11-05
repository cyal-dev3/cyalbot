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

// Pruebas de los comandos contra una Database temporal y un handler mínimo que
// imita el registro en memoria del real (Set por grupo + mutedUsers en la BD).
const { mkdtemp, rm } = await import('node:fs/promises');
const { tmpdir } = await import('node:os');
const { join } = await import('node:path');
const { after } = await import('node:test');
const { initDatabase } = await import('../src/lib/database.js');
const { setLogLevel } = await import('../src/lib/logger.js');
const { mutePlugin, tempMutePlugin, unmutePlugin, findStoredMute } = await import('../src/plugins/group-mute.js');

setLogLevel('error');
const dir = await mkdtemp(join(tmpdir(), 'cyalbot-mute-'));
const db = await initDatabase(join(dir, 'database.json'));
after(async () => {
  await db.stop();
  await rm(dir, { recursive: true, force: true });
});

const GROUP = '120363000000000000@g.us';
const ADMIN = { pn: '5210000000002@s.whatsapp.net', lid: '100000000000003@lid' };
const USER = { pn: '5210000000003@s.whatsapp.net', lid: '100000000000004@lid' };
const LID_METADATA = {
  id: GROUP,
  addressingMode: 'lid',
  participants: [
    { id: ADMIN.lid, jid: ADMIN.pn, admin: 'admin' },
    { id: USER.lid, jid: USER.pn, admin: null },
  ],
};

function fakeHandler() {
  const sets = new Map<string, Set<string>>();
  const setOf = (chat: string) => {
    let s = sets.get(chat);
    if (!s) {
      s = new Set(db.getChatSettings(chat).mutedUsers ?? []);
      sets.set(chat, s);
    }
    return s;
  };
  const save = (chat: string) => db.updateChatSettings(chat, { mutedUsers: [...setOf(chat)] });
  return {
    muteUser: (chat: string, jid: string) => { setOf(chat).add(jid); save(chat); },
    unmuteUser: (chat: string, jid: string) => { const ok = setOf(chat).delete(jid); save(chat); return ok; },
    isUserMuted: (chat: string, jid: string) => setOf(chat).has(jid),
    isAutoMuteEnabled: (chat: string) => db.getChatSettings(chat).autoMuteEnabled === true,
    setAutoMute: (chat: string, on: boolean) => db.updateChatSettings(chat, { autoMuteEnabled: on }),
    isCompactMode: () => false,
    trackMessage: () => {},
  };
}

interface Sent { text?: string; mentions?: string[] }

async function runMute(plugin: { handler: (ctx: never) => Promise<void> }, chat: string, text: string, mentioned: string[]) {
  const replies: string[] = [];
  const sent: Sent[] = [];
  const ctx = {
    m: {
      chat,
      sender: ADMIN.lid,
      mentionedJid: mentioned,
      reply: async (t: string) => { replies.push(t); },
      react: async () => {},
    },
    text,
    args: text ? text.split(/\s+/) : [],
    usedPrefix: '/',
    isOwner: false,
    groupMetadata: LID_METADATA,
    conn: {
      user: { id: '5219990000000:1@s.whatsapp.net' },
      sendMessage: async (_c: string, content: Sent) => { sent.push(content); return { key: { id: 'x' } }; },
    },
    handler: fakeHandler(),
  };
  await plugin.handler(ctx as never);
  return { replies, sent };
}

test('unmute quita una entrada guardada en otro formato por una versión anterior', async () => {
  const chat = 'legacy@g.us';
  // Grupo LID con el número guardado tal cual (así lo dejaba la versión anterior).
  db.updateChatSettings(chat, { mutedUsers: [USER.pn] });
  assert.equal(findStoredMute({ groupMetadata: LID_METADATA as never }, db.getChatSettings(chat), USER.lid), USER.pn);

  const r = await runMute(unmutePlugin, chat, '@usuario', [USER.lid]);
  assert.deepEqual(db.getChatSettings(chat).mutedUsers, []);
  assert.match(r.sent[0].text ?? '', /ya puede hablar/);
  assert.deepEqual(r.sent[0].mentions, [USER.lid]);

  const again = await runMute(unmutePlugin, chat, '@usuario', [USER.lid]);
  assert.match(again.replies[0], /no está silenciado/);
});

test('mute sobre un tempmute lo vuelve permanente y mute repetido avisa; tempmute actualiza el vencimiento', async () => {
  const chat = 'update@g.us';
  const temp = await runMute(tempMutePlugin, chat, '@usuario 10m', [USER.lid]);
  assert.match(temp.sent[0].text ?? '', /silenciado por/);
  assert.match(temp.sent[0].text ?? '', /Automute se activó/);
  let s = db.getChatSettings(chat);
  assert.deepEqual(s.mutedUsers, [USER.lid]);
  assert.equal(typeof getMutedUntil(s)[USER.lid], 'number');
  assert.equal(s.autoMuteEnabled, true);

  const perm = await runMute(mutePlugin, chat, '@usuario', [USER.lid]);
  assert.match(perm.sent[0].text ?? '', /permanentemente/);
  s = db.getChatSettings(chat);
  assert.deepEqual(s.mutedUsers, [USER.lid]);
  assert.deepEqual(getMutedUntil(s), {});

  const repeat = await runMute(mutePlugin, chat, '@usuario', [USER.lid]);
  assert.match(repeat.replies[0], /ya está silenciado permanentemente/);
  assert.equal(repeat.sent.length, 0);

  const before = Date.now();
  const extended = await runMute(tempMutePlugin, chat, '@usuario 2h', [USER.lid]);
  assert.match(extended.sent[0].text ?? '', /actualizado/);
  s = db.getChatSettings(chat);
  assert.deepEqual(s.mutedUsers, [USER.lid]);
  assert.ok(getMutedUntil(s)[USER.lid] >= before + 2 * 3_600_000 - 1000);
});

test('mute migra al id canónico una entrada antigua en vez de duplicarla', async () => {
  const chat = 'migrate@g.us';
  db.updateChatSettings(chat, { mutedUsers: [USER.pn], mutedUntil: { [USER.pn]: Date.now() + 60_000 } } as never);
  const r = await runMute(mutePlugin, chat, '@usuario', [USER.lid]);
  assert.match(r.sent[0].text ?? '', /permanentemente/);
  const s = db.getChatSettings(chat);
  assert.deepEqual(s.mutedUsers, [USER.lid]);
  assert.deepEqual(getMutedUntil(s), {});
});
