import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  msToTime, formatNumber, createProgressBar, checkCooldown, normalizeText, parseAmount, getTargetUser, getTargetUserOrSelf, mentionTag, displayName,
} from '../src/lib/utils.js';

test('msToTime formatea horas y minutos', () => {
  assert.equal(msToTime(0), '0 segundos');
  assert.equal(msToTime(90_000), '1 minuto 30 segundos');
  assert.equal(msToTime(2 * 3_600_000 + 5 * 60_000), '2 horas 5 minutos');
});

test('formatNumber compacto', () => {
  assert.equal(formatNumber(999, 'compact'), '999');
  assert.equal(formatNumber(1500, 'compact'), '1.5K');
  assert.equal(formatNumber(2_300_000, 'compact'), '2.3M');
});

test('createProgressBar no se sale del rango', () => {
  assert.equal(createProgressBar(5, 10, 10), '█████░░░░░');
  assert.equal(createProgressBar(50, 10, 10), '██████████');
  assert.equal(createProgressBar(-3, 10, 10), '░░░░░░░░░░');
});

test('checkCooldown aplica la reducción por rango', () => {
  const now = Date.now();
  const r = checkCooldown(now - 5_000, 10_000, 50);
  assert.equal(r.effectiveCooldown, 5_000);
  assert.equal(r.onCooldown, false);
  const r2 = checkCooldown(now - 1_000, 10_000, 0);
  assert.equal(r2.onCooldown, true);
  assert.ok(r2.remaining > 8_000 && r2.remaining <= 9_000);
});

test('normalizeText quita acentos', () => {
  assert.equal(normalizeText('Poción de Salud'), 'pocion de salud');
});

test('msToTime incluye días y omite minutos cuando hay horas', () => {
  assert.equal(msToTime(90_000_000), '1 día 1 hora');
  assert.equal(msToTime(2 * 86_400_000 + 3 * 3_600_000 + 7 * 60_000), '2 días 3 horas 7 minutos');
});

test('parseAmount interpreta sufijos, palabras clave y rechaza basura', () => {
  assert.equal(parseAmount('5k'), 5000);
  assert.equal(parseAmount('2.5m'), 2_500_000);
  assert.equal(parseAmount('1,000'), 1000);
  assert.equal(parseAmount('todo', 777), 777);
  assert.equal(parseAmount('todo'), null);
  assert.equal(parseAmount('mitad', 101), 50);
  assert.equal(parseAmount('50%', 200), 100);
  assert.equal(parseAmount('100abc'), null);
  assert.equal(parseAmount('-5'), null);
  assert.equal(parseAmount('0'), null);
  assert.equal(parseAmount(undefined), null);
});

test('getTargetUser prioriza mención, luego cita, luego número en args; nunca un grupo', () => {
  const GROUP = '123@g.us';
  const A = '5210000000001@s.whatsapp.net';
  const B = '5210000000002@s.whatsapp.net';
  assert.equal(getTargetUser({ mentionedJid: [GROUP], chat: GROUP }), null);
  assert.equal(getTargetUser({ mentionedJid: [B], quoted: { sender: A }, chat: GROUP }), B);
  assert.equal(getTargetUser({ mentionedJid: [], quoted: { sender: A }, chat: GROUP }), A);
  assert.equal(getTargetUser({ mentionedJid: [], quoted: { sender: GROUP }, chat: GROUP }), null);
  assert.equal(getTargetUser({ mentionedJid: [], chat: GROUP }, { args: ['dar', '5210000000002', '100'] }), B);
  assert.equal(getTargetUser({ mentionedJid: [], chat: GROUP }, { args: ['100'] }), null);
  // El propio remitente solo cuenta con allowSelf.
  assert.equal(getTargetUser({ mentionedJid: [A], chat: GROUP, sender: A }), null);
  assert.equal(getTargetUser({ mentionedJid: [A], chat: GROUP, sender: A }, { allowSelf: true }), A);
  assert.equal(getTargetUserOrSelf({ mentionedJid: [], chat: GROUP, sender: A }), A);
});

test('mentionTag y displayName', () => {
  assert.equal(mentionTag('5210000000001:3@s.whatsapp.net'), '@5210000000001');
  assert.equal(displayName('5210000000001@s.whatsapp.net', '  ', 'Push'), 'Push');
  assert.equal(displayName('5210000000001@s.whatsapp.net', 'Registrado', 'Push'), 'Registrado');
  assert.equal(displayName('5210000000001@s.whatsapp.net'), '5210000000001');
});
