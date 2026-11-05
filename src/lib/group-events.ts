/**
 * Eventos de grupo: bienvenidas, despedidas, cambios de admin y metadatos.
 * También resuelve los roles (admin / bot admin) a partir de la metadata cacheada.
 */

import type { WASocket, GroupMetadata, GroupParticipant, ParticipantAction } from 'baileys';
import { LRUCache } from './lru-cache.js';
import { getDatabase } from './database.js';
import { createLogger } from './logger.js';
import { sameUser } from '../config.js';

const log = createLogger('grupos');

const metadataCache = new LRUCache<string, GroupMetadata>(1000);
/** Grupos cuya consulta falló hace poco: no se repite en cada mensaje mientras dure el fallo. */
const failedUntil = new LRUCache<string, number>(1000);
export const METADATA_FAILURE_TTL_MS = 15_000;

export async function getGroupMetadataCached(conn: WASocket, groupId: string): Promise<GroupMetadata | null> {
  const cached = metadataCache.get(groupId);
  if (cached) return cached;
  const retryAt = failedUntil.get(groupId);
  if (retryAt !== undefined && Date.now() < retryAt) return null;
  try {
    const metadata = await conn.groupMetadata(groupId);
    metadataCache.set(groupId, metadata);
    failedUntil.delete(groupId);
    return metadata;
  } catch (error) {
    failedUntil.set(groupId, Date.now() + METADATA_FAILURE_TTL_MS);
    log.debug(`sin metadata de ${groupId}:`, error instanceof Error ? error.message : error);
    return null;
  }
}

export async function getGroupName(conn: WASocket, groupId: string): Promise<string> {
  return (await getGroupMetadataCached(conn, groupId))?.subject || 'Grupo';
}

export function invalidateGroupMetadata(groupId: string): void {
  metadataCache.delete(groupId);
  failedUntil.delete(groupId);
}

function isAdminParticipant(p: GroupParticipant): boolean {
  return p.admin === 'admin' || p.admin === 'superadmin' || p.isAdmin === true || p.isSuperAdmin === true;
}

/**
 * En grupos con direccionamiento LID el participante llega como
 * { id: '<lid>@lid', jid: '<número>@s.whatsapp.net', lid }, y en los demás con
 * id = número; se compara con los tres campos.
 */
function participantMatches(p: GroupParticipant, ids: readonly string[]): boolean {
  return ids.some((id) => sameUser(p.id, id) || sameUser(p.lid, id) || sameUser(p.jid, id));
}

/** Identificadores del bot (número y LID) tal y como los expone el socket. */
export function botIdentities(conn: Pick<WASocket, 'user'>): string[] {
  const user = conn.user as { id?: string; lid?: string } | undefined;
  return [user?.id, user?.lid].filter((id): id is string => Boolean(id));
}

/** true si `jid` es admin del grupo según la metadata dada (coincidencia exacta de dígitos). */
export function isGroupAdmin(metadata: GroupMetadata | null | undefined, jid: string): boolean {
  if (!metadata) return false;
  return metadata.participants.some((p) => isAdminParticipant(p) && participantMatches(p, [jid]));
}

/** true si `jid` (número o LID) está en el grupo; sirve para validar menciones contra `ctx.participants`. */
export function isGroupMember(metadata: GroupMetadata | null | undefined, jid: string): boolean {
  if (!metadata) return false;
  return metadata.participants.some((p) => participantMatches(p, [jid]));
}

export interface GroupRoles {
  isAdmin: boolean;
  isBotAdmin: boolean;
  /** `p.id` de cada admin (número o LID según el grupo); comparar con sameUser o isGroupAdmin, no con ===. */
  admins: string[];
  /** `p.id` de cada miembro; para saber si una mención pertenece al grupo usar isGroupMember. */
  participants: string[];
  /** null cuando WhatsApp no devolvió la metadata (el caller decide qué hacer). */
  metadata: GroupMetadata | null;
}

/** Roles de `sender` y del bot en el grupo, a partir de la metadata cacheada. */
export async function resolveGroupRoles(conn: WASocket, groupId: string, sender: string): Promise<GroupRoles> {
  const metadata = await getGroupMetadataCached(conn, groupId);
  if (!metadata) {
    return { isAdmin: false, isBotAdmin: false, admins: [], participants: [], metadata: null };
  }
  const botIds = botIdentities(conn);
  let isAdmin = false;
  let isBotAdmin = false;
  const admins: string[] = [];
  for (const p of metadata.participants) {
    const admin = isAdminParticipant(p);
    if (admin) admins.push(p.id);
    if (admin && participantMatches(p, [sender])) isAdmin = true;
    if (admin && participantMatches(p, botIds)) isBotAdmin = true;
  }
  return { isAdmin, isBotAdmin, admins, participants: metadata.participants.map((p) => p.id), metadata };
}

interface ParticipantsUpdate {
  id: string;
  participants: string[];
  action: ParticipantAction;
}

export async function handleParticipantsUpdate(conn: WASocket, update: ParticipantsUpdate): Promise<void> {
  const { id: groupId, participants, action } = update;
  try {
    // Cualquier cambio de miembros deja la metadata cacheada desfasada.
    invalidateGroupMetadata(groupId);
    const groupName = await getGroupName(conn, groupId);
    const settings = getDatabase().getChatSettings(groupId);

    for (const participant of participants) {
      const number = participant.split('@')[0];

      switch (action) {
        case 'add':
          log.info(`[${groupName}] se unió ${number}`);
          if (settings.welcome) {
            const text = settings.sWelcome
              .replace(/{user}/g, `@${number}`)
              .replace(/{group}/g, groupName)
              .replace(/{desc}/g, metadataCache.get(groupId)?.desc || 'Sin descripción');
            await conn.sendMessage(groupId, { text, mentions: [participant] });
          }
          break;

        case 'remove':
          log.info(`[${groupName}] salió ${number}`);
          if (settings.detect) {
            const text = settings.sBye.replace(/{user}/g, number).replace(/{group}/g, groupName);
            await conn.sendMessage(groupId, { text });
          }
          break;

        case 'promote':
          log.info(`[${groupName}] ${number} ahora es admin`);
          await conn.sendMessage(groupId, { text: `👑 @${number} ahora es administrador.`, mentions: [participant] });
          break;

        case 'demote':
          log.info(`[${groupName}] ${number} dejó de ser admin`);
          await conn.sendMessage(groupId, { text: `📉 @${number} ya no es administrador.`, mentions: [participant] });
          break;
      }
    }
  } catch (error) {
    log.error('error en participants.update:', error);
  }
}

export function handleGroupsUpdate(updates: Partial<GroupMetadata>[]): void {
  for (const update of updates) {
    if (!update.id) continue;
    const cached = metadataCache.get(update.id);
    if (update.subject) {
      log.info(`[Grupo] nombre cambiado a: ${update.subject}`);
      if (cached) cached.subject = update.subject;
    }
    if (update.desc !== undefined && cached) {
      cached.desc = update.desc ?? undefined;
    }
  }
}
