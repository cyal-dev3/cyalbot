import { shuffle } from './common.js';

export interface Card {
  rank: string;
  suit: string;
}

const SUITS = ['♠️', '♥️', '♦️', '♣️'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

export function newDeck(decks = 4): Card[] {
  const deck: Card[] = [];
  for (let d = 0; d < decks; d++) {
    for (const suit of SUITS) for (const rank of RANKS) deck.push({ rank, suit });
  }
  return shuffle(deck);
}

export function cardText(card: Card): string {
  return `${card.rank}${card.suit}`;
}

export function handText(hand: Card[]): string {
  return hand.map(cardText).join(' ');
}

/** Valor de la mano: los ases valen 11 salvo que la mano se pase, entonces 1. */
export function handValue(hand: Card[]): { total: number; soft: boolean } {
  let total = 0;
  let aces = 0;
  for (const card of hand) {
    if (card.rank === 'A') {
      aces++;
      total += 11;
    } else if (['J', 'Q', 'K'].includes(card.rank)) {
      total += 10;
    } else {
      total += parseInt(card.rank, 10);
    }
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return { total, soft: aces > 0 };
}

export function isBlackjack(hand: Card[]): boolean {
  return hand.length === 2 && handValue(hand).total === 21;
}

export function isBust(hand: Card[]): boolean {
  return handValue(hand).total > 21;
}

/** El crupier se planta en 17 o más, incluido el 17 suave. */
export function dealerShouldStand(hand: Card[]): boolean {
  return handValue(hand).total >= 17;
}

export function dealerPlay(hand: Card[], deck: Card[]): Card[] {
  while (!dealerShouldStand(hand) && deck.length > 0) hand.push(deck.pop() as Card);
  return hand;
}

export type Outcome = 'blackjack' | 'gana' | 'empate' | 'pierde';

/**
 * Resuelve una mano contra el crupier y devuelve lo que recibe el jugador
 * (apuesta incluida): blackjack natural 3:2, victoria 1:1, empate devuelve.
 * El natural del crupier gana a cualquier 21 no natural.
 */
export function settle(player: Card[], dealer: Card[], bet: number): { outcome: Outcome; payout: number } {
  const p = handValue(player).total;
  const d = handValue(dealer).total;
  const pNatural = isBlackjack(player);
  const dNatural = isBlackjack(dealer);

  if (p > 21) return { outcome: 'pierde', payout: 0 };
  if (pNatural && dNatural) return { outcome: 'empate', payout: bet };
  if (pNatural) return { outcome: 'blackjack', payout: bet + Math.floor(bet * 1.5) };
  if (dNatural) return { outcome: 'pierde', payout: 0 };
  if (d > 21 || p > d) return { outcome: 'gana', payout: bet * 2 };
  if (p === d) return { outcome: 'empate', payout: bet };
  return { outcome: 'pierde', payout: 0 };
}
