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
  | 'UNAUTHORIZED';

export const STATUS_BY_CODE: Record<ErrorCode, number> = {
  INVALID_URL: 400,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  TOO_LARGE: 413,
  UNSUPPORTED: 422,
  LOGIN_REQUIRED: 422,
  RATE_LIMITED: 429,
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

// El orden importa: la primera regla que coincide gana. Instagram, por ejemplo, mezcla
// "rate-limit reached or login required" en un mismo mensaje y lo util es pedir cookies.
const RULES: Rule[] = [
  { code: 'TOO_LARGE', pattern: /larger than max-filesize|file is larger than|exceeds maximum/i },
  { code: 'TIMEOUT', pattern: /timed? ?out|timeout|read operation timed/i },
  {
    code: 'LOGIN_REQUIRED',
    pattern:
      /login required|log ?in (?:to|is) |sign in to confirm|sign in to view|requires? authentication|not logged in|private video|this (?:video|post|tweet|account) is private|use --cookies|--cookies-from-browser|age[- ]restricted|confirm your age|members[- ]only|only available to (?:registered|logged)|nsfw tweet requires authentication|requested content is not available, rate-limit reached/i,
  },
  { code: 'RATE_LIMITED', pattern: /rate[- ]?limit|too many requests|http error 429|429 client error/i },
  {
    code: 'NOT_FOUND',
    pattern:
      /video unavailable|is unavailable|(?:video|page|user|tweet|post|content|media|account|playlist|item) not found|http error 404|http error 410|does not exist|has been removed|been deleted|no longer available|no video could be found|this content isn't available|no such user|could not be found/i,
  },
  {
    code: 'UNSUPPORTED',
    pattern:
      /unsupported url|no video formats found|requested format is not available|is not a valid url|unable to extract|no suitable (?:extractor|format)|only images|not a video|no media found|this tweet does not contain|does not contain any media|unable to recognize|no formats found/i,
  },
];

/**
 * Convierte la salida (stderr y/o stdout) de yt-dlp en un codigo de error del contrato HTTP.
 * Siempre devuelve un error; si nada coincide, INTERNAL con la ultima linea "ERROR:" como mensaje.
 */
export function mapYtdlpError(output: string, fallback = 'yt-dlp fallo'): DownloadError {
  const text = (output || '').replace(/\r/g, '\n');
  for (const rule of RULES) {
    if (rule.pattern.test(text)) {
      return new DownloadError(rule.code, extractErrorLine(text) ?? fallback);
    }
  }
  return new DownloadError('INTERNAL', extractErrorLine(text) ?? fallback);
}

export function extractErrorLine(output: string): string | null {
  const lines = output
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const errorLines = lines.filter((l) => /^(?:ERROR|WARNING):/i.test(l));
  const chosen = errorLines.length ? errorLines[errorLines.length - 1] : lines[lines.length - 1];
  if (!chosen) return null;
  // Se recorta el prefijo "ERROR: [extractor] id:" para dejar un mensaje legible al usuario.
  return chosen
    .replace(/^(?:ERROR|WARNING):\s*/i, '')
    .replace(/^\[[^\]]+\]\s*(?:[\w-]+:\s*)?/, '')
    .slice(0, 300);
}
