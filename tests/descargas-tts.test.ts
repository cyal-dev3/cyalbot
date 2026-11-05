import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_LANG, LANGUAGES, parseTtsInput, splitTtsChunks, ttsPlugin } from '../src/plugins/tools-tts.js';

test('parseTtsInput solo cambia de idioma con un código explícito de LANGUAGES', () => {
  assert.deepEqual(parseTtsInput('hola mundo'), { lang: 'es', text: 'hola mundo' });
  assert.deepEqual(parseTtsInput('en: hello world'), { lang: 'en', text: 'hello world' });
  assert.deepEqual(parseTtsInput('EN:hello'), { lang: 'en', text: 'hello' });
  assert.deepEqual(parseTtsInput('-pt bom dia'), { lang: 'pt', text: 'bom dia' });
  // "la casa" o "en casa" son español, no latín ni inglés.
  assert.deepEqual(parseTtsInput('la casa es grande'), { lang: 'es', text: 'la casa es grande' });
  assert.deepEqual(parseTtsInput('en casa estoy'), { lang: 'es', text: 'en casa estoy' });
  // Código fuera de la lista: se lee tal cual en español.
  assert.deepEqual(parseTtsInput('xx: algo'), { lang: 'es', text: 'xx: algo' });
  assert.deepEqual(parseTtsInput('-zz algo'), { lang: 'es', text: '-zz algo' });
  // Código solo (respondiendo a un mensaje): idioma fijado y texto vacío para usar el citado.
  assert.deepEqual(parseTtsInput('  en:   '), { lang: 'en', text: '' });
  assert.deepEqual(parseTtsInput('-en'), { lang: 'en', text: '' });
  assert.deepEqual(parseTtsInput('-entero'), { lang: 'es', text: '-entero' });
  assert.deepEqual(parseTtsInput('xx:'), { lang: 'es', text: 'xx:' });
  assert.deepEqual(parseTtsInput(''), { lang: DEFAULT_LANG, text: '' });
  assert.ok('es' in LANGUAGES && 'en' in LANGUAGES);
});

test('splitTtsChunks respeta el límite y corta por frase', () => {
  const sentence = 'Esta es una frase de prueba bastante normal. ';
  const long = sentence.repeat(12).trim();
  const chunks = splitTtsChunks(long);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) assert.ok(chunk.length <= 200, `${chunk.length}`);
  assert.equal(chunks.join(' ').replace(/\s+/g, ' '), long.replace(/\s+/g, ' '));
  assert.ok(chunks.slice(0, -1).every((c) => c.endsWith('.')));

  const noSpaces = 'a'.repeat(450);
  const forced = splitTtsChunks(noSpaces);
  assert.deepEqual(forced.map((c) => c.length), [200, 200, 50]);

  assert.deepEqual(splitTtsChunks('hola'), ['hola']);
  assert.deepEqual(splitTtsChunks('ok'), ['Dice: ok']);
  assert.deepEqual(splitTtsChunks('  con​  espacios   raros '), ['con espacios raros']);
});

test('el plugin expone los comandos y no acepta idioma implícito en la ayuda', () => {
  assert.deepEqual(ttsPlugin.command, ['tts', 'voz', 'speak']);
  assert.ok(ttsPlugin.usage?.some((u) => u.includes('idiomas')));
});
