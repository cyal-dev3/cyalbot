import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeForIssue, reporterLabel, issueTitle } from '../src/plugins/tools-github.js';
import { isAllowedThumbnail } from '../src/plugins/tools-wiki.js';
import { findLanguage, languageHint, LANGUAGES } from '../src/plugins/tools-translate.js';
import { dadoPlugin, parseDice } from '../src/plugins/tools-random.js';
import { normalizeNoteKey } from '../src/plugins/tools-notas.js';

test('sanitizeForIssue evita menciones de GitHub y no rompe la tabla de metadatos', () => {
  const out = sanitizeForIssue('hola @torvalds y @github | fin');
  assert.doesNotMatch(out, /@torvalds/);
  assert.match(out, /@​torvalds/);
  assert.match(out, /\\\|/);
  assert.equal(sanitizeForIssue('correo a@b.com'), 'correo a@​b.com');
  assert.equal(sanitizeForIssue('línea 1\nlínea | 2', { singleLine: true }), 'línea 1 línea \\| 2');
  assert.equal(reporterLabel('Pepe | @admin\n', '5215512345678@s.whatsapp.net'), 'Pepe \\| @​admin (…5678)');
  assert.equal(reporterLabel('', 'x@lid'), 'Usuario (sin número)');
  assert.equal(issueTitle('[BUG]', 'una\nlínea   rota'), '[BUG] una línea rota');
});

test('isAllowedThumbnail solo acepta https en upload.wikimedia.org', () => {
  assert.equal(isAllowedThumbnail('https://upload.wikimedia.org/wikipedia/commons/thumb/a/a.jpg'), true);
  assert.equal(isAllowedThumbnail('http://upload.wikimedia.org/a.jpg'), false);
  assert.equal(isAllowedThumbnail('https://upload.wikimedia.org.evil.com/a.jpg'), false);
  assert.equal(isAllowedThumbnail('https://evil.com/upload.wikimedia.org/a.jpg'), false);
  assert.equal(isAllowedThumbnail('no es url'), false);
});

test('findLanguage no toma palabras españolas corrientes como código de idioma', () => {
  assert.equal(findLanguage('en')?.code, 'en');
  assert.equal(findLanguage('japonés')?.code, 'ja');
  assert.equal(findLanguage('alemán')?.code, 'de');
  assert.equal(findLanguage('german')?.code, 'de');
  for (const word of ['la', 'de', 'es', 'it']) assert.equal(findLanguage(word), null, word);
  assert.equal(findLanguage('latín')?.code, 'la');
  assert.equal(findLanguage('italiano')?.code, 'it');
  assert.equal(findLanguage('xx'), null);
  assert.match(languageHint(LANGUAGES.find((l) => l.code === 'de')!), /escríbelo así/);
  assert.equal(languageHint(LANGUAGES.find((l) => l.code === 'en')!), 'inglés (en)');
});

test('el dado no registra el alias del juego de casino y parseDice valida límites', () => {
  assert.ok(!dadoPlugin.command.includes('dados'));
  assert.deepEqual(parseDice('2d6'), { count: 2, sides: 6 });
  assert.deepEqual(parseDice(''), { count: 1, sides: 6 });
  assert.equal(parseDice('101d6'), null);
  assert.equal(parseDice('1d1001'), null);
});

test('normalizeNoteKey rechaza claves heredadas de Object.prototype', () => {
  assert.equal(normalizeNoteKey('Reglas del grupo'), 'reglasdelgrupo');
  for (const key of ['__proto__', 'constructor', 'prototype', '!!!']) {
    assert.equal(normalizeNoteKey(key), null, key);
  }
  // Las claves se guardan en minúsculas: "toString" pasa a "tostring", que no hereda nada.
  assert.equal(normalizeNoteKey('toString'), 'tostring');
});
