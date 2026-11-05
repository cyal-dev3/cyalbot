import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { calculate, calculateWithTimeout, preprocessExpression, stopCalcWorker, MAX_EXPRESSION_LENGTH } from '../src/plugins/tools-calc.js';

after(() => stopCalcWorker());

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
  assert.equal(result('1,5*2'), '3');
  assert.equal(result('3,5'), '3.5');
});

test('la coma decimal no rompe argumentos ni listas, y % entre números es módulo', () => {
  assert.equal(result('max(3,5)'), '5');
  assert.equal(result('max(3,5,2)'), '5');
  assert.equal(result('gcd(12,18)'), '6');
  assert.equal(result('pow(2,10)'), '1024');
  assert.equal(result('round(2.567,2)'), '2.57');
  assert.equal(result('[1,2,3]'), '[1, 2, 3]');
  assert.equal(result('1,5 + max(2,3)'), '4.5');
  assert.equal(result('10 % 3'), '1');
  assert.equal(result('10%*3'), '0.3');
});

test('bloquea las funciones que redefinen el entorno, evalúan texto o cambian la configuración', () => {
  for (const expr of ['import({})', 'evaluate("1+1")', 'parse("1")', 'compile("1")', 'createUnit("foo")', 'simplify("x+x")', 'derivative("x^2", "x")', 'config({number: "BigNumber"})', 'parser()']) {
    assert.match(error(expr), /deshabilitada/, expr);
  }
  // Tras los intentos el entorno sigue funcionando y con la configuración de siempre.
  assert.equal(result('1 + 1'), '2');
  assert.equal(result('typeOf(1/3)'), '"number"');
  assert.equal(result('1 == 1.9'), 'false');
});

test('da errores legibles', () => {
  assert.match(error('x + 1'), /No sé qué es "x"/);
  assert.match(error('foo(1)'), /No existe la función "foo"/);
  assert.match(error('2 +'), /no está bien formada/);
  assert.match(error(''), /Escribe una expresión/);
  assert.match(error('1+'.repeat(MAX_EXPRESSION_LENGTH)), /Máximo/);
  assert.match(error('sqrt'), /función, no un valor/);
  assert.match(error('100 usd to mxn'), /No sé qué es "usd"/);
});

test('calculateWithTimeout resuelve igual que calculate y reutiliza el hilo', async () => {
  assert.deepEqual(await calculateWithTimeout('6 * 7'), { ok: true, result: '42' });
  assert.equal((await calculateWithTimeout('x')).ok, false);
  assert.match((await calculateWithTimeout('')).ok ? '' : 'Escribe una expresión.', /Escribe/);
  const [a, b] = await Promise.all([calculateWithTimeout('2^3'), calculateWithTimeout('3^2')]);
  assert.deepEqual([a, b], [{ ok: true, result: '8' }, { ok: true, result: '9' }]);
});

test('una expresión que bloquea se corta al vencer el plazo sin congelar el proceso', async () => {
  const started = Date.now();
  let ticks = 0;
  const ticker = setInterval(() => ticks++, 20);
  const outcome = await calculateWithTimeout('ones(4000,4000) * ones(4000,4000)', 300);
  clearInterval(ticker);
  assert.equal(outcome.ok, false);
  assert.match(outcome.ok ? '' : outcome.error, /demasiado/);
  assert.ok(Date.now() - started < 5_000, 'el plazo no se respetó');
  assert.ok(ticks >= 3, `el bucle de eventos quedó bloqueado (${ticks} ticks)`);
  // El hilo se reemplazó y la calculadora sigue viva.
  assert.deepEqual(await calculateWithTimeout('1 + 1'), { ok: true, result: '2' });
});
