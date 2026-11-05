import { LIMITS, type EquipmentSlot } from '../constants/rpg.js';
import { FORGE_MATERIALS, ITEMS, LEGACY_MATERIAL_ITEMS, type Item, type ForgeMaterial } from '../types/rpg.js';
import type { InventoryItem, UserRPG } from '../types/user.js';
import { normalizeText } from './utils.js';

export const EQUIPMENT_SLOTS: EquipmentSlot[] = ['weapon', 'armor', 'accessory'];

export function isEquipable(item: Item): boolean {
  return item.type === 'weapon' || item.type === 'armor' || item.type === 'accessory';
}

/** Unidades totales en el inventario (suma de cantidades), que es lo que acota MAX_INVENTORY_SIZE */
export function inventorySize(user: UserRPG): number {
  if (!Array.isArray(user.inventory)) return 0;
  return user.inventory.reduce((sum, entry) => sum + Math.max(0, entry.quantity || 0), 0);
}

export function freeInventorySpace(user: UserRPG): number {
  return Math.max(0, LIMITS.MAX_INVENTORY_SIZE - inventorySize(user));
}

export function countItem(user: UserRPG, itemId: string): number {
  if (!Array.isArray(user.inventory)) return 0;
  return user.inventory.filter(i => i.itemId === itemId).reduce((sum, i) => sum + i.quantity, 0);
}

export type AddItemFailure = 'unknown' | 'invalid' | 'full';

export interface AddItemResult {
  ok: boolean;
  /** Unidades realmente añadidas (puede ser menor que qty si el inventario se llenó) */
  added: number;
  reason?: AddItemFailure;
}

/**
 * Añade un item al inventario respetando el tope. Los equipables con nivel de
 * forja > 0 son entradas únicas (no se apilan ni heredan el +N); se insertan
 * delante de las demás entradas del mismo item para que calculateTotalStats,
 * que toma la primera, lea el nivel de la pieza mejorada.
 */
export function addItem(
  user: UserRPG,
  itemId: string,
  qty: number = 1,
  opts: { enhanceLevel?: number } = {}
): AddItemResult {
  const item = ITEMS[itemId];
  if (!item) return { ok: false, added: 0, reason: 'unknown' };
  if (!Number.isFinite(qty) || qty < 1) return { ok: false, added: 0, reason: 'invalid' };
  if (!Array.isArray(user.inventory)) user.inventory = [];

  const wanted = Math.floor(qty);
  const added = Math.min(wanted, freeInventorySpace(user));
  if (added <= 0) return { ok: false, added: 0, reason: 'full' };

  const enhanceLevel = isEquipable(item) ? Math.max(0, Math.floor(opts.enhanceLevel || 0)) : 0;

  if (enhanceLevel > 0) {
    const firstSame = user.inventory.findIndex(i => i.itemId === itemId);
    const entries: InventoryItem[] = [];
    for (let i = 0; i < added; i++) entries.push({ itemId, quantity: 1, enhanceLevel });
    if (firstSame === -1) user.inventory.push(...entries);
    else user.inventory.splice(firstSame, 0, ...entries);
    return { ok: added === wanted, added, reason: added === wanted ? undefined : 'full' };
  }

  const stack = user.inventory.find(i => i.itemId === itemId && !(i.enhanceLevel && i.enhanceLevel > 0));
  if (stack) {
    stack.quantity += added;
  } else {
    user.inventory.push({ itemId, quantity: added });
  }
  return { ok: added === wanted, added, reason: added === wanted ? undefined : 'full' };
}

/**
 * Quita unidades de un item. Falla (sin tocar nada) si no hay suficientes.
 * Con enhanceLevel solo descuenta de las entradas con ese nivel exacto; sin él,
 * descuenta primero de las entradas sin mejorar y luego de las mejoradas.
 */
export function removeItem(
  user: UserRPG,
  itemId: string,
  qty: number = 1,
  opts: { enhanceLevel?: number } = {}
): boolean {
  if (!Number.isFinite(qty) || qty < 1 || !Array.isArray(user.inventory)) return false;
  const wanted = Math.floor(qty);

  const matches = (entry: InventoryItem): boolean => {
    if (entry.itemId !== itemId) return false;
    if (opts.enhanceLevel === undefined) return true;
    return (entry.enhanceLevel || 0) === opts.enhanceLevel;
  };

  const candidates = user.inventory
    .filter(matches)
    .sort((a, b) => (a.enhanceLevel || 0) - (b.enhanceLevel || 0));
  const available = candidates.reduce((sum, e) => sum + e.quantity, 0);
  if (available < wanted) return false;

  let remaining = wanted;
  for (const entry of candidates) {
    if (remaining <= 0) break;
    const take = Math.min(entry.quantity, remaining);
    entry.quantity -= take;
    remaining -= take;
  }
  user.inventory = user.inventory.filter(e => e.quantity > 0);
  return true;
}

/** Slot en el que está equipado el item, o null */
export function isEquipped(user: UserRPG, itemId: string): EquipmentSlot | null {
  const equipment = user.equipment;
  if (!equipment) return null;
  for (const slot of EQUIPMENT_SLOTS) {
    if (equipment[slot] === itemId) return slot;
  }
  return null;
}

/** Entrada del inventario que representa la pieza equipada (la de mayor nivel de forja) */
export function findEquippedEntry(user: UserRPG, slot: EquipmentSlot): InventoryItem | null {
  const itemId = user.equipment?.[slot];
  if (!itemId || !Array.isArray(user.inventory)) return null;
  let best: InventoryItem | null = null;
  for (const entry of user.inventory) {
    if (entry.itemId !== itemId) continue;
    if (!best || (entry.enhanceLevel || 0) > (best.enhanceLevel || 0)) best = entry;
  }
  return best;
}

export type ResolveResult<T> =
  | { status: 'found'; item: T }
  | { status: 'ambiguous'; candidates: T[] }
  | { status: 'none' };

interface Named {
  id: string;
  name: string;
}

/**
 * Busca un item por lo que escribió el jugador: coincidencia exacta de id o
 * nombre, luego "empieza por", luego "contiene" (todo sin tildes ni mayúsculas).
 * Si en el primer nivel con resultados hay más de un candidato distinto, devuelve
 * la lista para que el comando pregunte en vez de actuar.
 */
export function resolveItem<T extends Named>(term: string, candidates: readonly T[]): ResolveResult<T> {
  const query = normalizeText(term.trim()).replace(/\s+/g, ' ');
  if (!query) return { status: 'none' };
  const queryId = query.replace(/\s+/g, '_');

  const unique = new Map<string, T>();
  for (const c of candidates) if (!unique.has(c.id)) unique.set(c.id, c);
  const list = [...unique.values()];

  const levels: ((c: T) => boolean)[] = [
    c => c.id === queryId || normalizeText(c.name) === query,
    c => c.id.startsWith(queryId) || normalizeText(c.name).startsWith(query),
    c => c.id.includes(queryId) || normalizeText(c.name).includes(query)
  ];

  for (const matches of levels) {
    const found = list.filter(matches);
    if (found.length === 1) return { status: 'found', item: found[0] };
    if (found.length > 1) return { status: 'ambiguous', candidates: found };
  }
  return { status: 'none' };
}

/** Texto para responder cuando resolveItem devolvió varios candidatos */
export function formatAmbiguous(candidates: readonly { id: string; name: string; emoji?: string }[], hint: string = 'Escribe el nombre completo o el id'): string {
  const lines = candidates.slice(0, 8).map(c => `   • ${c.emoji ? c.emoji + ' ' : ''}${c.name} (\`${c.id}\`)`);
  const more = candidates.length > 8 ? `\n   _...y ${candidates.length - 8} más_` : '';
  return `🔎 Hay varios items que coinciden:\n${lines.join('\n')}${more}\n\n💡 ${hint}.`;
}

/** Items distintos presentes en el inventario (definición de ITEMS) */
export function inventoryItems(user: UserRPG): Item[] {
  if (!Array.isArray(user.inventory)) return [];
  const seen = new Set<string>();
  const out: Item[] = [];
  for (const entry of user.inventory) {
    if (seen.has(entry.itemId)) continue;
    const item = ITEMS[entry.itemId];
    if (!item) continue;
    seen.add(entry.itemId);
    out.push(item);
  }
  return out;
}

// ==================== MATERIALES DE FORJA ====================

export function getMaterialCount(user: UserRPG, materialId: string): number {
  const value = user.forgeMaterials?.[materialId];
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export function addMaterial(user: UserRPG, materialId: string, qty: number = 1): boolean {
  if (!FORGE_MATERIALS[materialId] || !Number.isFinite(qty) || qty < 1) return false;
  if (!user.forgeMaterials || typeof user.forgeMaterials !== 'object') user.forgeMaterials = {};
  user.forgeMaterials[materialId] = getMaterialCount(user, materialId) + Math.floor(qty);
  return true;
}

/** Quita materiales; falla sin tocar nada si no hay suficientes */
export function removeMaterial(user: UserRPG, materialId: string, qty: number = 1): boolean {
  if (!Number.isFinite(qty) || qty < 1) return false;
  const have = getMaterialCount(user, materialId);
  const wanted = Math.floor(qty);
  if (have < wanted) return false;
  const left = have - wanted;
  if (left > 0) user.forgeMaterials[materialId] = left;
  else delete user.forgeMaterials[materialId];
  return true;
}

export interface MaterialRequirement {
  materialId: string;
  quantity: number;
}

export interface MissingMaterial extends MaterialRequirement {
  have: number;
}

export function missingMaterials(user: UserRPG, required: readonly MaterialRequirement[]): MissingMaterial[] {
  const missing: MissingMaterial[] = [];
  for (const req of required) {
    const have = getMaterialCount(user, req.materialId);
    if (have < req.quantity) missing.push({ ...req, have });
  }
  return missing;
}

/** Consume todos los materiales o ninguno; devuelve false si falta alguno */
export function consumeMaterials(user: UserRPG, required: readonly MaterialRequirement[]): boolean {
  if (missingMaterials(user, required).length > 0) return false;
  for (const req of required) removeMaterial(user, req.materialId, req.quantity);
  return true;
}

/** Materiales que tiene el jugador, ordenados por rareza descendente */
export function listMaterials(user: UserRPG): { material: ForgeMaterial; quantity: number }[] {
  const order: Record<string, number> = { legendario: 0, epico: 1, raro: 2, comun: 3 };
  const out: { material: ForgeMaterial; quantity: number }[] = [];
  for (const id of Object.keys(user.forgeMaterials || {})) {
    const material = FORGE_MATERIALS[id];
    const quantity = getMaterialCount(user, id);
    if (material && quantity > 0) out.push({ material, quantity });
  }
  return out.sort((a, b) => (order[a.material.rarity] ?? 9) - (order[b.material.rarity] ?? 9) || a.material.name.localeCompare(b.material.name));
}

export type LootKind = 'item' | 'material' | 'unknown' | 'full';

/**
 * Entrega un drop: si es un item va al inventario, si es un material va a
 * forgeMaterials. Devuelve dónde acabó (o por qué no).
 */
export function addLoot(user: UserRPG, id: string, qty: number = 1): LootKind {
  if (ITEMS[id]) {
    const result = addItem(user, id, qty);
    return result.added > 0 ? 'item' : 'full';
  }
  if (FORGE_MATERIALS[id]) {
    return addMaterial(user, id, qty) ? 'material' : 'unknown';
  }
  return 'unknown';
}

/** Nombre con emoji de un item o material, para listas de botín */
export function lootLabel(id: string): string {
  const def = ITEMS[id] ?? FORGE_MATERIALS[id];
  return def ? `${def.emoji} ${def.name}` : id;
}

/**
 * Mueve al almacén de materiales las entradas del inventario que eran items de
 * tipo material (hierro, oro_material...). Devuelve true si cambió algo.
 */
export function migrateLegacyMaterials(user: UserRPG): boolean {
  if (!Array.isArray(user.inventory)) return false;
  let changed = false;
  const kept: InventoryItem[] = [];
  for (const entry of user.inventory) {
    const materialId = LEGACY_MATERIAL_ITEMS[entry.itemId];
    if (materialId && !ITEMS[entry.itemId]) {
      if (entry.quantity > 0) addMaterial(user, materialId, entry.quantity);
      changed = true;
      continue;
    }
    kept.push(entry);
  }
  if (changed) user.inventory = kept;
  return changed;
}
