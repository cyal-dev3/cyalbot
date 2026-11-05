import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  type Card, handValue, isBlackjack, isBust, dealerShouldStand, dealerPlay, settle, newDeck,
} from '../src/lib/games/blackjack.js';

const c = (rank: string): Card => ({ rank, suit: '♠️' });
const hand = (...ranks: string[]): Card[] => ranks.map(c);

test('handValue: ases flexibles y figuras a 10', () => {
  assert.deepEqual(handValue(hand('A', 'K')), { total: 21, soft: true });
  assert.deepEqual(handValue(hand('A', 'A')), { total: 12, soft: true });
  assert.deepEqual(handValue(hand('A', 'A', '9')), { total: 21, soft: true });
  assert.deepEqual(handValue(hand('A', '9', '9')), { total: 19, soft: false });
  assert.deepEqual(handValue(hand('K', 'Q', '5')), { total: 25, soft: false });
  assert.deepEqual(handValue(hand('A', '6')), { total: 17, soft: true });
});

test('blackjack natural, pasarse y plante del crupier', () => {
  assert.equal(isBlackjack(hand('A', 'J')), true);
  assert.equal(isBlackjack(hand('7', '7', '7')), false, '21 con tres cartas no es natural');
  assert.equal(isBust(hand('K', 'K', '2')), true);
  assert.equal(dealerShouldStand(hand('A', '6')), true, 'se planta en 17 suave');
  assert.equal(dealerShouldStand(hand('10', '6')), false);
  const dealer = dealerPlay(hand('10', '6'), [c('2'), c('5')]);
  assert.equal(handValue(dealer).total, 21, 'saca del final del mazo hasta plantarse');
});

test('settle: pagos estándar', () => {
  assert.deepEqual(settle(hand('A', 'K'), hand('10', '9'), 100), { outcome: 'blackjack', payout: 250 });
  assert.deepEqual(settle(hand('A', 'K'), hand('A', 'Q'), 100), { outcome: 'empate', payout: 100 });
  assert.deepEqual(settle(hand('7', '7', '7'), hand('A', 'K'), 100), { outcome: 'pierde', payout: 0 }, 'natural del crupier gana a 21 no natural');
  assert.deepEqual(settle(hand('10', '9'), hand('10', '8'), 100), { outcome: 'gana', payout: 200 });
  assert.deepEqual(settle(hand('10', '9'), hand('10', '9'), 100), { outcome: 'empate', payout: 100 });
  assert.deepEqual(settle(hand('10', '9'), hand('10', '6', '6'), 100), { outcome: 'gana', payout: 200 }, 'crupier pasado');
  assert.deepEqual(settle(hand('10', '6', '6'), hand('10', '6', '6'), 100), { outcome: 'pierde', payout: 0 }, 'jugador pasado pierde aunque el crupier también');
  assert.deepEqual(settle(hand('10', '5'), hand('10', '7'), 100), { outcome: 'pierde', payout: 0 });
});

test('newDeck tiene 52 cartas por mazo, barajadas', () => {
  const deck = newDeck(1);
  assert.equal(deck.length, 52);
  const keys = new Set(deck.map((k) => `${k.rank}${k.suit}`));
  assert.equal(keys.size, 52);
  const ordered = newDeck(1).map((k) => k.rank).join('') === deck.map((k) => k.rank).join('');
  assert.equal(ordered, false, 'dos mazos no salen en el mismo orden');
});
