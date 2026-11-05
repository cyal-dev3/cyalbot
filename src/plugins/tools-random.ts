import type { PluginHandler } from '../types/message.js';
import { pickRandom, randomInt } from '../lib/utils.js';

const MAX_DICE = 100;
const MAX_SIDES = 1000;

/** "2d6" -> { count: 2, sides: 6 }; "20" -> 1d20; vacío -> 1d6. Null si no es válido. */
export function parseDice(input: string): { count: number; sides: number } | null {
  const raw = input.trim().toLowerCase();
  if (!raw) return { count: 1, sides: 6 };
  const match = raw.match(/^(\d*)d(\d+)$/) ?? raw.match(/^()(\d+)$/);
  if (!match) return null;
  const count = match[1] ? parseInt(match[1], 10) : 1;
  const sides = parseInt(match[2], 10);
  if (count < 1 || count > MAX_DICE || sides < 2 || sides > MAX_SIDES) return null;
  return { count, sides };
}

export const dadoPlugin: PluginHandler = {
  // Sin 'dados': ese alias es del juego de casino (game-dados.ts).
  command: ['dado', 'roll', 'tirar'],
  description: 'Tira uno o varios dados',
  category: 'herramientas',
  help: [`dado [NdM] - Tira N dados de M caras (por defecto 1d6; máximo ${MAX_DICE}d${MAX_SIDES})`],
  usage: ['dado', 'dado 2d6', 'dado 20'],

  handler: async ({ m, text, usedPrefix }) => {
    const dice = parseDice(text);
    if (!dice) {
      await m.reply(`Formato: *${usedPrefix}dado 2d6* (hasta ${MAX_DICE} dados de ${MAX_SIDES} caras).`);
      return;
    }
    const rolls = Array.from({ length: dice.count }, () => randomInt(1, dice.sides));
    const total = rolls.reduce((a, b) => a + b, 0);
    if (dice.count === 1) {
      await m.reply(`🎲 d${dice.sides}: *${total}*`);
      return;
    }
    const detail = rolls.length <= 20 ? ` (${rolls.join(' + ')})` : '';
    await m.reply(`🎲 ${dice.count}d${dice.sides}: *${total}*${detail}`);
  },
};

export const monedaPlugin: PluginHandler = {
  command: ['moneda', 'coin', 'flip', 'caraocruz'],
  description: 'Lanza una moneda',
  category: 'herramientas',
  help: ['moneda - Cara o cruz'],
  usage: ['moneda'],

  handler: async ({ m }) => {
    await m.reply(`🪙 ${pickRandom(['*Cara*', '*Cruz*'])}`);
  },
};

export const elegirPlugin: PluginHandler = {
  command: ['elegir', 'elige', 'escoge', 'choose', 'pick1'],
  description: 'Elige una opción al azar',
  category: 'herramientas',
  help: ['elegir a | b | c - Elige una de las opciones separadas por |'],
  usage: ['elegir pizza | tacos | sushi'],

  handler: async ({ m, text, usedPrefix }) => {
    const options = text.split(/\s*[|,]\s*|\s+o\s+/i).map((s) => s.trim()).filter(Boolean);
    if (options.length < 2) {
      await m.reply(`Dame al menos dos opciones: *${usedPrefix}elegir pizza | tacos | sushi*`);
      return;
    }
    await m.reply(`🎯 Elijo: *${pickRandom(options)}*`);
  },
};
