import { lookup } from 'node:dns/promises';
import net from 'node:net';
import { DownloadError } from './errors.js';

const BLOCKED_HOSTS = new Set(['localhost', 'localhost.localdomain', 'ip6-localhost', 'ip6-loopback', 'metadata.google.internal']);
const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.localdomain', '.home.arpa', '.lan', '.intranet'];

/** True si la IP (v4 o v6) pertenece a un rango privado, loopback, link-local o reservado. */
export function isPrivateIp(ip: string): boolean {
  const kind = net.isIP(ip);
  if (kind === 4) return isPrivateIpv4(ip);
  if (kind === 6) return isPrivateIpv6(ip);
  return true;
}

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number.parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => !Number.isFinite(p) || p < 0 || p > 255)) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a === 169 && b === 254) return true; // link-local y metadata de nubes
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0 && parts[2] === 0) return true;
  if (a === 192 && b === 0 && parts[2] === 2) return true; // TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51 && parts[2] === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && parts[2] === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast, reservado y broadcast
  return false;
}

function isPrivateIpv6(ip: string): boolean {
  const lower = ip.toLowerCase().split('%')[0];
  if (lower === '::' || lower === '::1') return true;
  // IPv4 embebida (::ffff:a.b.c.d): se evalua la parte v4.
  const mapped = /^(?:0*:)*ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped) return isPrivateIpv4(mapped[1]);
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local
  if (/^fe[89ab]/.test(lower)) return true; // link-local
  if (lower.startsWith('ff')) return true; // multicast
  if (lower.startsWith('2001:db8')) return true; // documentacion
  if (lower.startsWith('::ffff:') || lower.startsWith('64:ff9b')) return true; // mapeados/traduccion
  return false;
}

/** Valida sintaxis y host; lanza INVALID_URL si no es http(s) publica. No hace DNS. */
export function validateUrl(raw: unknown): URL {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new DownloadError('INVALID_URL', 'Falta el campo "url"');
  }
  const trimmed = raw.trim();
  if (trimmed.length > 2048) throw new DownloadError('INVALID_URL', 'URL demasiado larga');
  // Caracteres de control o saltos de linea nunca forman parte de una URL legitima.
  if (/[\u0000-\u001f\u007f\s]/.test(trimmed)) throw new DownloadError('INVALID_URL', 'La URL contiene caracteres no validos');
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new DownloadError('INVALID_URL', 'URL mal formada');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new DownloadError('INVALID_URL', 'Solo se aceptan URLs http(s)');
  }
  if (url.username || url.password) throw new DownloadError('INVALID_URL', 'No se aceptan credenciales en la URL');
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host) throw new DownloadError('INVALID_URL', 'La URL no tiene host');
  if (host.startsWith('[') || net.isIP(host) !== 0) {
    throw new DownloadError('INVALID_URL', 'No se aceptan direcciones IP literales');
  }
  if (BLOCKED_HOSTS.has(host) || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new DownloadError('INVALID_URL', 'Host no permitido');
  }
  if (!host.includes('.')) throw new DownloadError('INVALID_URL', 'El host debe ser un dominio publico');
  // Hosts tipo "0x7f.1" o puramente numericos son formas alternativas de IP.
  if (/^[0-9x.]+$/i.test(host)) throw new DownloadError('INVALID_URL', 'No se aceptan direcciones IP literales');
  return url;
}

/** True si hay un proxy HTTP configurado por entorno: entonces resuelve el proxy, no este proceso. */
export function proxyConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy'].some((k) => Boolean(env[k]?.trim()));
}

/**
 * Resuelve el host y rechaza (INVALID_URL) si alguna direccion es privada o si no se puede resolver.
 * Solo se deja pasar un fallo de DNS cuando hay un proxy configurado, porque en ese caso la
 * resolucion la hace el proxy y este proceso puede no tener DNS. Devuelve las IPs resueltas.
 *
 * Limite conocido: yt-dlp vuelve a resolver el nombre al conectar, asi que un DNS que cambie de
 * respuesta entre ambas consultas (rebinding con TTL 0) no se detecta aqui; yt-dlp no permite
 * fijar la IP de destino sin romper TLS/SNI de los extractores.
 */
export async function assertPublicHost(hostname: string, timeoutMs = 5000): Promise<string[]> {
  let addresses: { address: string }[];
  try {
    addresses = await Promise.race([
      lookup(hostname, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('dns timeout')), timeoutMs).unref()),
    ]);
  } catch {
    if (proxyConfigured()) return [];
    throw new DownloadError('INVALID_URL', 'No se pudo resolver el host');
  }
  if (!addresses.length) throw new DownloadError('INVALID_URL', 'No se pudo resolver el host');
  if (addresses.some((a) => isPrivateIp(a.address))) {
    throw new DownloadError('INVALID_URL', 'El host resuelve a una direccion privada');
  }
  return addresses.map((a) => a.address);
}

/** validateUrl + assertPublicHost en un paso, para URLs derivadas (imagenes, redirecciones, entradas). */
export async function assertPublicUrl(raw: unknown): Promise<URL> {
  const url = validateUrl(raw);
  await assertPublicHost(url.hostname);
  return url;
}

const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/** Nombre de archivo seguro: sin rutas, sin caracteres de control ni reservados, longitud acotada. */
export function sanitizeFilename(name: unknown, fallback = 'file'): string {
  if (typeof name !== 'string') return fallback;
  // Se separan los segmentos de ruta y se descartan los vacios y los relativos (".", "..").
  let out = name
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .split(/[\\/]+/)
    .filter((seg) => seg !== '' && seg !== '.' && seg !== '..')
    .join('_')
    .replace(/[:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  // Puntos iniciales (ocultos/traversal) y finales (Windows) se eliminan.
  out = out.replace(/^[. ]+/, '').replace(/[. ]+$/, '');
  if (!out || out === '..' || RESERVED_NAMES.test(out)) return fallback;
  if (out.length > 120) {
    const ext = /\.([a-z0-9]{1,5})$/i.exec(out)?.[0] ?? '';
    out = out.slice(0, 120 - ext.length) + ext;
  }
  return out;
}
