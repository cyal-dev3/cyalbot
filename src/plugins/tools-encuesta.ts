import type { PluginHandler } from '../types/message.js';

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 12;
const MAX_QUESTION = 255;
const MAX_OPTION = 100;

export interface ParsedPoll {
  question: string;
  options: string[];
  multiple: boolean;
}

/** "pregunta | a | b" con flag opcional -m (varias respuestas). Null si falta algo. */
export function parsePoll(input: string): ParsedPoll | { error: string } {
  let text = input.trim();
  const multiple = /(^|\s)-m(\s|$)/.test(text);
  if (multiple) text = text.replace(/(^|\s)-m(?=\s|$)/, ' ').trim();
  const parts = text.split('|').map((s) => s.trim()).filter(Boolean);
  if (parts.length < MIN_OPTIONS + 1) return { error: `Necesito una pregunta y al menos ${MIN_OPTIONS} opciones separadas por |.` };
  const [question, ...options] = parts;
  if (options.length > MAX_OPTIONS) return { error: `Máximo ${MAX_OPTIONS} opciones.` };
  if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) return { error: 'Hay opciones repetidas.' };
  return {
    question: question.slice(0, MAX_QUESTION),
    options: options.map((o) => o.slice(0, MAX_OPTION)),
    multiple,
  };
}

export const encuestaPlugin: PluginHandler = {
  command: ['encuesta', 'poll', 'votacion', 'votación'],
  description: 'Crea una encuesta nativa de WhatsApp',
  category: 'herramientas',
  help: [`encuesta pregunta | op1 | op2 [| ...] - Encuesta con ${MIN_OPTIONS} a ${MAX_OPTIONS} opciones (-m permite varias respuestas)`],
  usage: ['encuesta ¿Cenamos? | Pizza | Tacos | Sushi', 'encuesta -m ¿Qué días? | Lunes | Martes | Viernes'],

  handler: async ({ m, text, usedPrefix, send }) => {
    const parsed = parsePoll(text);
    if ('error' in parsed) {
      await m.reply(`${parsed.error}\nEjemplo: *${usedPrefix}encuesta ¿Cenamos? | Pizza | Tacos*`);
      return;
    }
    await send({
      poll: {
        name: parsed.question,
        values: parsed.options,
        selectableCount: parsed.multiple ? 0 : 1,
      },
    });
  },
};
