import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findBadWord, foldText } from '../src/lib/moderation.js';

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
