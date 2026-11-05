import { isPrivateHost } from './fetch-media.js';

export { isPrivateHost };

/** User-Agent de navegador para servicios que rechazan clientes genéricos (Google TTS, CDNs). */
export const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export interface FetchWithTimeoutOptions extends RequestInit {
  timeoutMs?: number;
}

/**
 * fetch con tope de tiempo. Lanza el error de abort de fetch si se agota;
 * el llamador decide cómo contarlo (normalmente como TIMEOUT).
 */
export async function fetchWithTimeout(url: string, options: FetchWithTimeoutOptions = {}): Promise<Response> {
  const { timeoutMs = 15_000, signal, ...init } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref();
  // Si el llamador trae su propia señal, cualquiera de las dos cancela la petición.
  signal?.addEventListener('abort', () => controller.abort(), { once: true });
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export interface FetchedText {
  response: Response;
  text: string;
}

/**
 * Como fetchWithTimeout, pero el tope cubre también la lectura del cuerpo:
 * un servidor que manda las cabeceras y se cuelga a mitad del JSON dejaría
 * la petición pendiente para siempre con response.text() fuera del timer.
 */
export async function fetchTextWithTimeout(url: string, options: FetchWithTimeoutOptions = {}): Promise<FetchedText> {
  const { timeoutMs = 15_000, signal, ...init } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref();
  signal?.addEventListener('abort', () => controller.abort(), { once: true });
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    return { response, text };
  } finally {
    clearTimeout(timer);
  }
}
