/**
 * Estado observable del proceso para /botstats y /logs: reconexiones, errores
 * y las últimas líneas warn/error del logger. Vive aparte de index.ts para que
 * los plugins no importen el punto de entrada.
 */

export interface RuntimeStats {
  startedAt: number;
  /** Reconexiones completadas (socket abierto de nuevo). */
  reconnects: number;
  /** Intentos de reconexión programados, incluidos los fallidos. */
  reconnectAttempts: number;
  errors: number;
  lastErrorAt: number | null;
  lastError: string | null;
}

export const runtimeStats: RuntimeStats = {
  startedAt: Date.now(),
  reconnects: 0,
  reconnectAttempts: 0,
  errors: 0,
  lastErrorAt: null,
  lastError: null,
};

export function recordReconnectAttempt(): void {
  runtimeStats.reconnectAttempts++;
}

/** Llamar cuando la conexión vuelve a abrirse tras una caída. */
export function recordReconnect(): void {
  runtimeStats.reconnects++;
}

export function recordError(error: unknown, scope = 'bot'): void {
  const message = error instanceof Error ? error.message : String(error);
  runtimeStats.errors++;
  runtimeStats.lastErrorAt = Date.now();
  runtimeStats.lastError = message;
  recordLogLine('error', scope, message);
}

export type BufferedLevel = 'warn' | 'error';

export interface LogLine {
  at: number;
  level: BufferedLevel;
  scope: string;
  message: string;
}

export const LOG_BUFFER_SIZE = 200;

const logBuffer: LogLine[] = [];

const MAX_LINE_LENGTH = 600;

/**
 * Deja el mensaje apto para mandarlo por WhatsApp con /logs: sin pilas de
 * llamadas (traen rutas absolutas del servidor), en una sola línea y acotado.
 */
export function sanitizeLogMessage(message: string): string {
  const flat = message
    .split('\n')
    .filter((line) => !/^\s+at\s/.test(line))
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' | ');
  return flat.length > MAX_LINE_LENGTH ? `${flat.slice(0, MAX_LINE_LENGTH - 3)}...` : flat;
}

/** Buffer circular con las últimas líneas warn/error; logger.write debe llamarlo. */
export function recordLogLine(level: BufferedLevel, scope: string, message: string): void {
  logBuffer.push({ at: Date.now(), level, scope, message: sanitizeLogMessage(message) });
  if (logBuffer.length > LOG_BUFFER_SIZE) logBuffer.splice(0, logBuffer.length - LOG_BUFFER_SIZE);
}

/** Últimas `limit` líneas, de la más antigua a la más reciente. */
export function getRecentLogLines(limit = LOG_BUFFER_SIZE): LogLine[] {
  const n = Math.max(0, Math.min(limit, logBuffer.length));
  return logBuffer.slice(logBuffer.length - n);
}

export function formatLogLine(line: LogLine): string {
  const time = new Date(line.at).toLocaleTimeString('es-MX', { hour12: false });
  return `${time} ${line.level.padEnd(5)} ${line.scope} ${line.message}`;
}

/** Vacía contadores y buffer; pensado para pruebas. */
export function resetRuntimeStats(): void {
  runtimeStats.startedAt = Date.now();
  runtimeStats.reconnects = 0;
  runtimeStats.reconnectAttempts = 0;
  runtimeStats.errors = 0;
  runtimeStats.lastErrorAt = null;
  runtimeStats.lastError = null;
  logBuffer.length = 0;
}
