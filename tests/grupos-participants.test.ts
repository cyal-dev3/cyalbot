import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GroupMetadata, GroupParticipant } from 'baileys';
import type { MessageContext } from '../src/types/message.js';

process.env.BOT_OWNERS = '5210000000001';
const {
  findParticipant, isParticipantAdmin, getAdmins, findBotParticipant, canonicalJid, isSameParticipant,
  resolveTarget, resolveTargets, assertCanModerate, numbersInArgs,
} = await import('../src/lib/participants.js');

const GROUP = '120363000000000000@g.us';
const BOT = { pn: '5219990000000@s.whatsapp.net', lid: '100000000000001@lid' };
const OWNER = { pn: '5210000000001@s.whatsapp.net', lid: '100000000000002@lid' };
const ADMIN = { pn: '5210000000002@s.whatsapp.net', lid: '100000000000003@lid' };
const USER = { pn: '5210000000003@s.whatsapp.net', lid: '100000000000004@lid' };
const CREATOR = { pn: '5210000000004@s.whatsapp.net', lid: '100000000000005@lid' };
const OTHER = { pn: '5210000000005@s.whatsapp.net', lid: '100000000000006@lid' };
const STRANGER = '5217777777777@s.whatsapp.net';

type Mode = GroupMetadata['addressingMode'];
type Person = { pn: string; lid: string };

const idOf = (mode: Mode, p: Person): string => (mode === 'pn' ? p.pn : p.lid);

function metadata(mode: Mode): GroupMetadata {
  const participant = (p: Person, admin: GroupParticipant['admin']): GroupParticipant =>
    mode === 'pn' ? { id: p.pn, lid: p.lid, admin } : { id: p.lid, jid: p.pn, admin };
  return {
    id: GROUP,
    addressingMode: mode,
    owner: idOf(mode, CREATOR),
    subject: 'Prueba',
    participants: [
      participant(CREATOR, 'superadmin'),
      participant(ADMIN, 'admin'),
      participant(BOT, 'admin'),
      participant(OWNER, null),
      participant(USER, null),
      participant(OTHER, null),
    ],
  } as GroupMetadata;
}

interface CtxOptions {
  sender: string;
  mentionedJid?: string[];
  quoted?: string;
  args?: string[];
  isOwner?: boolean;
}

function ctx(mode: Mode, options: CtxOptions): MessageContext {
  return {
    m: {
      chat: GROUP,
      sender: options.sender,
      mentionedJid: options.mentionedJid ?? [],
      quoted: options.quoted ? { sender: options.quoted, key: {}, text: '', message: {} } : undefined,
    },
    args: options.args ?? [],
    groupMetadata: metadata(mode),
    isOwner: options.isOwner ?? false,
    // El bot se identifica con sufijo de dispositivo, como lo expone Baileys en conn.user.
    conn: { user: { id: '5219990000000:12@s.whatsapp.net', lid: '100000000000001:12@lid' } },
    handler: {},
  } as unknown as MessageContext;
}

for (const mode of ['pn', 'lid'] as Mode[]) {
  test(`[${mode}] findParticipant encuentra por número o por LID, con o sin sufijo de dispositivo`, () => {
    const md = metadata(mode);
    assert.equal(findParticipant(md, USER.pn)?.id, idOf(mode, USER));
    assert.equal(findParticipant(md, USER.lid)?.id, idOf(mode, USER));
    assert.equal(findParticipant(md, '5210000000003:7@s.whatsapp.net')?.id, idOf(mode, USER));
    assert.equal(findParticipant(md, STRANGER), undefined);
    assert.equal(findParticipant(md, undefined, null, 'sin-arroba'), undefined);
    assert.equal(findParticipant(undefined, USER.pn), undefined);
  });

  test(`[${mode}] admins, bot y jid canónico`, () => {
    const md = metadata(mode);
    assert.deepEqual(getAdmins(md).map((p) => p.id), [idOf(mode, CREATOR), idOf(mode, ADMIN), idOf(mode, BOT)]);
    assert.equal(isParticipantAdmin(findParticipant(md, USER.pn)), false);
    assert.equal(isParticipantAdmin({ id: 'x@lid', isAdmin: true }), true);
    assert.equal(findBotParticipant(md, ['5219990000000:12@s.whatsapp.net', '100000000000001:12@lid'])?.id, idOf(mode, BOT));
    assert.equal(findBotParticipant(md, [])?.id, undefined);
    assert.equal(canonicalJid(md, USER.lid), idOf(mode, USER));
    assert.equal(canonicalJid(md, USER.pn), idOf(mode, USER));
    assert.equal(canonicalJid(md, STRANGER), STRANGER);
  });

  test(`[${mode}] resolveTarget: mención > cita > número, siempre en el id del grupo`, () => {
    const sender = idOf(mode, ADMIN);
    const other = mode === 'pn' ? USER.lid : USER.pn;
    // Mención en el formato contrario al del grupo se canonicaliza.
    assert.equal(resolveTarget(ctx(mode, { sender, mentionedJid: [other], quoted: OTHER.pn })), idOf(mode, USER));
    // Sin menciones se usa la cita.
    assert.equal(resolveTarget(ctx(mode, { sender, quoted: OTHER.lid })), idOf(mode, OTHER));
    // Una cita del propio grupo (mensaje de sistema) no es un objetivo.
    assert.equal(resolveTarget(ctx(mode, { sender, quoted: GROUP })), null);
    // Número en args: se busca también en p.jid; solo si allowNumber.
    assert.equal(resolveTarget(ctx(mode, { sender, args: ['5210000000003'] })), null);
    // El handler parte el texto por espacios: un número escrito con espacios llega en varios args.
    assert.equal(resolveTarget(ctx(mode, { sender, args: '+52 1 000 000 0003'.split(/\s+/) }), { allowNumber: true }), idOf(mode, USER));
    assert.equal(resolveTarget(ctx(mode, { sender, args: ['(52)', '1000-000-0003', '10m'] }), { allowNumber: true }), idOf(mode, USER));
    // Número que no está en el grupo: se devuelve como jid para que assertCanModerate lo explique.
    assert.equal(resolveTarget(ctx(mode, { sender, args: ['5217777777777'] }), { allowNumber: true }), STRANGER);
    // Uno mismo se descarta salvo allowSelf.
    assert.equal(resolveTarget(ctx(mode, { sender, mentionedJid: [ADMIN.pn] })), null);
    assert.equal(resolveTarget(ctx(mode, { sender, mentionedJid: [ADMIN.pn] }), { allowSelf: true }), sender);
  });

  test(`[${mode}] resolveTargets devuelve varias menciones sin duplicados`, () => {
    const targets = resolveTargets(ctx(mode, { sender: idOf(mode, ADMIN), mentionedJid: [USER.pn, USER.lid, OTHER.lid, GROUP] }));
    assert.deepEqual(targets, [idOf(mode, USER), idOf(mode, OTHER)]);
    // Varios números en args, cada uno un objetivo.
    const byNumber = resolveTargets(ctx(mode, { sender: idOf(mode, ADMIN), args: ['5210000000003', '5210000000005'] }), { allowNumber: true });
    assert.deepEqual(byNumber, [idOf(mode, USER), idOf(mode, OTHER)]);
  });

  test(`[${mode}] isSameParticipant compara número y LID a través de la metadata`, () => {
    const md = metadata(mode);
    assert.equal(isSameParticipant(md, USER.pn, USER.lid), true);
    assert.equal(isSameParticipant(md, '5210000000003:3@s.whatsapp.net', USER.lid), true);
    assert.equal(isSameParticipant(md, USER.pn, OTHER.pn), false);
    assert.equal(isSameParticipant(md, STRANGER, STRANGER), true);
    assert.equal(isSameParticipant(md, undefined, USER.pn), false);
    assert.equal(isSameParticipant(null, USER.pn, USER.lid), false);
  });

  test(`[${mode}] assertCanModerate: uno mismo, el bot, el owner del bot y desconocidos`, () => {
    const admin = idOf(mode, ADMIN);
    assert.equal(assertCanModerate(ctx(mode, { sender: admin }), ADMIN.lid, 'kick'), 'No puedes expulsarte a ti mismo.');
    assert.equal(assertCanModerate(ctx(mode, { sender: admin }), BOT.lid, 'kick'), 'No puedo hacer eso conmigo mismo.');
    assert.equal(assertCanModerate(ctx(mode, { sender: admin }), BOT.pn, 'mute'), 'No puedo hacer eso conmigo mismo.');
    // El owner del bot se reconoce aunque la mención llegue por LID (se mira participant.jid).
    assert.equal(assertCanModerate(ctx(mode, { sender: admin }), OWNER.lid, 'warn'), 'Ese usuario es el dueño del bot.');
    assert.equal(assertCanModerate(ctx(mode, { sender: admin }), STRANGER, 'kick'), 'Ese usuario no está en el grupo.');
  });

  test(`[${mode}] assertCanModerate: jerarquía de admins`, () => {
    const admin = idOf(mode, ADMIN);
    const owner = idOf(mode, OWNER);
    // Nadie expulsa ni degrada al creador, ni siquiera el owner del bot.
    assert.equal(assertCanModerate(ctx(mode, { sender: owner, isOwner: true }), CREATOR.pn, 'kick'), 'Ese usuario es el creador del grupo.');
    assert.equal(assertCanModerate(ctx(mode, { sender: owner, isOwner: true }), CREATOR.lid, 'demote'), 'Ese usuario es el creador del grupo.');
    // Un admin no toca a otro admin; el owner del bot sí.
    assert.equal(assertCanModerate(ctx(mode, { sender: idOf(mode, USER) }), ADMIN.pn, 'kick'), 'No puedes expulsar a un administrador.');
    assert.equal(assertCanModerate(ctx(mode, { sender: idOf(mode, USER) }), ADMIN.pn, 'mute'), 'No puedes silenciar a un administrador.');
    assert.equal(assertCanModerate(ctx(mode, { sender: idOf(mode, USER) }), ADMIN.pn, 'warn'), 'No puedes advertir a un administrador.');
    assert.equal(assertCanModerate(ctx(mode, { sender: owner, isOwner: true }), ADMIN.pn, 'kick'), null);
    // Promote/demote miran el estado actual.
    const creator = idOf(mode, CREATOR);
    assert.equal(assertCanModerate(ctx(mode, { sender: creator }), ADMIN.lid, 'promote'), 'Ese usuario ya es administrador.');
    assert.equal(assertCanModerate(ctx(mode, { sender: creator }), ADMIN.pn, 'demote'), null);
    assert.equal(assertCanModerate(ctx(mode, { sender: admin }), USER.lid, 'demote'), 'Ese usuario no es administrador.');
    assert.equal(assertCanModerate(ctx(mode, { sender: admin }), OTHER.pn, 'promote'), null);
    // El propio admin mencionado en el formato contrario sigue siendo "uno mismo".
    assert.equal(assertCanModerate(ctx(mode, { sender: admin }), mode === 'pn' ? ADMIN.lid : ADMIN.pn, 'promote'), 'No puedes hacerte admin a ti mismo.');
    // Usuario normal: todo permitido.
    for (const action of ['kick', 'mute', 'warn', 'promote'] as const) {
      assert.equal(assertCanModerate(ctx(mode, { sender: admin }), USER.lid, action), null, action);
    }
  });
}

test('numbersInArgs une los grupos cortos de un número con espacios y separa los números completos', () => {
  assert.deepEqual(numbersInArgs('+52 1 000 000 0003'.split(/\s+/)), ['5210000000003']);
  assert.deepEqual(numbersInArgs(['5210000000003', '5210000000004']), ['5210000000003', '5210000000004']);
  // Una palabra (la duración de tempmute) cierra el número en curso; "10" solo no es un número.
  assert.deepEqual(numbersInArgs(['5210000000003', '10m']), ['5210000000003']);
  assert.deepEqual(numbersInArgs(['52', '1', '000', '000', '0003', '10m']), ['5210000000003']);
  assert.deepEqual(numbersInArgs(['(52)', '1000-000-0003']), ['5210000000003']);
  assert.deepEqual(numbersInArgs(['@5210000000003', 'razon', '2', 'veces']), []);
  assert.deepEqual(numbersInArgs([]), []);
});
