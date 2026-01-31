/**
 * Generador de StringSession para Telegram
 *
 * Este script te permite autenticarte en Telegram por primera vez
 * y genera una StringSession que puedes guardar en tu .env
 *
 * Uso: npm run telegram:session
 */

import 'dotenv/config';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import * as readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function question(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      resolve(answer);
    });
  });
}

async function main(): Promise<void> {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('   GENERADOR DE STRING SESSION - TELEGRAM');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
  console.log('Para obtener API_ID y API_HASH:');
  console.log('1. Ve a https://my.telegram.org/apps');
  console.log('2. Inicia sesion con tu numero de telefono');
  console.log('3. Crea una nueva aplicacion o usa una existente');
  console.log('4. Copia el API_ID y API_HASH');
  console.log('');

  // Obtener credenciales (de .env o pedir al usuario)
  let apiId = process.env.TELEGRAM_API_ID;
  let apiHash = process.env.TELEGRAM_API_HASH;

  if (!apiId) {
    apiId = await question('Ingresa tu API_ID: ');
  } else {
    console.log(`API_ID encontrado en .env: ${apiId}`);
  }

  if (!apiHash) {
    apiHash = await question('Ingresa tu API_HASH: ');
  } else {
    console.log(`API_HASH encontrado en .env: ${apiHash.substring(0, 8)}...`);
  }

  console.log('');
  console.log('Conectando a Telegram...');
  console.log('');

  const session = new StringSession('');
  const client = new TelegramClient(session, parseInt(apiId, 10), apiHash, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: async () => {
      return await question('Ingresa tu numero de telefono (con codigo de pais, ej: +521234567890): ');
    },
    password: async () => {
      return await question('Ingresa tu contrasena de 2FA (si tienes, sino presiona Enter): ');
    },
    phoneCode: async () => {
      return await question('Ingresa el codigo que recibiste en Telegram: ');
    },
    onError: (err) => {
      console.error('Error:', err);
    },
  });

  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('   AUTENTICACION EXITOSA');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');

  const stringSession = client.session.save() as unknown as string;

  console.log('Tu STRING_SESSION es:');
  console.log('');
  console.log('─────────────────────────────────────────────────────────────');
  console.log(stringSession);
  console.log('─────────────────────────────────────────────────────────────');
  console.log('');
  console.log('IMPORTANTE: Copia este valor y pegalo en tu archivo .env:');
  console.log('');
  console.log(`TELEGRAM_STRING_SESSION=${stringSession}`);
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');

  // Mostrar información útil
  try {
    const me = await client.getMe();
    if (me && 'firstName' in me) {
      console.log(`Autenticado como: ${me.firstName} ${me.lastName || ''}`);
      console.log(`Username: @${me.username || 'sin username'}`);
      console.log(`ID: ${me.id}`);
    }
  } catch {
    // Ignorar errores al obtener info del usuario
  }

  console.log('');
  console.log('Para obtener los IDs de los grupos de Telegram:');
  console.log('1. Anade el bot @userinfobot a tu grupo');
  console.log('2. El bot mostrara el ID del grupo (ej: -1001234567890)');
  console.log('3. Anade esos IDs a TELEGRAM_GROUP_IDS en tu .env');
  console.log('');

  await client.disconnect();
  rl.close();
  process.exit(0);
}

main().catch((error) => {
  console.error('Error fatal:', error);
  rl.close();
  process.exit(1);
});
