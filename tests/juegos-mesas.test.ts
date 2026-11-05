import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setLogLevel } from '../src/lib/logger.js';
import { initDatabase, type Database } from '../src/lib/database.js';
import type { MessageContext, CommandContext, PluginHandler, SerializedMessage } from '../src/types/message.js';
import type { MessageHandler } from '../src/handler.js';
import { closeAllTables, listActiveTables } from '../src/lib/games/session.js';
import { getCasino, CASINO_LIMITS } from '../src/lib/games/state.js';
import { noPrefixOnly } from '../src/lib/games/common.js';
import { adivinaPlugin, intentoPlugin } from '../src/plugins/game-adivina.js';
import { pptPlugin, aceptarPptPlugin, eleccionPptPlugin, botPayout } from '../src/plugins/game-ppt.js';
import { bjPlugin, pedirPlugin, plantarsePlugin } from '../src/plugins/game-blackjack.js';
import { ruletaPlugin, girarPlugin } from '../src/plugins/game-roulette.js';
import { ahorcadoPlugin, letraPlugin } from '../src/plugins/game-ahorcado.js';
import { registerCasino, registerMinijuegos } from '../src/plugins/game-casino.js';
import { nextLevel } from '../src/plugins/game-memoria.js';

setLogLevel('error');

const G = 'grupo@g.us';
const A = '111@s.whatsapp.net';
const B = '222@s.whatsapp.net';
const PREFIX = '!';

let db: Database;
let dir: string;
/** Todo lo que el bot "envía" al grupo (respuestas, say, ediciones). */
const sent: string[] = [];
const contexts: CommandContext[] = [];

const fakeConn = {
  sendMessage: async (_chat: string, content: { text?: string }) => {
    sent.push(content.text ?? '');
    return { key: { id: `msg-${sent.length}` } };
  },
};

const fakeHandler = {
  registerContext: (c: CommandContext) => { contexts.push(c); },
  registerPlugin: () => {},
  isCompactMode: () => false,
} as unknown as MessageHandler;

function message(sender: string, text: string, extra: Partial<SerializedMessage> = {}): SerializedMessage {
  return {
    key: { id: 'in' }, sender, chat: G, text, fromMe: false, isGroup: true, pushName: sender.slice(0, 3),
    mentionedJid: [], rawMessage: undefined,
    reply: async (t: string) => { sent.push(t); return undefined; },
    react: async () => {},
    ...extra,
  } as SerializedMessage;
}

/** Ejecuta un plugin como lo haría el handler para `text` (con o sin prefijo). */
async function run(plugin: PluginHandler, sender: string, text: string, extra: Partial<SerializedMessage> = {}): Promise<void> {
  const usedPrefix = text.startsWith(PREFIX) ? PREFIX : '';
  const [command = '', ...args] = text.slice(usedPrefix.length).trim().split(/\s+/);
  const m = message(sender, text, extra);
  const ctx = {
    conn: fakeConn, m, text: args.join(' '), args, command: command.toLowerCase(), usedPrefix,
    isOwner: false, isAdmin: false, isBotAdmin: false, isGroup: true, handler: fakeHandler, chatSettings: {},
    get user() { return db.getUser(m.sender); },
    send: async () => undefined, target: () => null,
  } as unknown as MessageContext;
  await plugin.handler(ctx);
}

/** Los temporizadores de las mesas corren en una microtarea tras el tick. */
const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
async function tick(ms: number): Promise<void> {
  mock.timers.tick(ms);
  await flush();
  await flush();
}

function context(name: string): CommandContext {
  const c = contexts.find((x) => x.name === name);
  assert.ok(c, `contexto ${name} registrado`);
  return c;
}

test.before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cyalbot-mesas-'));
  db = await initDatabase(join(dir, 'database.json'));
  db.updateUser(A, { money: 10_000, registered: true, name: 'Ana' });
  db.updateUser(B, { money: 10_000, registered: true, name: 'Beto' });
  registerCasino(fakeHandler);
  registerMinijuegos(fakeHandler);
});

test.after(async () => {
  await db.stop();
  await rm(dir, { recursive: true, force: true });
});

test.beforeEach(() => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  sent.length = 0;
  closeAllTables(G);
  db.updateUser(A, { money: 10_000 });
  db.updateUser(B, { money: 10_000 });
});

test.afterEach(() => {
  mock.timers.reset();
});

test('adivina solo: dejar expirar el tiempo pierde la apuesta (no hay reembolso)', async () => {
  await run(adivinaPlugin, A, '!adivina 1000');
  assert.equal(db.getUser(A).money, 9_000);
  // "50 pesos" es charla: no consume intento.
  await run(intentoPlugin, A, '50 pesos');
  assert.equal(sent.some((t) => t.includes('intento 1/')), false);
  await run(intentoPlugin, A, '50');
  const afterGuess = sent.length;
  assert.ok(sent.some((t) => t.includes('intento 1/')));
  if (listActiveTables(G).length === 0) return; // acertó a la primera: la mesa ya se pagó
  await tick(90_000);
  assert.equal(listActiveTables(G).length, 0, 'la mesa se cerró');
  assert.equal(db.getUser(A).money, 9_000, 'la apuesta no vuelve');
  assert.equal(getCasino(db).escrow.length, 0);
  assert.match(sent.slice(afterGuess).join('\n'), /pierdes/);
});

test('ppt: quien no elige en 60 s pierde el duelo por abandono; sin elecciones hay reembolso', async () => {
  await run(pptPlugin, A, '!ppt @222 1000', { mentionedJid: [B] });
  assert.equal(db.getUser(A).money, 9_000);
  await run(aceptarPptPlugin, B, 'aceptar');
  assert.equal(db.getUser(B).money, 9_000);
  await run(eleccionPptPlugin, A, 'piedra');
  await tick(60_000);
  const prize = Math.floor(2_000 * (1 - CASINO_LIMITS.duelFee));
  assert.equal(db.getUser(A).money, 9_000 + prize, 'A cobra el bote menos la comisión');
  assert.equal(db.getUser(B).money, 9_000, 'B perdió su apuesta');
  assert.equal(listActiveTables(G).length, 0);
  assert.match(sent.join('\n'), /abandono/);

  // Sin elecciones: reembolso para ambos.
  db.updateUser(A, { money: 10_000 });
  db.updateUser(B, { money: 10_000 });
  await run(pptPlugin, A, '!ppt @222 1000', { mentionedJid: [B] });
  await run(aceptarPptPlugin, B, 'aceptar');
  await tick(60_000);
  assert.equal(db.getUser(A).money, 10_000);
  assert.equal(db.getUser(B).money, 10_000);
  assert.equal(getCasino(db).escrow.length, 0);
});

test('ppt contra el bot: el empate devuelve la apuesta menos la comisión (margen > 0)', () => {
  assert.equal(botPayout(1_000, 1), 2_000);
  assert.equal(botPayout(1_000, 0), 950);
  assert.equal(botPayout(1_000, -1), 0);
  const ev = (botPayout(1_000, 1) + botPayout(1_000, 0) + botPayout(1_000, -1)) / 3 / 1_000;
  assert.ok(ev < 1, `RTP ${ev}`);
});

test('blackjack: tras plantarse, un segundo mensaje no toca la mano', async () => {
  await run(bjPlugin, A, '!bj mesa 500');
  await run(bjPlugin, B, '!bj 500');
  await tick(20_000);
  const table = listActiveTables(G)[0];
  if (!table) return; // naturales en el reparto: la ronda se resolvió sola
  assert.equal(table.phase, 'turnos');
  // Quien no está en turno recibe un aviso y no juega.
  for (const who of [A, B]) {
    sent.length = 0;
    await run(plantarsePlugin, who, 'plantarse');
    if (sent.some((t) => t.includes('Te plantas'))) {
      // Mismo jugador, de inmediato: ya terminó su mano, nada de cartas nuevas.
      sent.length = 0;
      await run(pedirPlugin, who, 'pedir');
      assert.equal(sent.some((t) => t.includes('¿*pedir* o *plantarse*?') || t.includes('Te pasaste')), false);
      break;
    }
    assert.ok(sent.some((t) => t.includes('Aún no es tu turno') || t.includes('Ya terminaste')));
  }
  // Pase lo que pase, al final la custodia se liquida.
  await tick(45_000);
  await tick(45_000);
  assert.equal(getCasino(db).escrow.length, 0);
  assert.equal(listActiveTables(G).length, 0);
});

test('ruleta: cerrarmesa durante la animación reembolsa y el giro no paga', async () => {
  await run(ruletaPlugin, A, '!ruleta rojo 1000');
  assert.equal(db.getUser(A).money, 9_000);
  await run(girarPlugin, A, 'girar');
  assert.match(sent.at(-1) ?? '', /podrás girar en/);
  await tick(10_000);
  sent.length = 0;
  const spinning = run(girarPlugin, A, 'girar');
  await flush();
  assert.ok(sent.some((t) => t.includes('La bola gira')));
  closeAllTables(G);
  assert.equal(db.getUser(A).money, 10_000, 'reembolsada por cerrarmesa');
  for (let i = 0; i < 5; i++) await tick(900);
  await spinning;
  assert.equal(db.getUser(A).money, 10_000, 'el giro viejo no paga ni cobra');
  assert.equal(getCasino(db).escrow.length, 0);
  assert.match(sent.join('\n'), /se cerró durante el giro/);
  assert.equal(sent.some((t) => t.includes('Resultado')), false);
});

test('contextos de patrón libre solo se activan sin prefijo y con una sola palabra', async () => {
  await run(ahorcadoPlugin, A, '!ahorcado frutas');
  assert.equal(listActiveTables(G)[0]?.phase, 'jugando');
  const ahorcado = context('ahorcado');
  assert.equal(ahorcado.isActive(message(A, 's')), true);
  assert.equal(ahorcado.isActive(message(A, '!s')), false, 'el sticker no es una letra');
  assert.equal(ahorcado.isActive(message(A, '!menu')), false);
  // "y tú?" empieza por una letra pero lleva más palabras: no resta vida.
  sent.length = 0;
  await run(letraPlugin, A, 'y tú?');
  assert.equal(sent.length, 0);
  // Una segunda partida no empieza mientras hay una o durante el cooldown.
  sent.length = 0;
  await run(ahorcadoPlugin, B, '!ahorcado');
  assert.match(sent.at(-1) ?? '', /letra|Escriban/);
  closeAllTables(G);
  sent.length = 0;
  await run(ahorcadoPlugin, B, '!ahorcado');
  assert.match(sent.at(-1) ?? '', /puede empezar en/);

  for (const name of ['trivia', 'adivina', 'memoria', 'ttt-jugada', 'ppt-eleccion']) {
    assert.equal(context(name).isActive(message(A, '!50')), false, `${name} ignora texto con prefijo`);
  }
  const base = noPrefixOnly(() => true);
  assert.equal(base(message(A, 'hola')), true);
  assert.equal(base(message(A, '/hola')), false);
  assert.equal(base(message(A, '.hola')), false);
});

test('memoria: el nivel tiene tope', () => {
  assert.equal(nextLevel(1), 2);
  assert.equal(nextLevel(10), 10);
  assert.equal(nextLevel(50), 10);
});
