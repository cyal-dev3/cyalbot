/**
 * Eventos de grupo: bienvenidas, despedidas, cambios de admin y metadatos.
 */

import type { WASocket, GroupMetadata, ParticipantAction } from 'baileys';
import { LRUCache } from './lru-cache.js';
import { getDatabase } from './database.js';
import { createLogger } from './logger.js';

const log = createLogger('grupos');

const metadataCache = new LRUCache<string, GroupMetadata>(1000);

export async function getGroupMetadataCached(conn: WASocket, groupId: string): Promise<GroupMetadata | null> {
  const cached = metadataCache.get(groupId);
  if (cached) return cached;
  try {
    const metadata = await conn.groupMetadata(groupId);
    metadataCache.set(groupId, metadata);
    return metadata;
  } catch {
    return null;
  }
}

export async function getGroupName(conn: WASocket, groupId: string): Promise<string> {
  return (await getGroupMetadataCached(conn, groupId))?.subject || 'Grupo';
}

export function invalidateGroupMetadata(groupId: string): void {
  metadataCache.delete(groupId);
}

interface ParticipantsUpdate {
  id: string;
  participants: string[];
  action: ParticipantAction;
}

export async function handleParticipantsUpdate(conn: WASocket, update: ParticipantsUpdate): Promise<void> {
  const { id: groupId, participants, action } = update;
  try {
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
          invalidateGroupMetadata(groupId);
          break;

        case 'demote':
          log.info(`[${groupName}] ${number} dejó de ser admin`);
          await conn.sendMessage(groupId, { text: `📉 @${number} ya no es administrador.`, mentions: [participant] });
          invalidateGroupMetadata(groupId);
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
