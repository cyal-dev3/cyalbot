/**
 * Genera la StringSession de Telegram para el puente (npm run telegram:session).
 * Pide API_ID/API_HASH si no están en .env, autentica con teléfono, código y
 * 2FA, y ofrece escribir TELEGRAM_STRING_SESSION en .env.
 */

import 'dotenv/config';
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { createLogger } from './lib/logger.js';

const log = createLogger('telegram');

/** El paquete `input` no trae tipos; se declara lo que se usa. */
interface InputModule {
  text(label: string, options?: { default?: string }): Promise<string>;
  password(label: string): Promise<string>;
  confirm(label: string, options?: { default?: boolean }): Promise<boolean>;
}
const input = createRequire(import.meta.url)('input') as InputModule;

const ENV_PATH = '.env';

// La salida de un asistente interactivo se lee en la terminal; el logger con hora y nivel sería ruido.
function print(line = ''): void {
  process.stdout.write(`${line}\n`);
}

async function askApiId(): Promise<number> {
  const fromEnv = process.env.TELEGRAM_API_ID?.trim();
  if (fromEnv && /^\d+$/.test(fromEnv)) {
    print(`API_ID encontrado en .env: ${fromEnv}`);
    return parseInt(fromEnv, 10);
  }
  if (fromEnv) log.warn(`TELEGRAM_API_ID en .env no es numérico ("${fromEnv}"); se pedirá de nuevo`);
  for (;;) {
    const raw = (await input.text('API_ID (solo dígitos):')).trim();
    if (/^\d+$/.test(raw)) return parseInt(raw, 10);
    print('El API_ID es un número; vuelve a intentarlo.');
  }
}

async function askApiHash(): Promise<string> {
  const fromEnv = process.env.TELEGRAM_API_HASH?.trim();
  if (fromEnv) {
    print(`API_HASH encontrado en .env: ${fromEnv.slice(0, 6)}...`);
    return fromEnv;
  }
  for (;;) {
    const raw = (await input.text('API_HASH:')).trim();
    if (raw) return raw;
  }
}

/** Sustituye o añade TELEGRAM_STRING_SESSION en .env conservando el resto. */
async function writeSessionToEnv(session: string): Promise<void> {
  let content = '';
  try {
    content = await readFile(ENV_PATH, 'utf8');
  } catch {
    // sin .env: se crea
  }
  const line = `TELEGRAM_STRING_SESSION=${session}`;
  const pattern = /^TELEGRAM_STRING_SESSION=.*$/m;
  const updated = pattern.test(content)
    ? content.replace(pattern, line)
    : `${content}${content && !content.endsWith('\n') ? '\n' : ''}${line}\n`;
  await writeFile(ENV_PATH, updated, 'utf8');
}

async function main(): Promise<void> {
  print();
  print('Generador de StringSession para el puente de Telegram');
  print('Credenciales: https://my.telegram.org/apps (crea una app y copia API_ID y API_HASH)');
  print();

  const apiId = await askApiId();
  const apiHash = await askApiHash();

  print();
  log.info('conectando a Telegram');
  const client = new TelegramClient(new StringSession(''), apiId, apiHash, { connectionRetries: 5 });

  await client.start({
    phoneNumber: () => input.text('Número de teléfono con código de país (ej. +521234567890):'),
    phoneCode: () => input.text('Código que recibiste en Telegram:'),
    password: () => input.password('Contraseña de verificación en dos pasos (Enter si no tienes):'),
    onError: (error) => log.error('autenticación:', error instanceof Error ? error.message : error),
  });

  const stringSession = String(client.session.save());
  try {
    const me = await client.getMe();
    if (me && 'firstName' in me) log.info(`autenticado como ${[me.firstName, me.lastName].filter(Boolean).join(' ')} (@${me.username || 'sin username'})`);
  } catch {
    // solo informativo
  }

  print();
  print('Tu TELEGRAM_STRING_SESSION:');
  print(stringSession);
  print();

  if (await input.confirm(`¿Escribirla en ${ENV_PATH} como TELEGRAM_STRING_SESSION?`, { default: true })) {
    await writeSessionToEnv(stringSession);
    log.info(`TELEGRAM_STRING_SESSION guardada en ${ENV_PATH}`);
  } else {
    print(`Cópiala a mano en ${ENV_PATH}: TELEGRAM_STRING_SESSION=<valor>`);
  }

  print();
  print('IDs de los grupos de Telegram: añade @userinfobot al grupo y copia el id (ej. -1001234567890) en TELEGRAM_GROUP_IDS.');
  await client.disconnect();
  process.exit(0);
}

main().catch((error) => {
  log.error('error fatal:', error);
  process.exit(1);
});
