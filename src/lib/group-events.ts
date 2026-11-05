/**
 * Eventos de grupo: bienvenidas, despedidas, cambios de admin y metadatos.
 * También resuelve los roles (admin / bot admin) a partir de la metadata cacheada.
 */

import { areJidsSameUser, type WASocket, type GroupMetadata, type ParticipantAction } from 'baileys';
import type { ChatSettings } from '../types/database.js';
import { LRUCache } from './lru-cache.js';
import { getDatabase } from './database.js';
import { createLogger } from './logger.js';
import { findParticipant, findBotParticipant, getAdmins, isParticipantAdmin } from './participants.js';
import { mentionTag } from './utils.js';
import { renderGroupMessage } from '../plugins/group-welcome.js';

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

/** Identificadores del bot (número y LID) tal y como los expone el socket. */
export function botIdentities(conn: Pick<WASocket, 'user'>): string[] {
  const user = conn.user as { id?: string; lid?: string } | undefined;
  return [user?.id, user?.lid].filter((id): id is string => Boolean(id));
}

/** true si `jid` (número o LID) es admin del grupo según la metadata dada. */
export function isGroupAdmin(metadata: GroupMetadata | null | undefined, jid: string): boolean {
  return isParticipantAdmin(findParticipant(metadata, jid));
}

/** true si `jid` (número o LID) está en el grupo; sirve para validar menciones contra `ctx.participants`. */
export function isGroupMember(metadata: GroupMetadata | null | undefined, jid: string): boolean {
  return findParticipant(metadata, jid) !== undefined;
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
  return {
    isAdmin: isParticipantAdmin(findParticipant(metadata, sender)),
    isBotAdmin: isParticipantAdmin(findBotParticipant(metadata, botIdentities(conn))),
    admins: getAdmins(metadata).map((p) => p.id),
    participants: metadata.participants.map((p) => p.id),
    metadata,
  };
}

/** Lee ChatSettings.adminAlerts (campo pendiente en types/database.ts) con default true. */
function adminAlertsEnabled(settings: ChatSettings): boolean {
  return (settings as ChatSettings & { adminAlerts?: boolean }).adminAlerts !== false;
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
    const metadata = await getGroupMetadataCached(conn, groupId);
    const groupName = metadata?.subject || 'Grupo';
    const settings = getDatabase().getChatSettings(groupId);
    const botIds = botIdentities(conn);
    const vars = { group: groupName, desc: metadata?.desc, count: metadata?.participants.length };

    for (const participant of participants) {
      const number = participant.split('@')[0];
      // Al propio bot lo meten y lo sacan de grupos: no se saluda ni se despide a sí mismo.
      if (botIds.some((id) => areJidsSameUser(id, participant))) continue;

      switch (action) {
        case 'add':
          log.info(`[${groupName}] se unió ${number}`);
          if (settings.welcome) {
            const text = renderGroupMessage(settings.sWelcome, { user: participant, ...vars });
            await conn.sendMessage(groupId, { text, mentions: [participant] });
          }
          break;

        case 'remove':
          log.info(`[${groupName}] salió ${number}`);
          // El campo se llama `detect` por herencia; datos lo renombra a `bye` en la ronda 2.
          if (settings.detect) {
            const text = renderGroupMessage(settings.sBye, { user: participant, ...vars });
            await conn.sendMessage(groupId, { text, mentions: [participant] });
          }
          break;

        case 'promote':
          log.info(`[${groupName}] ${number} ahora es admin`);
          if (adminAlertsEnabled(settings)) {
            await conn.sendMessage(groupId, { text: `👑 ${mentionTag(participant)} ahora es administrador.`, mentions: [participant] });
          }
          break;

        case 'demote':
          log.info(`[${groupName}] ${number} dejó de ser admin`);
          if (adminAlertsEnabled(settings)) {
            await conn.sendMessage(groupId, { text: `📉 ${mentionTag(participant)} ya no es administrador.`, mentions: [participant] });
          }
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
