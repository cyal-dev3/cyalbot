/**
 * Conexión a WhatsApp con Baileys: autenticación por QR o código de
 * emparejamiento, y creación del socket.
 */

import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  Browsers,
  type WASocket,
  type ConnectionState,
} from 'baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import * as readline from 'node:readline';
import * as fs from 'node:fs';
import * as path from 'node:path';
import NodeCache from 'node-cache';
import chalk from 'chalk';
// @ts-ignore - qrcode-terminal no publica tipos
import qrcode from 'qrcode-terminal';
import { CONFIG } from './config.js';
import { createLogger } from './lib/logger.js';

const log = createLogger('whatsapp');

// Baileys es muy ruidoso; sus logs se silencian y se usan los nuestros.
const baileysLogger = pino({ level: 'silent' });

export const msgRetryCounterCache = new NodeCache({ stdTTL: 300, useClones: false, maxKeys: 5000 });

let pairingTimeout: NodeJS.Timeout | null = null;
let rl: readline.Interface | null = null;
let useQRMethod = true;
let savedPhoneNumber: string | undefined;

export function cancelPairingTimeout(): void {
  if (pairingTimeout) {
    clearTimeout(pairingTimeout);
    pairingTimeout = null;
  }
}

function hasExistingSession(): boolean {
  return fs.existsSync(path.join(CONFIG.authFolder, 'creds.json'));
}

function ask(prompt: string): Promise<string> {
  rl ??= readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl!.question(prompt, resolve));
}

function closePrompt(): void {
  rl?.close();
  rl = null;
}

/** Deja solo dígitos. México: añade el 1 tras el 52 si falta (formato de WhatsApp). */
export function formatPhoneNumber(phone: string): string {
  let digits = phone.replace(/\D/g, '');
  if (digits.startsWith('52') && !digits.startsWith('521') && digits.length === 12) {
    digits = '521' + digits.slice(2);
  }
  return digits;
}

async function chooseAuthMethod(): Promise<{ useQR: boolean; phoneNumber?: string }> {
  const methodQR = process.argv.includes('--method=qr');
  const methodCode = process.argv.includes('--method=code');
  const phoneFromArg = process.argv.find((a) => a.startsWith('--phone='))?.split('=')[1];

  if (hasExistingSession()) {
    log.info('sesión existente encontrada, conectando');
    return { useQR: useQRMethod, phoneNumber: savedPhoneNumber };
  }

  if (methodQR || methodCode) {
    return {
      useQR: methodQR || !methodCode,
      phoneNumber: phoneFromArg ? formatPhoneNumber(phoneFromArg) : undefined,
    };
  }

  // Interactivo: primera vez sin sesión y sin argumentos.
  console.log('');
  console.log(chalk.bold('Vincular WhatsApp'));
  console.log('  1) Escanear código QR');
  console.log('  2) Código de 8 dígitos (sin cámara)');
  const answer = await ask('Elige (1 o 2): ');
  const useQR = answer.trim() !== '2';
  let phoneNumber: string | undefined;
  if (!useQR) {
    const phone = await ask('Número con código de país (ej. 5213312345678): ');
    phoneNumber = formatPhoneNumber(phone);
  }
  closePrompt();
  return { useQR, phoneNumber };
}

export async function startBot(): Promise<WASocket> {
  const { state, saveCreds } = await useMultiFileAuthState(CONFIG.authFolder);
  const { version } = await fetchLatestBaileysVersion();
  log.info(`WhatsApp Web v${version.join('.')}`);

  const { useQR, phoneNumber } = await chooseAuthMethod();
  useQRMethod = useQR;
  savedPhoneNumber = phoneNumber;

  const conn = makeWASocket({
    version,
    logger: baileysLogger,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, baileysLogger),
    },
    browser: Browsers.ubuntu('Chrome'),
    generateHighQualityLinkPreview: true,
    msgRetryCounterCache,
    defaultQueryTimeoutMs: undefined,
    markOnlineOnConnect: true,
  });

  if (!useQR && !hasExistingSession() && phoneNumber) {
    log.info('solicitando código de emparejamiento');
    pairingTimeout = setTimeout(async () => {
      pairingTimeout = null;
      try {
        const code = await conn.requestPairingCode(phoneNumber);
        const pretty = code?.match(/.{1,4}/g)?.join('-') || code;
        console.log('');
        console.log(chalk.bold(`  Código de emparejamiento: ${chalk.cyan(pretty)}`));
        console.log(chalk.gray('  WhatsApp > Dispositivos vinculados > Vincular dispositivo > Vincular con número'));
        console.log('');
      } catch (error) {
        log.error('no se pudo pedir el código:', error);
      }
    }, 3000);
  }

  conn.ev.on('connection.update', (update) => onConnectionUpdate(conn, update));
  conn.ev.on('creds.update', saveCreds);
  return conn;
}

function onConnectionUpdate(conn: WASocket, update: Partial<ConnectionState>): void {
  const { connection, lastDisconnect, qr } = update;

  if (qr && useQRMethod && !hasExistingSession()) {
    console.log('');
    console.log(chalk.bold('  Escanea este QR con WhatsApp (Dispositivos vinculados):'));
    qrcode.generate(qr, { small: true });
    console.log('');
  }

  if (connection === 'close') {
    const statusCode = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
    if (statusCode === DisconnectReason.loggedOut) {
      log.error(`sesión cerrada desde el teléfono. Borra ${CONFIG.authFolder} y vuelve a vincular.`);
    } else if (statusCode === DisconnectReason.connectionReplaced) {
      log.error('sesión reemplazada: hay otra instancia del bot corriendo.');
    } else {
      log.warn(`conexión cerrada (código ${statusCode ?? 'desconocido'})`);
    }
  }

  if (connection === 'open') {
    const user = conn.user?.id?.split(':')[0] || 'desconocido';
    log.info(`conectado como ${user}`);
  }
}

/** Reconectar salvo que la sesión se haya cerrado o reemplazado. */
export function shouldReconnect(error: Error | undefined): boolean {
  const statusCode = (error as Boom | undefined)?.output?.statusCode;
  return statusCode !== DisconnectReason.loggedOut && statusCode !== DisconnectReason.connectionReplaced;
}
