import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TRIVIA_BANK, TRIVIA_TEMAS } from '../src/constants/trivia.js';
import { PALABRAS, PALABRAS_CATEGORIAS } from '../src/constants/palabras.js';
import { localTriviaQuestion, localWord, normalizeWord } from '../src/lib/ai-games.js';
import { maskWord } from '../src/plugins/game-ahorcado.js';
import { parseBetType, BET_TYPES } from '../src/plugins/game-roulette.js';
import { compare, parseChoice } from '../src/plugins/game-ppt.js';
import { winnerOf, boardText } from '../src/plugins/game-ttt.js';
import { normalizeEmoji } from '../src/plugins/game-memoria.js';
import { lovePercentage, stableHash } from '../src/plugins/fun-amor.js';

test('banco de trivia: al menos 100 preguntas válidas y variadas', () => {
  assert.ok(TRIVIA_BANK.length >= 100, `hay ${TRIVIA_BANK.length}`);
  const seen = new Set<string>();
  for (const q of TRIVIA_BANK) {
    assert.equal(q.opciones.length, 4, q.pregunta);
    assert.ok(Number.isInteger(q.correcta) && q.correcta >= 0 && q.correcta <= 3, q.pregunta);
    assert.equal(new Set(q.opciones.map((o) => o.toLowerCase())).size, 4, `opciones repetidas: ${q.pregunta}`);
    assert.ok(q.opciones.every((o) => o.trim().length > 0), q.pregunta);
    assert.ok(q.explicacion.length > 0, q.pregunta);
    assert.ok((TRIVIA_TEMAS as readonly string[]).includes(q.tema), q.pregunta);
    assert.equal(seen.has(q.pregunta), false, `pregunta duplicada: ${q.pregunta}`);
    seen.add(q.pregunta);
  }
  for (const tema of TRIVIA_TEMAS) {
    assert.ok(TRIVIA_BANK.filter((q) => q.tema === tema).length >= 10, `pocas preguntas de ${tema}`);
  }
  const positions = new Set(TRIVIA_BANK.map((q) => q.correcta));
  assert.equal(positions.size, 4, 'la respuesta correcta aparece en las cuatro posiciones');
});

test('localTriviaQuestion filtra por tema y evita repetidas', () => {
  const q = localTriviaQuestion('ciencia');
  assert.equal(q.tema, 'ciencia');
  const exclude = new Set(TRIVIA_BANK.filter((x) => x.tema === 'mexico').slice(0, -1).map((x) => x.pregunta));
  const last = localTriviaQuestion('mexico', exclude);
  assert.equal(exclude.has(last.pregunta), false);
  assert.ok(localTriviaQuestion('tema inexistente'));
});

test('banco de palabras: 150 palabras normalizadas con pista', () => {
  assert.ok(PALABRAS.length >= 150, `hay ${PALABRAS.length}`);
  for (const p of PALABRAS) {
    assert.equal(p.palabra, normalizeWord(p.palabra), `palabra sin normalizar: ${p.palabra}`);
    assert.ok(p.palabra.length >= 3, p.palabra);
    assert.ok(p.pista.length > 3, p.palabra);
    assert.equal(normalizeWord(p.pista).includes(p.palabra), false, `la pista revela ${p.palabra}`);
    assert.ok((PALABRAS_CATEGORIAS as readonly string[]).includes(p.categoria));
  }
  assert.equal(localWord('frutas').categoria, 'frutas');
  assert.equal(maskWord('gato', new Set(['a', 't'])), '_ A T _');
  assert.equal(normalizeWord('Piña Colada'), 'pinacolada');
});

test('ruleta: parseBetType y pagos europeos', () => {
  assert.equal(parseBetType('17')?.type.key, 'pleno');
  assert.equal(parseBetType('37'), null);
  assert.equal(parseBetType('rojo')?.type.payout, 1);
  assert.equal(parseBetType('d2')?.pick, 2);
  assert.equal(parseBetType('columna3')?.type.key, 'columna');
  assert.equal(parseBetType('d4'), null);
  assert.equal(parseBetType('nada'), null);
  const by = (key: string) => BET_TYPES.find((t) => t.key === key)!;
  assert.equal(by('rojo').wins(1, 0), true);
  assert.equal(by('negro').wins(0, 0), false);
  assert.equal(by('par').wins(0, 0), false);
  assert.equal(by('docena').wins(12, 1), true);
  assert.equal(by('docena').wins(13, 1), false);
  assert.equal(by('columna').wins(1, 1), true);
  assert.equal(by('columna').wins(2, 2), true);
  assert.equal(by('columna').wins(36, 3), true);
  // Cada tipo paga en proporción a su probabilidad con el 0 como margen (RTP 36/37).
  for (const t of BET_TYPES) {
    const pick = t.key === 'pleno' ? 17 : 1;
    const winning = Array.from({ length: 37 }, (_, n) => n).filter((n) => t.wins(n, pick)).length;
    assert.ok(Math.abs((winning / 37) * (t.payout + 1) - 36 / 37) < 1e-9, `${t.key} RTP incorrecto`);
  }
});

test('ppt y ttt: lógica pura', () => {
  assert.equal(compare('piedra', 'tijera'), 1);
  assert.equal(compare('papel', 'tijera'), -1);
  assert.equal(compare('papel', 'papel'), 0);
  assert.equal(parseChoice('pa'), 'papel');
  assert.equal(parseChoice('zzz'), null);
  assert.equal(winnerOf(['X', 'X', 'X', null, 'O', 'O', null, null, null]), 'X');
  assert.equal(winnerOf(['O', 'X', null, 'O', 'X', null, 'O', null, null]), 'O');
  assert.equal(winnerOf([null, null, null, null, null, null, null, null, null]), null);
  assert.equal(boardText([null, 'X', null, null, 'O', null, null, null, null]).split('\n').length, 3);
  assert.equal(normalizeEmoji('✈️'), '✈');
});

test('amor/gay: hashes estables e independientes del orden', () => {
  assert.equal(lovePercentage('a@s.whatsapp.net', 'b@s.whatsapp.net'), lovePercentage('b@s.whatsapp.net', 'a@s.whatsapp.net'));
  assert.equal(lovePercentage('Juan', 'María'), lovePercentage('maria', 'juan'));
  assert.ok(lovePercentage('x', 'y') >= 0 && lovePercentage('x', 'y') <= 100);
  assert.equal(stableHash('abc'), stableHash('abc'));
  assert.notEqual(stableHash('1@s.whatsapp.net'), stableHash('2@s.whatsapp.net'));
});
