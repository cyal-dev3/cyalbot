import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WASocket, GroupMetadata, proto } from 'baileys';

process.env.BOT_OWNERS = '5210000000001';
const { setLogLevel } = await import('../src/lib/logger.js');
setLogLevel('error');
const { initDatabase } = await import('../src/lib/database.js');
const { handleParticipantsUpdate, invalidateGroupMetadata } = await import('../src/lib/group-events.js');
const { rememberMessage, handleMessageUpdates, isRemembered, forgetMessage } = await import('../src/lib/anti-delete.js');

const GROUP = '120363000000000011@g.us';
const USER = '5210000000002@s.whatsapp.net';
const ADMIN = '5210000000003@s.whatsapp.net';
const BOT = '5210000000099:7@s.whatsapp.net';
const BOT_PN = '5210000000099@s.whatsapp.net';

interface Sent { jid: string; content: Record<string, unknown> }

function fakeConn(): { conn: WASocket; sent: Sent[] } {
  const sent: Sent[] = [];
  const metadata = {
    id: GROUP,
    subject: 'Grupo de prueba',
    desc: 'Reglas aquí',
    participants: [
      { id: ADMIN, admin: 'admin' },
      { id: USER, admin: null },
      { id: BOT_PN, admin: null },
    ],
  } as unknown as GroupMetadata;
  const conn = {
    user: { id: BOT },
    sendMessage: async (jid: string, content: Record<string, unknown>) => {
      sent.push({ jid, content });
      return { key: { remoteJid: jid, fromMe: true, id: `B${sent.length}` } };
    },
    groupMetadata: async () => metadata,
  } as unknown as WASocket;
  return { conn, sent };
}

async function withDb(fn: (conn: WASocket, sent: Sent[], db: Awaited<ReturnType<typeof initDatabase>>) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'nucleo-group-events-'));
  const db = await initDatabase(join(dir, 'database.json'));
  invalidateGroupMetadata(GROUP);
  const { conn, sent } = fakeConn();
  try {
    await fn(conn, sent, db);
  } finally {
    await db.stop();
    await rm(dir, { recursive: true, force: true });
  }
}

test('bienvenida y despedida con variables y mención; al bot no se le saluda', async () => {
  await withDb(async (conn, sent, db) => {
    db.updateChatSettings(GROUP, {
      welcome: true,
      detect: true,
      sWelcome: 'Hola {user} ({name}) bienvenido a {group}: {desc}. Somos {count}',
      sBye: 'Adiós {user}, quedamos {count}',
    });
    await handleParticipantsUpdate(conn, { id: GROUP, participants: [USER, BOT_PN], action: 'add' });
    assert.equal(sent.length, 1, 'solo una bienvenida: el bot no se saluda a sí mismo');
    assert.equal(sent[0].content.text, 'Hola @5210000000002 (@5210000000002) bienvenido a Grupo de prueba: Reglas aquí. Somos 3');
    assert.deepEqual(sent[0].content.mentions, [USER]);

    await handleParticipantsUpdate(conn, { id: GROUP, participants: [USER], action: 'remove' });
    assert.equal(sent[1].content.text, 'Adiós @5210000000002, quedamos 3');
    assert.deepEqual(sent[1].content.mentions, [USER]);
  });
});

test('los avisos de promote/demote se pueden apagar con adminAlerts', async () => {
  await withDb(async (conn, sent, db) => {
    await handleParticipantsUpdate(conn, { id: GROUP, participants: [USER], action: 'promote' });
    assert.equal(sent.length, 1);
    assert.match(String(sent[0].content.text), /@5210000000002 ahora es administrador/);

    db.updateChatSettings(GROUP, { adminAlerts: false } as never);
    await handleParticipantsUpdate(conn, { id: GROUP, participants: [USER], action: 'demote' });
    await handleParticipantsUpdate(conn, { id: GROUP, participants: [USER], action: 'promote' });
    assert.equal(sent.length, 1, 'con adminAlerts en false no se avisa');
  });
});

let counter = 0;
function groupMessage(sender: string, text: string): proto.IWebMessageInfo {
  return {
    key: { remoteJid: GROUP, fromMe: false, id: `AD${++counter}`, participant: sender },
    pushName: 'Alguien',
    message: { conversation: text },
  };
}

function revoke(original: proto.IWebMessageInfo, by: { participant?: string; fromMe?: boolean }) {
  return [{
    key: original.key,
    update: {
      message: null,
      messageStubType: 1,
      key: { remoteJid: GROUP, fromMe: by.fromMe ?? false, id: `REV${++counter}`, participant: by.participant },
    },
  }] as never;
}

test('anti-delete reenvía diciendo quién borró, y calla si borró el bot o un admin', async () => {
  await withDb(async (conn, sent, db) => {
    db.updateChatSettings(GROUP, { antiDelete: true });

    const own = groupMessage(USER, 'hola a todos');
    rememberMessage(own);
    await handleMessageUpdates(conn, revoke(own, { participant: USER }));
    assert.equal(sent.length, 1);
    assert.equal(sent[0].content.text, '🗑️ @5210000000002 borró este mensaje\n\nhola a todos');
    assert.deepEqual(sent[0].content.mentions, [USER]);
    assert.equal(isRemembered(GROUP, own.key.id!), false);

    const byBot = groupMessage(USER, 'enlace prohibido');
    rememberMessage(byBot);
    await handleMessageUpdates(conn, revoke(byBot, { fromMe: true }));
    assert.equal(sent.length, 1, 'lo que borra el bot no se reenvía');

    const byAdmin = groupMessage(USER, 'spam');
    rememberMessage(byAdmin);
    await handleMessageUpdates(conn, revoke(byAdmin, { participant: ADMIN }));
    assert.equal(sent.length, 1, 'lo que borra un admin no se reenvía');

    const forgotten = groupMessage(USER, 'borrado por el handler');
    rememberMessage(forgotten);
    forgetMessage(GROUP, forgotten.key.id!);
    await handleMessageUpdates(conn, revoke(forgotten, { participant: USER }));
    assert.equal(sent.length, 1, 'un mensaje olvidado no se reenvía');
  });
});
