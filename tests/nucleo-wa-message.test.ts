import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { proto } from 'baileys';
import { unwrapMessage, getText, getMentions, getQuoted, getMediaSize, getContextInfo } from '../src/lib/wa-message.js';

const USER_A = '5210000000001@s.whatsapp.net';
const USER_B = '5210000000002@s.whatsapp.net';

function webMessage(message: proto.IMessage): proto.IWebMessageInfo {
  return { key: { remoteJid: '123@g.us', fromMe: false, id: 'ABC', participant: USER_A }, message };
}

test('unwrapMessage devuelve el contenido plano tal cual', () => {
  const content = unwrapMessage(webMessage({ conversation: 'hola' }));
  assert.equal(content?.conversation, 'hola');
  assert.equal(unwrapMessage(null), undefined);
  assert.equal(unwrapMessage({ key: { remoteJid: 'x' } }), undefined);
});

test('unwrapMessage desenvuelve mensajes efímeros con texto extendido y menciones', () => {
  const msg = webMessage({
    ephemeralMessage: {
      message: {
        extendedTextMessage: { text: '/perfil @5210000000002', contextInfo: { mentionedJid: [USER_B] } },
      },
    },
  });
  const content = unwrapMessage(msg);
  assert.ok(content);
  assert.equal(getText(content), '/perfil @5210000000002');
  assert.deepEqual(getMentions(content), [USER_B]);
});

test('unwrapMessage desenvuelve ver una vez y documento con caption (anidados)', () => {
  const viewOnce = unwrapMessage({
    viewOnceMessageV2: { message: { imageMessage: { caption: '/s', fileLength: 2048, contextInfo: { mentionedJid: [USER_A] } } } },
  });
  assert.equal(getText(viewOnce), '/s');
  assert.deepEqual(getMentions(viewOnce), [USER_A]);
  assert.equal(getMediaSize(viewOnce), 2048);

  const doc = unwrapMessage({
    ephemeralMessage: {
      message: { documentWithCaptionMessage: { message: { documentMessage: { caption: 'informe', fileName: 'a.pdf', fileLength: 10 } } } },
    },
  });
  assert.equal(getText(doc), 'informe');
  assert.equal(doc?.documentMessage?.fileName, 'a.pdf');
});

test('getText cubre caption de video y respuestas de botones', () => {
  assert.equal(getText({ videoMessage: { caption: 'mira' } }), 'mira');
  assert.equal(getText({ buttonsResponseMessage: { selectedDisplayText: 'Sí' } }), 'Sí');
  assert.equal(getText({ listResponseMessage: { title: 'Opción 1' } }), 'Opción 1');
  assert.equal(getText({ stickerMessage: {} }), '');
  assert.equal(getText(undefined), '');
});

test('getMentions lee el contextInfo de imagen, video y documento', () => {
  assert.deepEqual(getMentions({ imageMessage: { contextInfo: { mentionedJid: [USER_A] } } }), [USER_A]);
  assert.deepEqual(getMentions({ videoMessage: { contextInfo: { mentionedJid: [USER_B] } } }), [USER_B]);
  assert.deepEqual(getMentions({ documentMessage: { contextInfo: { mentionedJid: [USER_A, USER_B] } } }), [USER_A, USER_B]);
  assert.deepEqual(getMentions({ conversation: 'sin menciones' }), []);
});

test('getQuoted devuelve el mensaje citado desenvuelto con autor e id', () => {
  const content: proto.IMessage = {
    extendedTextMessage: {
      text: 'respuesta',
      contextInfo: {
        stanzaId: 'Q1',
        participant: USER_B,
        quotedMessage: { ephemeralMessage: { message: { imageMessage: { caption: 'foto original' } } } },
      },
    },
  };
  const quoted = getQuoted(content);
  assert.ok(quoted);
  assert.equal(quoted.stanzaId, 'Q1');
  assert.equal(quoted.participant, USER_B);
  assert.equal(quoted.text, 'foto original');
  assert.ok(quoted.message.imageMessage);
  assert.equal(getQuoted({ conversation: 'nada' }), undefined);
  assert.ok(getContextInfo(content));
});
