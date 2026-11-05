export type ErrorCode =
  | 'INVALID_URL'
  | 'UNSUPPORTED'
  | 'LOGIN_REQUIRED'
  | 'TOO_LARGE'
  | 'TIMEOUT'
  | 'RATE_LIMITED'
  | 'NOT_FOUND'
  | 'INTERNAL'
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'CLIENT_CLOSED';

export const STATUS_BY_CODE: Record<ErrorCode, number> = {
  INVALID_URL: 400,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  TOO_LARGE: 413,
  UNSUPPORTED: 422,
  LOGIN_REQUIRED: 422,
  RATE_LIMITED: 429,
  // Solo para el log: el cliente cerro la conexion antes de la respuesta (convencion de nginx).
  CLIENT_CLOSED: 499,
  INTERNAL: 500,
  TIMEOUT: 504,
};

export class DownloadError extends Error {
  readonly code: ErrorCode;
  readonly status: number;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'DownloadError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
  }
}

export function toDownloadError(err: unknown): DownloadError {
  if (err instanceof DownloadError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new DownloadError('INTERNAL', message || 'Error interno');
}

interface Rule {
  code: ErrorCode;
  pattern: RegExp;
}

// El orden importa: la primera regla que coincide gana. Los codigos HTTP van primero porque son
// el dato mas fiable; Instagram, por ejemplo, mezcla "rate-limit reached or login required" en un
// mismo mensaje y lo util es pedir cookies, de ahi que LOGIN_REQUIRED preceda a RATE_LIMITED.
const RULES: Rule[] = [
  { code: 'TOO_LARGE', pattern: /larger than max-filesize|file is larger than|exceeds maximum/i },
  { code: 'NOT_FOUND', pattern: /http error (?:404|410)\b/i },
  { code: 'RATE_LIMITED', pattern: /http error 429\b|429 client error/i },
  { code: 'UNSUPPORTED', pattern: /http error 403\b|redirect loop/i },
  { code: 'INTERNAL', pattern: /http error 5\d\d\b/i },
  { code: 'TIMEOUT', pattern: /timed? ?out|timeout|read operation timed/i },
  {
    code: 'LOGIN_REQUIRED',
    pattern:
      /login required|log ?in (?:to|is) |sign in to confirm|sign in to view|requires? authentication|not logged in|private video|this (?:video|post|tweet|account) is private|use --cookies|--cookies-from-browser|age[- ]restricted|confirm your age|members[- ]only|only available to (?:registered|logged)|nsfw tweet requires authentication|requested content is not available, rate-limit reached/i,
  },
  { code: 'RATE_LIMITED', pattern: /rate[- ]?limit|too many requests/i },
  {
    code: 'NOT_FOUND',
    pattern:
      /video unavailable|is unavailable|(?:video|page|user|tweet|post|content|media|account|playlist|item) not found|does not exist|has been removed|been deleted|no longer available|this content isn't available|no such user|could not be found|name or service not known|nodename nor servname|no address associated|name resolution|getaddrinfo failed/i,
  },
  {
    code: 'UNSUPPORTED',
    pattern:
      /unsupported url|no video formats found|no video could be found|requested format is not available|is not a valid url|unable to extract|no suitable (?:extractor|format)|only images|not a video|no media found|this tweet does not contain|does not contain any media|unable to recognize|no formats found|unable to obtain file audio codec|has no audio|no audio stream|does not contain audio|tunnel connection failed|unable to download webpage|unable to download (?:json|api|video)|ssl: certificate|certificate verify failed/i,
  },
];

const JSON_LINE = /^\{/;

/**
 * Convierte la salida (stderr y/o stdout) de yt-dlp en un codigo de error del contrato HTTP.
 * Las reglas se aplican solo sobre el mensaje de cada linea ERROR:/WARNING: una vez quitado el
 * prefijo "[extractor] id:" y las URLs, para que un slug como /timeout o /login no cambie el codigo.
 * Se evalua de la ultima linea a la primera (el veredicto final del extractor es el que cuenta).
 * Siempre devuelve un error; si nada coincide, INTERNAL con la ultima linea "ERROR:" como mensaje.
 */
export function mapYtdlpError(output: string, fallback = 'yt-dlp fallo'): DownloadError {
  const messages = candidateMessages(output);
  for (const message of messages) {
    const subject = message.replace(/https?:\/\/\S+/gi, '');
    for (const rule of RULES) {
      if (rule.pattern.test(subject)) {
        return new DownloadError(rule.code, message.slice(0, 300) || fallback);
      }
    }
  }
  return new DownloadError('INTERNAL', messages[0]?.slice(0, 300) ?? fallback);
}

/** Mensajes limpios de la salida, de la ultima linea relevante a la primera. */
function candidateMessages(output: string): string[] {
  const lines = (output || '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    // Las lineas JSON (metadata impresa en stdout) nunca describen el fallo.
    .filter((l) => l && !JSON_LINE.test(l));
  const tagged = lines.filter((l) => /^(?:ERROR|WARNING):/i.test(l) || /larger than max-filesize/i.test(l));
  const chosen = tagged.length ? tagged : lines.slice(-1);
  return chosen.map(cleanMessage).filter(Boolean).reverse();
}

/** Quita "ERROR:"/"WARNING:", "[download]" y el prefijo "[extractor] id:" de una linea de yt-dlp. */
export function cleanMessage(line: string): string {
  return line
    .trim()
    .replace(/^(?:ERROR|WARNING):\s*/i, '')
    .replace(/^\[download\]\s*/i, '')
    // El id del extractor generico es el ultimo segmento de la URL y puede contener cualquier cosa.
    .replace(/^\[[^\]]+\]\s*(?:\S+?:\s+)?/, '')
    // Coletillas de yt-dlp que no aportan nada al usuario del bot.
    .replace(/;?\s*please report this issue.*$/i, '')
    .replace(/\s*See\s+https?:\/\/github\.com\/yt-dlp\/yt-dlp\/wiki\S*.*$/i, '')
    .trim();
}

export function extractErrorLine(output: string): string | null {
  const messages = candidateMessages(output);
  return messages.length ? messages[0].slice(0, 300) : null;
}
