import type { LogLevel } from './config.js';

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

let current: LogLevel = 'info';

export function setLogLevel(level: LogLevel): void {
  current = level;
}

function formatFields(fields?: Record<string, unknown>): string {
  if (!fields) return '';
  const parts: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    // Las comillas solo hacen falta si el valor tiene espacios, para que la linea siga siendo parseable.
    parts.push(`${key}=${/\s/.test(text) ? JSON.stringify(text) : text}`);
  }
  return parts.length ? ' ' + parts.join(' ') : '';
}

function write(level: LogLevel, message: string, fields?: Record<string, unknown>): void {
  if (LEVELS[level] < LEVELS[current]) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${message}${formatFields(fields)}`;
  if (level === 'error' || level === 'warn') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
}

export const log = {
  debug: (message: string, fields?: Record<string, unknown>) => write('debug', message, fields),
  info: (message: string, fields?: Record<string, unknown>) => write('info', message, fields),
  warn: (message: string, fields?: Record<string, unknown>) => write('warn', message, fields),
  error: (message: string, fields?: Record<string, unknown>) => write('error', message, fields),
};
