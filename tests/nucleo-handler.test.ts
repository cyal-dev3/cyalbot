import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WASocket, proto, GroupMetadata } from 'baileys';

process.env.BOT_OWNERS = '5210000000001';
process.env.BOT_PREFIX = '!/.';
delete process.env.ANTHROPIC_API_KEY;

const { setLogLevel } = await import('../src/lib/logger.js');
setLogLevel('error');
const { CONFIG } = await import('../src/config.js');
const { MessageHandler } = await import('../src/handler.js');
const { initDatabase } = await import('../src/lib/database.js');
const { invalidateGroupMetadata } = await import('../src/lib/group-events.js');
type PluginHandler = import('../src/types/message.js').PluginHandler;
type MessageContext = import('../src/types/message.js').MessageContext;

const OWNER = '5210000000001@s.whatsapp.net';
const USER = '5210000000002@s.whatsapp.net';
const ADMIN = '5210000000003@s.whatsapp.net';
const BOT = '5210000000099:7@s.whatsapp.net';
const BOT_LID = '777000111@lid';
const GROUP = '120363000000000001@g.us';

interface Sent {
  jid: string;
  content: Record<string, unknown>;
}

interface FakeConn {
  sent: Sent[];
  metadataCalls: number;
  metadata: GroupMetadata | null;
  conn: WASocket;
}

function fakeConn(options: { botAdmin?: boolean; metadataFails?: boolean } = {}): FakeConn {
  const state: FakeConn = { sent: [], metadataCalls: 0, metadata: null, conn: undefined as unknown as WASocket };
  state.metadata = {
    id: GROUP,
    subject: 'Grupo de prueba',
    owner: ADMIN,
    participants: [
      { id: ADMIN, admin: 'admin' },
      { id: USER, admin: null },
      { id: OWNER, admin: null },
      { id: options.botAdmin ? '5210000000099@s.whatsapp.net' : '5210000000098@s.whatsapp.net', admin: options.botAdmin ? 'admin' : null },
    ],
  } as unknown as GroupMetadata;
  let counter = 0;
  state.conn = {
    user: { id: BOT, lid: BOT_LID },
    sendMessage: async (jid: string, content: Record<string, unknown>) => {
      state.sent.push({ jid, content });
      return { key: { remoteJid: jid, fromMe: true, id: `BOT${++counter}` } };
    },
    groupMetadata: async () => {
      state.metadataCalls++;
      if (options.metadataFails) throw new Error('sin red');
      return state.metadata;
    },
    updateMediaMessage: async (m: proto.IWebMessageInfo) => m,
    sendPresenceUpdate: async () => {},
    groupParticipantsUpdate: async () => [],
  } as unknown as WASocket;
  return state;
}

let msgCounter = 0;
function message(opts: { chat?: string; sender?: string; text: string; ephemeral?: boolean; pushName?: string }): proto.IWebMessageInfo {
  const chat = opts.chat ?? GROUP;
  const isGroup = chat.endsWith('@g.us');
  const sender = opts.sender ?? USER;
  const inner: proto.IMessage = { extendedTextMessage: { text: opts.text } };
  return {
    key: { remoteJid: chat, fromMe: false, id: `MSG${++msgCounter}`, participant: isGroup ? sender : undefined },
    pushName: opts.pushName ?? 'Tester',
    message: opts.ephemeral ? { ephemeralMessage: { message: inner } } : inner,
  };
}

type HandlerInstance = InstanceType<typeof MessageHandler>;

async function withHandler(
  fn: (h: HandlerInstance, fake: FakeConn, db: Awaited<ReturnType<typeof initDatabase>>) => Promise<void>,
  options: { botAdmin?: boolean; metadataFails?: boolean } = {},
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'cyalbot-handler-'));
  const db = await initDatabase(join(dir, 'database.json'));
  const fake = fakeConn(options);
  invalidateGroupMetadata(GROUP);
  const h = new MessageHandler(fake.conn, db);
  try {
    await fn(h, fake, db);
  } finally {
    h.stop();
    await db.stop();
    await rm(dir, { recursive: true, force: true });
  }
}

function texts(fake: FakeConn): string[] {
  return fake.sent.map((s) => String(s.content.text ?? '')).filter(Boolean);
}

function echo(name: string, extra: Partial<PluginHandler> = {}): PluginHandler & { calls: MessageContext[] } {
  const calls: MessageContext[] = [];
  return {
    command: [name],
    calls,
    handler: async (ctx) => {
      calls.push(ctx);
      await ctx.m.reply(`${name}:${ctx.args.join(',')}`);
    },
    ...extra,
  };
}

test('el prefijo configurable despacha !, / y . pero no texto plano', async () => {
  await withHandler(async (h, fake) => {
    const ping = echo('ping');
    h.registerPlugin('ping', ping);
    await h.handle([message({ text: '!ping a' }), message({ text: '/ping b' }), message({ text: '.ping c' }), message({ text: 'ping d' })]);
    assert.deepEqual(texts(fake), ['ping:a', 'ping:b', 'ping:c']);
    assert.equal(ping.calls[0].usedPrefix, '!');
    assert.equal(ping.calls[1].usedPrefix, '/');
    assert.equal(ping.calls[2].command, 'ping');
    assert.equal(ping.calls[2].text, 'c');
  });
});

test('plugins por array y por RegExp (simple y compleja) se encuentran', async () => {
  await withHandler(async (h, fake) => {
    h.registerPlugin('array', echo('hola'));
    h.registerPlugin('regex', { command: /^(saludo|hey)$/i, handler: async (ctx) => { await ctx.m.reply('regex'); } });
    h.registerPlugin('skill', { command: /^(bola.?de.?fuego|rayo)$/i, handler: async (ctx) => { await ctx.m.reply(`skill:${ctx.command}`); } });
    await h.handle([message({ text: '/HOLA' }), message({ text: '/hey' }), message({ text: '/bola de fuego' })]);
    assert.deepEqual(texts(fake), ['hola:', 'regex', 'skill:bola']);
    assert.ok(h.findPlugin('saludo'));
    assert.equal(h.findPlugin('bola'), null);
  });
});

test('un comando desconocido sugiere el parecido, con cooldown por chat', async () => {
  await withHandler(async (h, fake) => {
    h.registerPlugin('rpg-atacar', echo('atacar'));
    h.registerPlugin('menu', echo('menu'));
    await h.handle([message({ text: '/atakar' })]);
    assert.equal(fake.sent.length, 1);
    assert.match(texts(fake)[0], /No existe \/atakar/);
    assert.match(texts(fake)[0], /\/atacar/);
    assert.match(texts(fake)[0], /\/menu/);

    await h.handle([message({ text: '/zzzzzz' })]);
    assert.equal(fake.sent.length, 1, 'dentro del cooldown no responde');

    await h.handle([message({ text: '/qwerty', chat: '120363000000000002@g.us' })]);
    assert.equal(fake.sent.length, 2, 'otro chat tiene su propio cooldown');
    assert.doesNotMatch(texts(fake)[1], /Quisiste decir/);

    await h.handle([message({ text: '...' })]);
    assert.equal(fake.sent.length, 2, 'puntos suspensivos no son un intento de comando');
  });
});

test('comando desconocido en modo compacto solo reacciona', async () => {
  await withHandler(async (h, fake, db) => {
    db.updateChatSettings(GROUP, { compactMode: true });
    await h.handle([message({ text: '/nada' })]);
    assert.equal(fake.sent.length, 1);
    assert.deepEqual((fake.sent[0].content.react as { text: string }).text, '❓');
  });
});

test('las sugerencias no revelan comandos de owner a usuarios normales', async () => {
  await withHandler(async (h, fake) => {
    h.registerPlugin('admin-restart', echo('restart', { owner: true }));
    await h.handle([message({ text: '/restar' })]);
    assert.doesNotMatch(texts(fake)[0], /restart/);
    await h.handle([message({ text: '/restar', sender: OWNER, chat: '120363000000000003@g.us' })]);
    assert.match(texts(fake)[1], /restart/);
  });
});

test('orden de permisos: owner, grupo, admin, botAdmin, registro', async () => {
  await withHandler(async (h, fake) => {
    h.registerPlugin('solo-owner', echo('owner', { owner: true }));
    h.registerPlugin('solo-grupo', echo('grupo', { group: true }));
    h.registerPlugin('solo-admin', echo('admin', { group: true, admin: true }));
    h.registerPlugin('bot-admin', echo('botadmin', { group: true, botAdmin: true }));
    h.registerPlugin('registro', echo('registro', { register: true }));

    await h.handle([
      message({ text: '/owner' }),
      message({ text: '/grupo', chat: USER }),
      message({ text: '/admin' }),
      message({ text: '/botadmin', sender: ADMIN }),
      message({ text: '/registro' }),
    ]);
    const replies = texts(fake);
    assert.equal(replies[0], CONFIG.messages.ownerOnly);
    assert.equal(replies[1], CONFIG.messages.groupOnly);
    assert.match(replies[2], /administradores del grupo/);
    assert.match(replies[3], /Necesito ser administrador/);
    assert.match(replies[3], /Hacer admin del grupo/);
    assert.equal(replies[4], CONFIG.messages.notRegistered);

    fake.sent.length = 0;
    await h.handle([message({ text: '/admin x', sender: ADMIN }), message({ text: '/admin y', sender: OWNER }), message({ text: '/owner', sender: OWNER })]);
    assert.deepEqual(texts(fake), ['admin:x', 'admin:y', 'owner:']);
  });
});

test('isBotAdmin usa coincidencia exacta de número y acepta el LID del bot', async () => {
  await withHandler(async (h, fake) => {
    const plugin = echo('botadmin', { group: true, botAdmin: true });
    h.registerPlugin('bot-admin', plugin);
    await h.handle([message({ text: '/botadmin' })]);
    assert.deepEqual(texts(fake), ['botadmin:']);
    assert.equal(plugin.calls[0].isBotAdmin, true);
    assert.equal(plugin.calls[0].isAdmin, false);
    assert.deepEqual(plugin.calls[0].groupAdmins, [ADMIN, '5210000000099@s.whatsapp.net']);
  }, { botAdmin: true });

  await withHandler(async (h, fake) => {
    fake.metadata!.participants = [{ id: '15210000000099@s.whatsapp.net', admin: 'admin' } as never, { id: BOT_LID, admin: 'admin' } as never];
    h.registerPlugin('bot-admin', echo('botadmin', { group: true, botAdmin: true }));
    await h.handle([message({ text: '/botadmin' })]);
    assert.deepEqual(texts(fake), ['botadmin:']);
  });
});

test('la metadata del grupo solo se pide cuando hace falta', async () => {
  await withHandler(async (h, fake) => {
    const plain = echo('plain');
    h.registerPlugin('plain', plain);
    h.registerPlugin('admin', echo('admin', { group: true, admin: true }));
    await h.handle([message({ text: '/plain' })]);
    assert.equal(fake.metadataCalls, 0);
    assert.equal(plain.calls[0].groupMetadata, undefined);
    await h.handle([message({ text: '/admin', sender: ADMIN })]);
    assert.equal(fake.metadataCalls, 1);
    await h.handle([message({ text: '/admin', sender: ADMIN })]);
    assert.equal(fake.metadataCalls, 1, 'la segunda vez sale de la caché');
  });
});

test('si no hay metadata, un comando admin pide reintentar en vez de negar permiso', async () => {
  await withHandler(async (h, fake) => {
    h.registerPlugin('admin', echo('admin', { group: true, admin: true }));
    await h.handle([message({ text: '/admin', sender: ADMIN })]);
    assert.match(texts(fake)[0], /No pude leer los datos del grupo/);
  }, { metadataFails: true });
});

test('un contexto activo captura "a" sin prefijo y se ignora cuando no está activo', async () => {
  await withHandler(async (h, fake) => {
    let active = false;
    const dungeonAttack = echo('a');
    h.registerPlugin('rpg-atacar', echo('atacar'));
    h.registerContext({
      name: 'dungeon',
      noPrefix: true,
      isActive: (m) => active && m.sender === USER,
      plugins: [dungeonAttack, { command: /^(bola.?de.?fuego)$/i, handler: async (ctx) => { await ctx.m.reply('fuego'); } }],
    });

    await h.handle([message({ text: 'a' }), message({ text: 'bola de fuego' })]);
    assert.equal(fake.sent.length, 0, 'sin contexto activo el texto plano no es un comando');

    active = true;
    await h.handle([message({ text: 'a' }), message({ text: 'bola de fuego' }), message({ text: '/a' }), message({ text: 'a', sender: ADMIN })]);
    assert.deepEqual(texts(fake), ['a:', 'fuego', 'a:']);
    assert.equal(dungeonAttack.calls[0].usedPrefix, '');
    assert.equal(dungeonAttack.calls[1].usedPrefix, '/');
    assert.equal(h.getContexts().length, 1);
  });
});

test('los plugins de un contexto respetan las comprobaciones de permisos', async () => {
  await withHandler(async (h, fake) => {
    h.registerContext({
      name: 'mesa',
      noPrefix: true,
      isActive: () => true,
      plugins: [echo('pedir', { admin: true, group: true })],
    });
    await h.handle([message({ text: 'pedir' })]);
    assert.match(texts(fake)[0], /administradores del grupo/);
  });
});

test('un mensaje efímero con comando se procesa', async () => {
  await withHandler(async (h, fake) => {
    h.registerPlugin('ping', echo('ping'));
    await h.handle([message({ text: '/ping efimero', ephemeral: true })]);
    assert.deepEqual(texts(fake), ['ping:efimero']);
  });
});

test('un plugin que lanza no filtra error.message al chat', async () => {
  await withHandler(async (h, fake, db) => {
    h.registerPlugin('roto', { command: ['roto'], handler: async () => { throw new Error('secreto-interno'); } });
    await h.handle([message({ text: '/roto' })]);
    const reply = texts(fake)[0];
    assert.doesNotMatch(reply, /secreto-interno/);
    assert.ok(reply.startsWith(CONFIG.messages.error));
    assert.match(reply, /ref [0-9a-f]{6}/);
    assert.equal(db.data.stats.roto?.failed, 1);
  });
});

test('trackMessage y las consultas de ajustes no crean ChatSettings en privado', async () => {
  await withHandler(async (h, fake, db) => {
    h.registerPlugin('ping', echo('ping'));
    await h.handle([message({ text: '/ping', chat: USER })]);
    assert.deepEqual(texts(fake), ['ping:']);
    assert.equal(h.isAutoClearEnabled(USER), false);
    assert.equal(h.isCompactMode(USER), false);
    assert.equal(h.isAutoMuteEnabled(USER), false);
    h.trackMessage(USER, { remoteJid: USER, id: 'X' });
    assert.equal(h.getTrackedMessages(USER).length, 0);
    assert.equal(db.data.chats[USER], undefined);
    // En grupo sí se rastrea el comando y la respuesta.
    await h.handle([message({ text: '/ping' })]);
    assert.equal(h.getTrackedMessages(GROUP).length, 2);
    assert.equal(db.data.chats[GROUP], undefined, 'leer ajustes tampoco crea la entrada del grupo');
  });
});

test('el índice de alias registra colisiones y gana el primero', async () => {
  await withHandler(async (h, fake) => {
    h.registerPlugin('primero', echo('top'));
    h.registerPlugin('segundo', { command: ['top', 'otro'], handler: async (ctx) => { await ctx.m.reply('segundo'); } });
    assert.deepEqual(h.getAliasCollisions(), [{ alias: 'top', winner: 'primero', loser: 'segundo' }]);
    await h.handle([message({ text: '/top' }), message({ text: '/otro' })]);
    assert.deepEqual(texts(fake), ['top:', 'segundo']);
    assert.equal(h.findPlugin('top')?.name, 'primero');
  });
});

test('ctx.user es perezoso, ctx.target resuelve menciones y ctx.send rastrea', async () => {
  await withHandler(async (h, fake, db) => {
    const plugin = echo('perfil');
    h.registerPlugin('perfil', plugin);
    const raw = message({ text: '/perfil @5210000000003' });
    raw.message!.extendedTextMessage!.contextInfo = { mentionedJid: [ADMIN] };
    await h.handle([raw]);
    const ctx = plugin.calls[0];
    assert.equal(db.data.users[USER], undefined, 'no se crea el usuario hasta pedirlo');
    assert.equal(ctx.user.registered, false);
    assert.ok(db.data.users[USER]);
    assert.equal(ctx.target(), ADMIN);
    assert.equal(ctx.chatSettings.compactMode, false);
    assert.deepEqual(ctx.m.mentionedJid, [ADMIN]);
    await ctx.send({ text: 'extra' });
    assert.equal(h.getTrackedMessages(GROUP).length, 3);
  });
});

test('el modo del bot filtra chats y el remitente muteado se ignora', async () => {
  await withHandler(async (h, fake, db) => {
    h.registerPlugin('ping', echo('ping'));
    db.updateSettings({ botMode: 'private' });
    await h.handle([message({ text: '/ping' }), message({ text: '/ping', sender: OWNER })]);
    assert.deepEqual(texts(fake), ['ping:']);

    db.updateSettings({ botMode: 'public' });
    h.setAutoMute(GROUP, true);
    h.muteUser(GROUP, USER);
    await h.handle([message({ text: '/ping' })]);
    assert.equal(fake.sent.length, 1, 'el muteado no recibe respuesta');
    assert.deepEqual(db.data.chats[GROUP]?.mutedUsers, [USER]);
  });
});

test('"el primero registrado gana" también entre RegExp complejas y arrays', async () => {
  await withHandler(async (h, fake) => {
    h.registerPlugin('trivia', { command: /^[abcd]$/, handler: async (ctx) => { await ctx.m.reply('trivia'); } });
    h.registerPlugin('atacar-corto', echo('a'));
    h.registerPlugin('ahorcado', { command: /^[a-z]{3,20}$/i, handler: async (ctx) => { await ctx.m.reply('ahorcado'); } });
    h.registerPlugin('ping', echo('ping'));
    await h.handle([message({ text: '/a' }), message({ text: '/ping' }), message({ text: '/zzz' })]);
    assert.deepEqual(texts(fake), ['trivia', 'ahorcado', 'ahorcado']);
  });
});

test('re-registrar un nombre reemplaza el handler también en el despacho', async () => {
  await withHandler(async (h, fake) => {
    h.registerPlugin('x', { command: ['x'], handler: async (ctx) => { await ctx.m.reply('viejo'); } });
    h.registerPlugin('x', { command: ['x', 'y'], handler: async (ctx) => { await ctx.m.reply('nuevo'); } });
    h.registerPlugin('p', { command: /^z+$/, handler: async (ctx) => { await ctx.m.reply('patron viejo'); } });
    h.registerPlugin('p', { command: /^w+$/, handler: async (ctx) => { await ctx.m.reply('patron nuevo'); } });
    await h.handle([message({ text: '/x' }), message({ text: '/y' }), message({ text: '/www' }), message({ text: '/zzz' })]);
    assert.deepEqual(texts(fake), ['nuevo', 'nuevo', 'patron nuevo', 'No existe /zzz. Escribe /menu para ver todo.']);
    assert.equal(h.getAliasCollisions().length, 0);
  });
});

test('el owner pasa un comando admin aunque no haya metadata del grupo', async () => {
  await withHandler(async (h, fake) => {
    h.registerPlugin('admin', echo('admin', { group: true, admin: true }));
    h.registerPlugin('botadmin', echo('botadmin', { group: true, botAdmin: true }));
    await h.handle([message({ text: '/admin', sender: OWNER }), message({ text: '/botadmin', sender: OWNER })]);
    const replies = texts(fake);
    assert.equal(replies[0], 'admin:');
    assert.match(replies[1], /No pude leer los datos del grupo/);
  }, { metadataFails: true });
});

test('un grupo en modo LID reconoce al admin por su jid de teléfono', async () => {
  await withHandler(async (h, fake) => {
    fake.metadata!.participants = [
      { id: '999000111222@lid', jid: ADMIN, lid: '999000111222@lid', admin: 'admin' } as never,
      { id: '999000111333@lid', jid: USER, lid: '999000111333@lid', admin: null } as never,
    ];
    const plugin = echo('admin', { group: true, admin: true });
    h.registerPlugin('admin', plugin);
    await h.handle([message({ text: '/admin', sender: ADMIN }), message({ text: '/admin' })]);
    const replies = texts(fake);
    assert.equal(replies[0], 'admin:');
    assert.match(replies[1], /administradores del grupo/);
    assert.equal(plugin.calls[0].isAdmin, true);
  });
});

test('un comando desconocido muy largo se recorta antes de repetirlo', async () => {
  await withHandler(async (h, fake) => {
    h.registerPlugin('ping', echo('ping'));
    await h.handle([message({ text: `/${'a'.repeat(5000)}` })]);
    const reply = texts(fake)[0];
    assert.ok(reply.length < 120, reply.length.toString());
    assert.match(reply, /^No existe \/a{30}…\./);
  });
});

test('si la metadata falla no se vuelve a pedir en cada mensaje', async () => {
  await withHandler(async (h, fake, db) => {
    db.updateChatSettings(GROUP, { antiLink: true });
    await h.handle([message({ text: 'hola' }), message({ text: 'otra' }), message({ text: 'más' })]);
    assert.equal(fake.metadataCalls, 1, 'el fallo se recuerda unos segundos');
    invalidateGroupMetadata(GROUP);
    await h.handle([message({ text: 'hola' })]);
    assert.equal(fake.metadataCalls, 2, 'invalidar fuerza una nueva consulta');
  }, { metadataFails: true });
});
