/**
 * YouTube Token Manager
 * Gestiona PO Tokens y Visitor Data para yt-dlp
 * Genera automáticamente tokens usando BgUtils y los renueva si fallan
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const execAsync = promisify(exec);

// Archivo donde se guardan los tokens
const TOKENS_FILE = join(process.cwd(), 'youtube-tokens.json');

interface YouTubeTokens {
  poToken: string;
  visitorData: string;
  generatedAt: number;
  failCount: number;
}

let cachedTokens: YouTubeTokens | null = null;

/**
 * Script de Python para generar tokens usando BgUtils
 */
const PYTHON_GENERATE_SCRIPT = `
import json
import sys

try:
    from bgutil import BgUtils
    bg = BgUtils()
    result = {
        "poToken": bg.get_po_token(),
        "visitorData": bg.get_visitor_data(),
        "success": True
    }
    print(json.dumps(result))
except ImportError:
    # Si bgutil no está instalado, intentar con el método HTTP
    try:
        import requests
        import time

        # Usar el servidor de BgUtils si está corriendo
        try:
            resp = requests.get('http://127.0.0.1:4416/generate', timeout=30)
            data = resp.json()
            result = {
                "poToken": data.get("potoken", ""),
                "visitorData": data.get("visitor_data", ""),
                "success": True
            }
            print(json.dumps(result))
        except:
            # Generar visitorData básico sin poToken
            import base64
            import random
            import string

            # Generar un visitor ID aleatorio
            visitor_id = ''.join(random.choices(string.ascii_letters + string.digits, k=11))

            result = {
                "poToken": "",
                "visitorData": visitor_id,
                "success": False,
                "error": "bgutil not available, using basic visitor data"
            }
            print(json.dumps(result))
    except Exception as e:
        result = {"success": False, "error": str(e), "poToken": "", "visitorData": ""}
        print(json.dumps(result))
except Exception as e:
    result = {"success": False, "error": str(e), "poToken": "", "visitorData": ""}
    print(json.dumps(result))
`;

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
 * Genera nuevos tokens usando Python/BgUtils
 */
async function generateNewTokens(): Promise<YouTubeTokens | null> {
  console.log('🔄 Generando nuevos tokens de YouTube...');

  try {
    // Intentar con Python y bgutil
    const { stdout, stderr } = await execAsync(`python3 -c '${PYTHON_GENERATE_SCRIPT.replace(/'/g, "\\'")}'`, {
      timeout: 60000
    });

    const result = JSON.parse(stdout.trim());

    if (result.success && result.poToken) {
      const tokens: YouTubeTokens = {
        poToken: result.poToken,
        visitorData: result.visitorData,
        generatedAt: Date.now(),
        failCount: 0
      };

      console.log('✅ Tokens generados exitosamente');
      saveTokens(tokens);
      cachedTokens = tokens;
      return tokens;
    } else if (result.visitorData) {
      // Solo tenemos visitorData, sin poToken
      console.log('⚠️ Solo se obtuvo visitorData, sin poToken');
      const tokens: YouTubeTokens = {
        poToken: '',
        visitorData: result.visitorData,
        generatedAt: Date.now(),
        failCount: 0
      };
      saveTokens(tokens);
      cachedTokens = tokens;
      return tokens;
    }

    console.error('❌ No se pudieron generar tokens:', result.error);
    return null;

  } catch (err) {
    console.error('❌ Error ejecutando script de generación:', err);

    // Intentar método alternativo: servidor HTTP de bgutil
    try {
      console.log('🔄 Intentando servidor HTTP de bgutil...');
      const response = await fetch('http://127.0.0.1:4416/generate', {
        signal: AbortSignal.timeout(30000)
      });
      const data = await response.json() as { potoken?: string; visitor_data?: string };

      if (data.potoken) {
        const tokens: YouTubeTokens = {
          poToken: data.potoken,
          visitorData: data.visitor_data || '',
          generatedAt: Date.now(),
          failCount: 0
        };

        console.log('✅ Tokens obtenidos del servidor bgutil');
        saveTokens(tokens);
        cachedTokens = tokens;
        return tokens;
      }
    } catch {
      console.log('⚠️ Servidor bgutil no disponible');
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
    console.log('💡 Para mejor funcionamiento, instala: pip3 install bgutil');
  } else {
    console.log('❌ No se pudieron obtener tokens. yt-dlp puede fallar.');
    console.log('💡 Instala bgutil: pip3 install --break-system-packages bgutil');
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
