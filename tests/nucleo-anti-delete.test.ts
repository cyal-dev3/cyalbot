import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { proto } from 'baileys';
import { rememberMessage, isRemembered } from '../src/lib/anti-delete.js';

const GROUP = '120363000000000002@g.us';
let counter = 0;

function msg(message: proto.IMessage, opts: { chat?: string; fromMe?: boolean } = {}): proto.IWebMessageInfo {
  return { key: { remoteJid: opts.chat ?? GROUP, fromMe: opts.fromMe ?? false, id: `AD${++counter}`, participant: '5210000000002@s.whatsapp.net' }, message };
}

test('rememberMessage guarda texto y media de grupos, también efímeros', () => {
  const plain = msg({ conversation: 'hola' });
  const ephemeral = msg({ ephemeralMessage: { message: { imageMessage: { url: 'x', fileLength: 10 } } } });
  rememberMessage(plain);
  rememberMessage(ephemeral);
  assert.equal(isRemembered(GROUP, plain.key.id!), true);
  assert.equal(isRemembered(GROUP, ephemeral.key.id!), true);
});

test('rememberMessage ignora protocolo, reacciones, llaves, privados y propios', () => {
  const cases = [
    msg({ protocolMessage: { type: 0 } }),
    msg({ reactionMessage: { text: '👍' } }),
    msg({ senderKeyDistributionMessage: { groupId: GROUP } }),
    msg({ ephemeralMessage: { message: { protocolMessage: { type: 0 } } } }),
    msg({ conversation: 'privado' }, { chat: '5210000000002@s.whatsapp.net' }),
    msg({ conversation: 'mio' }, { fromMe: true }),
  ];
  for (const c of cases) rememberMessage(c);
  for (const c of cases) assert.equal(isRemembered(c.key.remoteJid!, c.key.id!), false, JSON.stringify(c.message));
});
