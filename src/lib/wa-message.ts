/**
 * Lectura uniforme de mensajes de Baileys: desenvuelve los contenedores
 * (efímeros, ver una vez, documento con caption, editados) y extrae texto,
 * menciones y cita sin importar el tipo de mensaje.
 */

import { downloadMediaMessage, normalizeMessageContent, type WASocket, type proto } from 'baileys';
import pino from 'pino';

type Content = proto.IMessage;

const silentLogger = pino({ level: 'silent' });

function isWebMessageInfo(value: proto.IWebMessageInfo | Content): value is proto.IWebMessageInfo {
  return typeof (value as proto.IWebMessageInfo).key === 'object' && (value as proto.IWebMessageInfo).key !== null;
}

/**
 * Devuelve el contenido real del mensaje. Acepta el mensaje completo de
 * Baileys o solo su `message`. En grupos con mensajes temporales todo llega
 * dentro de `ephemeralMessage`; sin esto el bot lo ignoraría.
 */
export function unwrapMessage(msg: proto.IWebMessageInfo | Content | null | undefined): Content | undefined {
  if (!msg) return undefined;
  const content = isWebMessageInfo(msg) ? msg.message : msg;
  return normalizeMessageContent(content) ?? undefined;
}

/** Texto visible del mensaje: conversación, texto extendido, caption o respuesta de botón/lista. */
export function getText(content: Content | null | undefined): string {
  if (!content) return '';
  return (
    content.conversation ||
    content.extendedTextMessage?.text ||
    content.imageMessage?.caption ||
    content.videoMessage?.caption ||
    content.documentMessage?.caption ||
    content.buttonsResponseMessage?.selectedDisplayText ||
    content.listResponseMessage?.title ||
    content.templateButtonReplyMessage?.selectedDisplayText ||
    ''
  );
}

/** contextInfo del mensaje, esté donde esté (texto extendido o media con caption). */
export function getContextInfo(content: Content | null | undefined): proto.IContextInfo | undefined {
  if (!content) return undefined;
  return (
    content.extendedTextMessage?.contextInfo ||
    content.imageMessage?.contextInfo ||
    content.videoMessage?.contextInfo ||
    content.documentMessage?.contextInfo ||
    content.audioMessage?.contextInfo ||
    content.stickerMessage?.contextInfo ||
    content.buttonsResponseMessage?.contextInfo ||
    content.listResponseMessage?.contextInfo ||
    undefined
  );
}

/** JIDs mencionados en el mensaje. */
export function getMentions(content: Content | null | undefined): string[] {
  const mentioned = getContextInfo(content)?.mentionedJid;
  return Array.isArray(mentioned) ? mentioned.filter((jid): jid is string => typeof jid === 'string') : [];
}

export interface QuotedContent {
  /** Contenido citado ya desenvuelto. */
  message: Content;
  /** Id del mensaje citado. */
  stanzaId?: string;
  /** JID de quien escribió el mensaje citado. */
  participant?: string;
  text: string;
}

/** Mensaje citado (respondido), o undefined si no hay. */
export function getQuoted(content: Content | null | undefined): QuotedContent | undefined {
  const info = getContextInfo(content);
  const quoted = unwrapMessage(info?.quotedMessage);
  if (!quoted) return undefined;
  return {
    message: quoted,
    stanzaId: info?.stanzaId ?? undefined,
    participant: info?.participant ?? undefined,
    text: getText(quoted),
  };
}

/** Tamaño declarado del adjunto (0 si no es media). */
export function getMediaSize(content: Content | null | undefined): number {
  if (!content) return 0;
  return Number(
    content.imageMessage?.fileLength ??
    content.videoMessage?.fileLength ??
    content.audioMessage?.fileLength ??
    content.documentMessage?.fileLength ??
    content.stickerMessage?.fileLength ??
    0,
  );
}

/** Descarga el adjunto de un mensaje como Buffer (resubiéndolo si WhatsApp ya lo caducó). */
export async function downloadMedia(conn: WASocket, msg: proto.IWebMessageInfo): Promise<Buffer> {
  return (await downloadMediaMessage(msg, 'buffer', {}, {
    logger: silentLogger,
    reuploadRequest: conn.updateMediaMessage,
  })) as Buffer;
}
