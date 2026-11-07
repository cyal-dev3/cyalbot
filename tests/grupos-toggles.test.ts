import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MessageContext, PluginHandler } from '../src/types/message.js';
import { setLogLevel } from '../src/lib/logger.js';
import { initDatabase } from '../src/lib/database.js';
import { CONFIG } from '../src/config.js';
import {
  parseToggle, createTogglePlugin, readToggle, isBotEnabled, TOGGLES, TOGGLE_ENTRIES,
  antiLinkPlugin, antiBadPlugin, botTogglePlugin, welcomeTogglePlugin,
} from '../src/plugins/group-toggles.js';

setLogLevel('error');

const dir = await mkdtemp(join(tmpdir(), 'cyalbot-toggles-'));
const db = await initDatabase(join(dir, 'database.json'));
after(async () => {
  await db.stop();
  await rm(dir, { recursive: true, force: true });
});

const SENDER = '5210000000002@s.whatsapp.net';

interface Fake {
  ctx: MessageContext;
  replies: string[];
  sent: { text?: string; mentions?: string[] }[];
}

function fakeCtx(chat: string, text: string): Fake {
  const replies: string[] = [];
  const sent: Fake['sent'] = [];
  const ctx = {
    m: {
      chat,
      sender: SENDER,
      pushName: 'Ana',
      mentionedJid: [],
      reply: async (t: string) => { replies.push(t); return undefined; },
      react: async () => {},
    },
    text,
    args: text ? text.split(/\s+/) : [],
    usedPrefix: '/',
    command: '',
    isOwner: false,
    isAdmin: true,
    isBotAdmin: true,
    isGroup: true,
    participants: [SENDER],
    groupMetadata: { subject: 'Grupo de prueba', participants: [{ id: SENDER, admin: 'admin' }] },
    conn: { sendMessage: async (_chat: string, content: Fake['sent'][number]) => { sent.push(content); return { key: { id: 'x' } }; } },
    handler: { trackMessage() {}, isCompactMode: () => false },
  } as unknown as MessageContext;
  return { ctx, replies, sent };
}

async function run(plugin: PluginHandler, chat: string, text: string): Promise<Fake> {
  const fake = fakeCtx(chat, text);
  await plugin.handler(fake.ctx);
  return fake;
}

test('parseToggle entiende sinónimos de on/off y lo demás es status', () => {
  for (const word of ['on', 'ON', '1', 'si', 'sí', 'activar', 'yes', 'enable', ' on extra']) assert.equal(parseToggle(word), 'on', word);
  for (const word of ['off', '0', 'no', 'desactivar', 'disable', 'false']) assert.equal(parseToggle(word), 'off', word);
  for (const word of ['', '   ', 'status', 'all', 'test', undefined, null]) assert.equal(parseToggle(word), 'status', String(word));
});

test('la tabla de interruptores y TOGGLE_ENTRIES tienen el mismo tamaño y alias únicos', () => {
  assert.equal(TOGGLE_ENTRIES.length, TOGGLES.length);
  const aliases = TOGGLES.flatMap((d) => d.command);
  assert.equal(new Set(aliases).size, aliases.length);
});

for (const def of TOGGLES) {
  test(`toggle ${def.command[0]} escribe ChatSettings.${def.field}`, async () => {
    const chat = `${def.field}@g.us`;
    const plugin = createTogglePlugin(def);
    assert.equal(plugin.group, true);
    assert.equal(plugin.admin ?? false, !def.owner);

    const status = await run(plugin, chat, '');
    assert.match(status.replies[0], /Estado:/);
    assert.match(status.replies[0], new RegExp(`/${def.command[0]} on`));

    const raw = () => (db.getChatSettings(chat) as unknown as Record<string, unknown>)[def.field];
    const initial = readToggle(db.getChatSettings(chat), def);

    const first = await run(plugin, chat, initial ? 'off' : 'on');
    assert.equal(raw(), !initial);
    assert.doesNotMatch(first.replies[0], /ya está/);

    const repeat = await run(plugin, chat, initial ? 'off' : 'on');
    assert.match(repeat.replies[0], /ya está/);
    assert.equal(raw(), !initial);

    await run(plugin, chat, initial ? 'activar' : 'desactivar');
    assert.equal(raw(), initial);
  });
}

test('antilink all activa y guarda antiLinkMode=all; wa vuelve al modo normal', async () => {
  const chat = 'antilink-all@g.us';
  await run(antiLinkPlugin, chat, 'all');
  let settings = db.getChatSettings(chat) as unknown as Record<string, unknown>;
  assert.equal(settings.antiLink, true);
  assert.equal(settings.antiLinkMode, 'all');
  const status = await run(antiLinkPlugin, chat, '');
  assert.match(status.replies[0], /Modo: cualquier URL/);

  await run(antiLinkPlugin, chat, 'wa');
  settings = db.getChatSettings(chat) as unknown as Record<string, unknown>;
  assert.equal(settings.antiLinkMode, 'wa');
});

test('antibad on carga las palabras por defecto solo si la lista está vacía', async () => {
  const chat = 'antibad-default@g.us';
  await run(antiBadPlugin, chat, 'on');
  assert.deepEqual(db.getChatSettings(chat).badWords, [...CONFIG.defaultBadWords]);

  const custom = 'antibad-custom@g.us';
  db.updateChatSettings(custom, { badWords: ['propia'] });
  await run(antiBadPlugin, custom, 'on');
  assert.deepEqual(db.getChatSettings(custom).badWords, ['propia']);
});

test('bot off apaga el grupo; por defecto está encendido aunque el campo no exista', async () => {
  const chat = 'bot-toggle@g.us';
  assert.equal(isBotEnabled(db.getChatSettings(chat)), true);
  await run(botTogglePlugin, chat, 'off');
  assert.equal(isBotEnabled(db.getChatSettings(chat)), false);
  await run(botTogglePlugin, chat, 'on');
  assert.equal(isBotEnabled(db.getChatSettings(chat)), true);
});

test('welcome test envía una vista previa mencionando a quien lo pide', async () => {
  const chat = 'welcome-test@g.us';
  db.updateChatSettings(chat, { sWelcome: 'Hola {user} ({name}) en {group}, somos {count}' });
  const fake = await run(welcomeTogglePlugin, chat, 'test');
  assert.equal(fake.sent.length, 1);
  assert.match(fake.sent[0].text ?? '', /Hola @5210000000002 \(Ana\) en Grupo de prueba, somos 1/);
  assert.deepEqual(fake.sent[0].mentions, [SENDER]);
});

test('el interruptor del bot se anuncia como bot y acepta botgrupo como alias', async () => {
  const def = TOGGLES.find((d) => d.field === 'enabled');
  assert.ok(def);
  assert.equal(def.command[0], 'bot');
  assert.ok(def.command.includes('botgrupo'));
  assert.ok(def.command.includes('bot'));
  const chat = 'bot-alias@g.us';
  const off = await run(botTogglePlugin, chat, 'off');
  assert.match(off.replies[0], /\/bot on/);
  const status = await run(botTogglePlugin, chat, '');
  assert.match(status.replies[0], /\/bot on/);
});

test('las descripciones no llevan marcadores sin sustituir', () => {
  for (const def of TOGGLES) {
    assert.doesNotMatch(def.description, /\{p\}/, def.command[0]);
    assert.doesNotMatch(def.label, /\{p\}/, def.command[0]);
  }
});

test('un argumento heredado de Object.prototype no es un subcomando', async () => {
  const chat = 'proto@g.us';
  for (const word of ['constructor', '__proto__', 'hasOwnProperty', 'toString']) {
    const fake = await run(antiLinkPlugin, chat, word);
    assert.equal(fake.replies.length, 1, word);
    assert.match(fake.replies[0], /Estado:/, word);
  }
  const welcome = await run(welcomeTogglePlugin, chat, '__proto__');
  assert.match(welcome.replies[0], /Estado:/);
});
