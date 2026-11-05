/**
 * Resolución de participantes de grupo. Los grupos pueden direccionar por
 * número (`pn`: ids @s.whatsapp.net) o por LID (`lid`: ids @lid), y el mismo
 * usuario aparece con una forma u otra según el origen (mención, cita,
 * conn.user, metadata). Todo lo que compare personas pasa por aquí.
 */

import { areJidsSameUser, type GroupMetadata, type GroupParticipant, type WASocket } from 'baileys';
import type { MessageContext } from '../types/message.js';
import { isOwnerId } from '../config.js';

type Metadata = Pick<GroupMetadata, 'participants'> | null | undefined;

/** Ids por los que se reconoce a un participante: id del grupo, número y LID. */
function participantIds(p: GroupParticipant): string[] {
  const ids = [p.id];
  if (p.jid) ids.push(p.jid);
  if (p.lid) ids.push(p.lid);
  return ids;
}

/** Busca al participante que coincida con cualquiera de los jids (número o LID). */
export function findParticipant(metadata: Metadata, ...jids: (string | null | undefined)[]): GroupParticipant | undefined {
  const wanted = jids.filter((jid): jid is string => typeof jid === 'string' && jid.includes('@'));
  if (!metadata?.participants?.length || wanted.length === 0) return undefined;
  return metadata.participants.find((p) =>
    participantIds(p).some((id) => wanted.some((jid) => areJidsSameUser(jid, id))));
}

export function isParticipantAdmin(p: GroupParticipant | null | undefined): boolean {
  if (!p) return false;
  return p.admin === 'admin' || p.admin === 'superadmin' || p.isAdmin === true || p.isSuperAdmin === true;
}

export function isParticipantSuperAdmin(p: GroupParticipant | null | undefined): boolean {
  if (!p) return false;
  return p.admin === 'superadmin' || p.isSuperAdmin === true;
}

export function getAdmins(metadata: Metadata): GroupParticipant[] {
  return metadata?.participants?.filter(isParticipantAdmin) ?? [];
}

export function findBotParticipant(metadata: Metadata, botIds: readonly string[]): GroupParticipant | undefined {
  return findParticipant(metadata, ...botIds);
}

/** Id con el que el grupo conoce a ese usuario; si no está en el grupo devuelve el jid tal cual. */
export function canonicalJid(metadata: Metadata, jid: string): string {
  return findParticipant(metadata, jid)?.id ?? jid;
}

/** Ids del bot (número y LID). botIds() vive en la clase MessageHandler, no en la interfaz. */
export function getBotIds(ctx: Pick<MessageContext, 'conn' | 'handler'>): string[] {
  const fromHandler = (ctx.handler as unknown as { botIds?: () => string[] }).botIds?.();
  if (fromHandler?.length) return fromHandler;
  const user = ctx.conn.user as { id?: string; lid?: string } | undefined;
  return [user?.id, user?.lid].filter((id): id is string => Boolean(id));
}

export interface ResolveTargetOptions {
  /** Aceptar un número de teléfono escrito en los argumentos. */
  allowNumber?: boolean;
  /** Permitir que el objetivo sea quien ejecuta el comando. */
  allowSelf?: boolean;
}

type TargetContext = Pick<MessageContext, 'm' | 'args' | 'groupMetadata'>;

function numbersInArgs(args: readonly string[]): string[] {
  return args
    .map((a) => a.replace(/[\s()+-]/g, ''))
    .filter((a) => /^\d{7,16}$/.test(a));
}

/** Participante cuyo número coincide con los dígitos dados (en p.id o p.jid). */
function findByNumber(metadata: Metadata, digits: string): GroupParticipant | undefined {
  return findParticipant(metadata, `${digits}@s.whatsapp.net`);
}

/**
 * Objetivos de un comando en orden mención > cita > número en args, ya con el
 * id canónico del grupo. Un número que no está en el grupo se devuelve como
 * jid @s.whatsapp.net para que assertCanModerate explique que no está.
 */
export function resolveTargets(ctx: TargetContext, options: ResolveTargetOptions = {}): string[] {
  const { m, groupMetadata } = ctx;
  const candidates: string[] = [];

  if (m.mentionedJid.length > 0) {
    candidates.push(...m.mentionedJid);
  } else if (m.quoted?.sender && m.quoted.sender !== m.chat) {
    candidates.push(m.quoted.sender);
  } else if (options.allowNumber) {
    for (const digits of numbersInArgs(ctx.args)) {
      candidates.push(findByNumber(groupMetadata, digits)?.id ?? `${digits}@s.whatsapp.net`);
    }
  }

  const seen = new Set<string>();
  const targets: string[] = [];
  for (const raw of candidates) {
    if (!raw || raw.endsWith('@g.us')) continue;
    const jid = canonicalJid(groupMetadata, raw);
    if (!options.allowSelf && areJidsSameUser(jid, m.sender)) continue;
    const key = jid.split('@')[0].split(':')[0];
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push(jid);
  }
  return targets;
}

/** Primer objetivo de resolveTargets, o null. */
export function resolveTarget(ctx: TargetContext, options: ResolveTargetOptions = {}): string | null {
  return resolveTargets(ctx, options)[0] ?? null;
}

export type ModerationAction = 'kick' | 'promote' | 'demote' | 'mute' | 'warn';

const SELF_TEXT: Record<ModerationAction, string> = {
  kick: 'No puedes expulsarte a ti mismo.',
  promote: 'No puedes hacerte admin a ti mismo.',
  demote: 'No puedes quitarte admin a ti mismo.',
  mute: 'No puedes silenciarte a ti mismo.',
  warn: 'No puedes advertirte a ti mismo.',
};

const ADMIN_TEXT: Partial<Record<ModerationAction, string>> = {
  kick: 'No puedes expulsar a un administrador.',
  mute: 'No puedes silenciar a un administrador.',
  warn: 'No puedes advertir a un administrador.',
};

type ModerationContext = Pick<MessageContext, 'm' | 'conn' | 'handler' | 'groupMetadata' | 'isOwner'>;

/**
 * Devuelve null si el ejecutor puede aplicar la acción al objetivo, o el
 * motivo legible por el que no. El owner del bot puede actuar sobre admins,
 * pero nadie sobre el creador del grupo (WhatsApp lo rechaza).
 */
export function assertCanModerate(ctx: ModerationContext, targetId: string, action: ModerationAction): string | null {
  const { m, groupMetadata } = ctx;

  if (areJidsSameUser(targetId, m.sender)) return SELF_TEXT[action];

  const participant = findParticipant(groupMetadata, targetId);
  const botIds = getBotIds(ctx);
  if (botIds.some((id) => areJidsSameUser(id, targetId)) || (participant && findBotParticipant(groupMetadata, botIds) === participant)) {
    return 'No puedo hacer eso conmigo mismo.';
  }

  if (isOwnerId(targetId) || (participant?.jid && isOwnerId(participant.jid))) {
    return 'Ese usuario es el dueño del bot.';
  }

  if (!participant) return 'Ese usuario no está en el grupo.';

  if ((action === 'kick' || action === 'demote') && isParticipantSuperAdmin(participant)) {
    return 'Ese usuario es el creador del grupo.';
  }

  const targetIsAdmin = isParticipantAdmin(participant);
  if (action === 'promote') return targetIsAdmin ? 'Ese usuario ya es administrador.' : null;
  if (action === 'demote') return targetIsAdmin ? null : 'Ese usuario no es administrador.';

  if (targetIsAdmin && !ctx.isOwner) return ADMIN_TEXT[action] ?? 'No puedes hacer eso con un administrador.';
  return null;
}

/** Expulsa a un participante y devuelve si WhatsApp lo aceptó. */
export async function removeParticipant(
  conn: Pick<WASocket, 'groupParticipantsUpdate'>,
  chat: string,
  jid: string,
): Promise<boolean> {
  try {
    const result = await conn.groupParticipantsUpdate(chat, [jid], 'remove');
    return result.length === 0 || result.some((r) => r.status === '200');
  } catch {
    return false;
  }
}
