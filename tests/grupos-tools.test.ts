import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTagChunks } from '../src/plugins/group-tagall.js';
import { renderGroupMessage } from '../src/plugins/group-welcome.js';
import { parsePinDuration } from '../src/plugins/group-pin.js';
import {
  runtimeStats, recordReconnect, recordReconnectAttempt, recordError, recordLogLine,
  getRecentLogLines, formatLogLine, resetRuntimeStats, LOG_BUFFER_SIZE,
} from '../src/lib/runtime-stats.js';

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
  recordError(new Error('boom'), 'prueba');
  assert.equal(runtimeStats.reconnectAttempts, 2);
  assert.equal(runtimeStats.reconnects, 1);
  assert.equal(runtimeStats.errors, 1);
  assert.equal(runtimeStats.lastError, 'boom');
  assert.equal(getRecentLogLines().length, 1);
  assert.match(formatLogLine(getRecentLogLines()[0]), /error prueba boom$/);

  for (let i = 0; i < LOG_BUFFER_SIZE + 50; i++) recordLogLine('warn', 'bucle', `linea ${i}`);
  const lines = getRecentLogLines();
  assert.equal(lines.length, LOG_BUFFER_SIZE);
  assert.equal(lines[lines.length - 1].message, `linea ${LOG_BUFFER_SIZE + 49}`);
  assert.equal(getRecentLogLines(3).length, 3);
  resetRuntimeStats();
  assert.equal(getRecentLogLines().length, 0);
});
