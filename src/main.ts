/**
 * 🔌 Motor Principal de CYALTRONIC
 * Conexión a WhatsApp usando Baileys
 */

import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  type WASocket,
  type ConnectionState,
  Browsers
} from 'baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import * as readline from 'readline';
import * as fs from 'fs';
import NodeCache from 'node-cache';
import chalk from 'chalk';
// @ts-ignore - qrcode-terminal no tiene tipos
import qrcode from 'qrcode-terminal';
import { CONFIG } from './config.js';

// Logger silencioso para Baileys
const logger = pino({ level: 'silent' });

// Caché para reintentos de mensajes — bounded para VPS de larga duración
export const msgRetryCounterCache = new NodeCache({
  stdTTL: 300,
  useClones: false,
  maxKeys: 5000
});

// setTimeout activo para solicitar el código de emparejamiento (trackeado para poder cancelarlo)
let pairingTimeout: NodeJS.Timeout | null = null;

export function cancelPairingTimeout(): void {
  if (pairingTimeout) {
    clearTimeout(pairingTimeout);
    pairingTimeout = null;
  }
}

// Variable global para el readline
let rl: readline.Interface | null = null;

// Variables globales para el método de autenticación
let useQRMethod = true;
let savedPhoneNumber: string | undefined;

/**
 * Verifica si existe el archivo creds.json (sesión guardada)
 */
function hasExistingSession(): boolean {
  const credsPath = `${CONFIG.authFolder}/creds.json`;
  return fs.existsSync(credsPath);
}

/**
 * Crea o retorna la interfaz readline
 */
function getReadline(): readline.Interface {
  if (!rl) {
    rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
  }
  return rl;
}

/**
 * Cierra la interfaz readline
 */
function closeReadline(): void {
  if (rl) {
    rl.close();
    rl = null;
  }
}

/**
 * Pregunta al usuario y espera respuesta
 */
async function question(prompt: string): Promise<string> {
  const readline = getReadline();
  return new Promise((resolve) => {
    readline.question(prompt, (answer) => {
      resolve(answer);
    });
  });
}

/**
 * Formatea un número de teléfono para WhatsApp
 */
function formatPhoneNumber(phone: string): string {
  let formatted = phone.replace(/[^0-9]/g, '');

  // Caso especial para México: agregar 1 después del 52
  if (formatted.startsWith('52') && !formatted.startsWith('521') && formatted.length === 12) {
    formatted = '521' + formatted.slice(2);
  }

  return formatted;
}

/**
 * Inicia el bot y conecta a WhatsApp
 */
export async function startBot(): Promise<WASocket> {
  // Cargar estado de autenticación
  const { state, saveCreds } = await useMultiFileAuthState(CONFIG.authFolder);
  const { version } = await fetchLatestBaileysVersion();

  console.log(chalk.cyan(`\n🔌 Versión de WhatsApp Web: ${version.join('.')}\n`));

  // Determinar método de autenticación desde argumentos
  const methodQR = process.argv.includes('--method=qr');
  const methodCode = process.argv.includes('--method=code');
  const phoneArg = process.argv.find(arg => arg.startsWith('--phone='));
  const phoneFromArg = phoneArg?.split('=')[1];

  let useQR = useQRMethod;
  let phoneNumber: string | undefined = savedPhoneNumber;

  // PRIORIDAD 1: Si existe creds.json, conectar directamente sin preguntar nada
  if (hasExistingSession()) {
    console.log(chalk.green('📱 Sesión existente encontrada, conectando...\n'));
    // No preguntamos nada, solo conectamos
  }
  // PRIORIDAD 2: Si se pasó argumento por línea de comandos
  else if (methodQR || methodCode) {
    useQR = methodQR || !methodCode;
    if (phoneFromArg) {
      phoneNumber = formatPhoneNumber(phoneFromArg);
      savedPhoneNumber = phoneNumber;
    }
  }
  // PRIORIDAD 3: Primera vez sin sesión - preguntar al usuario
  else {
    console.log(chalk.yellow('═══════════════════════════════════════'));
    console.log(chalk.yellow('   🤖 CYALTRONIC - Autenticación'));
    console.log(chalk.yellow('═══════════════════════════════════════\n'));

    const answer = await question(chalk.white(
      '📱 Selecciona el método de autenticación:\n\n' +
      '  1️⃣  Escanear código QR\n' +
      '  2️⃣  Código de 8 dígitos\n\n' +
      '➡️  Tu elección (1 o 2): '
    ));

    useQR = answer.trim() !== '2';

    if (!useQR) {
      console.log('');
      const phone = await question(chalk.white(
        '📞 Ingresa tu número de WhatsApp con código de país:\n' +
        '   Ejemplo: 5213314429560 (México)\n\n' +
        '➡️  Número: '
      ));
      phoneNumber = formatPhoneNumber(phone);
      savedPhoneNumber = phoneNumber;
    }

    closeReadline(); // Cerrar readline después de obtener respuestas
  }

  // Guardar método elegido globalmente
  useQRMethod = useQR;

  // Crear conexión con Baileys
  const conn = makeWASocket({
    version,
    logger,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger)
    },
    browser: Browsers.ubuntu('Chrome'),
    generateHighQualityLinkPreview: true,
    msgRetryCounterCache,
    defaultQueryTimeoutMs: undefined,
    markOnlineOnConnect: true
  });

  // Solicitar código de pairing si es necesario (solo si NO hay sesión existente)
  if (!useQR && !hasExistingSession() && phoneNumber) {
    console.log(chalk.yellow('\n⏳ Solicitando código de emparejamiento...\n'));

    pairingTimeout = setTimeout(async () => {
      pairingTimeout = null;
      try {
        const code = await conn.requestPairingCode(phoneNumber!);
        const formattedCode = code?.match(/.{1,4}/g)?.join('-') || code;

        console.log(chalk.green('═══════════════════════════════════════'));
        console.log(chalk.green('   🔐 CÓDIGO DE EMPAREJAMIENTO'));
        console.log(chalk.green('═══════════════════════════════════════\n'));
        console.log(chalk.white.bold(`   📱 Tu código: ${chalk.cyan.bold(formattedCode)}\n`));
        console.log(chalk.gray('   1. Abre WhatsApp en tu teléfono'));
        console.log(chalk.gray('   2. Ve a Dispositivos vinculados'));
        console.log(chalk.gray('   3. Toca "Vincular dispositivo"'));
        console.log(chalk.gray('   4. Ingresa el código de arriba\n'));
        console.log(chalk.green('═══════════════════════════════════════\n'));
      } catch (error) {
        console.error(chalk.red('❌ Error al solicitar código:'), error);
      }
    }, 3000);
  }

  // Manejar eventos de conexión
  conn.ev.on('connection.update', (update: Partial<ConnectionState>) => {
    handleConnectionUpdate(conn, update);
  });

  // Guardar credenciales cuando cambien
  conn.ev.on('creds.update', saveCreds);

  return conn;
}

/**
 * Maneja los cambios de estado de conexión
 */
function handleConnectionUpdate(
  conn: WASocket,
  update: Partial<ConnectionState>
): void {
  const { connection, lastDisconnect, qr } = update;

  // Mostrar QR solo si NO hay sesión existente y el usuario eligió QR
  if (qr && useQRMethod && !hasExistingSession()) {
    console.log(chalk.cyan('\n📱 Escanea el código QR con WhatsApp:\n'));
    qrcode.generate(qr, { small: true });
    console.log('');
  }

  // Conexión cerrada
  if (connection === 'close') {
    const boom = lastDisconnect?.error as Boom;
    const statusCode = boom?.output?.statusCode;

    console.log(chalk.yellow('\n⚠️  Conexión cerrada'));

    if (statusCode === DisconnectReason.loggedOut) {
      console.log(chalk.red('❌ Sesión cerrada. Elimina la carpeta CyaltronicSession y vuelve a escanear.\n'));
    } else if (statusCode === DisconnectReason.connectionReplaced) {
      console.log(chalk.red('❌ Sesión reemplazada. Cierra otras instancias del bot.\n'));
    } else {
      console.log(chalk.yellow('🔄 Reconectando automáticamente...\n'));
    }
  }

  // Conexión abierta exitosamente
  if (connection === 'open') {
    console.log(chalk.green('\n═══════════════════════════════════════'));
    console.log(chalk.green('   ✅ CYALTRONIC CONECTADO'));
    console.log(chalk.green('═══════════════════════════════════════\n'));
    console.log(chalk.white(`   🤖 Bot: ${CONFIG.botName}`));
    console.log(chalk.white(`   📱 Usuario: ${conn.user?.id?.split(':')[0] || 'N/A'}`));
    console.log(chalk.white(`   📅 Fecha: ${new Date().toLocaleString('es-MX')}\n`));
    console.log(chalk.green('═══════════════════════════════════════\n'));
    console.log(chalk.cyan('   ⏳ Esperando mensajes...\n'));
  }
}

/**
 * Verifica si hubo desconexión y si debe reconectar
 */
export function shouldReconnect(error: Error | undefined): boolean {
  const boom = error as Boom | undefined;
  const statusCode = boom?.output?.statusCode;

  // No reconectar si cerró sesión o fue reemplazada
  if (statusCode === DisconnectReason.loggedOut) return false;
  if (statusCode === DisconnectReason.connectionReplaced) return false;

  // Reconectar en otros casos
  return true;
}
