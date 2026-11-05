import type { MessageHandler } from '../handler.js';
import type { PluginHandler } from '../types/message.js';
import { atacarPlugin } from './rpg-atacar.js';
import { dueloPlugin, aceptarPlugin, rechazarPlugin, duelContext } from './rpg-duelo.js';
import { bombardearPlugin, pagarDeudaPlugin, verDeudaPlugin } from './rpg-bombardear.js';
import { dungeonPlugin } from './rpg-dungeon.js';
import { dungeonContext, startDungeonCleanup } from './rpg-dungeon-interactivo.js';
import { forjaMenuPlugin, forgeContext } from './rpg-forja.js';
import { inventoryPlugins } from './rpg-inventario.js';
import { shopPlugins } from './rpg-tienda.js';
import { bossPlugins } from './rpg-boss.js';
import { ownerRpgEntries } from './owner-rpg.js';

/**
 * Plugins globales del área de combate e items, en el orden en que deben
 * registrarse (gana el primero cuando dos comparten alias).
 */
export const combatEntries: [string, PluginHandler][] = [
  ...inventoryPlugins,
  ...shopPlugins,
  ['rpg-atacar', atacarPlugin],
  ['rpg-duelo', dueloPlugin],
  ['rpg-aceptar', aceptarPlugin],
  ['rpg-rechazar', rechazarPlugin],
  ['rpg-bombardear', bombardearPlugin],
  ['rpg-pagardeuda', pagarDeudaPlugin],
  ['rpg-verdeuda', verDeudaPlugin],
  ['rpg-dungeon', dungeonPlugin],
  ['rpg-forja', forjaMenuPlugin],
  ...bossPlugins,
  ...ownerRpgEntries
];

/**
 * Registra los plugins globales del área y los contextos de juego (duelo,
 * dungeon, confirmación de forja), que tienen prioridad y aceptan texto sin
 * prefijo mientras estén activos. Sección para plugins/index.ts:
 * `{ category: 'rpg-combate', register: registerCombatContexts }`.
 */
export function registerCombatContexts(handler: MessageHandler): void {
  for (const [name, plugin] of combatEntries) handler.registerPlugin(name, plugin);
  handler.registerContext(duelContext);
  handler.registerContext(dungeonContext);
  handler.registerContext(forgeContext);
  startDungeonCleanup();
}
