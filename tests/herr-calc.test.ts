import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculate, calculateWithTimeout, preprocessExpression, MAX_EXPRESSION_LENGTH } from '../src/plugins/tools-calc.js';

function result(expr: string): string {
  const r = calculate(expr);
  assert.ok(r.ok, `esperaba resultado para "${expr}", obtuve: ${r.ok ? '' : r.error}`);
  return r.result;
}

function error(expr: string): string {
  const r = calculate(expr);
  assert.ok(!r.ok, `esperaba error para "${expr}", obtuve ${r.ok ? r.result : ''}`);
  return r.error;
}

test('calcula aritmética, funciones y unidades', () => {
  assert.equal(result('2 + 2'), '4');
  assert.equal(result('2^10'), '1024');
  assert.equal(result('sqrt(144)'), '12');
  assert.equal(result('(12 + 8) * 3'), '60');
  assert.equal(result('10 / 4'), '2.5');
  assert.equal(result('5 km to m'), '5000 m');
  assert.equal(result('round(pi, 2)'), '3.14');
});

test('preprocesa porcentajes y símbolos escritos a mano', () => {
  assert.equal(preprocessExpression('15% de 2400'), '(15/100)*2400');
  assert.equal(result('15% de 2400'), '360');
  assert.equal(result('200 + 10%'), '200.1');
  assert.equal(result('3 × 4 ÷ 2'), '6');
  assert.equal(result('1,5 + 1'), '2.5');
});

test('bloquea las funciones que redefinen el entorno o evalúan texto', () => {
  for (const expr of ['import({})', 'evaluate("1+1")', 'parse("1")', 'compile("1")', 'createUnit("foo")', 'simplify("x+x")', 'derivative("x^2", "x")']) {
    assert.match(error(expr), /deshabilitada/, expr);
  }
  // Tras los intentos el entorno sigue funcionando.
  assert.equal(result('1 + 1'), '2');
});

test('da errores legibles', () => {
  assert.match(error('x + 1'), /No sé qué es "x"/);
  assert.match(error('foo(1)'), /No existe la función "foo"/);
  assert.match(error('2 +'), /no está bien formada/);
  assert.match(error(''), /Escribe una expresión/);
  assert.match(error('1+'.repeat(MAX_EXPRESSION_LENGTH)), /Máximo/);
  assert.match(error('sqrt'), /función, no un valor/);
});

test('calculateWithTimeout resuelve igual que calculate', async () => {
  assert.deepEqual(await calculateWithTimeout('6 * 7'), { ok: true, result: '42' });
  assert.equal((await calculateWithTimeout('x')).ok, false);
});
