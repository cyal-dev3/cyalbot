/**
 * YouTube Token Manager
 * Gestiona PO Tokens y Visitor Data para yt-dlp
 * Genera automáticamente tokens usando bgutil-ytdlp-pot-provider
 *
 * Para generar tokens, necesitas correr el servidor bgutil:
 * - Docker: docker run -d -p 4416:4416 --init brainicism/bgutil-ytdlp-pot-provider
 * - Node.js: git clone https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git
 *            cd bgutil-ytdlp-pot-provider/server && npm install && npx tsc && node build/main.js
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

// Archivo donde se guardan los tokens
const TOKENS_FILE = join(process.cwd(), 'youtube-tokens.json');

// URL del servidor bgutil (puede configurarse via env)
const BGUTIL_SERVER_URL = process.env.BGUTIL_SERVER_URL || 'http://127.0.0.1:4416';

interface YouTubeTokens {
  poToken: string;
  visitorData: string;
  generatedAt: number;
  failCount: number;
}

let cachedTokens: YouTubeTokens | null = null;

/**
 * Carga los tokens desde el archivo
 */
function loadTokens(): YouTubeTokens | null {
  try {
    if (existsSync(TOKENS_FILE)) {
      const data = readFileSync(TOKENS_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('Error cargando tokens:', err);
  }
  return null;
}

/**
 * Guarda los tokens en el archivo
 */
function saveTokens(tokens: YouTubeTokens): void {
  try {
    writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2));
    console.log('✅ Tokens guardados en', TOKENS_FILE);
  } catch (err) {
    console.error('Error guardando tokens:', err);
  }
}

/**
 * Genera nuevos tokens usando el servidor bgutil-ytdlp-pot-provider
 */
async function generateNewTokens(): Promise<YouTubeTokens | null> {
  console.log('🔄 Generando nuevos tokens de YouTube...');
  console.log(`📡 Conectando a servidor bgutil en ${BGUTIL_SERVER_URL}...`);

  try {
    // Usar el servidor HTTP de bgutil-ytdlp-pot-provider
    const response = await fetch(`${BGUTIL_SERVER_URL}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(60000)
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }

    const data = await response.json() as {
      poToken?: string;
      po_token?: string;
      visitorData?: string;
      visitor_data?: string;
    };

    const poToken = data.poToken || data.po_token || '';
    const visitorData = data.visitorData || data.visitor_data || '';

    if (poToken) {
      const tokens: YouTubeTokens = {
        poToken,
        visitorData,
        generatedAt: Date.now(),
        failCount: 0
      };

      console.log(`✅ Tokens generados exitosamente`);
      console.log(`   PO Token: ${poToken.substring(0, 30)}...`);
      console.log(`   Visitor Data: ${visitorData.substring(0, 30)}...`);
      saveTokens(tokens);
      cachedTokens = tokens;
      return tokens;
    }

    console.error('❌ Respuesta sin tokens:', data);
    return null;

  } catch (err) {
    const error = err as Error;

    if (error.name === 'TypeError' || error.message.includes('fetch')) {
      console.error('❌ No se pudo conectar al servidor bgutil');
      console.log('');
      console.log('📋 Para generar tokens, inicia el servidor bgutil:');
      console.log('');
      console.log('   DOCKER (recomendado):');
      console.log('   docker run -d -p 4416:4416 --init brainicism/bgutil-ytdlp-pot-provider');
      console.log('');
      console.log('   NODE.JS:');
      console.log('   git clone https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git');
      console.log('   cd bgutil-ytdlp-pot-provider/server && npm install && npx tsc');
      console.log('   node build/main.js');
    } else {
      console.error('❌ Error generando tokens:', error.message);
    }

    return null;
  }
}

/**
 * Obtiene los tokens actuales o genera nuevos si no existen
 */
export async function getTokens(): Promise<YouTubeTokens | null> {
  // Usar cache si está disponible
  if (cachedTokens) {
    return cachedTokens;
  }

  // Cargar desde archivo
  const savedTokens = loadTokens();

  if (savedTokens) {
    // Verificar si los tokens son muy viejos (más de 12 horas)
    const ageHours = (Date.now() - savedTokens.generatedAt) / (1000 * 60 * 60);

    if (ageHours < 12 && savedTokens.failCount < 3) {
      console.log(`📋 Usando tokens guardados (edad: ${ageHours.toFixed(1)}h, fallos: ${savedTokens.failCount})`);
      cachedTokens = savedTokens;
      return savedTokens;
    } else {
      console.log(`⚠️ Tokens viejos o con muchos fallos, regenerando...`);
    }
  }

  // Generar nuevos tokens
  return await generateNewTokens();
}

/**
 * Marca los tokens actuales como fallidos y regenera si es necesario
 */
export async function markTokensFailed(): Promise<YouTubeTokens | null> {
  const currentTokens = loadTokens();

  if (currentTokens) {
    currentTokens.failCount++;
    saveTokens(currentTokens);

    console.log(`⚠️ Token marcado como fallido (${currentTokens.failCount} fallos)`);

    // Si hay muchos fallos, regenerar
    if (currentTokens.failCount >= 2) {
      console.log('🔄 Demasiados fallos, regenerando tokens...');
      cachedTokens = null;
      return await generateNewTokens();
    }

    cachedTokens = currentTokens;
    return currentTokens;
  }

  // No hay tokens, generar nuevos
  return await generateNewTokens();
}

/**
 * Fuerza la regeneración de tokens
 */
export async function regenerateTokens(): Promise<YouTubeTokens | null> {
  console.log('🔄 Forzando regeneración de tokens...');
  cachedTokens = null;
  return await generateNewTokens();
}

/**
 * Obtiene el PO Token actual
 */
export async function getPoToken(): Promise<string> {
  const tokens = await getTokens();
  return tokens?.poToken || process.env.YT_PO_TOKEN || '';
}

/**
 * Obtiene el Visitor Data actual
 */
export async function getVisitorData(): Promise<string> {
  const tokens = await getTokens();
  return tokens?.visitorData || process.env.YT_VISITOR_DATA || '';
}

/**
 * Inicializa el sistema de tokens (llamar al inicio del bot)
 */
export async function initializeTokens(): Promise<void> {
  console.log('🔐 Inicializando sistema de tokens de YouTube...');

  const tokens = await getTokens();

  if (tokens?.poToken) {
    console.log('✅ Sistema de tokens listo (con PO Token)');
  } else if (tokens?.visitorData) {
    console.log('⚠️ Sistema de tokens listo (solo Visitor Data, sin PO Token)');
    console.log('💡 Para mejor funcionamiento, inicia el servidor bgutil');
  } else {
    console.log('❌ No se pudieron obtener tokens. yt-dlp puede fallar.');
    console.log('💡 Inicia el servidor bgutil: docker run -d -p 4416:4416 --init brainicism/bgutil-ytdlp-pot-provider');
  }
}

export default {
  getTokens,
  getPoToken,
  getVisitorData,
  markTokensFailed,
  regenerateTokens,
  initializeTokens
};
