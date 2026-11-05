/**
 * Logger mínimo para consola. Sin dependencias extra: pino ya se usa en modo
 * silencioso para Baileys y su salida JSON no sirve para leer en una terminal.
 *
 * Nivel por LOG_LEVEL (debug | info | warn | error). Por defecto info.
 */

import chalk from 'chalk';
import { recordLogLine } from './runtime-stats.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function resolveLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL || 'info').toLowerCase();
  return raw in LEVELS ? (raw as LogLevel) : 'info';
}

let currentLevel: LogLevel = resolveLevel();

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

function timestamp(): string {
  return new Date().toLocaleTimeString('es-MX', { hour12: false });
}

function format(value: unknown): string {
  if (value instanceof Error) return value.stack || value.message;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

const PAINT: Record<LogLevel, (s: string) => string> = {
  debug: chalk.gray,
  info: chalk.cyan,
  warn: chalk.yellow,
  error: chalk.red,
};

function write(level: LogLevel, scope: string, parts: unknown[]): void {
  if (LEVELS[level] < LEVELS[currentLevel]) return;
  const message = parts.map(format).join(' ');
  // El buffer de /logs se manda por WhatsApp: sin colores.
  if (level === 'warn' || level === 'error') recordLogLine(level, scope, message);
  const line = `${chalk.gray(timestamp())} ${PAINT[level](level.padEnd(5))} ${chalk.white(scope)} ${message}`;
  if (level === 'error') console.error(line);
  else console.log(line);
}

export interface Logger {
  debug: (...parts: unknown[]) => void;
  info: (...parts: unknown[]) => void;
  warn: (...parts: unknown[]) => void;
  error: (...parts: unknown[]) => void;
}

export function createLogger(scope: string): Logger {
  return {
    debug: (...parts) => write('debug', scope, parts),
    info: (...parts) => write('info', scope, parts),
    warn: (...parts) => write('warn', scope, parts),
    error: (...parts) => write('error', scope, parts),
  };
}

export const log = createLogger('bot');
