/**
 * @deprecated El modo compacto es un interruptor de group-toggles.ts
 * (compactPlugin). Este archivo solo existe para que plugins/index.ts compile
 * hasta que su dueño use TOGGLE_ENTRIES; entonces debe borrarse.
 */

import type { MessageHandler } from '../handler.js';
import { compactPlugin } from './group-toggles.js';

/** @deprecated Registrar compactPlugin desde ENTRIES.grupos. */
export function registerGroupCompactPlugin(handler: MessageHandler): void {
  handler.registerPlugin('group-compact', compactPlugin);
}
