import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GroupMetadata } from 'baileys';
import { buildTagChunks } from '../src/plugins/group-tagall.js';
import { renderGroupMessage } from '../src/plugins/group-welcome.js';
import { parsePinDuration } from '../src/plugins/group-pin.js';
import { splitUpdateResults } from '../src/plugins/group-admin.js';
import { setPicPlugin } from '../src/plugins/group-tools.js';
import { setLogLevel } from '../src/lib/logger.js';
import {
  runtimeStats, recordReconnect, recordReconnectAttempt, recordError, recordLogLine,
  getRecentLogLines, formatLogLine, resetRuntimeStats, sanitizeLogMessage, LOG_BUFFER_SIZE,
} from '../src/lib/runtime-stats.js';

setLogLevel('error');

const jids = (n: number): string[] => Array.from({ length: n }, (_, i) => `52100000${String(i).padStart(5, '0')}@s.whatsapp.net`);

test('buildTagChunks pone 3 menciones por fila y el encabezado solo en el primer trozo', () => {
  const chunks = buildTagChunks('HEAD', jids(7));
  assert.equal(chunks.length, 1);
  const lines = chunks[0].text.split('\n');
  assert.equal(lines[0], 'HEAD');
  assert.equal(lines[1].split('  ').length, 3);
  assert.equal(lines[3].split('  ').length, 1);
  assert.equal(chunks[0].mentions.length, 7);
});

test('buildTagChunks trocea cuando se pasa del límite sin perder menciones', () => {
  const all = jids(400);
  const chunks = buildTagChunks('HEAD', all, 3, 1000);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) assert.ok(chunk.text.length <= 1000 + 80, `trozo de ${chunk.text.length}`);
  assert.deepEqual(chunks.flatMap((c) => c.mentions), all);
  assert.match(chunks[1].text, /continúa/);
  assert.equal(buildTagChunks('HEAD', []).length, 1);
});

test('renderGroupMessage sustituye todas las variables con valores por defecto sensatos', () => {
  const vars = { user: '5210000000003@s.whatsapp.net', group: 'Mi grupo', desc: '', count: 42, name: '' };
  assert.equal(
    renderGroupMessage('{user} {name} {group} {desc} {count}', vars),
    '@5210000000003 @5210000000003 Mi grupo Sin descripción 42',
  );
  assert.equal(renderGroupMessage('{name} {count}', { user: 'x@lid', group: 'g', name: 'Ana' }), 'Ana ?');
});

test('parsePinDuration: vacío es 24h, alias conocidos, y lo inválido es null', () => {
  assert.equal(parsePinDuration(''), 86400);
  assert.equal(parsePinDuration('24h'), 86400);
  assert.equal(parsePinDuration('semana'), 604800);
  assert.equal(parsePinDuration('30 d'), 2592000);
  assert.equal(parsePinDuration('2h'), null);
  assert.equal(parsePinDuration('para siempre'), null);
});

test('runtime-stats cuenta reconexiones y errores y guarda las últimas 200 líneas', () => {
  resetRuntimeStats();
  recordReconnectAttempt();
  recordReconnectAttempt();
  recordReconnect();
  recordError(new Error('boom'));
  assert.equal(runtimeStats.reconnectAttempts, 2);
  assert.equal(runtimeStats.reconnects, 1);
  assert.equal(runtimeStats.errors, 1);
  assert.equal(runtimeStats.lastError, 'boom');
  // recordError solo cuenta; la línea la pone el logger, si no saldría dos veces en /logs.
  assert.equal(getRecentLogLines().length, 0);
  recordLogLine('error', 'prueba', 'boom');
  assert.match(formatLogLine(getRecentLogLines()[0]), /error prueba boom$/);

  for (let i = 0; i < LOG_BUFFER_SIZE + 50; i++) recordLogLine('warn', 'bucle', `linea ${i}`);
  const lines = getRecentLogLines();
  assert.equal(lines.length, LOG_BUFFER_SIZE);
  assert.equal(lines[lines.length - 1].message, `linea ${LOG_BUFFER_SIZE + 49}`);
  assert.equal(getRecentLogLines(3).length, 3);
  resetRuntimeStats();
  assert.equal(getRecentLogLines().length, 0);
});

test('el buffer de /logs no guarda pilas de llamadas ni líneas interminables', () => {
  resetRuntimeStats();
  const stack = 'Error: boom\n    at handler (/home/bot/dist/handler.js:123:5)\n    at async run (/home/bot/dist/index.js:9:1)';
  recordLogLine('error', 'handler', `plugin x: ${stack}`);
  const [line] = getRecentLogLines();
  assert.equal(line.message, 'plugin x: Error: boom');
  assert.doesNotMatch(formatLogLine(line), /\/home\//);
  assert.equal(sanitizeLogMessage('uno\n  dos  \n\ntres'), 'uno | dos | tres');
  const long = sanitizeLogMessage('x'.repeat(2000));
  assert.ok(long.length <= 600);
  assert.ok(long.endsWith('...'));
  resetRuntimeStats();
});

const LID_GROUP = {
  participants: [
    { id: '100000000000004@lid', jid: '5210000000003@s.whatsapp.net', admin: null },
    { id: '100000000000006@lid', jid: '5210000000005@s.whatsapp.net', admin: null },
  ],
} as unknown as GroupMetadata;

test('splitUpdateResults empareja la respuesta de WhatsApp aunque venga en el otro formato de id', () => {
  const sent = ['100000000000004@lid', '100000000000006@lid'];
  // Respuesta por número para ids LID: el 403 debe contar como fallo, no como éxito.
  const mixed = splitUpdateResults(sent, [
    { status: '403', jid: '5210000000003@s.whatsapp.net', content: { attrs: { jid: '5210000000003@s.whatsapp.net' } } },
    { status: '200', jid: undefined, content: { attrs: { lid: '100000000000006@lid' } } },
  ], LID_GROUP);
  assert.deepEqual(mixed, { done: ['100000000000006@lid'], failed: ['100000000000004@lid'] });
  // Sin respuesta por participante WhatsApp aceptó todo.
  assert.deepEqual(splitUpdateResults(sent, [], LID_GROUP), { done: sent, failed: [] });
  // Si respondió y alguien no aparece, no se confirma.
  const partial = splitUpdateResults(sent, [{ status: '200', jid: '100000000000004@lid' }], LID_GROUP);
  assert.deepEqual(partial, { done: ['100000000000004@lid'], failed: ['100000000000006@lid'] });
});

interface SetPicFake {
  replies: string[];
  reacts: string[];
  ctx: Parameters<typeof setPicPlugin.handler>[0];
}

function setPicCtx(message: Record<string, unknown> | undefined, raw: Record<string, unknown> | undefined): SetPicFake {
  const replies: string[] = [];
  const reacts: string[] = [];
  const ctx = {
    m: {
      chat: 'g@g.us',
      sender: 'u@s.whatsapp.net',
      key: { id: '1', remoteJid: 'g@g.us' },
      mentionedJid: [],
      message,
      rawMessage: { key: { id: '1' }, message: raw },
      reply: async (t: string) => { replies.push(t); },
      react: async (e: string) => { reacts.push(e); },
    },
    usedPrefix: '/',
    conn: { updateProfilePicture: async () => {}, updateMediaMessage: async () => { throw new Error('sin red'); } },
  } as unknown as SetPicFake['ctx'];
  return { replies, reacts, ctx };
}

test('setpic reconoce la imagen aunque llegue envuelta en un mensaje temporal', async () => {
  const imageMessage = { mimetype: 'image/jpeg', fileLength: 10 };
  // m.message ya viene desenvuelto; rawMessage.message trae el contenedor efímero.
  const wrapped = setPicCtx({ imageMessage }, { ephemeralMessage: { message: { imageMessage } } });
  await setPicPlugin.handler(wrapped.ctx);
  assert.equal(wrapped.reacts[0], '⏳');
  // La descarga falla (no hay red ni claves) pero ya no se responde el texto de uso.
  assert.doesNotMatch(wrapped.replies[0] ?? '', /Responde a una imagen/);

  const none = setPicCtx({ conversation: '/setpic' }, { conversation: '/setpic' });
  await setPicPlugin.handler(none.ctx);
  assert.deepEqual(none.reacts, []);
  assert.match(none.replies[0], /Responde a una imagen/);
});
